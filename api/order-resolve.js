const { db } = require("./_firebase");
const { requireAdmin } = require("./_auth");

// POST /api/order-resolve
// Solo admin. Marca una solicitud de cancelación/reembolso como resuelta
// (o la reabre). No procesa el reembolso en sí — eso se hace manualmente
// desde el Dashboard de Stripe, a propósito, para que siempre haya
// revisión humana antes de que salga dinero real.
//
// Body: { orderId, status: 'resolved'|'pending' }

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAdmin(req)) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const { orderId, status } = req.body || {};
  if (!orderId || !["resolved", "pending"].includes(status)) {
    return res.status(400).json({ error: "Missing orderId or invalid status" });
  }

  try {
    await db.collection("orders").doc(orderId).set(
      {
        request: {
          status,
          resolvedAt: status === "resolved" ? new Date().toISOString() : null,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("order-resolve error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
