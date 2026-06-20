const { bucket } = require("./_firebase");
const { requireAdmin } = require("./_auth");
const { rateLimit } = require("./_ratelimit");

// POST /api/upload-image
// Body: { filename: "foto.jpg", dataUrl: "data:image/jpeg;base64,..." }
// Header: x-admin-key: <ADMIN_PW>
// Devuelve: { url: "https://storage.googleapis.com/.../products/169..._foto.jpg" }
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Límite general de subidas (incluso con clave válida).
  const uploadRl = await rateLimit(req, { action: "image-upload", maxAttempts: 50, windowMs: 15 * 60 * 1000 });
  if (!uploadRl.allowed) {
    return res.status(429).json({ error: "Demasiadas subidas. Intenta de nuevo en unos minutos." });
  }

  if (!requireAdmin(req)) {
    const authRl = await rateLimit(req, { action: "upload-auth-fail", maxAttempts: 5, windowMs: 15 * 60 * 1000 });
    if (!authRl.allowed) {
      return res.status(429).json({ error: "Demasiados intentos fallidos. Espera unos minutos." });
    }
    return res.status(401).json({ error: "No autorizado" });
  }

  try {
    const { filename, dataUrl } = req.body || {};
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return res.status(400).json({ error: "dataUrl inválido" });
    }

    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "No se pudo leer el formato de la imagen" });
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");

    const safeName = (filename || "imagen").replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `products/${Date.now()}_${safeName}`;
    const file = bucket.file(path);

    await file.save(buffer, { metadata: { contentType }, public: true });

    const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
    return res.status(200).json({ url });
  } catch (err) {
    console.error("POST /api/upload-image error:", err);
    return res.status(500).json({ error: err.message });
  }
};
