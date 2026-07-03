const { bucket } = require("./_firebase");
const { rateLimit } = require("./_ratelimit");

// POST /api/upload-evidence
// Endpoint público — el cliente sube una foto como evidencia de daño junto
// a su solicitud de reembolso. Sin auth de admin (el cliente no tiene
// token de sesión), protegido solo por rate limit.
//
// Body: { filename, dataUrl }
// Devuelve: { url }
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const rl = await rateLimit(req, { action: "evidence-upload", maxAttempts: 10, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return res.status(429).json({ error: "Too many uploads. Please try again later." });
  }

  try {
    const { filename, dataUrl } = req.body || {};
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "Please upload a valid image." });
    }

    const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!match) {
      return res.status(400).json({ error: "Could not read the image." });
    }
    const contentType = match[1];
    const buffer = Buffer.from(match[2], "base64");

    // Límite de tamaño — 8MB, de sobra para una foto de celular ya comprimida
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "Image is too large. Please use a photo under 8MB." });
    }

    const safeName = (filename || "evidence").replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `order-evidence/${Date.now()}_${safeName}`;
    const file = bucket.file(path);

    await file.save(buffer, { metadata: { contentType }, public: true });

    const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
    return res.status(200).json({ url });
  } catch (err) {
    console.error("POST /api/upload-evidence error:", err);
    return res.status(500).json({ error: "Could not upload photo. Please try again." });
  }
};
