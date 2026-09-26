// Tomo · solicitar: alguien pide una cuenta. Te llega un correo para aprobarla o rechazarla.
// Secretos: BREVO_API_KEY, REMITENTE_EMAIL, ADMIN_EMAIL, APP_URL
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
    body: JSON.stringify({
      sender: { name: "Tomo", email: Deno.env.get("REMITENTE_EMAIL") },
      to: [{ email: to }],
      subject: asunto,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const nombre = String(body.nombre || "").trim().replace(/\s+/g, " ").slice(0, 60);
    const mensaje = String(body.mensaje || "").trim().slice(0, 300);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return json({ error: "Escribe un correo válido." }, 400);
    if (!nombre) return json({ error: "Escribe tu nombre." }, 400);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const app = (Deno.env.get("APP_URL") || "").replace(/\/$/, "");

    // ¿Ya tiene cuenta? Le recordamos su ID a su propio correo (a quien pregunta no se le dice nada)
    const { data: ya } = await db.from("perfiles").select("codigo").eq("email", email).limit(1);
    if (ya && ya.length) {
      await enviarCorreo(email, "Ya tienes una cuenta en Tomo", plantilla("Ya tienes una cuenta",
        `Alguien (seguramente tú) pidió una cuenta con este correo, pero ya tienes una.<br><br>Tu ID es <b style="font-family:monospace;font-size:17px;color:#1E1912">${ya[0].codigo}</b>.<br><br>Si no recuerdas tu contraseña, entra a Tomo y toca <b>¿Olvidaste tu contraseña?</b>.`,
        app ? { texto: "Ir a Tomo", url: app + "/" } : undefined));
      return json({ ok: true });
    }

    // Una sola solicitud pendiente por correo
    const { data: prev } = await db.from("solicitudes").select("id").eq("email", email).eq("estado", "pendiente").limit(1);
    if (prev && prev.length) return json({ ok: true });

    // Freno contra spam: como mucho 20 solicitudes por hora en total
    const hace1h = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("solicitudes").select("id", { count: "exact", head: true }).gte("creado", hace1h);
    if ((count || 0) >= 20) return json({ error: "Hay muchas solicitudes en este momento. Intenta en un rato." }, 429);

    const { data: sol, error } = await db.from("solicitudes").insert({ email, nombre, mensaje }).select("token").single();
    if (error) throw error;

    await enviarCorreo(Deno.env.get("ADMIN_EMAIL")!, `Nueva solicitud en Tomo: ${nombre}`, plantilla("Nueva solicitud de cuenta",
      `<b>${esc(nombre)}</b> quiere una cuenta.<br>Correo: ${esc(email)}${mensaje ? `<br><br><i>“${esc(mensaje)}”</i>` : ""}<br><br>Abre el enlace para aprobarla o rechazarla.`,
      { texto: "Revisar solicitud", url: `${app}/aprobar.html?t=${sol.token}` }));

    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ error: "No se pudo enviar la solicitud. Intenta más tarde." }, 500);
  }
});
