# 📚 Tomo · tu estante en el bolsillo

**Tomo** es una app web para organizar tu colección de **libros, mangas, manhwas y cómics**. Escaneas el código de barras y el libro se agrega solo, con título, autor y portada. Funciona en el celular y en la computadora, se instala como app y abre aunque no haya internet.

👉 **[nan-ni.github.io/Tomo](https://nan-ni.github.io/Tomo/)**

Por ahora es **por invitación**: entra a la página, toca **“Solicitar una cuenta”** y te llegará tu acceso por correo.

---

## ✨ Qué puedes hacer

- **Agregar libros en segundos:** con la cámara del celular, con un lector de códigos USB o escribiendo el ISBN. Título, autor, editorial, páginas y portada se completan solos.
- **Mangas y colecciones por tomos:** ves qué tomos tienes, cuáles te faltan y cuál sigue. Tomo busca cuántos tomos tiene la serie y si continúa en otra.
- **Colecciones de quiosco y grupos:** colecciones por entregas, y grupos por editorial, diseño o club de lectura, con lo que llevas gastado en soles.
- **Lista de deseos:** los libros que quieres y los tomos que te faltan de tus series. Se puede copiar para mandarla por WhatsApp.
- **Préstamos:** anota a quién le prestaste cada libro y desde cuándo.
- **¿Qué leo ahora?:** sugerencias entre tus pendientes (algo corto, cambiar de género, seguir una serie…).
- **Estadísticas:** libros leídos por mes, por género, por tipo y por autor.
- **Compartir tu estante:** un enlace para que cualquiera vea tu estante y tu lista de deseos sin crear cuenta. No se muestran tus notas, préstamos ni precios.
- **Tu cuenta en la nube:** se guarda solo, se sincroniza entre tus dispositivos y funciona sin internet.
- **Géneros automáticos:** cada libro recibe un género clásico (romance, fantasía, historia…) según lo que dicen Google Books, Open Library y, en mangas, AniList.
- **Copias de seguridad:** exporta a JSON o CSV (para Excel) e importa cuando quieras.
- **Enviar comentario:** desde *Mi cuenta* puedes reportar un error o proponer una idea.

## 🛠️ Cómo está hecho

Es una app sin instalación ni compilación: HTML, CSS y JavaScript que se sirven tal cual.

| Parte | Servicio |
|---|---|
| Página | GitHub Pages |
| Cuentas, base de datos y fotos | Supabase (Auth, Postgres con reglas por lector, Storage y Edge Functions) |
| Correos | Brevo |
| Datos de libros | Google Books, Open Library, AniList y Wikidata |
| Lector de códigos | BarcodeDetector del navegador o ZXing |

## 📁 Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La app: estante, colecciones, lista de deseos y estadísticas |
| `cuenta.js` | Ingreso, solicitudes, contraseñas, compartir y guardado en la nube |
| `aprobar.html` | Página para aprobar o rechazar solicitudes (el enlace llega al correo del administrador) |
| `config.js` | Dirección y clave **pública** de Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | Lo que permite instalarla como app y abrirla sin internet |
| `supabase/schema.sql` | Tablas y reglas de seguridad de la base de datos |
| `supabase/functions/` | Funciones del servidor: `solicitar`, `aprobar`, `olvide`, `libros` y `compartido` |

La carpeta `supabase/` no se publica en la página: es el código que se copia en el panel de Supabase.

## 🔒 Privacidad y seguridad

- Cada lector solo puede ver y cambiar su propio estante y sus fotos (reglas de la base de datos, *row level security*).
- Las cuentas se identifican con un ID (`TOMO-XXXXX`); el correo solo se usa para enviar el acceso o una contraseña temporal.
- La clave de `config.js` es la **pública** de Supabase: está hecha para estar en la página. Las claves secretas (Brevo, Google Books y la *service role* de Supabase) viven solo en el servidor.

---

## 🚀 Montar tu propia copia

<details>
<summary>Pasos para ponerla en línea con cuentas gratuitas</summary>

### 1. Brevo (correos)
1. **Senders → Add a sender:** agrega y confirma el correo remitente.
2. **SMTP & API → API Keys:** genera una clave.

### 2. Supabase
1. **SQL Editor → New query:** pega `supabase/schema.sql` y pulsa **Run**. Se puede ejecutar más de una vez sin borrar nada.
2. **Authentication → Sign In / Providers:** deja **Email** activado y desactiva **“Allow new users to sign up”**. Las cuentas solo las crea la función `aprobar`.
3. **Edge Functions → Deploy a new function → Via Editor**, una por cada carpeta de `supabase/functions/`: `solicitar`, `aprobar`, `olvide`, `libros` y `compartido`. Usa el nombre exacto, pega su `index.ts`, pulsa **Deploy** y, en sus ajustes, **desactiva “Enforce JWT verification”**.
4. **Edge Functions → Secrets:**

   | Nombre | Valor |
   |---|---|
   | `BREVO_API_KEY` | la clave de Brevo |
   | `REMITENTE_EMAIL` | el correo confirmado en Brevo |
   | `ADMIN_EMAIL` | el correo donde llegan las solicitudes |
   | `APP_URL` | la dirección de la página, por ejemplo `https://tu-usuario.github.io/Tomo` |
   | `GOOGLE_BOOKS_KEY` | una clave de Google Books (opcional pero recomendada) |

5. **Project Settings → API:** copia la **Project URL** y la clave **anon/publishable** en `config.js`. Nunca pongas ahí la *service role*.

### 3. GitHub Pages
**Settings → Pages:** *Deploy from a branch*, rama `main`, carpeta `/ (root)`.

### Publicar cambios
Sube el número de `VERSION` en `sw.js` (y el de “Tomo · versión N” en `index.html`) para que las apps ya instaladas reciban la versión nueva.

### Límites del plan gratuito
- **Supabase:** 500 MB de base de datos y 1 GB de fotos. Si nadie lo usa en 7 días se pausa; se reactiva con *Restore*.
- **Brevo:** 300 correos al día (unas 150 cuentas nuevas por día).
- **GitHub Pages:** el repositorio debe ser público.

</details>
