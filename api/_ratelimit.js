const { db } = require("./_firebase");

// Limitador de tasa simple basado en Firestore — funciona entre distintas
// instancias/cold starts de las funciones serverless de Vercel (a
// diferencia de un contador en memoria, que se reinicia con cada instancia).
//
// Guarda un contador por IP + acción en la colección "_ratelimits", con
// una ventana de tiempo. Pasado el límite, devuelve { allowed: false }.
//
// Uso:
//   const rl = await rateLimit(req, { action: "products-write", maxAttempts: 30, windowMs: 15*60*1000 });
//   if (!rl.allowed) return res.status(429).json({ error: "Demasiadas solicitudes" });

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

async function rateLimit(req, { action, maxAttempts, windowMs }) {
  const ip = getClientIp(req);
  const key = `${action}__${ip}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const ref = db.collection("_ratelimits").doc(key);
  const now = Date.now();

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;

      if (!data || now - data.windowStart > windowMs) {
        tx.set(ref, { count: 1, windowStart: now });
        return { allowed: true, remaining: maxAttempts - 1 };
      }

      if (data.count >= maxAttempts) {
        const retryAfterMs = windowMs - (now - data.windowStart);
        return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
      }

      tx.update(ref, { count: data.count + 1 });
      return { allowed: true, remaining: maxAttempts - data.count - 1 };
    });
  } catch (err) {
    // Si Firestore falla, no bloqueamos la petición por esto — el rate
    // limiting es una capa extra, no la única defensa.
    console.error("rateLimit error:", err.message);
    return { allowed: true, remaining: null };
  }
}

module.exports = { rateLimit, getClientIp };
