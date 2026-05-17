module.exports = function handler(req, res) {
  res.status(200).json({ 
    ok: true, 
    key: process.env.STRIPE_SECRET_KEY ? "key exists" : "NO KEY",
    method: req.method
  });
};
