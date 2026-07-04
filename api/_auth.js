const crypto = require("crypto");
const { db } = require("./_firebase");

// Documento donde se guarda la contraseña de administrador (hasheada).
// La primera vez que se llama getAdminConfig(), se crea automáticamente
// usando ADMIN_PW (variable de entorno) como contraseña inicial, marcada
// para cambio obligatorio.
const ADMIN_DOC_PATH = "_admin/config";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

// ── Tokens de sesión ──────────────────────────────────────────
// Firma simple HMAC (similar a un JWT) usando SESSION_SECRET. No requiere
// dependencias adicionales.

function signToken(payload) {
  const secret = process.env.SESSION_SECRET || "";
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const secret = process.env.SESSION_SECRET || "";
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueToken() {
  return signToken({ role: "admin", exp: Date.now() + TOKEN_TTL_MS });
}

// Para /api/products y /api/upload-image: true si el header
// x-admin-token contiene una sesión válida y vigente.
function requireAdmin(req) {
  return Boolean(verifyToken(req.headers["x-admin-token"]));
}

// ── Configuración del admin (Firestore) ─────────────────────────

async function getAdminConfig() {
  const ref = db.doc(ADMIN_DOC_PATH);
  const snap = await ref.get();
  if (snap.exists) return { ref, ...snap.data() };

  // Bootstrap: primera vez que se usa el login nuevo. ADMIN_PW (env var)
  // sirve como contraseña inicial, y se obliga a cambiarla.
  const initial = process.env.ADMIN_PW || "changeme";
  const salt = makeSalt();
  const config = {
    passwordHash: hashPassword(initial, salt),
    salt,
    mustChangePassword: true,
    updatedAt: new Date().toISOString(),
  };
  await ref.set(config);
  return { ref, ...config };
}

module.exports = {
  makeSalt,
  hashPassword,
  issueToken,
  verifyToken,
  requireAdmin,
  getAdminConfig,
};
