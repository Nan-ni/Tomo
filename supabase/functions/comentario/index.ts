// Tomo · comentario: un lector envía un error, una idea u otro comentario desde "Mi cuenta".
// Se guarda en la tabla "comentarios" y te llega por correo (a ADMIN_EMAIL). Si respondes ese correo, le llega al lector.
// Secretos: BREVO_API_KEY, REMITENTE_EMAIL, ADMIN_EMAIL
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

const TIPOS: Record<string, string> = { error: "🐞 Algo falla", idea: "💡 Una idea", otro: "💬 Otro" };
// Lo que la app manda para entender el comentario (y cómo se muestra en el correo)
const CONTEXTO: [string, string][] = [["version", "Versión"], ["vista", "Pantalla abierta"], ["libros", "Libros en su estante"], ["instalada", "Instalada como app"], ["pantalla", "Tamaño de pantalla"], ["dispositivo", "Dispositivo"]];
const POR_HORA = 20;   // comentarios por lector en una hora (más que eso es abuso)
const CORREOS_HORA = 5; // correos por lector en una hora (el resto se guarda igual, sin correo)
const CORREOS_DIA = 100; // correos de comentarios al día en total (Brevo gratis da 300 y también se usan para las cuentas)

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function plantilla(titulo: string, cuerpo: string) {
  return `<div style="background:#F3EEE4;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#1E1912">
  <div style="max-width:480px;margin:0 auto;background:#FFFCF6;border:1px solid #E2D9C8;border-radius:18px;padding:28px">
    <div style="font-family:Georgia,serif;font-size:22px;font-weight:bold;color:#1F4D3F;margin-bottom:14px">Tomo</div>
    <h1 style="font-family:Georgia,serif;font-size:21px;margin:0 0 12px">${titulo}</h1>
    <div style="font-size:15px;line-height:1.6;color:#5B5244">${cuerpo}</div>
  </div></div>`;
}

async function enviarCorreo(to: string, asunto: string, html: string, responderA?: { email: string; name: string }) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": Deno.env.get("BREVO_API_KEY")!, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: "Tomo", email: Deno.env.get("REMITENTE_EMAIL") },
      to: [{ email: to }],
      ...(responderA ? { replyTo: responderA } : {}),
      subject: asunto,
      htmlContent: html,
    }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  // Solo lectores con sesión iniciada
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inicia sesión" }, 401);
  const { data: u, error: eu } = await db.auth.getUser(token);
  if (eu || !u?.user) return json({ error: "Sesión no válida" }, 401);
  const uid = u.user.id;

  try {
    const body = await req.json().catch(() => ({}));
    const tipo = TIPOS[body.tipo] ? String(body.tipo) : "otro";
    const texto = String(body.texto || "").trim().slice(0, 2000);
    if (!texto) return json({ error: "Escribe tu comentario." }, 400);
    const id = /^[0-9a-f-]{36}$/i.test(String(body.id || "")) ? String(body.id) : crypto.randomUUID();
    const entrada = body.contexto && typeof body.contexto === "object" ? body.contexto : {};
    const contexto: Record<string, string | number | boolean> = {};
    for (const [k] of CONTEXTO) {
      const v = entrada[k];
      if (typeof v === "number" || typeof v === "boolean") contexto[k] = v;
      else if (typeof v === "string" && v) contexto[k] = v.slice(0, 250);
    }

    // Freno: cuántos envió este lector en la última hora (antes de guardar este)
    const hace1h = new Date(Date.now() - 3600_000).toISOString();
    const { count: suyos } = await db.from("comentarios").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("creado", hace1h);
    if ((suyos || 0) >= POR_HORA) return json({ error: "Enviaste muchos comentarios seguidos. Intenta en un rato." }, 429);

    const { error } = await db.from("comentarios").insert({ id, user_id: uid, tipo, texto, contexto });
    if (error) {
      if (String(error.code) === "23505") return json({ ok: true, correo: false }); // ya se había guardado (reintento)
      throw error;
    }

    // Ya quedó guardado: el correo es un aviso extra. Si falla, el comentario igual está en la tabla.
    let correo = false;
    try {
      const admin = Deno.env.get("ADMIN_EMAIL");
      const hace24h = new Date(Date.now() - 86400_000).toISOString();
      const { count: hoy } = await db.from("comentarios").select("id", { count: "exact", head: true }).gte("creado", hace24h);
      const { count: todos } = await db.from("envios").select("id", { count: "exact", head: true }).gte("creado", hace24h); // todos los correos de Tomo hoy
      if (admin && (suyos || 0) < CORREOS_HORA && (hoy || 0) <= CORREOS_DIA && (todos || 0) < 250) {
        await db.from("envios").insert({ tipo: "comentario", destino: uid });
        const { data: p } = await db.from("perfiles").select("codigo,nombre,email").eq("user_id", uid).maybeSingle();
        const codigo = p?.codigo || "sin ID";
        const nombre = (p?.nombre || "").trim() || codigo;
        const filas = CONTEXTO.filter(([k]) => k in contexto).map(([k, t]) => {
          const v = contexto[k];
          const valor = typeof v === "boolean" ? (v ? "Sí" : "No") : String(v);
          return `<tr><td style="padding:3px 12px 3px 0;color:#8A806F;vertical-align:top;white-space:nowrap">${t}</td><td style="padding:3px 0;color:#1E1912;word-break:break-word">${esc(valor)}</td></tr>`;
        }).join("");
        await enviarCorreo(admin, `${TIPOS[tipo]} · comentario de ${nombre} en Tomo`, plantilla(TIPOS[tipo],
          `<b>${esc(nombre)}</b> <span style="font-family:monospace;color:#8A806F">${esc(codigo)}</span> escribió:
          <div style="margin:12px 0 18px;padding:14px 16px;background:#F3EEE4;border-radius:12px;color:#1E1912;white-space:pre-wrap;word-break:break-word">${esc(texto)}</div>
          ${filas ? `<table style="font-size:13px;line-height:1.5;border-collapse:collapse">${filas}</table>` : ""}
          ${p?.email ? `<p style="margin:18px 0 0;font-size:13px">Si respondes este correo, la respuesta le llega a ${esc(p.email)}.</p>` : ""}`),
          p?.email ? { email: p.email, name: nombre } : undefined);
        correo = true;
      }
    } catch (e) {
      console.error("correo", e);
    }
    return json({ ok: true, correo });
  } catch (e) {
    console.error(e);
    const code = String((e as { code?: string })?.code || "");
    return json({ error: "No se pudo guardar el comentario.", code }, 500);
  }
});
