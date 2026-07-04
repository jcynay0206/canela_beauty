const { bucket } = require("./_firebase");
const { requireAdmin } = require("./_auth");
const { rateLimit } = require("./_ratelimit");

// POST /api/upload
//
// Un solo endpoint para las dos subidas de imágenes del sitio (consolidado
// para no pasar el límite de 12 Serverless Functions del plan gratuito de
// Vercel):
//
//  context: 'product' (default)
//    Solo admin (x-admin-token). Fotos de producto para el catálogo.
//    Guardadas en products/...
//
//  context: 'evidence'
//    Público — el cliente sube una foto como evidencia de daño junto a su
//    solicitud de reembolso. Sin auth de admin, protegido por rate limit.
//    Guardadas en order-evidence/...
//
// Body: { context, filename, dataUrl }
// Devuelve: { url }

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = req.body?.context === "evidence" ? "evidence" : "product";

  if (context === "product") {
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
  } else {
    // evidence — endpoint público, protegido solo por rate limit
    const rl = await rateLimit(req, { action: "evidence-upload", maxAttempts: 10, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return res.status(429).json({ error: "Too many uploads. Please try again later." });
    }
  }

  try {
    const { filename, dataUrl } = req.body || {};
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return res.status(400).json({ error: "Invalid image data." });
    }

    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "Could not read the image format." });
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");

    if (buffer.length > MAX_BYTES) {
      return res.status(400).json({ error: "Image is too large. Please use a photo under 8MB." });
    }

    const safeName = (filename || "image").replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const folder = context === "evidence" ? "order-evidence" : "products";
    const path = `${folder}/${Date.now()}_${safeName}`;
    const file = bucket.file(path);

    await file.save(buffer, { metadata: { contentType }, public: true });

    const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
    return res.status(200).json({ url });
  } catch (err) {
    console.error("POST /api/upload error:", err);
    return res.status(500).json({ error: err.message });
  }
};
