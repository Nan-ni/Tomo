// Tomo · olvide: "¿Olvidaste tu contraseña?"
//  {dato}          el lector escribe su ID o su correo y le llega un ENLACE para crear una contraseña nueva
//                  (vale 30 minutos y una sola vez). Mientras no lo use, su contraseña de siempre sigue sirviendo:
//                  nadie puede cambiarle la contraseña a otro solo sabiendo su ID o su correo.
//  {token, clave}  desde ese enlace: guarda la contraseña nueva y cierra las sesiones de otros dispositivos.
// Siempre responde lo mismo a {dato}, exista o no la cuenta, para no revelar quién está registrado.
// Secretos: BREVO_API_KEY, REMITENTE_EMAIL, APP_URL
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const VENCE_MIN = 30;          // el enlace vale 30 minutos
const ENTRE_MIN = 5;           // como mucho un enlace cada 5 minutos por cuenta
const POR_DIA = 5;             // y 5 al día por cuenta
const POR_HORA_TOTAL = 60;     // y 60 por hora en total (cuida los 300 correos diarios de Brevo)

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function plantilla(titulo: string, cuerpo: string, boton?: { texto: string; url: string }) {
  return `<div style="background:#F3EEE4;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#1E1912">
  <div style="max-width:480px;margin:0 auto;background:#FFFCF6;border:1px solid #E2D9C8;border-radius:18px;padding:28px">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#1F4D3F;margin-bottom:14px">Tomo</div>
    <h1 style="font-family:Georgia,serif;font-size:21px;margin:0 0 12px">${titulo}</h1>
    <div style="font-size:15px;line-height:1.6;color:#5B5244">${cuerpo}</div>
    ${boton ? `<a href="${boton.url}" style="display:inline-block;margin-top:20px;background:#1F4D3F;color:#FBF8F1;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:11px">${boton.texto}</a>` : ""}
  </div></div>`;
}
async function enviarCorreo(to: string, asunto: string, html: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { name: "Tomo", email: Deno.env.get("REMITENTE_EMAIL") }, to: [{ email: to }], subject: asunto, htmlContent: html }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}
// Enlace al azar (256 bits); en la base se guarda solo su huella
const nuevoToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function huella(t: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}
async function contar(tipo: string, desde: number, destino?: string) {
  let q = db.from("envios").select("id", { count: "exact", head: true }).eq("tipo", tipo).gte("creado", new Date(Date.now() - desde).toISOString());
  if (destino) q = q.eq("destino", destino);
  const { count, error } = await q; if (error) throw error;
  return count || 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const body = await req.json().catch(() => ({}));

  // --- 2. Desde el enlace del correo: guardar la contraseña nueva
  if (body.token !== undefined) {
    try {
      const token = String(body.token || ""), clave = String(body.clave || "");
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return json({ error: "Este enlace no es válido. Pide otro." }, 400);
      if (clave.length < 8) return json({ error: "Usa al menos 8 caracteres." }, 400);
      if (clave.length > 72) return json({ error: "Usa como mucho 72 caracteres." }, 400);
      const { data: r } = await db.from("restablecer").select("user_id,vence").eq("hash", await huella(token)).maybeSingle();
      if (!r || new Date(r.vence).getTime() < Date.now()) return json({ error: "Este enlace venció o ya se usó. Pide otro desde “¿Olvidaste tu contraseña?”." }, 400);
      // se usa una sola vez: se borra antes de cambiar la contraseña
      const { data: borrado } = await db.from("restablecer").delete().eq("user_id", r.user_id).eq("hash", await huella(token)).select("user_id");
      if (!borrado?.length) return json({ error: "Este enlace venció o ya se usó. Pide otro desde “¿Olvidaste tu contraseña?”." }, 400);
      const { error } = await db.auth.admin.updateUserById(r.user_id, { password: clave });
      if (error) return json({ error: /weak|short|pwned|breach/i.test(error.message) ? "Esa contraseña es muy fácil de adivinar. Prueba con otra." : "No se pudo guardar la contraseña. Pide otro enlace." }, 400);
      await db.from("perfiles").update({ debe_cambiar: false }).eq("user_id", r.user_id);
      await db.rpc("cerrar_sesiones", { uid: r.user_id }).then(() => {}, () => {}); // los otros dispositivos vuelven a pedir la contraseña
      const { data: p } = await db.from("perfiles").select("codigo").eq("user_id", r.user_id).maybeSingle();
      return json({ ok: true, codigo: p?.codigo || "" });
    } catch (e) {
      console.error(e);
      return json({ error: "No se pudo guardar la contraseña. Intenta en unos minutos." }, 500);
    }
  }

  // --- 1. Pedir el enlace
  const respuesta = json({ ok: true }); // la misma para todos
  try {
    let d = String(body.dato || "").trim();
    if (!d || d.length > 120) return json({ error: "Escribe tu ID o tu correo." }, 400);
    const app = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
    if (!app) throw new Error("Falta el secreto APP_URL");

    let q = db.from("perfiles").select("user_id,codigo,email,nombre");
    if (d.includes("@")) q = q.eq("email", d.toLowerCase());
    else {
      d = d.toUpperCase().replace(/\s+/g, "");
      if (/^[A-Z0-9]{5}$/.test(d)) d = "TOMO-" + d;
      q = q.eq("codigo", d);
    }
    const { data: p } = await q.maybeSingle();
    if (!p) return respuesta;

    // Límites: por cuenta y en total
    if (await contar("olvide", ENTRE_MIN * 60_000, p.user_id) > 0) return respuesta;
    if (await contar("olvide", 86_400_000, p.user_id) >= POR_DIA) return respuesta;
    if (await contar("olvide", 3_600_000) >= POR_HORA_TOTAL) { console.error("olvide: límite total por hora"); return respuesta; }

    const token = nuevoToken();
    const { error: e1 } = await db.from("restablecer").upsert({ user_id: p.user_id, hash: await huella(token), vence: new Date(Date.now() + VENCE_MIN * 60_000).toISOString(), creado: new Date().toISOString() });
    if (e1) throw e1;
    await db.from("envios").insert({ tipo: "olvide", destino: p.user_id });
    await db.from("restablecer").delete().lt("vence", new Date().toISOString()); // limpieza de enlaces vencidos

    await enviarCorreo(p.email, "Crea tu contraseña nueva de Tomo", plantilla(`Hola, ${esc(p.nombre || "lector")}`,
      `Pediste entrar de nuevo a tu estante. Tu ID es <b style="font-family:monospace;font-size:17px;color:#1E1912">${esc(p.codigo)}</b>.<br><br>` +
      `Toca el botón para crear una contraseña nueva. El enlace sirve una sola vez y vence en ${VENCE_MIN} minutos.<br><br>` +
      `<span style="font-size:13px">Si no fuiste tú, ignora este correo: tu contraseña sigue igual y nadie más puede usar este enlace.</span>`,
      { texto: "Crear contraseña nueva", url: `${app}/?r=${token}` }));
    return respuesta;
  } catch (e) {
    console.error(e);
    return json({ error: "No pudimos enviarte el correo. Intenta en unos minutos." }, 500);
  }
});
