// GET /api/order-labels
// Devuelve todos los labels de envío guardados en Firestore (colección "orders").
// Solo accesible por el admin — se usa en loadOrders() para fusionar los
// tracking numbers con las órdenes de Stripe.

const { db }           = require("./_firebase");
const { requireAdmin } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const snap = await db.collection("orders").get();
    const labels = {};
    snap.forEach(doc => {
      labels[doc.id] = doc.data();
    });
    return res.status(200).json({ labels });
  } catch (err) {
    console.error("order-labels error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
