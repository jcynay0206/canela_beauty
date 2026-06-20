// GET /api/orders
// Lee las últimas 50 sesiones de Stripe pagadas y las enriquece con los
// shipping_details de cada sesión (fetch individual, ya que Stripe no
// permite expandir shipping_details en list()).

const Stripe = require("stripe");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  try {
    // 1. Listar sesiones pagadas — sin expandir shipping_details aquí
    //    porque Stripe no lo permite en list(), solo en retrieve()
    const sessions = await stripe.checkout.sessions.list({
      limit: 50,
      expand: ["data.line_items"],
    });

    const paid = sessions.data.filter(s => s.payment_status === "paid");

    // 2. Para cada sesión, hacer retrieve() para obtener shipping_details
    //    Usamos Promise.all para hacerlo en paralelo y no tardar mucho
    const detailed = await Promise.all(
      paid.map(s =>
        stripe.checkout.sessions.retrieve(s.id, {
          expand: ["line_items", "shipping_details"],
        }).catch(() => s) // si falla, usar lo que ya teníamos
      )
    );

    const orders = detailed.map(s => ({
      id:            s.id,
      customerName:  s.shipping_details?.name || s.customer_details?.name || "—",
      email:         s.customer_details?.email || "—",
      phone:         s.customer_details?.phone || "",
      street1:       s.shipping_details?.address?.line1 || "",
      street2:       s.shipping_details?.address?.line2 || "",
      city:          s.shipping_details?.address?.city  || "",
      state:         s.shipping_details?.address?.state || "",
      zip:           s.shipping_details?.address?.postal_code || "",
      country:       s.shipping_details?.address?.country || "US",
      total:         (s.amount_total / 100).toFixed(2),
      currency:      (s.currency || "usd").toUpperCase(),
      items:         (s.line_items?.data || []).map(i => ({
                       name: i.description,
                       qty:  i.quantity,
                     })),
      createdAt:     new Date(s.created * 1000).toISOString(),
      trackingNumber: null,
      trackingUrl:    null,
      labelUrl:       null,
      status:         "pending",
    }));

    return res.status(200).json({ orders });

  } catch (err) {
    console.error("orders error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
