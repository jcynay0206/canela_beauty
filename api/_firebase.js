// Inicialización compartida de Firebase Admin para las funciones serverless
// de /api. Requiere las variables de entorno:
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY        (con los \n escapados)
//   FIREBASE_STORAGE_BUCKET
//
// Ver _auth.js para ADMIN_PW (contraseña inicial) y SESSION_SECRET.
// Ver FIREBASE_SETUP.md para cómo obtener estas credenciales.
//
// firebase-admin v13+ dejó de exponer la API con namespace
// (admin.credential.cert(), admin.firestore(), etc.) — ahora es API
// modular, con imports separados por submódulo. Por eso db/bucket se
// arman así en vez del patrón viejo con require("firebase-admin") a secas.

const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

const app = getApps().length
  ? getApps()[0]
  : initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        // Vercel puede quitar el \n final — lo forzamos aquí.
        privateKey: ((process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trimEnd()) + "\n",
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

const db = getFirestore(app);
const bucket = getStorage(app).bucket();

module.exports = { db, bucket };
