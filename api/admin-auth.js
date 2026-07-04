const { rateLimit } = require("./_ratelimit");
const { hashPassword, makeSalt, issueToken, verifyToken, getAdminConfig } = require("./_auth");

// POST /api/admin-auth
//
// { action: "login", password }
//   -> { token, mustChangePassword }
//
// { action: "change-password", token, currentPassword?, newPassword }
//   -> { ok: true, token }
//   currentPassword no es necesaria si mustChangePassword era true
//   (cambio obligatorio del primer ingreso).
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action } = req.body || {};

  if (action === "login") {
    const rl = await rateLimit(req, { action: "admin-login", maxAttempts: 5, windowMs: 15 * 60 * 1000 });
    if (!rl.allowed) {
      return res.status(429).json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." });
    }

    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Falta la contraseña" });

    try {
      const config = await getAdminConfig();
      const hash = hashPassword(password, config.salt);
      if (hash !== config.passwordHash) {
        return res.status(401).json({ error: "Contraseña incorrecta" });
      }

      return res.status(200).json({
        token: issueToken(),
        mustChangePassword: Boolean(config.mustChangePassword),
      });
    } catch (err) {
      console.error("admin-auth login error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  if (action === "change-password") {
    const { token, currentPassword, newPassword } = req.body;

    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ error: "Sesión expirada. Vuelve a iniciar sesión." });

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });
    }

    try {
      const config = await getAdminConfig();

      if (!config.mustChangePassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: "Ingresa tu contraseña actual." });
        }
        const currentHash = hashPassword(currentPassword, config.salt);
        if (currentHash !== config.passwordHash) {
          return res.status(401).json({ error: "Contraseña actual incorrecta." });
        }
      }

      const salt = makeSalt();
      const passwordHash = hashPassword(newPassword, salt);
      await config.ref.set({
        passwordHash,
        salt,
        mustChangePassword: false,
        updatedAt: new Date().toISOString(),
      });

      return res.status(200).json({ ok: true, token: issueToken() });
    } catch (err) {
      console.error("admin-auth change-password error:", err);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: "Acción no reconocida" });
};
