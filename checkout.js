module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

    // ── SHIPPING CALCULATION ──────────────────────────────
    const subtotal    = items.reduce((s, i) => s + (i.price * i.qty), 0);
    const totalWeight = items.reduce((s, i) => s + ((i.weight || 0.3) * i.qty), 0); // oz
    const totalQty    = items.reduce((s, i) => s + i.qty, 0);
    const needsBox    = items.some(i => i.packaging === 'box') || totalQty > 3;
    const freeShipping = subtotal >= 50;

    // Determine shipping rates
    let stdLabel, stdPrice, expPrice;

    if(needsBox){
      if(totalWeight <= 8){
        stdLabel = 'Standard Shipping (5–7 business days)';
        stdPrice = 799;  // $7.99
      } else if(totalWeight <= 16){
        stdLabel = 'Standard Shipping (5–7 business days)';
        stdPrice = 899;  // $8.99
      } else {
        stdLabel = 'Standard Shipping (3–5 business days)';
        stdPrice = 1299; // $12.99
      }
      expPrice = 1499; // $14.99 express for boxes
    } else {
      // Bubble mailer — always $5.99
      stdLabel = 'Standard Shipping (5–7 business days)';
      stdPrice = 599;  // $5.99
      expPrice = 999;  // $9.99 express
    }

    const origin = "https://jonarabeauty.vercel.app";
    const params = new URLSearchParams();

    params.append("mode", "payment");
    params.append("allow_promotion_codes", "true");
    params.append("success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${origin}/cancel.html`);
    params.append("shipping_address_collection[allowed_countries][0]", "US");

    // Line items
    items.forEach((item, i) => {
      params.append(`line_items[${i}][price_data][currency]`, "usd");
      params.append(`line_items[${i}][price_data][product_data][name]`, item.name);
      params.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(item.price * 100)));
      params.append(`line_items[${i}][quantity]`, String(item.qty));
    });

    // Shipping options
    if (freeShipping) {
      // Free standard
      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]",
        needsBox ? "Free Shipping — Box (5–7 days)" : "Free Shipping — Bubble Mailer (5–7 days)");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
      // Express still charged
      params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[1][shipping_rate_data][display_name]",
        `Express Shipping (2–3 days)`);
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][amount]", String(expPrice));
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][currency]", "usd");
    } else {
      // Standard paid
      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]", stdLabel);
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(stdPrice));
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");
      // Express
      params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[1][shipping_rate_data][display_name]",
        `Express Shipping (2–3 days)`);
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
