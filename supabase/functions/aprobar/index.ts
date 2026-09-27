// Tomo · aprobar: tú abres el enlace del correo, ves la solicitud y la apruebas o rechazas.
// Al aprobar se crea la cuenta con un ID único (TOMO-XXXXX) y una contraseña temporal, y se le envía por correo.
// El enlace lleva un token secreto e irrepetible; sin él no se puede aprobar nada.
// Secretos: BREVO_API_KEY, REMITENTE_EMAIL, APP_URL
import { createClient } from "npm:@supabase/supabase-js@2";

// Correo interno de cada cuenta: <id>@tomo.invalid. Nunca recibe correos (los reales van al campo email del perfil).
// Si algún día lo cambias, cambia también "dominioId" en config.js.
const DOMINIO_ID = Deno.env.get("DOMINIO_ID") || "tomo.invalid";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Sin letras que se confunden (0/O, 1/I/L)
const ALFA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const azar = (n: number, alfa = ALFA) => {
  const b = crypto.getRandomValues(new Uint32Array(n));
  return Array.from(b, (x) => alfa[x % alfa.length]).join("");
};
const nuevaClave = () => azar(4, "abcdefghjkmnpqrstuvwxyz") + azar(4, "23456789") + azar(2, "ABCDEFGHJKMNPQRSTUVWXYZ");

function plantilla(titulo: string, cuerpo: string, boton?: { texto: string; url: string }) {
  return `<div style="background:#F3EEE4;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#1E1912">
  <div style="max-width:480px;margin:0 auto;background:#FFFCF6;border:1px solid #E2D9C8;border-radius:18px;padding:28px">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#1F4D3F;margin-bottom:14px">Tomo</div>
    <h1 style="font-family:Georgia,serif;font-size:21px;margin:0 0 12px">${titulo}</h1>
    <div style="font-size:15px;line-height:1.6;color:#5B5244">${cuerpo}</div>
    ${boton ? `<a href="${boton.url}" style="display:inline-block;margin-top:20px;background:#1F4D3F;color:#FBF8F1;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:11px">${boton.texto}</a>` : ""}
  </div></div>`;
}
const datoGrande = (etiqueta: string, valor: string) =>
  `<div style="margin:10px 0;padding:12px 14px;background:#EDE6D8;border-radius:12px"><div style="font-size:12px;color:#8C8272;text-transform:uppercase;letter-spacing:.06em">${etiqueta}</div><div style="font-family:monospace;font-size:20px;font-weight:bold;color:#1E1912;letter-spacing:.04em">${valor}</div></div>`;

async function enviarCorreo(to: string, asunto: string, html: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Tomo", email: Deno.env.get("REMITENTE_EMAIL") }, to: [{ email: to }], subject: asunto, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const { token, accion } = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/i.test(String(token || ""))) return json({ error: "Enlace no válido." }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const app = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
    const { data: sol } = await db.from("solicitudes").select("*").eq("token", token).maybeSingle();
    if (!sol) return json({ error: "Esta solicitud no existe." }, 404);

    const resumen = { nombre: sol.nombre, email: sol.email, mensaje: sol.mensaje, creado: sol.creado, estado: sol.estado };
    if (accion === "ver") {
      let codigo = null;
      if (sol.user_id) { const { data: p } = await db.from("perfiles").select("codigo").eq("user_id", sol.user_id).maybeSingle(); codigo = p?.codigo || null; }
      return json({ ok: true, solicitud: { ...resumen, codigo } });
    }
    if (sol.estado !== "pendiente") return json({ error: `Esta solicitud ya fue ${sol.estado}.`, solicitud: resumen }, 409);

    if (accion === "rechazar") {
      await db.from("solicitudes").update({ estado: "rechazada", resuelto: new Date().toISOString() }).eq("id", sol.id);
      return json({ ok: true, estado: "rechazada" });
    }
    if (accion !== "aprobar") return json({ error: "Acción no válida." }, 400);

    // Se "toma" la solicitud antes de crear la cuenta: si tocas Aprobar dos veces seguidas, no se crean dos cuentas
    const { data: tomada } = await db.from("solicitudes").update({ resuelto: new Date().toISOString() }).eq("id", sol.id).eq("estado", "pendiente").is("resuelto", null).select("id");
    if (!tomada?.length) return json({ error: "Esta solicitud ya se está procesando.", solicitud: resumen }, 409);
    const soltar = () => db.from("solicitudes").update({ resuelto: null }).eq("id", sol.id).eq("estado", "pendiente");

    // Si mientras tanto ya se le creó una cuenta con ese correo, solo le recordamos su ID
    const { data: ya } = await db.from("perfiles").select("codigo,user_id").eq("email", sol.email).maybeSingle();
    if (ya) {
      await db.from("solicitudes").update({ estado: "aprobada", user_id: ya.user_id, resuelto: new Date().toISOString() }).eq("id", sol.id);
      return json({ ok: true, estado: "aprobada", codigo: ya.codigo, yaExistia: true });
    }

    // ID único
    let codigo = "";
    for (let i = 0; i < 20 && !codigo; i++) {
      const c = "TOMO-" + azar(5);
      const { data: choca } = await db.from("perfiles").select("user_id").eq("codigo", c).maybeSingle();
      if (!choca) codigo = c;
    }
    if (!codigo) { await soltar(); throw new Error("No se pudo generar un ID único"); }

    const clave = nuevaClave();
    const { data: creado, error: e1 } = await db.auth.admin.createUser({
      email: `${codigo.toLowerCase()}@${DOMINIO_ID}`,
      password: clave,
      email_confirm: true,
      user_metadata: { codigo, nombre: sol.nombre },
    });
    if (e1 || !creado?.user) { await soltar(); throw e1 || new Error("No se creó el usuario"); }
    const uid = creado.user.id;

    const { error: e2 } = await db.from("perfiles").insert({ user_id: uid, codigo, email: sol.email, nombre: sol.nombre, debe_cambiar: true });
    if (e2) { await db.auth.admin.deleteUser(uid); await soltar(); throw e2; }
    await db.from("solicitudes").update({ estado: "aprobada", user_id: uid, resuelto: new Date().toISOString() }).eq("id", sol.id);

    await db.from("envios").insert({ tipo: "aprobada", destino: String(sol.email).toLowerCase() }).then(() => {}, () => {});
    await enviarCorreo(sol.email, "¡Tu cuenta de Tomo está lista!", plantilla(`¡Bienvenido, ${esc(sol.nombre || "lector")}!`,
      `Tu cuenta fue aprobada. Estos son tus datos para entrar:` +
      datoGrande("Tu ID", codigo) + datoGrande("Contraseña temporal", clave) +
      `Al entrar por primera vez, Tomo te pedirá crear tu propia contraseña.<br><br>Consejo: en el celular, abre Tomo y elige <b>Instalar app</b> o <b>Agregar a pantalla de inicio</b> para tenerlo como una app.`,
      app ? { texto: "Entrar a Tomo", url: app + "/" } : undefined));

    return json({ ok: true, estado: "aprobada", codigo });
  } catch (e) {
    console.error(e);
    return json({ error: "Algo falló al procesar la solicitud. Revisa los registros de la función." }, 500);
  }
});
