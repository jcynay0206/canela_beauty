# Catálogo en Firestore — guía de configuración

Esta actualización mueve el catálogo de productos de `localStorage` (solo
visible en el navegador donde se editó) a Firestore (`canela-beauty-dc884`),
para que lo que agregues o edites en `/admin` se vea de inmediato en
`/index.html` desde cualquier dispositivo.

## Qué cambió

- **Nuevo:** `api/products.js` — `GET` devuelve el catálogo, `PUT` lo
  reemplaza (solo admin). Guarda todo en un documento `catalog/products`
  de Firestore.
- **Nuevo:** `api/upload-image.js` — sube fotos de productos a Firebase
  Storage y devuelve la URL pública. Solo admin.
- **Nuevo:** `api/_firebase.js` — inicializa Firebase Admin con tus
  credenciales de servicio.
- **`admin.html`:** ahora carga el catálogo desde `/api/products` al
  iniciar sesión, y cada cambio (agregar, editar, borrar, ajustar stock) se
  guarda automáticamente en el servidor.
- **`index.html`:** carga el catálogo publicado desde `/api/products`; si
  no hay conexión, sigue funcionando con los productos de ejemplo.

La primera vez que `/api/products` se llama (con la base de datos vacía),
se "siembra" automáticamente con los 4 productos de ejemplo — no necesitas
hacer nada manual para esto.

## 1. Generar la clave de servicio de Firebase

1. Ve a https://console.firebase.google.com → proyecto **canela-beauty-dc884**.
2. **Configuración del proyecto > Cuentas de servicio**.
3. Click en **Generar nueva clave privada** → descarga un archivo `.json`.
4. De ese archivo, copia:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (incluye las comillas y los
     `\n`; Vercel lo guarda como una sola línea, el código ya se encarga de
     convertir los `\n` en saltos de línea reales).

⚠️ No subas ese archivo `.json` a GitHub — solo copia los valores a las
variables de entorno.

## 2. Configurar variables de entorno en Vercel

En **Project Settings > Environment Variables**, agrega:

| Variable | Valor |
|---|---|
| `FIREBASE_PROJECT_ID` | `canela-beauty-dc884` |
| `FIREBASE_CLIENT_EMAIL` | (del JSON descargado) |
| `FIREBASE_PRIVATE_KEY` | (del JSON descargado) |
| `FIREBASE_STORAGE_BUCKET` | `canela-beauty-dc884.firebasestorage.app` |
| `ADMIN_PW` | igual al valor de `ADMIN_PW` en `admin.html` (línea ~560) |

Vuelve a hacer deploy después de guardarlas.

## 3. Reglas de Firestore

En **Firestore Database > Reglas**, asegúrate de incluir (junto con las
reglas que ya tengas para `customers` y `reviews`):

```
match /catalog/{docId} {
  allow read: if true;   // la tienda necesita leer el catálogo
  allow write: if false; // todas las escrituras pasan por /api (Admin SDK)
}
```

`allow write: if false` es correcto y seguro: las escrituras desde
`/admin` no pasan por las reglas de Firestore porque usan la clave de
servicio (Admin SDK), que siempre tiene permiso total.

## 4. Reglas de Storage

En **Storage > Reglas**:

```
match /b/{bucket}/o {
  match /products/{fileName} {
    allow read: if true;
    allow write: if false; // las subidas pasan por /api/upload-image
  }
}
```

## 5. Probar

1. Haz deploy con las variables configuradas.
2. Entra a `/admin` con tu contraseña.
3. La pestaña Products debería mostrar los 4 productos de ejemplo
   (sembrados automáticamente la primera vez).
4. Edita un producto, cambia el precio o sube una foto nueva, y guarda.
5. Abre `/` en otro navegador o dispositivo (o en modo incógnito) — el
   cambio debería verse ahí también después de recargar.

## Notas

- Si `/api/products` falla (sin conexión, credenciales mal puestas), la
  tienda sigue funcionando con los productos de ejemplo guardados
  localmente — no se rompe, solo no muestra tus cambios más recientes.
- Las fotos subidas desde `/admin` se guardan en
  `canela-beauty-dc884.firebasestorage.app/products/...` y son públicas
  (de solo lectura).
- `ADMIN_PW` sigue siendo la misma contraseña simple del login — ahora
  también se usa para autorizar las escrituras al servidor. Si la cambias
  en `admin.html`, cámbiala también en la variable de entorno `ADMIN_PW`.

## Seguridad: webhook de Stripe y rate limiting

Además del catálogo, esta actualización corrige dos cosas:

### 1. Verificación de firma en el webhook de Stripe

`api/stripe-webhook.js` (antes `stripe-webhook.js` en la raíz, que era un
archivo "muerto" — Vercel no lo ejecutaba como función, solo lo servía
como texto plano) ahora verifica que cada evento venga realmente de
Stripe usando `STRIPE_WEBHOOK_SECRET`. Sin esto, cualquiera podía mandar
un POST falso simulando un pago exitoso.

**Pasos para activarlo:**
1. En el Dashboard de Stripe → **Developers > Webhooks**.
2. Si ya tienes un endpoint configurado apuntando a `/stripe-webhook`,
   edítalo (o crea uno nuevo) para que apunte a:
   `https://TU-DOMINIO.vercel.app/api/stripe-webhook`
3. Asegúrate de que escuche el evento `checkout.session.completed`.
4. Copia el **Signing secret** (empieza con `whsec_...`) y pégalo en la
   variable de entorno `STRIPE_WEBHOOK_SECRET` en Vercel.
5. Vuelve a hacer deploy.

También moví `subscribe.js` (newsletter) de la raíz a `api/subscribe.js`
— antes `/api/subscribe` devolvía 404 porque el archivo no estaba en la
carpeta correcta. Y eliminé las copias duplicadas en la raíz
(`checkout.js`, `stripe-webhook.js`), que Vercel servía como texto plano
y cualquiera podía leer visitando esas URLs directamente.

### 2. Rate limiting en endpoints de escritura

`api/products.js` (PUT) y `api/upload-image.js` ahora usan
`api/_ratelimit.js`, que guarda un contador por IP en Firestore
(colección `_ratelimits`, bloqueada para el navegador en las reglas):

- **5 intentos fallidos** de `x-admin-key` por IP cada 15 minutos →
  después de eso, `429 Too Many Requests` aunque la clave sea correcta
  (protege contra fuerza bruta de `ADMIN_PW`).
- **30 escrituras** (`/api/products`) y **20 subidas de imagen**
  (`/api/upload-image`) por IP cada 15 minutos, incluso con clave
  válida — protege contra un script descontrolado o una clave filtrada.

No requiere configuración adicional — funciona con las mismas
credenciales de Firebase ya configuradas arriba.

## Cambio de contraseña obligatorio

El login de `/admin` ya no compara contra una contraseña escrita en
texto plano dentro de `admin.html` (la que estaba ahí —
`Jonara2026!` — quedó expuesta en el código fuente). Ahora:

1. `ADMIN_PW` (variable de entorno) se usa **solo una vez**, como
   contraseña inicial, la primera vez que alguien entra a `/admin` con
   este cambio activo.
2. Esa primera vez, después de iniciar sesión con `ADMIN_PW`, aparece una
   pantalla **obligatoria** para establecer una nueva contraseña (mínimo
   8 caracteres) — no se puede cerrar ni usar el resto del admin hasta
   guardarla.
3. La nueva contraseña se guarda **hasheada** (no en texto plano) en
   Firestore (`_admin/config`, bloqueado para el navegador en las
   reglas). `ADMIN_PW` deja de usarse después de esto.
4. Para cambiarla de nuevo más adelante, usa el botón **"Change
   Password"** en la barra superior del admin (pide la contraseña actual
   + la nueva).

**Importante:** agrega `SESSION_SECRET` como variable de entorno en
Vercel — es la clave que firma las sesiones de 12 horas del admin. Genera
una con:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Si cambias `SESSION_SECRET` más adelante, todas las sesiones activas se
invalidan (los admins deben volver a iniciar sesión) — útil si alguna vez
sospechas que un token se filtró.

