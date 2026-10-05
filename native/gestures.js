/* 247WC iOS — gestures.js
   Deslizar desde el borde izquierdo para volver, como en las apps de iOS.

   La web no usa el historial del navegador para sus vistas, así que el gesto
   de «atrás» del WebView no tendría a dónde ir. Acá lo armamos a mano con los
   mismos botones que ya existen (no toca el código de la web):
     - detalle de un baño → la lista (el botón «Lista»): el detalle se corre
       con el dedo y deja ver la lista debajo, como en iOS;
     - lista o tarjeta del más cercano abiertas → la hoja baja siguiendo al
       dedo, y queda el mapa;
     - modal de ajustes → se corre y se cierra.
   La portada, la introducción y la guía no tienen gesto (las tapan otras
   capas): la guía se cierra con la X, para no salir sin querer caminando.

   Si el dedo pasa un tercio del ancho, o suelta con un movimiento rápido,
   vuelve; si no, todo regresa a su lugar. Script clásico, después de
   bridge.js; en un navegador común no hace nada. */

(() => {
  'use strict';

  let isNative = false;
  try { isNative = Boolean(window.Capacitor?.isNativePlatform?.()); } catch { /* sin Capacitor */ }
  if (!isNative) return;

  const EDGE = 24;          // px desde el borde donde puede empezar (el margen de la hoja)
  const LOCK = 10;          // px de movimiento para decidir si el gesto es horizontal
  const COMMIT = 1 / 3;     // fracción del ancho que confirma «volver»
  const FLING = 0.45;       // px/ms: un deslizamiento rápido confirma aunque sea corto
  const FLING_WINDOW = 100; // ms: la velocidad sale de este último tramo
  const MS = 220;           // duración de las animaciones del gesto
  const SHEET_MS = 340;     // la hoja de la web tarda .32 s en subir o bajar
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';

  const $ = (sel) => document.querySelector(sel);
  const shown = (node) => Boolean(node) && !node.hidden;
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const px = (n) => `${Math.round(n)}px`;

  // Estilos que pone el gesto, para poder sacarlos todos juntos.
  const touched = new Set();
  function style(node, props) {
    touched.add(node);
    Object.assign(node.style, props);
  }
  function clearAll() {
    for (const node of touched) {
      Object.assign(node.style, {
        transition: 'none', translate: '', opacity: '', willChange: '',
        position: '', left: '', top: '', width: '', height: '', zIndex: '',
        background: '', pointerEvents: '',
      });
    }
    const nodes = [...touched];
    touched.clear();
    // Sin transición para volver a 0 y, en el cuadro siguiente, la de la web.
    requestAnimationFrame(() => { for (const node of nodes) node.style.transition = ''; });
  }

  // Cuánto de la hoja queda a la vista cerrada (la web lo guarda en --sheet-peek).
  const peek = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) || 200;

  // La hoja se baja como lo hace la web con el teclado: Enter en la manija
  // (alterna, así que solo si de verdad está abierta).
  function collapseSheet() {
    if ($('#sheet')?.dataset.open !== 'full') return;
    $('.sheet-handle')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }

  /* Cada destino sabe qué mover con el dedo (move), cómo terminar si vuelve
     (commit) y cómo deshacer si no (cancel). */

  // Hasta dónde bajaste en la lista: al ocultarse el WebView puede perderlo, y
  // la web recién lo repone al volver. Lo guardamos para que detrás del
  // detalle se vea igual que como la dejaste.
  let listScroll = 0;

  function detailTarget(sheet, detail) {
    const list = $('#view-list');
    return {
      start() {
        // La lista, debajo y del mismo tamaño, para que se vea a dónde volvés.
        const r = detail.getBoundingClientRect();
        const s = sheet.getBoundingClientRect();
        style(list, {
          position: 'absolute', left: px(r.left - s.left), top: px(r.top - s.top),
          width: px(r.width), height: px(r.height), zIndex: '0', pointerEvents: 'none',
          transition: 'none', translate: px(-r.width * 0.3) + ' 0',
        });
        style(detail, {
          position: 'relative', zIndex: '1', background: getComputedStyle(sheet).backgroundColor,
          transition: 'none', willChange: 'translate',
        });
        list.hidden = false;
        list.scrollTop = listScroll;
      },
      move(dx) {
        const w = detail.getBoundingClientRect().width || window.innerWidth;
        detail.style.translate = `${px(dx)} 0`;
        list.style.translate = `${px(-w * 0.3 * (1 - Math.min(1, dx / w)))} 0`;
      },
      commit(done) {
        const w = window.innerWidth;
        style(detail, { transition: `translate ${MS}ms ${EASE}`, translate: `${px(w)} 0` });
        style(list, { transition: `translate ${MS}ms ${EASE}`, translate: '0 0' });
        setTimeout(() => {
          // La lista es más alta que el detalle: con la altura fija, la hoja baja
          // derecho desde donde está en vez de estirarse primero hacia arriba.
          style(sheet, { height: px(sheet.getBoundingClientRect().height) });
          try { $('#btn-back')?.click(); } finally {
            clearAll();
            style(sheet, { height: sheet.style.height });
            setTimeout(() => { sheet.style.height = ''; touched.delete(sheet); done(); }, SHEET_MS);
          }
        }, MS);
      },
      cancel(done) {
        style(detail, { transition: `translate ${MS}ms ${EASE}`, translate: '0 0' });
        style(list, { transition: `translate ${MS}ms ${EASE}`, translate: px(-detail.getBoundingClientRect().width * 0.3) + ' 0' });
        setTimeout(() => { list.hidden = true; clearAll(); done(); }, MS);
      },
    };
  }

  function sheetTarget(sheet) {
    // Lo que tiene que bajar la hoja hasta quedar cerrada.
    const travel = () => Math.max(0, sheet.getBoundingClientRect().height - peek());
    const both = `transform ${SHEET_MS - 20}ms ${EASE}, translate ${SHEET_MS - 20}ms ${EASE}`;
    return {
      start() {
        style(sheet, { transition: 'none', willChange: 'translate' });
      },
      move(dx) {
        sheet.style.translate = `0 ${px(travel() * Math.min(1, dx / window.innerWidth) * 1.4)}`;
      },
      commit(done) {
        // La transformación de la web y nuestro corrimiento se animan juntos:
        // la hoja sigue bajando desde donde la dejó el dedo, sin saltos.
        style(sheet, { transition: both });
        requestAnimationFrame(() => {
          sheet.style.translate = '0 0';
          collapseSheet();
          setTimeout(() => { clearAll(); done(); }, SHEET_MS);
        });
      },
      cancel(done) {
        style(sheet, { transition: both, translate: '0 0' });
        setTimeout(() => { clearAll(); done(); }, SHEET_MS);
      },
    };
  }

  function dialogTarget(info) {
    return {
      start() { style(info, { transition: 'none', willChange: 'translate, opacity' }); },
      move(dx) {
        info.style.translate = `${px(dx)} 0`;
        info.style.opacity = String(1 - Math.min(0.4, (dx / window.innerWidth) * 0.6));
      },
      commit(done) {
        style(info, { transition: `translate ${MS}ms ${EASE}, opacity ${MS}ms ease`, translate: `${px(window.innerWidth)} 0`, opacity: '0' });
        setTimeout(() => {
          try { $('#info-close')?.click(); } finally { clearAll(); done(); }
        }, MS);
      },
      cancel(done) {
        style(info, { transition: `translate ${MS}ms ${EASE}, opacity ${MS}ms ease`, translate: '0 0', opacity: '1' });
        setTimeout(() => { clearAll(); done(); }, MS);
      },
    };
  }

  // Qué hace «volver» desde donde empieza el dedo. null = nada.
  function backTarget(startNode) {
    const info = $('#info');
    if (info?.open) return info.contains(startNode) ? dialogTarget(info) : null;
    const sheet = $('#sheet');
    if (!sheet || !sheet.contains(startNode)) return null;
    const detail = $('#view-detail');
    if (shown(detail)) return detailTarget(sheet, detail);
    if (sheet.dataset.open === 'full') return sheetTarget(sheet);
    return null;
  }

  let g = null;        // el gesto en curso
  let busy = false;    // mientras termina una animación, no empieza otro gesto

  function finish() { busy = false; }

  function abandon() {
    // Un segundo dedo o algo raro: todo vuelve a su lugar.
    if (!g) return;
    const { locked, target } = g;
    g = null;
    if (!locked) return;
    busy = true;
    if (reduceMotion()) { clearAll(); finish(); } else target.cancel(finish);
  }

  // Un toque que empieza en el borde no arrastra la hoja hacia arriba o abajo:
  // ese gesto es para volver. Fuera del borde, todo sigue igual.
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.clientX > EDGE) return;
    if (busy || backTarget(e.target)) e.stopPropagation();
  }, true);

  function onStart(e) {
    if (busy) return;
    if (g || e.touches.length !== 1) { abandon(); return; }
    const t = e.touches[0];
    if (t.clientX > EDGE) return;
    const target = backTarget(e.target);
    if (!target) return;
    g = { id: t.identifier, x0: t.clientX, y0: t.clientY, dx: 0, locked: false, target, samples: [{ x: t.clientX, t: e.timeStamp }] };
  }

  function onMove(e) {
    if (!g) return;
    const t = [...e.changedTouches].find((x) => x.identifier === g.id);
    if (!t) return;
    const dx = t.clientX - g.x0;
    const dy = t.clientY - g.y0;
    if (!g.locked) {
      if (Math.abs(dx) < LOCK && Math.abs(dy) < LOCK) return;
      // Solo hacia la derecha y más horizontal que vertical; si no, es scroll.
      if (dx <= 0 || Math.abs(dx) < Math.abs(dy) * 1.2) { g = null; return; }
      g.locked = true;
      g.target.start();
    }
    e.preventDefault();   // que la lista no se desplace mientras volvés
    g.dx = Math.max(0, dx);
    // Muestras para la velocidad: solo las de los últimos FLING_WINDOW ms.
    const last = g.samples[g.samples.length - 1];
    if (e.timeStamp > last.t) g.samples.push({ x: t.clientX, t: e.timeStamp });
    while (g.samples.length > 2 && e.timeStamp - g.samples[0].t > FLING_WINDOW) g.samples.shift();
    g.target.move(g.dx);
  }

  function velocity(samples, now) {
    const a = samples[0];
    const b = samples[samples.length - 1];
    // Si el dedo se quedó quieto antes de soltar, no hay envión.
    if (!a || !b || b.t <= a.t || now - b.t > FLING_WINDOW) return 0;
    return (b.x - a.x) / (b.t - a.t);
  }

  function onEnd(e) {
    if (!g) return;
    const t = [...e.changedTouches].find((x) => x.identifier === g.id);
    if (!t) return;
    const { target, locked, dx, samples } = g;
    g = null;
    if (!locked) return;
    const v = velocity(samples, e.timeStamp);
    const commit = e.type === 'touchend' && (dx > window.innerWidth * COMMIT || (v > FLING && dx > 30));
    busy = true;
    if (reduceMotion()) {
      clearAll();
      if (commit) {
        if (target === null) return finish();
        // Sin animaciones: el mismo efecto, de una.
        const info = $('#info');
        if (info?.open) $('#info-close')?.click();
        else if (shown($('#view-detail'))) $('#btn-back')?.click();
        else collapseSheet();
      }
      finish();
      return;
    }
    if (commit) target.commit(finish);
    else target.cancel(finish);
  }

  // Solo en la hoja y en el modal: el resto de la pantalla (el mapa) no espera
  // a este código para desplazarse.
  function attach() {
    const list = $('#view-list');
    list?.addEventListener('scroll', () => { if (!list.hidden && !g) listScroll = list.scrollTop; }, { passive: true });
    for (const node of [$('#sheet'), $('#info')]) {
      if (!node) continue;
      node.addEventListener('touchstart', onStart, { passive: true });
      node.addEventListener('touchmove', onMove, { passive: false });
      node.addEventListener('touchend', onEnd, { passive: true });
      node.addEventListener('touchcancel', onEnd, { passive: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', attach, { once: true });
  else attach();
})();
