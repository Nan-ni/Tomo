// Tomo · compartido: devuelve el estante y la lista de deseos de quien compartió su enlace, para verlos sin iniciar sesión.
// Solo sale lo que se ve en el estante: sin notas, préstamos ni precios. Las fotos propias van con un enlace que vence en 6 horas.
// Si el lector deja de compartir (se borra su fila en "compartidos"), el enlace responde 404.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, s = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json", ...extra } });

// Campos de cada libro que se pueden mostrar
const CAMPOS = ["id", "isbn", "tipo", "titulo", "autor", "editorial", "anio", "paginas", "portadaUrl", "portadaLocal", "portadaOtraEd", "genero", "serie", "tomo", "estado", "calificacion", "creado"];
const CAMPOS_COL = ["id", "propia", "clase", "nombre", "tipo", "total", "oculta"];
const solo = (o: Record<string, unknown>, campos: string[]) => Object.fromEntries(campos.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
// mismo nombre de archivo que usa cuenta.js al subir la foto
const ruta = (uid: string, id: string) => `${uid}/${String(id).replace(/[^A-Za-z0-9._-]/g, "_")}.jpg`;

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  try {
    const t = new URL(req.url).searchParams.get("t") || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return json({ error: "Enlace no válido." }, 400);

    const { data: c } = await db.from("compartidos").select("user_id").eq("token", t).maybeSingle();
    if (!c) return json({ error: "Este estante ya no se comparte." }, 404);
    const uid = c.user_id as string;

    const [{ data: e }, { data: p }] = await Promise.all([
      db.from("estantes").select("datos,actualizado").eq("user_id", uid).maybeSingle(),
      db.from("perfiles").select("nombre").eq("user_id", uid).maybeSingle(),
    ]);
    const d = (e?.datos || {}) as Record<string, any>;

    const libros = (Array.isArray(d.libros) ? d.libros : [])
      .filter((b: any) => b && b.id && b.titulo)
      .map((b: any) => solo(b, CAMPOS));
    const w = d.deseos || {};
    const deseos = {
      items: (Array.isArray(w.items) ? w.items : []).filter((x: any) => x && x.titulo).map((x: any) => solo(x, ["id", "titulo", "autor", "nota"])),
      ocultas: Array.isArray(w.ocultas) ? w.ocultas.filter((x: unknown) => typeof x === "string") : [],
    };
    const colecciones: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d.colecciones || {})) if (v && typeof v === "object") colecciones[k] = solo(v as Record<string, unknown>, CAMPOS_COL);

    // Fotos de portada propias: están en la carpeta privada del lector, así que se prestan con un enlace temporal
    const fotos: Record<string, string> = {};
    const conFoto = libros.filter((b: any) => b.portadaLocal);
    if (conFoto.length) {
      const porRuta = new Map(conFoto.map((b: any) => [ruta(uid, b.id), b.id as string]));
      const { data: firmados } = await db.storage.from("portadas").createSignedUrls([...porRuta.keys()], 6 * 3600);
      for (const f of firmados || []) if (f.signedUrl && f.path && porRuta.has(f.path)) fotos[porRuta.get(f.path)!] = f.signedUrl;
    }

    return json({ nombre: p?.nombre || "", actualizado: e?.actualizado || null, libros, deseos, colecciones, fotos }, 200, { "Cache-Control": "public, max-age=30" });
  } catch (err) {
    console.error(err);
    return json({ error: "No se pudo abrir el estante. Intenta en un rato." }, 500);
  }
});
