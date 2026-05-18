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

    const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const freeShipping = subtotal >= 25;

    const origin = "https://canelabeauty.vercel.app";
    const params = new URLSearchParams();

    params.append("mode", "payment");
    params.append("allow_promotion_codes", "true");
    params.append("success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `${origin}/cancel.html`);
    params.append("shipping_address_collection[allowed_countries][0]", "US");

    items.forEach((item, i) => {
      params.append(`line_items[${i}][price_data][currency]`, "usd");
      params.append(`line_items[${i}][price_data][product_data][name]`, item.name);
      params.append(`line_items[${i}][price_data][unit_amount]`, String(Math.round(item.price * 100)));
      params.append(`line_items[${i}][quantity]`, String(item.qty));
    });

    if (freeShipping) {
      // $25+ → free standard + paid express
      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]", "Free Standard Shipping (5-7 days)");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "0");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

      params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[1][shipping_rate_data][display_name]", "Express Shipping (2-3 days)");
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][amount]", "1299");
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][currency]", "usd");
    } else {
      // Under $25 → only paid options, no free shipping available
      params.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[0][shipping_rate_data][display_name]", "Standard Shipping (5-7 days)");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", "599");
      params.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "usd");

      params.append("shipping_options[1][shipping_rate_data][type]", "fixed_amount");
      params.append("shipping_options[1][shipping_rate_data][display_name]", "Express Shipping (2-3 days)");
      params.append("shipping_options[1][shipping_rate_data][fixed_amount][amount]", "1299");
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
