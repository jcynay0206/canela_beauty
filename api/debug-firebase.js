// GET /api/debug-firebase
// Endpoint temporal de diagnóstico — BÓRRALO después de resolver el problema.
// Visita https://canelabeauty.vercel.app/api/debug-firebase para ver el diagnóstico.

module.exports = async function handler(req, res) {
  const key = process.env.FIREBASE_PRIVATE_KEY || "";
  const email = process.env.FIREBASE_CLIENT_EMAIL || "";
  const projectId = process.env.FIREBASE_PROJECT_ID || "";
  const bucket = process.env.FIREBASE_STORAGE_BUCKET || "";

  const info = {
    projectId: projectId || "❌ VACÍO",
    clientEmail: email ? `✅ ${email}` : "❌ VACÍO",
    storageBucket: bucket || "❌ VACÍO",
    privateKey: {
      length: key.length,
      startsCorrect: key.includes("-----BEGIN PRIVATE KEY-----") ? "✅ sí" : "❌ no",
      endsCorrect: key.includes("-----END PRIVATE KEY-----") ? "✅ sí" : "❌ no",
      hasLiteralBackslashN: key.includes("\\n") ? "sí (\\n literales)" : "no",
      hasRealNewlines: key.includes("\n") ? "sí (saltos reales)" : "no",
      firstChars: key.slice(0, 40),
      lastChars: key.slice(-40),
    },
  };

  // Probar conexión real a Firestore
  let firestoreStatus = "no probado";
  try {
    const { db } = require("./_firebase");
    await db.collection("_healthcheck").doc("ping").set({ ts: new Date().toISOString() });
    firestoreStatus = "✅ conexión OK";
  } catch (err) {
    firestoreStatus = `❌ ${err.message.slice(0, 200)}`;
  }

  return res.status(200).json({ info, firestoreStatus });
};
