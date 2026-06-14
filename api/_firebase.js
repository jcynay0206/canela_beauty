// Inicialización compartida de Firebase Admin para las funciones serverless
// de /api. Requiere las variables de entorno:
//   FIREBASE_PROJECT_ID
//   FIREBASE_CLIENT_EMAIL
//   FIREBASE_PRIVATE_KEY        (con los \n escapados)
//   FIREBASE_STORAGE_BUCKET
//
// Ver _auth.js para ADMIN_PW (contraseña inicial) y SESSION_SECRET.
// Ver FIREBASE_SETUP.md para cómo obtener estas credenciales.

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").split(String.fromCharCode(10)).join("\n").replace(/\\n/g, "\n"),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

module.exports = { admin, db, bucket };
