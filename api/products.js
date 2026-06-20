// ── /api/products ─────────────────────────────────────────────
// GET  → load product catalog from Firestore
// PUT  → save product catalog to Firestore (admin only)

const PROJECT_ID = 'canela-beauty-dc884';
const ADMIN_PW   = process.env.ADMIN_PASSWORD || 'Jonara2026!';
const FS_URL     = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/catalog/products`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: load products ───────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const fsRes = await fetch(FS_URL);
      if (fsRes.status === 404) {
        // No products yet — return empty list
        return res.status(200).json({ products: [] });
      }
      const data = await fsRes.json();
      // Decode Firestore format → plain JS array
      const raw = data.fields?.data?.stringValue;
      const products = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ products });
    } catch (err) {
      console.error('GET products error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── PUT: save products ───────────────────────────────────────
  if (req.method === 'PUT') {
    // Verify admin token
    const token = req.headers['x-admin-token'] || '';
    if (token !== ADMIN_PW) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
      const { products } = body;

      if (!Array.isArray(products)) {
        return res.status(400).json({ error: 'products must be an array' });
      }

      // Save to Firestore as a single document — products stored as JSON string
      const fsRes = await fetch(`${FS_URL}?updateMask.fieldPaths=data`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            data: { stringValue: JSON.stringify(products) },
            updatedAt: { stringValue: new Date().toISOString() }
          }
        })
      });

      if (!fsRes.ok) {
        const err = await fsRes.json();
        console.error('Firestore write error:', JSON.stringify(err));
        return res.status(500).json({ error: err.error?.message || 'Firestore write failed' });
      }

      console.log(`Products saved: ${products.length} items`);
      return res.status(200).json({ ok: true, count: products.length });

    } catch (err) {
      console.error('PUT products error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
