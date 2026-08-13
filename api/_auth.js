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

// Huella corta del salt actual — se guarda dentro del token para poder
// detectar si la contraseña cambió DESPUÉS de emitirlo. Como el salt se
// regenera en cada cambio de contraseña (ver admin-auth.js), esto sirve
// como un "número de versión" implícito sin tener que agregar un campo
// nuevo en Firestore.
function saltFingerprint(salt) {
  return crypto.createHash("sha256").update(salt).digest("hex").slice(0, 16);
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

// sv = "salt version" — huella del salt vigente al momento de emitir el
// token. Se exige pasar el salt actual explícitamente (en vez de leerlo
// acá adentro) para que login y change-password, que ya tienen el salt a
// mano, no disparen una lectura extra a Firestore solo para emitir el
// token.
function issueToken(currentSalt) {
  return signToken({ role: "admin", exp: Date.now() + TOKEN_TTL_MS, sv: saltFingerprint(currentSalt) });
}

// Para /api/products, /api/upload, /api/create-label, /api/reviews y
// /api/order-request (acción resolve): true si el header x-admin-token
// contiene una sesión válida, vigente, Y emitida con la contraseña
// ACTUAL — un cambio de contraseña invalida al instante cualquier token
// anterior, sin tener que esperar a que expiren solas (12h).
async function requireAdmin(req) {
  const payload = verifyToken(req.headers["x-admin-token"]);
  if (!payload) return false;

  try {
    const config = await getAdminConfig();
    return payload.sv === saltFingerprint(config.salt);
  } catch (err) {
    console.error("requireAdmin error:", err.message);
    return false;
  }
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
