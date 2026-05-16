const Stripe = require("stripe");

export default async function handler(req, res) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  if (req.method === "GET") {
    // Fetch last 50 orders from Stripe
    try {
      const sessions = await stripe.checkout.sessions.list({
        limit: 50,
        expand: ["data.line_items", "data.shipping_details"],
      });

      const orders = sessions.data
        .filter(s => s.payment_status === "paid")
        .map(s => ({
          id:           s.id,
          customerName: s.shipping_details?.name || s.customer_details?.name || "—",
          email:        s.customer_details?.email || "—",
          phone:        s.customer_details?.phone || "",
          street1:      s.shipping_details?.address?.line1 || "",
          street2:      s.shipping_details?.address?.line2 || "",
          city:         s.shipping_details?.address?.city || "",
          state:        s.shipping_details?.address?.state || "",
          zip:          s.shipping_details?.address?.postal_code || "",
          country:      s.shipping_details?.address?.country || "US",
          total:        (s.amount_total / 100).toFixed(2),
          currency:     s.currency.toUpperCase(),
          items:        s.line_items?.data?.map(i => ({ name: i.description, qty: i.quantity })) || [],
          createdAt:    new Date(s.created * 1000).toISOString(),
          labelCreated: false, // updated when label is generated
          trackingNumber: null,
          trackingUrl:    null,
          status:         "pending", // pending | labeled | in_transit | delivered
        }));

      res.status(200).json({ orders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }

  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
}
