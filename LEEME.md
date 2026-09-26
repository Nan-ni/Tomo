# Tomo · guía para ponerlo en línea

Tomo es tu estante como app web: login con ID y contraseña, cuentas solo por solicitud (tú apruebas cada una), "olvidé mi contraseña", todo guardado en la nube y se puede instalar en el celular o la computadora desde el navegador.

Todo es gratis: **GitHub Pages** (la página), **Supabase** (login, base de datos y fotos) y **Brevo** (correos).

---

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app (login + tu estante) |
| `cuenta.js` | Login, solicitudes, contraseñas, instalar app, fotos en la nube |
| `aprobar.html` | La página donde apruebas o rechazas solicitudes (llega el enlace a tu correo) |
| `config.js` | **Aquí pegas la dirección y la clave pública de Supabase** |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lo que hace que se pueda instalar como app |
| `supabase/schema.sql` | Crea las tablas y la seguridad de la base de datos |
| `supabase/functions/…` | Las 4 funciones del servidor: `solicitar`, `aprobar`, `olvide`, `libros` |

---

## Paso 1 · Brevo (correos)

1. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: agrega tu correo (por ejemplo tu Gmail) y confírmalo desde el correo que te llega. Ese será el remitente de Tomo.
2. **SMTP & API → API Keys → Generate a new API key**. Cópiala; la usarás en el paso 2.4.

## Paso 2 · Supabase

1. **SQL Editor → New query**: pega todo `supabase/schema.sql` y pulsa **Run**. Debe decir *Success*.
2. **Authentication → Sign In / Providers**: deja **Email** activado y **desactiva "Allow new users to sign up"**. (Las cuentas solo las crea la función `aprobar`.)
3. **Edge Functions → Deploy a new function → Via Editor**, cuatro veces, una por función. En cada una:
   - Nombre exacto: `solicitar`, `aprobar`, `olvide` y `libros`.
   - Borra el código de ejemplo y pega el `index.ts` de su carpeta.
   - **Deploy**.
   - En la función ya creada → **Details / Settings** → **desactiva "Enforce JWT verification"** (o "Verify JWT") y guarda.
4. **Edge Functions → Secrets** (o *Manage secrets*), agrega estos 5:

   | Nombre | Valor |
   |---|---|
   | `BREVO_API_KEY` | la clave de Brevo del paso 1.2 |
   | `REMITENTE_EMAIL` | el correo que verificaste en Brevo |
   | `ADMIN_EMAIL` | tu correo: ahí te llegan las solicitudes |
   | `APP_URL` | la dirección de Tomo del paso 3, por ejemplo `https://tu-usuario.github.io/tomo` |
   | `GOOGLE_BOOKS_KEY` | tu clave de Google Books (queda escondida en el servidor) |

5. **Project Settings → API** (o *API Keys*): copia la **Project URL** y la clave **anon public** o **publishable**. Pégalas en `config.js`. **Nunca** pegues ahí la *service_role* / *secret*.

## Paso 3 · GitHub Pages (la página)

1. **New repository** → nombre `tomo` → **Public** → *Create repository*.
2. **uploading an existing file** → arrastra **todo el contenido** de esta carpeta (con `config.js` ya completado) → *Commit changes*.
3. **Settings → Pages → Build and deployment**: *Deploy from a branch*, rama `main`, carpeta `/ (root)` → *Save*.
4. En 1 o 2 minutos tu app estará en `https://tu-usuario.github.io/tomo/`. Esa es la dirección que va en `APP_URL`.

## Paso 4 · Probar y pasar tus libros

1. Abre Tomo → **Solicitar una cuenta** con tu nombre y tu correo.
2. Te llega "Nueva solicitud" → **Revisar solicitud** → **Aprobar**.
3. Te llega tu ID (`TOMO-XXXXX`) y una contraseña temporal → entra → crea tu contraseña.
4. **Mi cuenta → Importar** → elige tu copia `estante-duque-copia.json` (en Documentos). Suben tus libros, colecciones, precios y fotos.
5. En el celular: abre la dirección → **Instalar app** (Android/Chrome) o **Compartir → Agregar a pantalla de inicio** (iPhone/Safari).

---

## Cómo funciona

- **ID y contraseña:** cada cuenta tiene un ID `TOMO-XXXXX`. Por dentro, Supabase la guarda como `tomo-xxxxx@tomo.invalid`; el correo real va aparte y solo se usa para enviarle mensajes.
- **Solicitudes:** llegan a `ADMIN_EMAIL`. El enlace abre `aprobar.html`, que pide confirmar con un botón (así los antivirus de correo que abren enlaces no aprueban nada solos).
- **Olvidé mi contraseña:** con su ID o su correo le llega su ID y una contraseña temporal (máximo una cada 10 minutos). Al entrar debe crear una nueva.
- **Guardado:** todo se guarda primero en el dispositivo (rápido y sin internet) y se sube a la nube en 1,5 segundos. El puntito junto a *Mi cuenta* dice *Guardado*, *Guardando…* o *Sin conexión*. Si usas dos dispositivos, se mezclan los cambios; nada se pierde.
- **Fotos de portada:** en una carpeta privada por lector. Nadie más puede verlas.
- **Google Books:** la app le pregunta al servidor de Tomo y el servidor usa tu clave. Nadie la ve.

## Para actualizar Tomo más adelante

1. Sube los archivos cambiados al repositorio (*Add file → Upload files*).
2. En `sw.js`, sube el número de `VERSION` (por ejemplo `tomo-v2`) para que los celulares con la app instalada reciban la versión nueva.

## Límites del plan gratis

- **Supabase:** 500 MB de base de datos, 1 GB de fotos, 50 000 usuarios al mes. Si nadie usa el proyecto en 7 días, se pausa: entras a supabase.com y pulsas *Restore*. Tus datos no se pierden.
- **Brevo:** 300 correos al día.
- **GitHub Pages:** el repositorio debe ser público (no contiene claves secretas).
