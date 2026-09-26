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
    authHeaders() { return { Authorization: "Bearer " + T.token, apikey: C.supabaseKey }; },
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
      try { return JSON.parse(localStorage.getItem(perfilKey()) || "null"); } catch (_) { return null; } // sin internet: el último conocido
    }
  }
  T.guardarNombre = (v) => {
    T.perfil.nombre = v;
    try { localStorage.setItem(perfilKey(), JSON.stringify(T.perfil)); } catch (e) {}
    sb.from("perfiles").update({ nombre: v }).eq("user_id", T.uid).then(({ error }) => { if (error) aviso("No se pudo guardar el nombre en tu cuenta."); });
  };

  async function entrar(session) {
    T.uid = session.user.id; T.token = session.access_token;
    const p = await cargarPerfil();
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
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
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
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

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
  (async () => {
    pag("boot");
    let session = null;
    try { ({ data: { session } } = await sb.auth.getSession()); } catch (e) {}
    if (session) entrar(session); else pag("login");
  })();
})();
