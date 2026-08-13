const { db } = require("./_firebase");
const { requireAdmin } = require("./_auth");

// PATCH /api/reviews
// Solo admin — aprueba/rechaza/reabre una reseña.
//
// Las reglas de Firestore para "reviews" solo tienen "allow create" y
// "allow read" — no hay ninguna regla "allow update". El admin de este
// sitio no usa Firebase Auth (tiene su propio sistema de sesión con
// token firmado), así que las reglas no tienen forma de reconocerlo como
// admin. Por eso esto se hace acá, con el Admin SDK, que ignora las
// reglas de seguridad del cliente.
//
// Body: { docId, status: 'pending'|'approved'|'rejected' }

module.exports = async function handler(req, res) {
  if (req.method !== "PATCH") {
    res.setHeader("Allow", "PATCH");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await requireAdmin(req))) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const { docId, status } = req.body || {};
  if (!docId || !["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Missing docId or invalid status" });
  }

  try {
    await db.collection("reviews").doc(docId).update({ status });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("reviews update error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
