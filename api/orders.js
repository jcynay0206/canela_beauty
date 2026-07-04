// GET /api/orders
// Lee las últimas 50 sesiones de Stripe pagadas y las enriquece con:
//  - shipping_details de cada sesión (fetch individual, ya que Stripe no
//    permite expandir shipping_details en list())
//  - datos de Firestore orders/{sessionId}: tracking number, status de
//    envío y solicitudes de cancelación/reembolso (escritos por
//    /api/create-label y /api/order-request)

const Stripe = require("stripe");
const { db } = require("./_firebase");

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
    const detailed = await Promise.all(
      paid.map(s =>
        stripe.checkout.sessions.retrieve(s.id, {
          expand: ["line_items", "shipping_details"],
        }).catch(() => s)
      )
    );

    // 3. Traer en paralelo el estado de envío / solicitudes desde Firestore
    //    (orders/{sessionId}) para cada orden.
    const firestoreDocs = await Promise.all(
      detailed.map(s => db.collection("orders").doc(s.id).get().catch(() => null))
    );

    const orders = detailed.map((s, i) => {
      const fsData = firestoreDocs[i]?.exists ? firestoreDocs[i].data() : {};
      return {
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
        // Desglose — total_details viene directo en el objeto de Stripe,
        // sin necesidad de expand adicional.
        subtotal:      ((s.amount_subtotal || 0) / 100).toFixed(2),
        shipping:      ((s.total_details?.amount_shipping || 0) / 100).toFixed(2),
        tax:           ((s.total_details?.amount_tax      || 0) / 100).toFixed(2),
        discount:      ((s.total_details?.amount_discount || 0) / 100).toFixed(2),
        total:         (s.amount_total / 100).toFixed(2),
        currency:      (s.currency || "usd").toUpperCase(),
        items:         (s.line_items?.data || []).map(i => ({
                         name: i.description,
                         qty:  i.quantity,
                       })),
        createdAt:      new Date(s.created * 1000).toISOString(),
        trackingNumber: fsData.trackingNumber || null,
        trackingUrl:    fsData.trackingUrl    || null,
        labelUrl:       fsData.labelUrl       || null,
        carrier:        fsData.carrier        || null,
        service:        fsData.service        || null,
        status:         fsData.trackingNumber ? "shipped" : "pending",
        request:        fsData.request        || null,
      };
    });

    return res.status(200).json({ orders });

  } catch (err) {
    console.error("orders error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
