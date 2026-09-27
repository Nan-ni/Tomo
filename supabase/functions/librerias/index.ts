// Tomo · librerias: para los ISBN que Google Books y Open Library no tienen (muchos libros peruanos, colombianos, mexicanos
// y chilenos, y las ediciones de clubes como Tinta, que no se venden en tiendas).
//  ?isbn=…        busca en la agencia del ISBN del país del libro (Perú, Colombia, México o Chile) y en librerías
//                 (Crisol, Buscalibre, SBS, Penguin Libros)
//  ?url=…&isbn=…  lee la página de una tienda que pegó el lector (título, autor, editorial, año, páginas y portada)
// Lo que encuentra se guarda en la tabla libros_extra: el siguiente lector que escanee ese ISBN lo tiene al instante.
// Sin secretos nuevos. Solo lectores con sesión iniciada.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

type Datos = { titulo?: string; autor?: string; editorial?: string; anio?: string; paginas?: string; portadaUrl?: string; fuente?: string; enlace?: string };
type Pagina = { url: string; status: number; tipo: string; texto: string };
type Intento = { fuente: string; resultado: string };

// Las agencias del ISBN: cada país registra ahí todos sus libros, también los que no se venden en tiendas (las ediciones
// de un club de lectura, las de una universidad…). Estas cuatro usan el mismo sistema de catálogo (el del Cerlalc).
const AGENCIAS = [
  { nombre: "Agencia Peruana del ISBN", solo: /^978(612|9972)/, web: "https://isbn.bnp.gob.pe" },
  { nombre: "Agencia Colombiana del ISBN", solo: /^978(958|628)/, web: "https://isbn.camlibro.com.co" },
  { nombre: "Agencia Mexicana del ISBN", solo: /^978(607|968|970)/, web: "https://isbnmexico.indautor.cerlalc.org" },
  { nombre: "Agencia Chilena del ISBN", solo: /^978956/, web: "https://isbnchile.cl" },
];
const ES_AGENCIA = new Set(AGENCIAS.map((a) => a.nombre));
// Buscalibre tiene una tienda por país: además de la peruana, la del país del libro
const BUSCALIBRE_PAIS: [RegExp, string][] = [[/^978(958|628)/, "https://www.buscalibre.com.co"], [/^978(607|968|970)/, "https://www.buscalibre.com.mx"], [/^978956/, "https://www.buscalibre.cl"]];
// Dónde buscar. Cada librería se prueba con sus direcciones en orden hasta que una trae el libro.
const FUENTES: { nombre: string; solo?: RegExp; urls: (i: string) => string[] }[] = [
  ...AGENCIAS.map((a) => ({ nombre: a.nombre, solo: a.solo, urls: (i: string) => [
    `${a.web}/catalogo.php?mode=busqueda_rapida&palabra=${i}`,
    `${a.web}/catalogo.php?mode=resultados_rapidos&palabra=${i}`] })),
  { nombre: "Crisol", urls: (i) => [
    `https://www.crisol.com.pe/api/catalog_system/pub/products/search?ft=${i}`,
    `https://www.crisol.com.pe/catalogsearch/result/?q=${i}`] },
  { nombre: "Buscalibre", urls: (i) => [`https://www.buscalibre.pe/libros/search?q=${i}`,
    ...BUSCALIBRE_PAIS.filter(([re]) => re.test(i)).map(([, web]) => `${web}/libros/search?q=${i}`)] },
  { nombre: "SBS", urls: (i) => [`https://www.sbs.com.pe/catalogsearch/result/?q=${i}`] },
  { nombre: "Penguin Libros", urls: (i) => [`https://www.penguinlibros.com/pe/index.php?controller=search&s=${i}`] },
];
const TIENDAS = /buscalibre|crisol|\bsbs\b|penguin libros|ibero|librer[ií]as?\b|bookstore|amazon|mercado ?libre|falabella|tienda|comprar|env[ií]o|precio|oferta|\.com|\.pe\b/i;
const NAVEGADOR = {
  "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "es-PE,es;q=0.9,en;q=0.5",
};

// ---------- traer una página sin salir a direcciones internas ----------
function permitido(u: URL) {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h) || /^0x/i.test(h)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp|arpa)$/.test(h) && !/\.supabase\.(co|in)$/.test(h);
}
async function leer(r: Response, max = 2_000_000) {
  if (!r.body) return "";
  const reader = r.body.getReader(); const partes: Uint8Array[] = []; let n = 0;
  while (n < max) { const { done, value } = await reader.read(); if (done) break; partes.push(value); n += value.length; }
  if (n >= max) await reader.cancel().catch(() => {});
  const buf = new Uint8Array(Math.min(n, max)); let o = 0;
  for (const p of partes) { if (o >= buf.length) break; const q = p.subarray(0, buf.length - o); buf.set(q, o); o += q.length; }
  const cs = (r.headers.get("content-type") || "").match(/charset=["']?([\w-]+)/i)?.[1];
  let t = ""; try { t = new TextDecoder(cs || "utf-8").decode(buf); } catch { t = new TextDecoder().decode(buf); }
  if (!cs) { const m = t.slice(0, 4000).match(/<meta[^>]+charset=["']?([\w-]+)/i); if (m && !/utf-?8/i.test(m[1])) { try { t = new TextDecoder(m[1]).decode(buf); } catch { /* se queda en utf-8 */ } } }
  return t;
}
async function traer(url: string, ms = 7000): Promise<Pagina> {
  let u = new URL(url);
  for (let i = 0; i < 5; i++) {
    if (!permitido(u)) throw new Error("dirección no permitida");
    const r = await fetch(u.href, { headers: NAVEGADOR, redirect: "manual", signal: AbortSignal.timeout(ms) });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) { await r.body?.cancel().catch(() => {}); u = new URL(loc, u); continue; }
    return { url: u.href, status: r.status, tipo: r.headers.get("content-type") || "", texto: await leer(r) };
  }
  throw new Error("demasiadas redirecciones");
}

// ---------- leer la ficha de un libro en cualquier página ----------
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", uuml: "ü", Uuml: "Ü", iexcl: "¡", iquest: "¿", ordm: "º", ordf: "ª", deg: "°", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", ccedil: "ç", middot: "·" };
const decodificar = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] !== "#") return ENT[e] ?? m;
  const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; });
const limpio = (s: unknown) => decodificar(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const atributos = (tag: string) => { const a: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) a[m[1].toLowerCase()] = decodificar(m[3] ?? m[4] ?? m[5] ?? ""); return a; };
const digitos = (s: unknown) => String(s ?? "").replace(/[^\dXx]/g, "").toUpperCase();
// el ISBN escrito en la página, con o sin guiones o espacios
const reIsbn = (isbn: string) => new RegExp(isbn.split("").join("[\\s\\u2010-\\u2014-]?"));
function isbn10(i: string) {
  if (!/^978\d{10}$/.test(i)) return "";
  const b = i.slice(3, 12); let s = 0; for (let k = 0; k < 9; k++) s += (10 - k) * +b[k];
  const c = (11 - (s % 11)) % 11; return b + (c === 10 ? "X" : String(c));
}
// (sin contar las cajas de búsqueda, que repiten el número que se buscó)
const mencionaIsbn = (texto: string, isbn: string) => { if (!isbn) return false; texto = texto.replace(/<(input|textarea)\b[^>]*>/gi, " ");
  return reIsbn(isbn).test(texto) || (!!isbn10(isbn) && reIsbn(isbn10(isbn)).test(texto)); };

function metas(html: string) {
  const m: Record<string, string> = {};
  for (const t of html.match(/<meta\b[^>]*>/gi) || []) { const a = atributos(t); const k = (a.property || a.name || a.itemprop || "").toLowerCase(); if (k && a.content && !(k in m)) m[k] = a.content.trim(); }
  return m;
}
function microdatos(html: string) {
  const m: Record<string, string> = {};
  for (const x of html.matchAll(/<(\w+)\b([^>]*\bitemprop=["']?([\w]+)["']?[^>]*)>/gi)) {
    const k = x[3].toLowerCase(); if (k in m) continue; const a = atributos(x[2]);
    const v = a.content || (x[1].toLowerCase() === "img" ? a.src : "") || (x[1].toLowerCase() === "link" || x[1].toLowerCase() === "meta" ? a.href : "")
      || limpio(html.slice((x.index || 0) + x[0].length, (x.index || 0) + x[0].length + 600).split(/<\/(?:\w+)>/)[0]);
    if (v) m[k] = v.trim();
  }
  return m;
}
function jsonLd(html: string) {
  const out: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j: unknown; const src = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try { j = JSON.parse(src); } catch { try { j = JSON.parse(src.replace(/[\u0000-\u001f]+/g, " ").replace(/,\s*([}\]])/g, "$1")); } catch { continue; } }
    const pila: unknown[] = [j];
    while (pila.length && out.length < 200) {
      const x = pila.pop(); if (!x || typeof x !== "object") continue;
      if (Array.isArray(x)) { pila.push(...x); continue; }
      const o = x as Record<string, unknown>; out.push(o);
      for (const k of ["@graph", "mainEntity", "itemListElement", "item", "workExample", "hasVariant", "offers"]) if (o[k] && typeof o[k] === "object") pila.push(o[k]);
    }
  }
  return out;
}
const tipos = (o: Record<string, unknown>) => ([] as unknown[]).concat(o["@type"] || []).map((t) => String(t).replace(/^.*[/#]/, ""));
const esFicha = (o: Record<string, unknown>) => tipos(o).some((t) => /^(Book|Product|ProductGroup|IndividualProduct|ProductModel)$/i.test(t));
const nombre = (v: unknown): string => {
  if (!v) return ""; if (Array.isArray(v)) return v.map(nombre).filter(Boolean).join(", ");
  if (typeof v === "object") { const o = v as Record<string, unknown>; return limpio(o.name || o["@value"] || ""); }
  return limpio(v); };
const imagen = (v: unknown): string => {
  if (!v) return ""; if (Array.isArray(v)) { for (const x of v) { const r = imagen(x); if (r) return r; } return ""; }
  if (typeof v === "object") { const o = v as Record<string, unknown>; return imagen(o.url || o.contentUrl || o["@id"]); }
  return String(v).trim(); };
const isbnsDe = (o: Record<string, unknown>) => ["isbn", "gtin13", "gtin", "gtin12", "productID", "sku", "mpn"].map((k) => digitos(nombre(o[k])));

// "Autor: Julio Cortázar", "Editorial | Alfaguara", "N° de páginas 730"… en tablas, listas o texto
const ETIQUETAS: [keyof Datos | "isbn", RegExp][] = [
  ["autor", /^(autor(es|\(es\)|a|as)?|escrito por|author|autor\/es)$/i],
  ["editorial", /^(editorial|sello( editorial)?|editor(es)?|publisher|casa editora)$/i],
  ["anio", /^(a[ñn]o( de (edici[oó]n|publicaci[oó]n))?|fecha de (edici[oó]n|publicaci[oó]n|lanzamiento)|publicaci[oó]n|publicado|publication date|release date)$/i],
  ["paginas", /^((n[°ºo.]*|nro\.?|n[uú]mero( de)?|cantidad( de)?|num\.?)\s*(de )?p[aá]g(inas|s|\.)?|p[aá]ginas|pages|extensi[oó]n)$/i],
  ["titulo", /^(t[ií]tulo|title|nombre del libro)$/i],
  ["isbn", /^(isbn(-?1[03])?|ean(-?13)?|c[oó]digo( de barras)?)$/i],
];
function lineas(html: string) {
  const t = html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(tr|td|th|li|dt|dd|div|p|br|h[1-6]|table|tbody|ul|ol|section|article|span|strong|b|label|a|option)\b[^>]*>/gi, "\n").replace(/<[^>]*>/g, " ");
  return decodificar(t).split(/\n/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
}
function etiquetas(html: string) {
  const ls = lineas(html), out: Record<string, string> = {};
  const cual = (s: string) => { const x = s.replace(/[:：]\s*$/, "").trim(); for (const [k, re] of ETIQUETAS) if (re.test(x)) return k; return ""; };
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^([^:：|]{2,40}?)\s*[:：|]\s*(.{1,200})$/);
    if (m) { const k = cual(m[1]); if (k && !(k in out)) { out[k] = m[2].trim(); continue; } }
    const k = cual(ls[i]);
    if (k && !(k in out) && ls[i + 1] && !cual(ls[i + 1]) && ls[i + 1].length <= 200) out[k] = ls[i + 1].replace(/^[:：|]\s*/, "").trim();
  }
  return out;
}

// ---------- ordenar lo encontrado ----------
const esMayus = (s: string) => /\p{L}{2}/u.test(s) && s === s.toUpperCase() && s !== s.toLowerCase();
const PARTICULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "das", "do", "dos", "van", "von", "der", "di", "el"]);
const nombrePropio = (s: string) => s.toLowerCase().split(/(\s+|-)/).map((w, i) => (i > 0 && PARTICULAS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join("");
function arreglarAutor(a: string) {
  a = limpio(a).replace(/^(por|de|by)\s+/i, "").replace(/\s*\(\s*(autor|author|ed\.?|editor|ilustrador|traductor)[^)]*\)/gi, "").replace(/\s*[,;]?\s*\d{4}\s*-\s*(\d{4})?\s*$/, "").trim();
  if (!a || a.length > 150 || TIENDAS.test(a)) return "";
  return a.split(/\s*;\s*|\s+\/\s+/).map((x) => {
    const m = x.match(/^([^,]+),\s*([^,]+)$/); if (m && m[2].split(/\s+/).length <= 3) x = `${m[2]} ${m[1]}`; // "Cortázar, Julio" → "Julio Cortázar"
    return esMayus(x) ? nombrePropio(x) : x;
  }).filter(Boolean).join(", ");
}
function arreglarTitulo(t: string, autor = "") {
  t = limpio(t); if (!t) return "";
  // "Rayuela | JULIO CORTAZAR | Comprar libro en Crisol" → "Rayuela" (pero "Harry Potter - La piedra filosofal" se queda entero)
  const partes = t.split(/\s+[|–—]\s+|\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  const na = autor.toLowerCase(), sobra = (x: string) => TIENDAS.test(x) || (!!na && x.toLowerCase() === na);
  if (partes.length > 1 && partes.slice(1).some(sobra)) t = partes.filter((x) => !sobra(x))[0] || partes[0];
  t = t.replace(/^libro\s+/i, "");
  if (na) { const re = new RegExp(`\\s+(de|por)\\s+${na.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "i"); t = t.replace(re, ""); }
  t = t.replace(/\s*[([]?\b(tapa (blanda|dura)|r[uú]stica|bolsillo|spanish edition|edici[oó]n en espa[ñn]ol)\b[)\]]?\s*$/i, "").trim();
  if (esMayus(t)) t = t.charAt(0) + t.slice(1).toLowerCase().replace(/\b(i{1,3}|iv|vi{0,3}|ix|x{1,3})\b/g, (r) => r.toUpperCase());
  return t.slice(0, 200);
}
const anioDe = (s: unknown) => (String(s ?? "").match(/\b(1[5-9]\d\d|20\d\d)\b/) || [""])[0];
const paginasDe = (s: unknown) => { const n = +(String(s ?? "").match(/\d{1,5}/) || [""])[0]; return n > 0 && n < 20000 ? String(n) : ""; };
function portada(u: string, base: string) {
  if (!u) return ""; try { const x = new URL(u.trim(), base); if (!/^https?:$/.test(x.protocol)) return "";
    if (/logo|placeholder|no[-_]?image|sin[-_]?imagen|noimage|default|blank|spacer|pixel|favicon/i.test(x.pathname)) return "";
    x.protocol = "https:"; return x.href; } catch { return ""; }
}

// Una página → los datos del libro. Con isbn: prefiere la ficha de ese ISBN (una página de resultados puede traer varios).
function leerFicha(html: string, url: string, isbn = "") {
  const lds = jsonLd(html).filter(esFicha);
  const ld = (isbn && lds.find((o) => isbnsDe(o).some((d) => d === isbn || (d && d === isbn10(isbn))))) || (lds.length === 1 || !isbn ? lds[0] : undefined) || {};
  const me = metas(html), mi = microdatos(html), et = etiquetas(html);
  const props: Record<string, string> = {}; // additionalProperty de schema.org (muchas tiendas ponen ahí autor y páginas)
  for (const p of ([] as unknown[]).concat((ld as Record<string, unknown>).additionalProperty || [])) { const o = p as Record<string, unknown>; if (o?.name) props[limpio(o.name).toLowerCase()] = limpio(o.value); }
  const prop = (re: RegExp) => Object.entries(props).find(([k]) => re.test(k))?.[1] || "";
  const h1 = limpio((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const titleTag = limpio((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const autor = arreglarAutor(nombre(ld.author) || mi.author || prop(/^autor/) || et.autor || me["book:author"] || "");
  const marca = nombre(ld.brand); const editorial = limpio(nombre(ld.publisher) || mi.publisher || prop(/editorial|sello/) || et.editorial || (marca && !TIENDAS.test(marca) ? marca : "") || me["product:brand"] || "");
  const d: Datos = {
    titulo: arreglarTitulo(nombre(ld.name) || mi.name || et.titulo || me["og:title"] || h1 || titleTag, autor),
    autor,
    editorial: editorial.length <= 100 && !TIENDAS.test(editorial) ? editorial : "",
    anio: anioDe(nombre(ld.datePublished) || nombre(ld.copyrightYear) || mi.datepublished || prop(/a[ñn]o|fecha|publica/) || et.anio || me["book:release_date"]),
    paginas: paginasDe(nombre(ld.numberOfPages) || mi.numberofpages || prop(/p[aá]gina/) || et.paginas),
    portadaUrl: portada(imagen(ld.image) || me["og:image"] || me["og:image:secure_url"] || mi.image || me["twitter:image"] || "", url),
  };
  const esProducto = Object.keys(ld).length > 0 || /product|book/i.test(me["og:type"] || "") || /schema\.org\/(Book|Product)/i.test(html) || !!(et.editorial || et.paginas || et.isbn);
  // coincide: la ficha misma dice que es ese ISBN (no solo que el número aparece en algún lado de la página)
  const suyo = (v: unknown) => { const x = digitos(v); return !!isbn && (x.includes(isbn) || (!!isbn10(isbn) && x.includes(isbn10(isbn)))); };
  const coincide = !!isbn && (isbnsDe(ld).some((x) => x === isbn || x === isbn10(isbn)) || suyo(et.isbn) || suyo(mi.isbn) || suyo(me["book:isbn"]));
  // la ficha dice que es OTRO ISBN: aunque el nuestro aparezca en la página, no es este libro
  const declarados = [...isbnsDe(ld), digitos(et.isbn), digitos(mi.isbn), digitos(me["book:isbn"])].filter((x) => /^97[89]\d{10}$/.test(x));
  const otro = !coincide && declarados.length > 0;
  return { d, esProducto, coincide, menciona: coincide || (!otro && mencionaIsbn(html, isbn)) };
}

// VTEX (la plataforma de muchas tiendas de Latinoamérica) tiene una búsqueda en JSON
function leerVtex(texto: string, isbn: string, base: string): Datos | null {
  let a: unknown; try { a = JSON.parse(texto); } catch { return null; }
  if (!Array.isArray(a)) return null;
  for (const p of a as Record<string, unknown>[]) {
    const items = (p.items as Record<string, unknown>[]) || [];
    const ids = [p.productReference, p.productReferenceCode, ...items.map((i) => i.ean), ...items.map((i) => (i.referenceId as { Value?: string }[] | undefined)?.[0]?.Value)].map(digitos);
    if (!ids.includes(isbn) && !mencionaIsbn(JSON.stringify(p), isbn)) continue;
    const campo = (re: RegExp) => { for (const [k, v] of Object.entries(p)) if (re.test(k) && Array.isArray(v) && v.length) return limpio(v[0]); return ""; };
    const img = (items[0]?.images as { imageUrl?: string }[] | undefined)?.[0]?.imageUrl || "";
    const autor = arreglarAutor(campo(/^autor/i));
    return { titulo: arreglarTitulo(String(p.productName || ""), autor), autor, editorial: limpio(campo(/editorial|sello/i) || p.brand || ""),
      anio: anioDe(campo(/a[ñn]o|fecha|publica/i)), paginas: paginasDe(campo(/p[aá]gina/i)), portadaUrl: portada(img, base), enlace: String(p.link || "") };
  }
  return null;
}

// Enlaces de una página de resultados que pueden llevar a la ficha del libro (primero los que traen el ISBN)
function enlaces(html: string, base: string, isbn: string) {
  const b = new URL(base), ls = b.hostname.split("."), out: [number, string][] = [];
  const raiz = ls.slice(ls.length >= 3 && ls[ls.length - 2].length <= 3 && ls[ls.length - 1].length === 2 ? -3 : -2).join("."); // crisol.com.pe, no com.pe
  for (const m of html.matchAll(/<a\b([^>]*)>/gi)) {
    const a = atributos(m[1]); if (!a.href || /^(#|javascript:|mailto:|tel:)/i.test(a.href)) continue;
    let u: URL; try { u = new URL(a.href, b); } catch { continue; }
    if (!u.hostname.endsWith(raiz) || u.href === b.href) continue;
    const href = decodeURIComponent(u.href);
    const p = href.includes(isbn) || (isbn10(isbn) && href.includes(isbn10(isbn))) ? 3 : /mode=detalle|[?&]nt=\d/.test(href) ? 2
      : /product-item-link|product-item-photo|product-name|product__title|product-title|product_title|card__heading|woocommerce-LoopProduct-link|product-thumbnail|item-title|nombre-producto/i.test(a.class || "") ? 1 : 0;
    if (p) out.push([p, u.href]);
  }
  return [...new Set(out.sort((x, y) => y[0] - x[0]).map((x) => x[1]))].slice(0, 3);
}

// La primera promesa que trae algo (no la primera que termina)
function primero<T>(ps: Promise<T | null>[]): Promise<T | null> {
  return new Promise((res) => { let n = ps.length; if (!n) res(null);
    for (const p of ps) p.then((v) => { if (v) res(v); else if (--n === 0) res(null); }, () => { if (--n === 0) res(null); }); });
}
// Una dirección de búsqueda de una librería → la ficha del libro (o null, anotando por qué)
async function probar(url: string, isbn: string, fuente: string, motivos: string[]): Promise<Datos | null> {
  try {
    const p = await traer(url);
    if (p.status >= 400) { motivos.push(`respondió ${p.status}`); return null; }
    if (/json/i.test(p.tipo) || /^\s*\[/.test(p.texto)) { const v = leerVtex(p.texto, isbn, p.url); if (v?.titulo) return { ...v, fuente, enlace: v.enlace || p.url }; motivos.push("no lo tiene"); return null; }
    // la búsqueda a veces lleva directo a la ficha (y la página de resultados repite el número buscado: eso no cuenta)
    const aqui = leerFicha(p.texto, p.url, isbn);
    if (aqui.d.titulo && (aqui.coincide || (p.url !== url && aqui.esProducto && aqui.menciona))) return { ...aqui.d, fuente, enlace: p.url };
    const r = await primero(enlaces(p.texto, p.url, isbn).slice(0, 2).map(async (e) => {
      const q = await traer(e); if (q.status >= 400) return null;
      const x = leerFicha(q.texto, q.url, isbn); return x.menciona && x.d.titulo ? { ...x.d, fuente, enlace: q.url } : null;
    }));
    if (!r) motivos.push("no lo tiene");
    return r;
  } catch (e) { motivos.push(/abort|timeout/i.test(String(e)) ? "no respondió a tiempo" : "no se pudo conectar"); return null; }
}
// Todas las direcciones de una librería a la vez (solo una suele ser la buena): gana la primera que trae el libro
async function buscarEn(f: (typeof FUENTES)[number], isbn: string, intentos: Intento[]): Promise<Datos | null> {
  const motivos: string[] = [];
  const d = await primero(f.urls(isbn).map((u) => probar(u, isbn, f.nombre, motivos)));
  intentos.push({ fuente: f.nombre, resultado: d ? "encontrado" : (motivos.find((m) => m === "no lo tiene") || motivos[0] || "sin resultados") });
  return d;
}

// Junta lo de varias fuentes: la primera que tenga cada dato, pero mejor un título o autor que no esté TODO EN MAYÚSCULAS
function juntar(rs: Datos[]): Datos {
  const out: Datos = {};
  for (const k of ["titulo", "autor", "editorial", "anio", "paginas", "portadaUrl", "fuente", "enlace"] as (keyof Datos)[]) {
    const vs = rs.map((r) => r[k]).filter(Boolean) as string[];
    out[k] = (k === "titulo" || k === "autor" ? vs.find((v) => !esMayus(v)) : undefined) || vs[0] || "";
  }
  // la portada, mejor de una librería que de la agencia (que casi nunca tiene)
  out.portadaUrl = rs.find((r) => r.portadaUrl && !ES_AGENCIA.has(r.fuente || ""))?.portadaUrl || out.portadaUrl;
  out.editorial = sinRazonSocial(out.editorial || "");
  return out;
}

// En las agencias la editorial viene con su razón social: "Tinta - Club del Libro S.A.S." → "Tinta - Club del Libro"
const sinRazonSocial = (e: string) => e.replace(/[\s,.;-]+(S\.?\s?A\.?\s?S|S\.?\s?A\.?\s?C|S\.?\s?A\.?\s?de\s?C\.?\s?V|S\.?\s?de\s?R\.?\s?L\.?(\s?de\s?C\.?\s?V)?|S\.?\s?R\.?\s?L|S\.?\s?A\.?\s?U|S\.?\s?L\.?\s?U|E\.?\s?I\.?\s?R\.?\s?L|S\.?\s?p\.?\s?A|Ltda|Limitada|S\.?\s?A|SpA)\.?\s*$/i, "").trim() || e;

async function guardar(isbn: string, datos: Datos) {
  try { await db.from("libros_extra").upsert({ isbn, datos, fuente: datos.fuente || "", actualizado: new Date().toISOString() }); } catch { /* sin la tabla: igual se responde */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "Método no permitido" }, 405);
  const q = new URL(req.url).searchParams;
  if (q.get("ping")) return json({ ok: true }); // la app la despierta al abrir, así la primera búsqueda no espera el arranque
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Inicia sesión" }, 401);
  const isbn = digitos(q.get("isbn")).slice(0, 13);
  const valido = /^97[89]\d{10}$/.test(isbn);
  // la sesión y lo ya guardado se consultan a la vez
  const [{ data: u, error: eu }, guardado] = await Promise.all([
    db.auth.getUser(token),
    valido && !q.get("url") ? Promise.resolve(db.from("libros_extra").select("datos").eq("isbn", isbn).maybeSingle()).catch(() => ({ data: null })) : Promise.resolve({ data: null }),
  ]);
  if (eu || !u?.user) return json({ error: "Sesión no válida" }, 401);

  // --- un enlace que pegó el lector
  const enlace = (q.get("url") || "").trim().slice(0, 2000);
  if (enlace) {
    let u2: URL; try { u2 = new URL(enlace); } catch { return json({ encontrado: false, error: "Ese enlace no es válido." }); }
    if (!permitido(u2)) return json({ encontrado: false, error: "Ese enlace no es válido." });
    try {
      const p = await traer(u2.href, 9000);
      if (p.status >= 400) return json({ encontrado: false, error: `La página respondió ${p.status}. Prueba con otro enlace.` });
      const r = leerFicha(p.texto, p.url, valido ? isbn : "");
      if (!r.d.titulo) return json({ encontrado: false, error: "No encontré los datos del libro en esa página." });
      const datos = { ...r.d, fuente: new URL(p.url).hostname.replace(/^www\./, ""), enlace: p.url };
      if (valido && r.menciona) await guardar(isbn, datos); // solo si la página es de ese ISBN, para no confundir a otros lectores
      return json({ encontrado: true, datos, coincide: valido ? r.menciona : null });
    } catch (e) {
      return json({ encontrado: false, error: /abort|timeout/i.test(String(e)) ? "La página tardó demasiado. Intenta otra vez." : "No se pudo abrir esa página." });
    }
  }

  // --- buscar un ISBN
  if (!valido) return json({ error: "Falta un ISBN válido" }, 400);
  const c = (guardado as { data?: { datos?: Datos } | null })?.data;
  if (c?.datos?.titulo) return json({ encontrado: true, datos: c.datos, intentos: [{ fuente: "Tomo", resultado: "ya lo había encontrado otro lector" }] });
  const intentos: Intento[] = [];
  const fuentes = FUENTES.filter((f) => !f.solo || f.solo.test(isbn));
  // Todas a la vez. Cuando ya hay título, autor y portada se espera solo 0.7 s más (por si la agencia trae el nombre con tildes);
  // si falta algo (la agencia casi nunca tiene portada), como mucho 1.5 s más. Y nunca más de 11 s en total.
  const rs: Datos[] = [];
  await new Promise<void>((listo) => {
    let espera = 0, completo = false;
    Promise.all(fuentes.map((f) => buscarEn(f, isbn, intentos).then((d) => {
      if (!d) return; rs.push(d);
      const j = juntar(rs);
      if (!completo && j.titulo && j.autor && j.portadaUrl) { completo = true; clearTimeout(espera); espera = setTimeout(listo, 700); }
      else if (!espera) espera = setTimeout(listo, 1500);
    }).catch(() => {}))).then(() => listo());
    setTimeout(listo, 11000);
  });
  const hallados = rs.slice(), vistos = intentos.slice(); // las que sigan buscando ya no cuentan
  for (const f of fuentes) if (!vistos.some((i) => i.fuente === f.nombre)) vistos.push({ fuente: f.nombre, resultado: "no respondió a tiempo" });
  if (!hallados.length) return json({ encontrado: false, intentos: vistos });
  const orden = fuentes.map((f) => f.nombre);
  const datos = juntar(hallados.sort((a, b) => orden.indexOf(a.fuente || "") - orden.indexOf(b.fuente || "")));
  if (datos.titulo) await guardar(isbn, datos);
  return json({ encontrado: !!datos.titulo, datos, intentos: vistos });
});
