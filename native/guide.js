/* 247WC iOS — guide.js
   La guía con el mapa. En la web la guía tapa toda la pantalla con la
   brújula; en la app pasa a ser un panel abajo (native.css) y arriba queda el
   mapa, que te sigue mientras caminás:
     - el recorrido se dibuja desde donde estás: lo que ya caminaste
       desaparece y la línea arranca en tu punto;
     - la distancia y los minutos son los que faltan por el recorrido (en la
       web, en línea recta);
     - la indicación es la próxima maniobra que tenés adelante, con lo que
       falta para llegar a ella (en la web, la más cercana, aunque ya la hayas
       pasado);
     - el mapa encuadra tu punto y lo que falta del recorrido entre la barra
       de arriba y el panel. Si lo movés con el dedo deja de seguirte y
       aparece el botón para volver a centrar.
   Si te desviás, la ruta la recalcula app.js como siempre (como mucho cada
   20 s); acá se toma la nueva apenas llega. Lo que cambia es cómo sabe que
   te desviaste: también por la distancia a la línea, no solo a sus vértices
   (WCGuide.offRoute).

   app.js es un módulo: el build le agrega window.WC.guideKit (sus piezas
   internas) y una llamada a window.WCGuide.tick() al final de cada vuelta de
   la guía (cada posición y cada lectura de la brújula) y al recalcular la
   ruta. Script clásico, después de bridge.js; en un navegador común no hace
   nada. */

(() => {
  'use strict';

  let isNative = false;
  try { isNative = Boolean(window.Capacitor?.isNativePlatform?.()); } catch { /* sin Capacitor */ }
  if (!isNative) return;

  const TAG = '[247WC guía]';
  const PHONE = '(max-width: 759px)';
  const SNAP = 25;            // m: más cerca que esto, la línea sale de tu punto
  const AHEAD = 80;           // m: saltar más adelante en el recorrido cuesta (vueltas que se cruzan)
  const STEP_SLACK = 5;       // m: una maniobra a menos de esto ya quedó atrás
  const DEPART = 15;          // m: al arrancar, la primera indicación («Caminá hacia…»)
  const SAY_DIST = 30;        // m: más lejos que esto, la indicación dice cuánto falta
  const MAX_ZOOM = 17.5;
  const SIDE = 44;            // px de margen a los costados al encuadrar
  const TOP_GAP = 60;         // px bajo la barra de arriba: el pin del baño se dibuja hacia arriba de su punta
  const GAP = 24;             // px sobre el panel

  const kit = () => window.WC?.guideKit;
  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;

  let open = false;
  let follow = true;
  let route = null;           // la ruta que tenemos medida (la de state.route)
  let geo = null;             // sus medidas: acumulados y posición de cada maniobra
  let lastMe = null;
  let progress = 0;           // m recorridos sobre la ruta
  let texts = null;           // { dist, eta, step } que pisan los de app.js
  let recenter = null;
  let panelH = 0;

  /* ---------------------------------------------------------- geometría */

  const RAD = Math.PI / 180;
  // Metros en un plano local alrededor de `o` (sobra para unos km).
  function planar(o) {
    const kx = 111320 * Math.cos(o.lat * RAD);
    const ky = 110574;
    return {
      xy: ([lat, lng]) => [(lng - o.lng) * kx, (lat - o.lat) * ky],
      ll: ([x, y]) => [o.lat + y / ky, o.lng + x / kx],
    };
  }
  const segLen = (a, b, pl) => {
    const [ax, ay] = pl.xy(a); const [bx, by] = pl.xy(b);
    return Math.hypot(bx - ax, by - ay);
  };

  // Medidas de una ruta, una sola vez: cuánto llevás recorrido en cada punto
  // y dónde cae cada maniobra sobre el recorrido.
  function measure(r) {
    const c = r.coords;
    const pl = planar({ lat: c[0][0], lng: c[0][1] });
    const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + segLen(c[i - 1], c[i], pl));
    const steps = (r.steps || []).filter((s) => s.loc && s.text).map((s) => {
      const p = locate(c, cum, { lat: s.loc.lat, lng: s.loc.lng }, null);
      return { text: s.text, at: p ? p.s : Infinity };
    }).sort((a, b) => a.at - b.at);
    return { cum, total: cum[cum.length - 1], steps };
  }

  // Tu lugar sobre el recorrido: el punto más cercano de cada tramo, pero
  // saltar muy adelante cuesta (si el recorrido da una vuelta y pasa cerca de
  // sí mismo, no te adelanta de golpe). Volver atrás no cuesta: si das la
  // vuelta, la línea te sigue.
  function locate(c, cum, me, from) {
    const pl = planar(me);
    let best = null;
    for (let i = 0; i < c.length - 1; i++) {
      const [ax, ay] = pl.xy(c[i]);
      const [bx, by] = pl.xy(c[i + 1]);
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const u = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      const qx = ax + u * dx, qy = ay + u * dy;
      const d = Math.hypot(qx, qy);
      const s = cum[i] + u * Math.sqrt(l2);
      const cost = d + (from == null ? 0 : Math.max(0, s - from - AHEAD) * 0.5);
      if (!best || cost < best.cost) best = { i, s, d, cost, q: pl.ll([qx, qy]) };
    }
    return best;
  }

  /* -------------------------------------------------------- en cada vuelta */

  function tick() {
    const k = kit();
    if (!k || !open) return;
    const { state } = k;
    if (!state.guiding || !state.me || !state.selected) return;

    const r = state.route && state.routeFor === state.selected.id ? state.route : null;
    const moved = !lastMe || lastMe.lat !== state.me.lat || lastMe.lng !== state.me.lng;
    const fresh = r !== route;
    if (fresh) {
      route = r;
      geo = r && r.coords?.length > 1 && !r.fallback ? measure(r) : null;
      progress = 0;
    }
    if (moved || fresh || !texts) update(k, r);
    lastMe = { ...state.me };
    apply(k);
  }

  function update(k, r) {
    const { state, fmtDistance, fmtMinutes } = k;
    const me = state.me;
    const target = state.selected;
    texts = null;
    if (!r) return;

    let line, left;
    if (geo) {
      const p = locate(r.coords, geo.cum, me, progress);
      progress = p.s;
      left = Math.max(0, geo.total - p.s);
      line = [p.q, ...r.coords.slice(p.i + 1)];
      if (p.d <= SNAP) line.unshift([me.lat, me.lng]);
      texts = { dist: fmtDistance(left), eta: fmtMinutes(left), step: stepText(k) };
    } else {
      // Sin ruta a pie (línea recta punteada): sale de tu punto.
      left = k.distance(me, target);
      line = [[me.lat, me.lng], [target.lat, target.lng]];
      texts = { dist: fmtDistance(left), eta: fmtMinutes(left), step: null };
    }
    try { k.setRoute(k.map, line, Boolean(r.fallback)); } catch (err) { console.warn(TAG, 'ruta', err); }
    if (follow) frame(k, line);
  }

  // La próxima maniobra que tenés adelante.
  function stepText(k) {
    const { t, fmtDistance } = k;
    const steps = geo.steps;
    if (!steps.length) return null;
    if (progress < DEPART && steps[0].at < DEPART) return steps[0].text;
    const next = steps.find((s) => s.at > progress + STEP_SLACK);
    if (!next) return null;
    const d = next.at - progress;
    return d > SAY_DIST ? t('untilStep', { dist: fmtDistance(d), text: next.text }) : next.text;
  }

  // app.js reescribe estos textos en cada vuelta (también con cada lectura de
  // la brújula): los nuestros van después, en el mismo instante, sin parpadeo.
  function apply(k) {
    if (!texts) return;
    const { el, state } = k;
    if (el.gDist.textContent !== texts.dist) el.gDist.textContent = texts.dist;
    if (el.gEta.textContent !== texts.eta) el.gEta.textContent = texts.eta;
    if (texts.step && !state.arrived && el.gStep.textContent !== texts.step) el.gStep.textContent = texts.step;
  }

  /* ------------------------------------------------------------- el mapa */

  // Tu punto y lo que falta del recorrido, entre la barra de arriba y el panel.
  function frame(k, line) {
    const { state, map, fitPoints } = k;
    if (!state.me) return;
    const pts = line?.length ? line : [[state.me.lat, state.me.lng]];
    const top = ($('.guide-top')?.getBoundingClientRect().bottom || 0) + TOP_GAP;
    const bottom = (panelH || $('#guide')?.getBoundingClientRect().height || 0) + GAP;
    if (top + bottom > window.innerHeight - 80) return;   // sin lugar para el mapa
    try {
      fitPoints(map, pts, { top, bottom, left: SIDE, right: SIDE, maxZoom: MAX_ZOOM });
    } catch (err) { console.warn(TAG, 'encuadre', err); }
  }

  function refit() {
    const k = kit();
    if (!k || !open || !follow) return;
    const src = k.map.getSource?.('route');
    const data = src?.serialize?.().data;
    const coords = data?.features?.[0]?.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]);
    frame(k, coords);
  }

  function setFollow(on) {
    follow = on;
    if (recenter) recenter.hidden = on;
    if (on) refit();
  }

  /* -------------------------------------------------- abrir y cerrar */

  function onOpen() {
    open = true;
    follow = true;
    route = null; geo = null; lastMe = null; progress = 0; texts = null;
    root.classList.add('guiding');
    if (recenter) {
      recenter.hidden = true;
      const label = kit()?.t?.('locateAria');
      if (label) recenter.setAttribute('aria-label', label);
    }
    // La primera vuelta de app.js pasó antes de este aviso: una ahora mismo
    // (si todavía no hay ruta medida, encuadra la que ya está dibujada) y otra
    // en el próximo cuadro, con el panel ya en su lugar.
    tick(); if (!texts) refit();
    requestAnimationFrame(() => { if (open) refit(); });
  }

  function onClose() {
    open = false;
    root.classList.remove('guiding');
  }

  function attach() {
    const guide = $('#guide');
    if (!guide) return;
    const phone = window.matchMedia(PHONE);

    recenter = document.createElement('button');
    recenter.id = 'guide-recenter';
    recenter.type = 'button';
    recenter.className = 'icon-btn round';
    recenter.hidden = true;
    recenter.setAttribute('aria-label', 'Centrar en mi ubicación');
    recenter.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.6"/>' +
      '<circle cx="12" cy="12" r="3.9" style="fill: var(--blue); stroke: none"/></svg>';
    recenter.addEventListener('click', () => setFollow(true));
    guide.append(recenter);

    // Alto del panel: para encuadrar arriba de él y subir los avisos.
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => {
        const h = Math.round(guide.getBoundingClientRect().height);
        if (h === panelH) return;
        panelH = h;
        root.style.setProperty('--guide-h', `${h}px`);
        if (open) refit();
      }).observe(guide);
    }

    const sync = () => {
      const now = !guide.hidden && phone.matches;
      if (now && !open) onOpen();
      else if (!now && open) onClose();
    };
    new MutationObserver(sync).observe(guide, { attributes: true, attributeFilter: ['hidden'] });
    phone.addEventListener?.('change', sync);
    sync();

    // Si movés el mapa con el dedo, deja de seguirte (los movimientos del
    // encuadre no traen originalEvent).
    const hookMap = () => {
      const map = kit()?.map || window.WC?.map;
      if (!map?.on) return false;
      for (const ev of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart']) {
        map.on(ev, (e) => { if (open && e?.originalEvent) setFollow(false); });
      }
      return true;
    };
    if (!hookMap()) {
      const wait = setInterval(() => { if (hookMap()) clearInterval(wait); }, 200);
      setTimeout(() => clearInterval(wait), 20000);
    }
  }

  // ¿Estás a más de `limit` metros de la línea del recorrido? (app.js solo
  // miraba los vértices; ver el parche en scripts/build-web.mjs.)
  function offRoute(me, coords, limit) {
    if (!me || !coords?.length) return true;
    if (coords.length === 1) return segLen([me.lat, me.lng], coords[0], planar(me)) > limit;
    const cum = [0];
    const pl = planar(me);
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + segLen(coords[i - 1], coords[i], pl));
    return locate(coords, cum, me, null).d > limit;
  }

  window.WCGuide = {
    tick: () => { try { tick(); } catch (err) { console.warn(TAG, err); } },
    offRoute: (me, coords, limit) => { try { return offRoute(me, coords, limit); } catch { return true; } },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { try { attach(); } catch (err) { console.warn(TAG, err); } }, { once: true });
  else { try { attach(); } catch (err) { console.warn(TAG, err); } }
})();
