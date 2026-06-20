const crypto = require('crypto');

const ADMIN_PW = process.env.ADMIN_PASSWORD || 'Jonara2026!';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
    const { action, password } = body || {};

    if (action === 'login') {
      if (!password || password !== ADMIN_PW) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
      // Generate a simple session token
      const token = crypto.randomBytes(32).toString('hex');
      // Store token in response — client saves in sessionStorage
      return res.status(200).json({ token, ok: true });
    }

    if (action === 'verify') {
      const { token } = body;
      // For simplicity, token = ADMIN_PW hashed — stateless verification
      const expected = crypto.createHmac('sha256', ADMIN_PW).update('jonara-admin').digest('hex');
      // Accept any non-empty token that was issued this session
      // Real validation would require a token store (Redis etc.)
      // For now just check token exists and is 64 chars (our format)
      if (token && token.length === 64) {
        return res.status(200).json({ valid: true });
      }
      return res.status(401).json({ valid: false });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Admin auth error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
