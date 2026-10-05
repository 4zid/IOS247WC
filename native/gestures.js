/* 247WC iOS — gestures.js
   Deslizar desde el borde izquierdo para volver, como en las apps de iOS.

   La web no usa el historial del navegador para sus vistas, así que el gesto
   de «atrás» del WebView no tendría a dónde ir. Acá lo armamos a mano con los
   mismos botones que ya existen (no toca el código de la web):
     - detalle de un baño → la lista (el botón «Lista»);
     - lista o tarjeta del más cercano abiertas → bajan, y queda el mapa;
     - modal de ajustes → se cierra.
   La portada, la introducción y la guía no tienen gesto: la guía se cierra
   con la X, para no salir sin querer mientras caminás.

   La vista sigue al dedo; si pasa un tercio del ancho (o el gesto es rápido)
   vuelve, si no, regresa a su lugar. Script clásico, después de bridge.js;
   en un navegador común no hace nada. */

(() => {
  'use strict';

  let isNative = false;
  try { isNative = Boolean(window.Capacitor?.isNativePlatform?.()); } catch { /* sin Capacitor */ }
  if (!isNative) return;

  const EDGE = 24;       // px desde el borde donde puede empezar (el margen de la hoja)
  const LOCK = 10;       // px de movimiento para decidir si el gesto es horizontal
  const COMMIT = 1 / 3;  // fracción del ancho que confirma «volver»
  const FLING = 0.45;    // px/ms: un deslizamiento rápido confirma aunque sea corto
  const OUT_MS = 200;

  const $ = (sel) => document.querySelector(sel);
  const shown = (node) => Boolean(node) && !node.hidden;
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // La hoja se baja como lo hace la web con el teclado: Enter en la manija.
  function collapseSheet() {
    $('.sheet-handle')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }

  // Qué hace «volver» desde donde empieza el dedo, y qué vista lo acompaña.
  function backTarget(startNode) {
    const info = $('#info');
    if (info?.open) {
      return info.contains(startNode) ? { node: info, run: () => $('#info-close')?.click() } : null;
    }
    const sheet = $('#sheet');
    if (!sheet || !sheet.contains(startNode)) return null;
    const detail = $('#view-detail');
    if (shown(detail)) return { node: detail, run: () => $('#btn-back')?.click() };
    if (sheet.dataset.open === 'full') {
      const view = [$('#view-list'), $('#view-best')].find(shown) || sheet;
      return { node: view, run: collapseSheet };
    }
    return null;
  }

  function clear(node) {
    node.style.transition = 'none';
    node.style.translate = '';
    node.style.opacity = '';
    node.style.willChange = '';
    // Sin transición para volver a 0 y después, la de siempre.
    requestAnimationFrame(() => { node.style.transition = ''; });
  }

  let g = null;

  // Un toque que empieza en el borde no arrastra la hoja hacia arriba o abajo:
  // ese gesto es para volver. Fuera del borde, todo sigue igual.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.clientX > EDGE) return;
    if (backTarget(e.target)) e.stopPropagation();
  }, true);

  document.addEventListener('touchstart', (e) => {
    if (g || e.touches.length !== 1) { g = null; return; }
    const t = e.touches[0];
    if (t.clientX > EDGE) return;
    const target = backTarget(e.target);
    if (!target) return;
    g = { id: t.identifier, x0: t.clientX, y0: t.clientY, lastX: t.clientX, lastT: e.timeStamp, v: 0, dx: 0, locked: null, target };
  }, { capture: true, passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = [...e.changedTouches].find((x) => x.identifier === g.id);
    if (!t) return;
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (g.locked === null) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      // Solo hacia la derecha y más horizontal que vertical; si no, es scroll.
      if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.2) { g = null; return; }
      g.locked = true;
      g.target.node.style.transition = 'none';
      g.target.node.style.willChange = 'translate, opacity';
    }
    e.preventDefault();   // que la lista no se desplace mientras volvés
    g.v = (t.clientX - g.lastX) / Math.max(1, e.timeStamp - g.lastT);
    g.lastX = t.clientX;
    g.lastT = e.timeStamp;
    g.dx = Math.max(0, dx);
    g.target.node.style.translate = `${g.dx}px 0`;
    g.target.node.style.opacity = String(1 - Math.min(0.3, (g.dx / window.innerWidth) * 0.45));
  }, { capture: true, passive: false });

  function end(e) {
    if (!g) return;
    const t = [...e.changedTouches].find((x) => x.identifier === g.id);
    if (!t) return;
    const { target, locked, dx, v } = g;
    g = null;
    if (!locked) return;
    const node = target.node;
    const commit = e.type === 'touchend' && (dx > window.innerWidth * COMMIT || (v > FLING && dx > 30));
    if (reduceMotion()) {
      clear(node);
      if (commit) target.run();
      return;
    }
    node.style.transition = `translate ${OUT_MS}ms cubic-bezier(.22, 1, .36, 1), opacity ${OUT_MS}ms ease`;
    if (!commit) {
      node.style.translate = '0 0';
      node.style.opacity = '';
      setTimeout(() => clear(node), OUT_MS);
      return;
    }
    node.style.translate = `${window.innerWidth}px 0`;
    node.style.opacity = '0';
    setTimeout(() => {
      try { target.run(); } finally { clear(node); }
    }, OUT_MS);
  }
  document.addEventListener('touchend', end, { capture: true, passive: true });
  document.addEventListener('touchcancel', end, { capture: true, passive: true });
})();
