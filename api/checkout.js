const { db } = require("./_firebase");

// POST /api/checkout
//
// Crea la sesión de Stripe Checkout. El precio, peso y tipo de empaque de
// cada línea se buscan en el catálogo real (catalog/products, Firestore)
// por nombre — NUNCA se confía en esos valores si vienen del navegador.
// Antes de este fix, el cliente podía mandar cualquier precio (y el peso
// también se usaba para calcular envío sin verificar).
//
// Envío dinámico: caja vs sobre acolchado, con tarifas escalonadas por
// peso total cuando se necesita caja.

const MAX_QTY_PER_ITEM = 50; // límite anti-abuso, no un límite de negocio real

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://jonarabeauty-azuregs.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return res.status(500).json({ error: "Stripe key not configured" });

  try {
    let body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
    if (!body) body = {};

    const { items, customerEmail } = body;
    if (!items || !items.length) return res.status(400).json({ error: "No items" });

    // ── Verificar cada item contra el catálogo real ──────────────────
    const catalogSnap = await db.doc("catalog/products").get();
    if (!catalogSnap.exists) {
      return res.status(500).json({ error: "Catalog not available" });
    }
    const catalog = catalogSnap.data().items || [];

    const verifiedItems = [];
    for (const item of items) {
      const qty = parseInt(item.qty, 10);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_ITEM) {
        return res.status(400).json({ error: `Invalid quantity for "${item.name || "item"}"` });
      }

      const name = String(item.name || "").trim();
      const product = catalog.find(p => p.name?.toLowerCase() === name.toLowerCase());

      if (!product) {
        return res.status(400).json({ error: `"${name}" is no longer available` });
      }
      if (product.soldOut) {
        return res.status(400).json({ error: `"${product.name}" is sold out` });
      }
      if (product.stock !== null && product.stock !== undefined && product.stock < qty) {
        return res.status(400).json({ error: `Not enough stock for "${product.name}"` });
      }

      // Precio, peso y empaque SIEMPRE salen del catálogo — lo que mande
      // el navegador se ignora por completo.
      verifiedItems.push({
        name: product.name,
        price: product.price,
        qty,
        weight: product.weight || 0.3,
        packaging: product.packaging || "envelope",
      });
    }

    // ── Cálculo de envío ──────────────────────────────────────────────
    const subtotal    = verifiedItems.reduce((s, i) => s + (i.price * i.qty), 0);
    const totalWeight = verifiedItems.reduce((s, i) => s + (i.weight * i.qty), 0); // oz
    const totalQty     = verifiedItems.reduce((s, i) => s + i.qty, 0);
    const needsBox     = verifiedItems.some(i => i.packaging === "box") || totalQty > 3;
    const freeShipping = subtotal >= 50;

    let stdLabel, stdPrice, expPrice;
    if (needsBox) {
      if (totalWeight <= 8) {
        stdLabel = "Standard Shipping (5–7 business days)";
        stdPrice = 799; // $7.99
      } else if (totalWeight <= 16) {
        stdLabel = "Standard Shipping (5–7 business days)";
        stdPrice = 899; // $8.99
      } else {
        stdLabel = "Standard Shipping (3–5 business days)";
        stdPrice = 1299; // $12.99
      }
      expPrice = 1499; // $14.99 express para cajas
    } else {
      // Sobre acolchado — siempre $5.99
      stdLabel = "Standard Shipping (5–7 business days)";
      stdPrice = 599; // $5.99
      expPrice = 999; // $9.99 express
    }

    const origin = "https://jonarabeauty-azuregs.vercel.app";
    const params = new URLSearchParams();

    params.append("mode", "payment");
    params.append("allow_promotion_codes", "true");
    params.append("success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${origin}/cancel.html`);
    params.append("shipping_address_collection[allowed_countries][0]", "US");

    verifiedItems.forEach((item, i) => {
      params.append(`line_items[${i}][price_data][currency]`, "usd");
      params.append(`line_items[${i}][price_data][product_data][name]`, item.name);
      params.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(item.price * 100)));
      params.append(`line_items[${i}][quantity]`, String(item.qty));
    });

    if (freeShipping) {
      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]",
        needsBox ? "Free Shipping — Box (5–7 days)" : "Free Shipping — Bubble Mailer (5–7 days)");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

      params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[1][shipping_rate_data][display_name]", "Express Shipping (2–3 days)");
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][amount]", String(expPrice));
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][currency]", "usd");
    } else {
      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]", stdLabel);
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(stdPrice));
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

      params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[1][shipping_rate_data][display_name]", "Express Shipping (2–3 days)");
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][amount]", String(expPrice));
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][currency]", "usd");
    }

    if (customerEmail) params.append("customer_email", customerEmail);

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Stripe error:", JSON.stringify(data.error));
      return res.status(500).json({ error: data.error?.message || "Stripe error" });
    }

    return res.status(200).json({ url: data.url });

  } catch (err) {
    console.error("Handler error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
