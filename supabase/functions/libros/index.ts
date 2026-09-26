// Tomo · libros: consulta Google Books con tu clave guardada en el servidor.
// Nadie ve la clave; solo quien inició sesión en Tomo puede usar esta función.
// Secreto: GOOGLE_BOOKS_KEY
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const PERMITIDOS = ["q", "maxResults", "printType", "startIndex", "langRestrict", "orderBy"];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);

  // Solo lectores con sesión iniciada
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inicia sesión" }, 401);
  const { data: u, error: eu } = await db.auth.getUser(token);
  if (eu || !u?.user) return json({ error: "Sesión no válida" }, 401);

  const key = Deno.env.get("GOOGLE_BOOKS_KEY");
  const entrada = new URL(req.url).searchParams;
  const salida = new URLSearchParams();
  for (const k of PERMITIDOS) { const v = entrada.get(k); if (v) salida.set(k, v.slice(0, 300)); }
  if (!salida.get("q")) return json({ error: "Falta la búsqueda" }, 400);
  if (key) salida.set("key", key);

  const r = await fetch("https://www.googleapis.com/books/v1/volumes?" + salida.toString());
  const cuerpo = await r.text();
  return new Response(cuerpo, {
    status: r.status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "private, max-age=3600" },
  });
});
