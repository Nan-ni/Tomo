// Tomo · olvide: el lector escribe su ID o su correo y le llega una contraseña temporal nueva (y su ID, por si lo olvidó).
// Siempre responde lo mismo, exista o no la cuenta, para no revelar quién está registrado.
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
const azar = (n: number, alfa: string) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => alfa[x % alfa.length]).join("");
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
  const respuesta = json({ ok: true }); // la misma para todos
  try {
    const { dato } = await req.json().catch(() => ({}));
    let d = String(dato || "").trim();
    if (!d || d.length > 120) return json({ error: "Escribe tu ID o tu correo." }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    let q = db.from("perfiles").select("user_id,codigo,email,nombre,ultimo_reset");
    if (d.includes("@")) q = q.eq("email", d.toLowerCase());
    else {
      d = d.toUpperCase().replace(/\s+/g, "");
      if (/^[A-Z0-9]{5}$/.test(d)) d = "TOMO-" + d;
      q = q.eq("codigo", d);
    }
    const { data: p } = await q.maybeSingle();
    if (!p) return respuesta;

    // Como mucho una contraseña nueva cada 10 minutos por cuenta
    if (p.ultimo_reset && Date.now() - new Date(p.ultimo_reset).getTime() < 10 * 60_000) return respuesta;

    const clave = nuevaClave();
    const { error } = await db.auth.admin.updateUserById(p.user_id, { password: clave });
    if (error) throw error;
    await db.from("perfiles").update({ debe_cambiar: true, ultimo_reset: new Date().toISOString() }).eq("user_id", p.user_id);

    const app = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");
    await enviarCorreo(p.email, "Tu nueva contraseña de Tomo", plantilla(`Hola, ${esc(p.nombre || "lector")}`,
      `Pediste entrar de nuevo a tu estante. Usa estos datos:` +
      datoGrande("Tu ID", p.codigo) + datoGrande("Contraseña temporal", clave) +
      `Al entrar, Tomo te pedirá crear una contraseña nueva. Si no fuiste tú, igual cámbiala al entrar: tu estante sigue a salvo.`,
      app ? { texto: "Entrar a Tomo", url: app + "/" } : undefined));
    return respuesta;
  } catch (e) {
    console.error(e);
    return json({ error: "No pudimos enviarte el correo. Intenta en unos minutos." }, 500);
  }
});
