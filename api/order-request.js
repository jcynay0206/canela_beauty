const Stripe = require("stripe");
const { db } = require("./_firebase");
const { rateLimit } = require("./_ratelimit");
const { requireAdmin } = require("./_auth");

// POST /api/order-request
//
// Dos acciones en un mismo endpoint (mismo patrón que /api/admin-auth) —
// consolidado para no pasar el límite de 12 Serverless Functions del plan
// gratuito de Vercel.
//
//  action: 'submit' (default si se omite, para compatibilidad)
//    Público — lo llama el cliente desde su cuenta. Protegido por rate
//    limit en vez de token de admin. Verifica que el email coincida con
//    el de la orden en Stripe antes de guardar nada.
//    Body: { orderId, email, type: 'cancel'|'damaged'|'other', reason }
//
//    Política de venta final (labiales):
//     - 'cancel'  → SOLO si la orden todavía no tiene shipping label
//                   (orders/{orderId}.trackingNumber). Antes de enviarse,
//                   cancelar = reembolso completo.
//     - 'damaged' → SOLO si la orden YA fue enviada. Es la única razón de
//                   reembolso válida después del envío, y requiere una
//                   descripción. La foto de evidencia se pide por
//                   WhatsApp (no se sube en el sitio — requeriría
//                   Firebase Storage en plan Blaze).
//     - 'other'   → siempre permitido, para preguntas generales.
//
//  action: 'resolve'
//    Solo admin (x-admin-token). Marca una solicitud como resuelta con un
//    resultado específico — nunca un "resuelto" ambiguo — y le manda un
//    email al cliente confirmando exactamente qué pasó. No procesa el
//    reembolso en sí — eso se hace manualmente en el Dashboard de Stripe,
//    a propósito, para que siempre haya revisión humana antes de que
//    salga dinero real.
//    Body: { orderId, resolution: 'refunded'|'denied'|'resolved', adminNote? }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = req.body?.action || "submit";

  if (action === "resolve") {
    return handleResolve(req, res);
  }
  return handleSubmit(req, res);
};

// Devuelve al inventario las unidades de una orden cancelada — el reflejo
// exacto de la resta que hace stripe-webhook.js al confirmarse la compra.
// Solo se llama para cancelaciones reembolsadas ANTES del envío: el
// producto físico nunca salió de la tienda, así que vuelve a estar
// disponible para vender. No aplica a "damaged" (ese producto ya se
// envió y no vuelve al inventario).
async function restoreStock(orderId) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const lineItems = await stripe.checkout.sessions.listLineItems(orderId, { limit: 100 });

    const catalogSnap = await db.doc("catalog/products").get();
    if (!catalogSnap.exists) return;

    const products = catalogSnap.data().items || [];
    let changed = false;

    lineItems.data.forEach(li => {
      const productName = li.description?.split(" —")[0]?.split(" - ")[0]?.trim();
      const qty = li.quantity || 1;
      const idx = products.findIndex(p => p.name?.toLowerCase() === productName?.toLowerCase());

      if (idx >= 0 && products[idx].stock !== null && products[idx].stock !== undefined) {
        products[idx].stock = (products[idx].stock || 0) + qty;
        if (products[idx].stock > 0) products[idx].soldOut = false;
        changed = true;
      }
    });

    if (changed) {
      await db.doc("catalog/products").set(
        { items: products, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      console.log("Stock restored for cancelled order:", orderId);
    }
  } catch (err) {
    // No fallar la resolución de la solicitud si el stock no se pudo
    // restaurar — el admin puede ajustarlo manualmente en Inventory.
    console.error("Stock restore error (non-fatal):", err.message);
  }
}

async function handleResolve(req, res) {
  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const { orderId, resolution, adminNote } = req.body || {};
  if (!orderId || !["refunded", "denied", "resolved", "replaced"].includes(resolution)) {
    return res.status(400).json({ error: "Missing orderId or invalid resolution" });
  }

  try {
    const orderRef  = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    const existing  = orderSnap.exists ? orderSnap.data() : {};
    const existingRequest = existing.request || {};

    // Si se cancela y reembolsa una orden (antes de enviarse), el producto
    // nunca salió de la tienda — se devuelve al inventario. Se protege
    // contra restaurar dos veces si el admin resuelve la misma solicitud
    // más de una vez (ej. reabrir por error).
    const shouldRestoreStock =
      resolution === "refunded" &&
      existingRequest.type === "cancel" &&
      !existingRequest.stockRestored;

    if (shouldRestoreStock) {
      await restoreStock(orderId);
    }

    const updatedRequest = {
      ...existingRequest,
      status: "resolved",
      resolution,
      adminNote: adminNote || null,
      resolvedAt: new Date().toISOString(),
      stockRestored: existingRequest.stockRestored || shouldRestoreStock,
    };

    await orderRef.set({ request: updatedRequest, updatedAt: new Date().toISOString() }, { merge: true });

    // ── Avisar al cliente por email con el resultado exacto ─────────
    // Para que nunca se quede solo con un "resuelto" ambiguo — le decimos
    // explícitamente si se le reembolsó, se le negó, o qué pasó.
    const brevoKey       = process.env.BREVO_API_KEY;
    const fromEmail      = process.env.FROM_EMAIL || "jcnay157@gmail.com";
    const customerEmail  = existingRequest.email;
    const shortId        = orderId.slice(-8).toUpperCase();
    const typeLabel      = { cancel: "cancellation", damaged: "damaged product", other: "support" }[existingRequest.type] || "request";

    if (brevoKey && customerEmail) {
      const outcomeText = {
        refunded: existingRequest.type === "cancel"
          ? "Your order has been cancelled and your payment has been refunded."
          : "Your refund has been processed.",
        replaced: "We're sending you a replacement at no extra cost — no need to send anything back. You'll get a new tracking number shortly.",
        denied: "After review, we're unable to approve this request.",
        resolved: "Your request has been addressed.",
      }[resolution];

      try {
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: { name: "Jonara Beauty", email: fromEmail },
            to: [{ email: customerEmail }],
            subject: `Update on your ${typeLabel} request — Order #${shortId}`,
            htmlContent: `
<div style="font-family:Georgia,serif;max-width:480px;margin:20px auto;background:#FDF9F7;border:1px solid rgba(92,26,36,0.12);border-radius:4px;overflow:hidden;">
  <div style="background:#5C1A24;padding:20px 28px;">
    <p style="color:#FAF6EF;font-size:16px;font-weight:300;letter-spacing:4px;text-transform:uppercase;margin:0;">Order #${shortId}</p>
  </div>
  <div style="padding:24px 28px;">
    <p style="font-size:14px;color:#5C1A24;line-height:1.7;margin:0 0 16px;">${outcomeText}</p>
    ${adminNote ? `<p style="font-size:13px;color:rgba(92,26,36,.7);line-height:1.6;background:#FBF6F1;border-radius:2px;padding:12px 14px;margin:0;">"${adminNote}"</p>` : ""}
    <div style="margin-top:20px;">
      <a href="https://jonarabeauty.vercel.app/account" style="display:inline-block;background:#5C1A24;color:#FAF6EF;padding:11px 24px;text-decoration:none;font-size:10px;letter-spacing:2px;text-transform:uppercase;border-radius:2px;">View Order →</a>
    </div>
  </div>
</div>`,
          }),
        });
      } catch (emailErr) {
        console.error("Customer resolution email failed (non-fatal):", emailErr.message);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("order-request (resolve) error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function handleSubmit(req, res) {
  const rl = await rateLimit(req, { action: "order-request", maxAttempts: 10, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const { orderId, email, type, reason, evidenceUrl } = req.body || {};

  if (!orderId || !email || !type) {
    return res.status(400).json({ error: "Missing orderId, email or type" });
  }
  if (!["cancel", "damaged", "other"].includes(type)) {
    return res.status(400).json({ error: "Invalid request type" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // Verificar que la orden existe y que el email coincide con el del
    // pago original.
    const session = await stripe.checkout.sessions.retrieve(orderId).catch(() => null);
    if (!session || session.payment_status !== "paid") {
      return res.status(404).json({ error: "Order not found" });
    }
    if ((session.customer_details?.email || "").toLowerCase() !== String(email).toLowerCase()) {
      return res.status(403).json({ error: "Email does not match this order" });
    }

    const orderRef  = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    const existing  = orderSnap.exists ? orderSnap.data() : {};
    const alreadyShipped = Boolean(existing.trackingNumber);

    // ── Política de venta final ─────────────────────────────────
    if (type === "cancel" && alreadyShipped) {
      return res.status(400).json({
        error: "This order has already shipped and can no longer be cancelled. Per our final sale policy, lip glosses can only be refunded if the product arrives damaged — please select \"Product Arrived Damaged\" instead.",
      });
    }
    if (type === "damaged") {
      if (!alreadyShipped) {
        return res.status(400).json({
          error: "This order hasn't shipped yet, so there's no product to inspect. Did you mean to cancel this order instead?",
        });
      }
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({ error: "Please describe the damage (at least a few words)." });
      }
      // La evidencia fotográfica ya no se sube en el sitio (requeriría
      // Firebase Storage en plan Blaze) — el cliente la manda por
      // WhatsApp en su lugar. Ver nota en el email al admin más abajo.
    }

    // No permitir duplicar una solicitud mientras haya una pendiente
    if (existing.request?.status === "pending") {
      return res.status(400).json({ error: "You already have a pending request for this order." });
    }

    const request = {
      type,
      reason: String(reason || "").slice(0, 1000),
      evidenceUrl: type === "damaged" ? evidenceUrl : null,
      email,
      requestedAt: new Date().toISOString(),
      status: "pending",
    };

    await orderRef.set({ request, updatedAt: new Date().toISOString() }, { merge: true });

    // ── Notificar al admin por email ──────────────────────────────
    const brevoKey   = process.env.BREVO_API_KEY;
    const fromEmail  = process.env.FROM_EMAIL  || "jcnay157@gmail.com";
    const adminEmail = process.env.ADMIN_EMAIL || fromEmail;
    const customerName = session.shipping_details?.name || session.customer_details?.name || "Customer";
    const shortId    = orderId.slice(-8).toUpperCase();
    const typeLabel  = { cancel: "Cancellation", damaged: "Damaged Product", other: "Support" }[type];

    if (brevoKey) {
      try {
        await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": brevoKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: { name: "Jonara Beauty Orders", email: fromEmail },
            to: [{ email: adminEmail }],
            subject: `⚠ ${typeLabel} Request — Order #${shortId}`,
            htmlContent: `
<div style="font-family:Georgia,serif;max-width:480px;margin:20px auto;background:#FDF9F7;border:1px solid rgba(92,26,36,0.12);border-radius:4px;overflow:hidden;">
  <div style="background:#5C1A24;padding:20px 28px;">
    <p style="color:#FAF6EF;font-size:16px;font-weight:300;letter-spacing:4px;text-transform:uppercase;margin:0;">⚠ ${typeLabel} Requested</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">Order</td><td style="font-size:13px;color:#5C1A24;font-weight:500;padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">#${shortId}</td></tr>
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">Customer</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">${customerName}</td></tr>
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">Email</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;border-bottom:1px solid rgba(92,26,36,.08);">${email}</td></tr>
      <tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;${request.reason ? 'border-bottom:1px solid rgba(92,26,36,.08);' : ''}">Type</td><td style="font-size:13px;color:#B8943C;font-weight:500;padding:8px 0;${request.reason ? 'border-bottom:1px solid rgba(92,26,36,.08);' : ''}">${typeLabel}</td></tr>
      ${request.reason ? `<tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;vertical-align:top;${type === 'damaged' ? 'border-bottom:1px solid rgba(92,26,36,.08);' : ''}">Message</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;${type === 'damaged' ? 'border-bottom:1px solid rgba(92,26,36,.08);' : ''}">${request.reason}</td></tr>` : ""}
      ${type === "damaged" ? `<tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;">Evidence</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;">📷 Check WhatsApp — customer was asked to send a photo there</td></tr>` : ""}
    </table>
    <div style="margin-top:20px;">
      <a href="https://jonarabeauty.vercel.app/admin" style="display:inline-block;background:#5C1A24;color:#FAF6EF;padding:11px 24px;text-decoration:none;font-size:10px;letter-spacing:2px;text-transform:uppercase;border-radius:2px;">Review in Admin →</a>
    </div>
  </div>
</div>`,
          }),
        });
      } catch (emailErr) {
        console.error("Admin notification email failed (non-fatal):", emailErr.message);
      }
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error("order-request (submit) error:", err.message);
    return res.status(500).json({ error: "Could not submit your request. Please try again or contact us directly." });
  }
}
