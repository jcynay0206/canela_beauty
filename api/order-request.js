const Stripe = require("stripe");
const { db } = require("./_firebase");
const { rateLimit } = require("./_ratelimit");

// POST /api/order-request
// Endpoint público (lo llama el cliente desde su cuenta) — protegido por
// rate limit en vez de token de admin. Verifica que el email coincida con
// el de la orden en Stripe antes de guardar nada.
//
// Body: { orderId, email, type: 'cancel'|'damaged'|'other', reason, evidenceUrl }
//
// Política de venta final (labiales):
//  - 'cancel'  → SOLO si la orden todavía no tiene shipping label
//                (orders/{orderId}.trackingNumber). Antes de enviarse,
//                cancelar = reembolso completo.
//  - 'damaged' → SOLO si la orden YA fue enviada. Es la única razón de
//                reembolso válida después del envío, y requiere foto de
//                evidencia (evidenceUrl, subida antes vía
//                /api/upload-evidence) + una descripción del daño.
//  - 'other'   → siempre permitido, para preguntas generales que no
//                necesariamente implican reembolso.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

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
      if (!evidenceUrl) {
        return res.status(400).json({ error: "Please upload a photo showing the damage before submitting." });
      }
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
      ${request.reason ? `<tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;vertical-align:top;${evidenceUrl ? 'border-bottom:1px solid rgba(92,26,36,.08);' : ''}">Message</td><td style="font-size:13px;color:#5C1A24;padding:8px 0;${evidenceUrl ? 'border-bottom:1px solid rgba(92,26,36,.08);' : ''}">${request.reason}</td></tr>` : ""}
      ${evidenceUrl ? `<tr><td style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(92,26,36,.45);padding:8px 0;">Evidence</td><td style="padding:8px 0;"><a href="${evidenceUrl}" style="color:#B8943C;">View Photo →</a></td></tr>` : ""}
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
    console.error("order-request error:", err.message);
    return res.status(500).json({ error: "Could not submit your request. Please try again or contact us directly." });
  }
};
