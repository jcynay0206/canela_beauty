const { db } = require("./_firebase");
const { requireAdmin } = require("./_auth");
const { rateLimit } = require("./_ratelimit");
const DEFAULT_PRODUCTS = require("./_default-products");

const DOC_PATH = "catalog/products";

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const snap = await db.doc(DOC_PATH).get();

      if (!snap.exists) {
        // Primera vez: siembra el catálogo con los productos de ejemplo.
        await db.doc(DOC_PATH).set({
          items: DEFAULT_PRODUCTS,
          updatedAt: new Date().toISOString(),
        });
        return res.status(200).json({ products: DEFAULT_PRODUCTS });
      }

      const data = snap.data();
      return res.status(200).json({ products: data.items || [] });
    } catch (err) {
      console.error("GET /api/products error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "PUT") {
    // Límite general de escrituras (incluso con clave válida): protege
    // contra un script descontrolado o una clave filtrada.
    const writeRl = await rateLimit(req, { action: "products-write", maxAttempts: 200, windowMs: 15 * 60 * 1000 });
    if (!writeRl.allowed) {
      return res.status(429).json({ error: "Demasiadas solicitudes. Intenta de nuevo en unos minutos." });
    }

    if (!requireAdmin(req)) {
      // Límite más estricto para intentos con clave incorrecta (fuerza bruta).
      const authRl = await rateLimit(req, { action: "products-auth-fail", maxAttempts: 5, windowMs: 15 * 60 * 1000 });
      if (!authRl.allowed) {
        return res.status(429).json({ error: "Demasiados intentos fallidos. Espera unos minutos." });
      }
      return res.status(401).json({ error: "No autorizado" });
    }

    const { products } = req.body || {};
    if (!Array.isArray(products)) {
      return res.status(400).json({ error: "Se esperaba { products: [...] }" });
    }

    try {
      await db.doc(DOC_PATH).set({
        items: products,
        updatedAt: new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, count: products.length });
    } catch (err) {
      console.error("PUT /api/products error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "Method not allowed" });
};
