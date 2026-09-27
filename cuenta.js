// =====================================================================
//  Tomo · cuentas
//  Login con ID y contraseña, solicitud de cuenta, "olvidé mi contraseña",
//  cambio de contraseña, instalar como app y fotos de portada en la nube.
//  El estante (index.html) arranca recién cuando hay sesión: window.iniciarApp().
// =====================================================================
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const C = window.TOMO_CONFIG || {};
  const auth = $("#auth"), app = $("#app");

  function pag(p) {
    for (const el of auth.querySelectorAll("[data-p]")) el.hidden = el.dataset.p !== p;
    auth.hidden = false;
    const f = auth.querySelector(`[data-p="${p}"] input`);
    if (f) setTimeout(() => f.focus({ preventScroll: true }), 60);
  }
  const msg = (sel, t, ok) => { const el = $(sel); el.textContent = t || ""; el.classList.toggle("ok", !!ok); };
  function ocupado(form, si) {
    const b = form.querySelector('button[type="submit"]');
    if (!b) return;
    if (si) { b.dataset.t = b.textContent; b.disabled = true; b.innerHTML = '<span class="spin"></span> Un momento…'; }
    else { b.disabled = false; if (b.dataset.t) b.textContent = b.dataset.t; }
  }
  function aviso(t) {
    const r = $("#toastRoot"); if (!r) return;
    r.innerHTML = `<div class="toast">${String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>`;
    clearTimeout(aviso.t); aviso.t = setTimeout(() => (r.innerHTML = ""), 3200);
  }

  // Ojito para ver la contraseña
  auth.addEventListener("click", (e) => {
    const eye = e.target.closest(".eye"); if (!eye) return;
    const inp = eye.parentElement.querySelector("input");
    inp.type = inp.type === "password" ? "text" : "password";
    eye.setAttribute("aria-pressed", inp.type === "text");
  });
  auth.addEventListener("click", (e) => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); pag(g.dataset.go); } });

  const configurado = C.supabaseUrl && !/TU-PROYECTO/.test(C.supabaseUrl) && C.supabaseKey && !/TU-CLAVE/.test(C.supabaseKey);
  if (!configurado) {
    $('[data-p="boot"]').innerHTML = "<h1>Falta configurar Tomo</h1><p class='auth-p'>Completa <b>config.js</b> con la dirección y la clave pública de tu proyecto de Supabase.</p>";
    return;
  }
  // ---------- estante compartido: con el enlace (…/?e=…) se ve sin iniciar sesión ----------
  const tokenVer = new URLSearchParams(location.search).get("e");
  if (tokenVer) { verCompartido(tokenVer); return; }
  async function verCompartido(token) {
    const boot = $('[data-p="boot"]'), escH = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    boot.innerHTML = '<div class="auth-load"><span class="spin"></span> Abriendo el estante…</div>';
    pag("boot");
    const fnUrl = C.supabaseUrl.replace(/\/$/, "") + "/functions/v1";
    let d = null, error = "";
    try {
      const r = await fetch(`${fnUrl}/compartido?t=${encodeURIComponent(token)}`, { headers: { apikey: C.supabaseKey } });
      const j = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(j.libros)) d = j; else error = j.error || "No se pudo abrir este estante. Intenta en un rato.";
    } catch (e) { error = "Sin conexión. Revisa tu internet y vuelve a abrir el enlace."; }
    if (!d) {
      boot.innerHTML = `<h1>No se pudo abrir el estante</h1><p class="auth-p">${escH(error)}</p><a class="btn primary big" href="./">Ir a Tomo</a>`;
      return;
    }
    window.TOMO = {
      fnUrl, uid: "", token: "", perfil: { nombre: d.nombre || "" }, soloVer: true, compartido: d, iniciado: true, aviso,
      authHeaders() { return { apikey: C.supabaseKey }; }, estadoNube() {},
    };
    document.documentElement.classList.add("solo-ver");
    auth.hidden = true; app.hidden = false;
    window.iniciarApp();
  }

  if (!window.supabase) {
    $('[data-p="boot"]').innerHTML = "<h1>No se pudo abrir Tomo</h1><p class='auth-p'>Revisa tu conexión a internet y vuelve a abrir la página.</p>";
    return;
  }

  const DOM = C.dominioId || "tomo.invalid";
  const sb = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "tomo.sesion" },
  });
  const T = (window.TOMO = {
    sb, fnUrl: C.supabaseUrl.replace(/\/$/, "") + "/functions/v1",
    uid: "", token: "", perfil: null, iniciado: false,
    // La sesión vence cada hora: si el celular estuvo en pausa, T.token puede estar vencido. getSession la renueva si hace falta
    // (sin esperar más de 4 s: sin internet igual se intenta con la que hay).
    async authHeaders() {
      let tk = T.token;
      try { const r = await Promise.race([sb.auth.getSession(), new Promise((res) => setTimeout(() => res(null), 4000))]); tk = r?.data?.session?.access_token || tk; } catch (e) {}
      return { Authorization: "Bearer " + tk, apikey: C.supabaseKey };
    },
    aviso,
  });
  sb.auth.onAuthStateChange((ev, s) => {
    T.token = s?.access_token || "";
    if (ev === "SIGNED_OUT" && T.iniciado) location.reload();
  });

  async function fn(nombre, body) {
    let r;
    try {
      r = await fetch(`${T.fnUrl}/${nombre}`, { method: "POST", headers: { "Content-Type": "application/json", apikey: C.supabaseKey }, body: JSON.stringify(body) });
    } catch (e) { throw new Error("Sin conexión. Revisa tu internet."); }
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || "Algo falló. Intenta de nuevo.");
    return j;
  }

  // ---------- perfil (ID, nombre y si tiene contraseña temporal) ----------
  const perfilKey = () => "tomo.perfil." + T.uid;
  async function cargarPerfil() {
    try {
      const { data, error } = await sb.from("perfiles").select("codigo,nombre,debe_cambiar").eq("user_id", T.uid).single();
      if (error) throw error;
      localStorage.setItem(perfilKey(), JSON.stringify(data));
      return data;
    } catch (e) {
      return perfilLocal(); // sin internet: el último conocido
    }
  }
  T.guardarNombre = (v) => {
    T.perfil.nombre = v;
    try { localStorage.setItem(perfilKey(), JSON.stringify(T.perfil)); } catch (e) {}
    sb.from("perfiles").update({ nombre: v }).eq("user_id", T.uid).then(({ error }) => { if (error) aviso("No se pudo guardar el nombre en tu cuenta."); });
  };

  const perfilLocal = () => { try { return JSON.parse(localStorage.getItem(perfilKey()) || "null"); } catch (e) { return null; } };
  // sinRed: se entra con la sesión guardada en este dispositivo, sin esperar a Supabase
  async function entrar(session, sinRed) {
    T.uid = session.user.id; T.token = session.access_token;
    const p = (sinRed && perfilLocal()) || await cargarPerfil();
    if (!p) {
      await sb.auth.signOut().catch(() => {});
      pag("login"); msg("#lMsg", "No encontramos tu perfil. Si el problema sigue, pide ayuda a quien te dio la cuenta.");
      return;
    }
    T.perfil = p;
    if (p.debe_cambiar) return abrirCambio(true);
    arrancar();
  }
  function arrancar() {
    auth.hidden = true; app.hidden = false;
    $("#menuId").textContent = T.perfil.codigo;
    if (!T.iniciado) { T.iniciado = true; window.iniciarApp(); }
  }

  // ---------- ingresar ----------
  $("#fLogin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    let id = $("#lId").value.trim().toUpperCase().replace(/\s+/g, "");
    const pw = $("#lPw").value;
    if (/^[A-Z0-9]{5}$/.test(id)) id = "TOMO-" + id;
    if (!id || !pw) return msg("#lMsg", "Escribe tu ID y tu contraseña.");
    msg("#lMsg", ""); ocupado(f, true);
    const { data, error } = await sb.auth.signInWithPassword({ email: `${id.toLowerCase()}@${DOM}`, password: pw });
    ocupado(f, false);
    if (error) {
      msg("#lMsg", /fetch|network|failed/i.test(error.message) ? "Sin conexión. Revisa tu internet." : /rate|too many/i.test(error.message) ? "Demasiados intentos. Espera unos minutos." : "ID o contraseña incorrectos.");
      return;
    }
    $("#lPw").value = "";
    entrar(data.session);
  });

  // ---------- solicitar una cuenta ----------
  $("#fSol").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const nombre = $("#sNombre").value.trim(), email = $("#sMail").value.trim(), mensaje = $("#sMsg").value.trim();
    if (!nombre) return msg("#sErr", "Escribe tu nombre.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return msg("#sErr", "Escribe un correo válido.");
    msg("#sErr", ""); ocupado(f, true);
    try {
      await fn("solicitar", { nombre, email, mensaje });
      $("#sMailOk").textContent = email; f.reset(); pag("enviado");
    } catch (err) { msg("#sErr", err.message); }
    finally { ocupado(f, false); }
  });

  // ---------- olvidé mi contraseña ----------
  $("#fOlv").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, dato = $("#oDato").value.trim();
    if (!dato) return msg("#oErr", "Escribe tu ID o tu correo.");
    msg("#oErr", ""); ocupado(f, true);
    try { await fn("olvide", { dato }); f.reset(); pag("olvEnviado"); }
    catch (err) { msg("#oErr", err.message); }
    finally { ocupado(f, false); }
  });

  // ---------- crear una contraseña nueva desde el enlace del correo (?r=…) ----------
  // El enlace se saca de la barra de direcciones al abrirlo (no queda en el historial ni se comparte por error)
  const tokenR = (() => { const u = new URL(location.href), t = u.searchParams.get("r") || "";
    if (t) { u.searchParams.delete("r"); history.replaceState(null, "", u.pathname + (u.search || "") + u.hash); }
    return /^[A-Za-z0-9_-]{40,64}$/.test(t) ? t : ""; })();
  $("#fRes").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, a = $("#rs1").value, b = $("#rs2").value;
    if (a.length < 8) return msg("#rErr", "Usa al menos 8 caracteres.");
    if (a !== b) return msg("#rErr", "Las dos contraseñas no coinciden.");
    msg("#rErr", ""); ocupado(f, true);
    try {
      const j = await fn("olvide", { token: tokenR, clave: a });
      await sb.auth.signOut({ scope: "local" }).catch(() => {}); // si en este dispositivo había otra sesión abierta, se cierra
      f.reset(); if (j.codigo) $("#lId").value = j.codigo;
      pag("login"); msg("#lMsg", "¡Listo! Ya puedes ingresar con tu contraseña nueva.", true);
    } catch (err) { msg("#rErr", err.message); }
    finally { ocupado(f, false); }
  });

  // ---------- crear / cambiar contraseña ----------
  let cambioForzado = false;
  function abrirCambio(forzado) {
    cambioForzado = forzado;
    $("#pwT").textContent = forzado ? "Crea tu contraseña" : "Cambiar contraseña";
    $("#pwP").textContent = forzado
      ? `Hola${T.perfil?.nombre ? ", " + T.perfil.nombre : ""}. Estás usando una contraseña temporal; elige una tuya para seguir.`
      : "Elige una contraseña nueva para tu cuenta.";
    $("#pwCancel").hidden = forzado;
    $("#fPw").reset(); msg("#pErr", "");
    pag("cambiar");
  }
  $("#pwCancel").addEventListener("click", () => { auth.hidden = true; });
  $("#fPw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget, a = $("#pw1").value, b = $("#pw2").value;
    if (a.length < 8) return msg("#pErr", "Usa al menos 8 caracteres.");
    if (a !== b) return msg("#pErr", "Las dos contraseñas no coinciden.");
    msg("#pErr", ""); ocupado(f, true);
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) {
      ocupado(f, false);
      msg("#pErr", /different|same/i.test(error.message) ? "Elige una contraseña distinta a la temporal." : /weak|short/i.test(error.message) ? "Esa contraseña es muy débil. Prueba con otra." : "No se pudo guardar. Revisa tu conexión.");
      return;
    }
    await sb.from("perfiles").update({ debe_cambiar: false }).eq("user_id", T.uid);
    T.perfil.debe_cambiar = false;
    try { localStorage.setItem(perfilKey(), JSON.stringify(T.perfil)); } catch (err) {}
    ocupado(f, false); f.reset();
    if (cambioForzado) { arrancar(); aviso("¡Listo! Ya puedes usar tu estante."); }
    else { auth.hidden = true; aviso("Contraseña cambiada"); }
  });

  // ---------- menú "Mi cuenta" ----------
  const cerrarMenu = () => { const m = $("#dataMenu"); if (m) m.open = false; };
  $("#pwBtn").addEventListener("click", () => { cerrarMenu(); abrirCambio(false); });
  $("#logoutBtn").addEventListener("click", async () => {
    cerrarMenu();
    await sb.auth.signOut().catch(() => {});
    location.reload();
  });

  // ---------- instalar como app ----------
  let instalador = null;
  // El iPad (iPadOS 13 o más nuevo) se presenta como Mac: se reconoce porque tiene pantalla táctil
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const instalada = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); instalador = e; $("#installBtn").hidden = false; });
  window.addEventListener("appinstalled", () => { $("#installBtn").hidden = true; aviso("¡Tomo quedó instalado!"); });
  if (esIOS && !instalada) $("#installBtn").hidden = false;
  $("#installBtn").addEventListener("click", async () => {
    cerrarMenu();
    if (instalador) { instalador.prompt(); await instalador.userChoice.catch(() => {}); instalador = null; $("#installBtn").hidden = true; }
    else if (esIOS) aviso("En Safari toca Compartir ⬆︎ y luego “Agregar a pantalla de inicio”.");
    else aviso("Abre el menú del navegador y elige “Instalar Tomo”.");
  });
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // Versión nueva: el service worker la instaló por detrás mientras usabas la de antes; la app ofrece recargar
    const habia = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (habia) { T.nuevaVersion = true; window.dispatchEvent(new Event("tomo-nueva-version")); } });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // ---------- fotos de portada en la nube (carpeta privada de cada lector) ----------
  const BUCKET = "portadas";
  const ruta = (id) => `${T.uid}/${String(id).replace(/[^A-Za-z0-9._-]/g, "_")}.jpg`;
  const pendKey = () => "tomo." + T.uid + ".fotosPend";
  const pend = () => { try { return new Set(JSON.parse(localStorage.getItem(pendKey()) || "[]")); } catch (e) { return new Set(); } };
  const setPend = (s) => { try { localStorage.setItem(pendKey(), JSON.stringify([...s])); } catch (e) {} };
  T.subirFoto = async (id, blob) => {
    let ok = false;
    try { const { error } = await sb.storage.from(BUCKET).upload(ruta(id), blob, { upsert: true, contentType: blob.type || "image/jpeg", cacheControl: "31536000" }); ok = !error; } catch (e) {}
    const p = pend(); if (ok) p.delete(id); else p.add(id); setPend(p);
    return ok;
  };
  T.fotosPendientes = () => [...pend()];
  T.bajarFotos = async (ids) => {
    const out = new Map(), cola = [...ids];
    if (!T.uid || !cola.length) return out;
    const trabajar = async () => {
      while (cola.length) {
        const id = cola.shift();
        try { const { data, error } = await sb.storage.from(BUCKET).download(ruta(id)); if (!error && data && data.size) out.set(id, data); } catch (e) {}
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, cola.length) }, trabajar));
    return out;
  };
  T.borrarFoto = (id) => {
    sb.storage.from(BUCKET).remove([ruta(id)]).catch(() => {});
    const p = pend(); p.delete(id); setPend(p);
  };

  // ---------- compartir mi estante: un enlace secreto para verlo sin cuenta ----------
  T.compartir = {
    enlace: (token) => new URL(`./?e=${token}`, location.href).href,
    async obtener() {
      const { data, error } = await sb.from("compartidos").select("token").eq("user_id", T.uid).maybeSingle();
      if (error) throw error;
      return data?.token || "";
    },
    async crear() {
      const { data, error } = await sb.from("compartidos").insert({ user_id: T.uid }).select("token").single();
      if (error) { if (String(error.code) === "23505") return T.compartir.obtener(); throw error; } // ya existía
      return data.token;
    },
    async quitar() {
      const { error } = await sb.from("compartidos").delete().eq("user_id", T.uid);
      if (error) throw error;
    },
  };

  // ---------- enviar un comentario (idea, error u otro) ----------
  // La función "comentario" lo guarda y te lo manda por correo. Si no está publicada o no responde,
  // se guarda directo en la tabla (sin correo). El id evita que quede dos veces si ambos caminos lo guardan.
  T.enviarComentario = async (tipo, texto, contexto) => {
    const id = crypto.randomUUID ? crypto.randomUUID() : undefined;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
      const r = await fetch(`${T.fnUrl}/comentario`, {
        method: "POST", signal: ctl.signal,
        headers: { ...(await T.authHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ id, tipo, texto, contexto }),
      }).finally(() => clearTimeout(t));
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) return;
      if (r.status === 400 || r.status === 429) throw Object.assign(new Error(j.error || "No se pudo enviar."), { mensaje: j.error });
    } catch (e) { if (e.mensaje) throw e; }
    const { error } = await sb.from("comentarios").insert({ ...(id ? { id } : {}), user_id: T.uid, tipo, texto, contexto });
    if (error && String(error.code) !== "23505") throw error;
  };

  // ---------- estado del guardado (el puntito junto a "Mi cuenta") ----------
  T.estadoNube = (s) => {
    const el = $("#syncState"); if (!el) return;
    const txt = { ok: "Guardado", sync: "Guardando…", pend: "Guardando…", off: "Sin conexión", err: "Reintentando…" }[s] || "";
    el.dataset.s = s; el.querySelector("span").textContent = txt;
    el.title = {
      ok: "Tu estante está guardado en tu cuenta",
      off: "Sin internet: tus cambios quedan en este dispositivo y se subirán solos al volver la conexión",
      err: "No se pudo guardar; se reintentará solo",
    }[s] || txt;
  };

  // ---------- al abrir ----------
  // La sesión que Supabase dejó guardada en este dispositivo (sirve para abrir el estante sin internet)
  const sesionGuardada = () => {
    try { const s = JSON.parse(localStorage.getItem("tomo.sesion") || "null"); return s && s.user && s.user.id && s.refresh_token ? s : null; }
    catch (e) { return null; }
  };
  const perfilDe = (uid) => { try { return JSON.parse(localStorage.getItem("tomo.perfil." + uid) || "null"); } catch (e) { return null; } };
  (async () => {
    if (tokenR) return pag("restablecer"); // vienes del enlace de "¿Olvidaste tu contraseña?"
    pag("boot");
    const guardada = sesionGuardada();
    // Sin internet no se puede renovar la sesión (vence cada hora): se abre con la guardada y se renueva sola al volver la conexión
    if (guardada && navigator.onLine === false) return entrar(guardada, true);
    // Ya entraste antes en este dispositivo: el estante se abre al instante con lo guardado, y la sesión y el perfil
    // se renuevan por detrás (si la sesión ya no vale, Supabase avisa y se vuelve a la pantalla de ingreso)
    const pl = guardada && perfilDe(guardada.user.id);
    if (pl && pl.codigo && !pl.debe_cambiar) {
      entrar(guardada, true);
      sb.auth.getSession().then(async ({ data }) => {
        if (!data?.session) return; // sin red: sigue con la guardada; sesión vencida: onAuthStateChange recarga
        T.token = data.session.access_token;
        const p = await cargarPerfil();
        if (p && p.codigo) { T.perfil = p; $("#menuId").textContent = p.codigo; if (p.debe_cambiar) abrirCambio(true); }
      }, () => {});
      return;
    }
    // Con internet lento o que no responde, no se espera más de 5 s
    const r = await Promise.race([
      sb.auth.getSession().then((x) => x, (error) => ({ data: {}, error })),
      new Promise((res) => setTimeout(() => res({ lento: true }), guardada ? 5000 : 60000)),
    ]);
    const session = r.data?.session;
    if (session) return entrar(session);
    const sinRed = r.lento || /fetch|network|retryable|timeout/i.test(`${r.error?.name} ${r.error?.message}`);
    if (guardada && sinRed) return entrar(guardada, true);
    pag("login");
  })();
})();
