#!/usr/bin/env node
/* 247WC iOS — capturas para el App Store (iPhone de 6,9").

   Uso: npm run screenshots   (hace el build y corre este script)

   Fotografía la app real: www/ ya construido (con los textos nativos y el
   ícono neutro de «Abrir en Mapas»), con la capa nativa de Capacitor imitada
   igual que en las pruebas (tests/fixtures/capacitor-mock.js). Así cada
   pantalla es exactamente lo que se ve en el iPhone.

   No necesita red: lo que vendría de afuera se reemplaza por datos propios y
   coherentes entre sí. La geografía, los baños, la ruta, la barra de estado y
   los rótulos de calle son una adaptación de tools/mockups/app-screens.mjs del
   repo de la web (247wc, del mismo autor):
   - el estilo del mapa: un barrio vectorial en GeoJSON con la paleta de los
     mockups, con nombres de calle como marcadores HTML (sin red no hay glifos);
   - /api/toilets: baños porteños sobre esas calles, devueltos por el
     CapacitorHttp «nativo» (window.__mock), como en el teléfono;
   - la posición, por WCNative.getCurrentPosition / locationUpdate;
   - la brújula, por el evento heading de WCNative;
   - la ruta a pie de Valhalla, siguiendo la grilla.

   Salen 5 PNG por idioma de 1320×2868 (440×956 a 3x, iPhone 16/17 Pro Max)
   en store/screenshots/es/ y store/screenshots/en/, más una hoja de contacto
   (store/screenshots/contact-sheet.png). Sin transparencia: App Store
   Connect rechaza capturas con canal alfa; el script lo comprueba.

   Sale con código 1 si algo no cumple (error de la página, mapa vacío, flecha
   sin brújula, tamaño o canal alfa). */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const MOCK = path.join(ROOT, 'tests/fixtures/capacitor-mock.js');
const OUT = path.join(ROOT, 'store/screenshots');

// iPhone 16/17 Pro Max: 440×956 puntos a 3x = 1320×2868, el tamaño de 6,9"
// que pide App Store Connect. Áreas seguras de ese modelo: 62 arriba (Dynamic
// Island) y 34 abajo (barra de inicio).
const SIZE = { width: 440, height: 956 };
const SCALE = 3;
const SAFE = { top: 62, bottom: 34 };

// Hora fija adentro de la app (hora de Buenos Aires): todos los horarios de
// los baños dan «abierto» y las capturas no cambian según cuándo se corra.
// La barra de estado dice 9:41, como en todas las capturas de Apple.
const CLOCK = '2026-10-14T13:41:00-03:00';

const SHOTS = {
  es: ['01-portada', '02-mapa', '03-mas-cercano', '04-guia', '05-lista-oscuro'],
  en: ['01-home', '02-map', '03-nearest', '04-guide', '05-list-dark'],
};

/* ---------- Geografía: una grilla porteña girada ----------
   Coordenadas locales en metros (x hacia el este de la grilla, y hacia el
   norte de la grilla), giradas 32° como el microcentro. */
const C = { lat: -34.5962, lng: -58.3762 };
const TH = (-32 * Math.PI) / 180;
const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((C.lat * Math.PI) / 180);
const B = 125;                                   // largo de cuadra
function ll(x, y) {
  const xr = x * Math.cos(TH) - y * Math.sin(TH);
  const yr = x * Math.sin(TH) + y * Math.cos(TH);
  return [C.lng + xr / M_LNG, C.lat + yr / M_LAT];   // [lng, lat]
}
const pt = (x, y) => { const [lng, lat] = ll(x, y); return { lat, lng }; };

// Calles: [posición en cuadras, nombre, ancho en metros]
const VERT = [[-4, 'Arenales', 12], [-3, 'Charcas', 12], [-2, 'Paraguay', 12], [-1, 'M. T. de Alvear', 12], [0, 'Florida', 9], [1, 'San Martín', 12], [2, 'Reconquista', 12], [3, '25 de Mayo', 12], [4, 'Av. L. N. Alem', 26]];
const HORZ = [[-4, 'Av. Corrientes', 24], [-3, 'Lavalle', 10], [-2, 'Tucumán', 12], [-1, 'Viamonte', 12], [0, 'Av. Córdoba', 24], [1, 'Maipú', 12], [2, 'Esmeralda', 12], [3, 'Suipacha', 12], [4, 'Av. Santa Fe', 24], [5, 'Arroyo', 12], [6, 'Av. del Libertador', 30]];
const SPAN = 8 * B;
const R = 6;
// La plaza ocupa dos por dos cuadras al noreste de Florida y Córdoba.
const inPark = (i, j) => i >= 0 && i < 2 && j >= 0 && j < 2;

const poly = (pts) => ({ type: 'Polygon', coordinates: [[...pts.map(([x, y]) => ll(x, y)), ll(...pts[0])]] });
const rect = (x0, y0, x1, y1) => poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

function cityGeoJSON() {
  const f = [];
  const add = (geometry, properties) => f.push({ type: 'Feature', geometry, properties });
  for (let i = -R; i < R; i++) {
    for (let j = -R; j < R + 1; j++) {
      if (inPark(i, j)) continue;
      const x0 = i * B, y0 = j * B;
      add(rect(x0 + 8, y0 + 8, x0 + B - 8, y0 + B - 8), { k: 'block', c: ['#e9edf3', '#eef1f6', '#ebeff4'][((i + j) % 3 + 3) % 3] });
      // Dos edificios por manzana, deterministas
      const bx = x0 + 18 + (((i * 7 + j * 3) % 18) + 18) % 18;
      const by = y0 + 18 + (((i * 5 + j * 11) % 20) + 20) % 20;
      add(rect(bx, by, bx + 30 + (i & 1) * 12, by + 26 + (j & 1) * 14), { k: 'bldg' });
      add(rect(bx + 46, by + 34, bx + 72 + (j & 1) * 10, by + 56 + (i & 1) * 12), { k: 'bldg' });
    }
  }
  add(rect(8, 8, 2 * B - 8, 2 * B - 8), { k: 'park' });
  // Senderos y árboles de la plaza
  const trail = (pts) => add({ type: 'LineString', coordinates: pts.map(([x, y]) => ll(x, y)) }, { k: 'trail' });
  trail([[10, 120], [80, 100], [160, 110], [240, 135]]);
  trail([[125, 10], [115, 90], [130, 170], [120, 240]]);
  [[40, 60], [70, 190], [200, 60], [210, 200], [160, 160], [60, 150], [190, 30], [100, 40]].forEach(([x, y]) =>
    add({ type: 'Point', coordinates: ll(x, y) }, { k: 'tree' }));
  for (const [k, , w] of VERT) add({ type: 'LineString', coordinates: [ll(k * B, -SPAN), ll(k * B, SPAN)] }, { k: 'street', w });
  for (const [k, , w] of HORZ) add({ type: 'LineString', coordinates: [ll(-SPAN, k * B), ll(SPAN, k * B)] }, { k: 'street', w });
  add({ type: 'LineString', coordinates: [ll(-1 * B, -4 * B), ll(-4 * B, -1 * B)] }, { k: 'street', w: 18 });   // diagonal
  return { type: 'FeatureCollection', features: f };
}

// Ancho en metros → píxeles según el zoom (1 px ≈ 1,97 m en z16 a esta latitud).
const W = (extra = 0) => ['interpolate', ['exponential', 2], ['zoom'],
  13, ['*', ['+', ['get', 'w'], extra], 0.0634], 19, ['*', ['+', ['get', 'w'], extra], 4.06]];

function mapStyle() {
  return {
    version: 8,
    sources: { city: { type: 'geojson', data: cityGeoJSON() } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#ecf0f5' } },
      { id: 'block', type: 'fill', source: 'city', filter: ['==', ['get', 'k'], 'block'], paint: { 'fill-color': ['get', 'c'], 'fill-outline-color': '#e0e5ed' } },
      { id: 'bldg', type: 'fill', source: 'city', filter: ['==', ['get', 'k'], 'bldg'], paint: { 'fill-color': '#e3e8ef' } },
      { id: 'park', type: 'fill', source: 'city', filter: ['==', ['get', 'k'], 'park'], paint: { 'fill-color': '#dcebd9', 'fill-outline-color': '#cfe2cb' } },
      { id: 'trail', type: 'line', source: 'city', filter: ['==', ['get', 'k'], 'trail'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f2f8f0', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 8] } },
      { id: 'tree', type: 'circle', source: 'city', filter: ['==', ['get', 'k'], 'tree'], paint: { 'circle-color': '#c9dfc4', 'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 14, 1.5, 18, 20] } },
      { id: 'street-case', type: 'line', source: 'city', filter: ['==', ['get', 'k'], 'street'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#dde3ec', 'line-width': W(3) } },
      { id: 'street', type: 'line', source: 'city', filter: ['==', ['get', 'k'], 'street'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': W() } },
    ],
  };
}

// Varias posiciones candidatas por calle, a mitad de cuadra; después
// cullLabels() deja solo las que no se pisan con nada.
function streetLabels() {
  const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * M_LNG, (b[1] - a[1]) * M_LAT) * 180) / Math.PI;
  const rot = (a, b) => { let r = bearing(a, b) - 90; if (r > 90) r -= 180; if (r < -90) r += 180; return r; };
  const out = [];
  const at = [-4.5, -2.5, -0.5, 1.5, 3.5, 5.5];
  for (const [k, name] of VERT) for (const j of at) out.push({ name, at: ll(k * B, j * B), rot: rot(ll(k * B, 0), ll(k * B, B)) });
  for (const [k, name] of HORZ) for (const i of at) out.push({ name, at: ll((i + 0.5) * B, k * B), rot: rot(ll(0, k * B), ll(B, k * B)) });
  out.push({ name: 'Plaza San Martín', at: ll(1 * B, 1.55 * B), rot: rot(ll(0, 0), ll(B, 0)), park: true });
  return out;
}

/* ---------- Datos: vos y los baños sobre esas calles ---------- */
const ME = pt(0, -95);                           // sobre Florida, casi una cuadra al sur de Córdoba
const node = (id, [x, y], tags) => { const p = pt(x, y); return { type: 'node', id, lat: p.lat, lon: p.lng, tags }; };
// Los nombres van como estarían en OpenStreetMap (en castellano también para
// la versión en inglés: son lugares de Buenos Aires).
const TOILETS = {
  elements: [
    node(1, [62, 16], { amenity: 'toilets', name: 'Baños Plaza San Martín', fee: 'no', opening_hours: '24/7', wheelchair: 'yes', changing_table: 'yes', unisex: 'yes' }),
    node(2, [-40, -2.35 * B], { amenity: 'toilets', name: 'Galerías Pacífico', fee: 'no', opening_hours: 'Mo-Su 10:00-21:00', changing_table: 'yes', wheelchair: 'yes' }),
    node(3, [2.4 * B, 4.3 * B], { railway: 'station', toilets: 'yes', name: 'Estación Retiro · Mitre', fee: 'no', opening_hours: 'Mo-Su 05:00-24:00' }),
    node(4, [3.55 * B, 2.6 * B], { amenity: 'toilets', name: 'Torre Monumental', fee: 'no', wheelchair: 'yes', opening_hours: 'Mo-Su 08:00-20:00' }),
    node(5, [-4.6 * B, 3.6 * B], { shop: 'mall', toilets: 'yes', name: 'Patio Bullrich', fee: 'no', changing_table: 'yes', opening_hours: 'Mo-Su 10:00-21:00' }),
    node(6, [-2.55 * B, -3.1 * B], { amenity: 'toilets', name: 'Baño público Lavalle', fee: 'yes', charge: '500 ARS' }),
    node(7, [-1.3 * B, 1.25 * B], { amenity: 'cafe', toilets: 'yes', 'toilets:access': 'customers', name: 'Café Martínez · Florida' }),
  ],
  fuentes: { osm: 7, refugio: 0, espejo: 'capturas' },
};

/* ---------- Ruta a pie por la grilla (Valhalla) ---------- */
function polyline6(coords) {   // coords: [[lat, lng], …]
  let out = '', pLat = 0, pLng = 0;
  const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const [lat, lng] of coords) {
    const a = Math.round(lat * 1e6), b = Math.round(lng * 1e6);
    out += enc(a - pLat) + enc(b - pLng); pLat = a; pLng = b;
  }
  return out;
}
const ROUTE_PTS = [[0, -95], [0, 8], [62, 8], [62, 16]].map(([x, y]) => { const p = pt(x, y); return [p.lat, p.lng]; });
// Valhalla contesta en el idioma que le pide app.js (directions_options.language).
const STEPS = {
  es: ['Caminá por Florida hacia Av. Córdoba.', 'Doblá a la derecha en Av. Córdoba.', 'Entrá a Plaza San Martín: el baño está a la izquierda.', 'Llegaste.', 'Caminá hasta el baño.'],
  en: ['Walk along Florida toward Av. Córdoba.', 'Turn right onto Av. Córdoba.', 'Enter Plaza San Martín: the restroom is on your left.', 'You have arrived.', 'Walk to the restroom.'],
};
function valhalla(body) {
  const s = STEPS[/^es/i.test(body?.directions_options?.language || '') ? 'es' : 'en'];
  const [from, to] = body?.locations || [];
  const t1 = TOILETS.elements[0];
  if (!to || (Math.abs(to.lat - t1.lat) < 1e-7 && Math.abs(to.lon - t1.lon) < 1e-7)) {
    return { trip: { summary: { length: 0.175 }, legs: [{ shape: polyline6(ROUTE_PTS), maneuvers: [
      { instruction: s[0], length: 0.103, begin_shape_index: 0 },
      { instruction: s[1], length: 0.062, begin_shape_index: 1 },
      { instruction: s[2], length: 0.008, begin_shape_index: 2 },
      { instruction: s[3], length: 0, begin_shape_index: 3 },
    ] }] } };
  }
  // A los demás baños, una recta: no sale en ninguna captura.
  const km = Math.hypot((to.lat - from.lat) * M_LAT, (to.lon - from.lon) * M_LNG) / 1000;
  return { trip: { summary: { length: km }, legs: [{ shape: polyline6([[from.lat, from.lon], [to.lat, to.lon]]), maneuvers: [
    { instruction: s[4], length: km, begin_shape_index: 0 },
    { instruction: s[3], length: 0, begin_shape_index: 1 },
  ] }] } };
}

/* ---------- Barra de estado, barra de inicio y rótulos ----------
   Medidas de un iPhone de 6,9" (franja de 62 puntos arriba). Sin la Dynamic
   Island: las capturas que saca el propio iPhone tampoco la muestran. */
const CHROME_CSS = `
  :root { --safe-t: ${SAFE.top}px; --safe-b: ${SAFE.bottom}px; }
  .mk-statusbar { position: fixed; left: 0; right: 0; top: 0; height: ${SAFE.top}px; z-index: 2147483647; display: flex; align-items: center; justify-content: space-between; padding: 6px 34px 0 50px; font: 600 17px/1 Inter, system-ui, sans-serif; letter-spacing: -.01em; color: #0a0e17; pointer-events: none; }
  .mk-statusbar .t { width: 54px; text-align: center; }
  .mk-statusbar .r { display: flex; align-items: center; gap: 7px; }
  .mk-statusbar svg { display: block; width: auto; height: 12px; fill: currentColor; stroke: none; }
  .mk-home { position: fixed; left: 50%; bottom: 8px; width: 150px; height: 5px; margin-left: -75px; border-radius: 3px; background: rgba(10, 14, 23, .85); z-index: 2147483647; pointer-events: none; }
  .mk-light .mk-statusbar { color: #fff; } .mk-light .mk-home, .mk-home-light .mk-home { background: rgba(255, 255, 255, .9); }
  .mk-label { font: 500 10.5px/1 Inter, system-ui, sans-serif; letter-spacing: .02em; color: #98a2b3; white-space: nowrap; pointer-events: none; text-shadow: 0 0 3px #fff, 0 0 3px #fff; }
  .mk-label.park { font-size: 11.5px; color: #7f9a7a; text-shadow: 0 0 3px #e4f0e1, 0 0 3px #e4f0e1; }
  html[data-theme="dark"] .mk-label { color: #8a94a6; text-shadow: 0 0 3px #0b1220, 0 0 3px #0b1220; }
`;
const STATUSBAR = `<div class="mk-statusbar"><span class="t">9:41</span><span class="r">
  <svg viewBox="0 0 20 12"><rect x="0" y="8" width="3.4" height="4" rx="1"/><rect x="5.3" y="5.5" width="3.4" height="6.5" rx="1"/><rect x="10.6" y="3" width="3.4" height="9" rx="1"/><rect x="15.9" y="0" width="3.4" height="12" rx="1"/></svg>
  <svg viewBox="0 0 17 12"><path d="M8.5 11.6a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm3.2-4.3a4.6 4.6 0 0 0-6.4 0L4 6a6.5 6.5 0 0 1 9 0ZM15 3.6a9.4 9.4 0 0 0-13 0L.7 2.3a11.3 11.3 0 0 1 15.6 0Z"/></svg>
  <svg viewBox="0 0 28 13"><rect x=".6" y=".6" width="23" height="11.8" rx="3.4" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="1.2"/><rect x="2.3" y="2.3" width="19.6" height="8.4" rx="2"/><path d="M25.4 4.3v4.4a2.3 2.3 0 0 0 0-4.4Z" fill-opacity=".45"/></svg>
</span></div><div class="mk-home"></div>`;

/* ---------- Servidor de www/ ---------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
  '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8',
};
function serve() {
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      const file = path.join(WWW, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(WWW + path.sep) || !existsSync(file)) { res.writeHead(404).end('no'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(500).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ---------- La app con el «nativo» imitado ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

async function openApp(browser, base, lang, { theme = 'light', onboarded = true, filters = [], permission = 'granted' } = {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 247WC-iOS',
    viewport: SIZE, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true,
    locale: lang === 'es' ? 'es-AR' : 'en-US', timezoneId: 'America/Argentina/Buenos_Aires',
    colorScheme: theme, reducedMotion: 'no-preference',
  });
  await context.clock.install({ time: new Date(CLOCK) });
  // Toda la red de afuera cortada, salvo el estilo del mapa y la ruta a pie.
  // La API de baños no pasa por acá: va por CapacitorHttp (el mock).
  const blocked = [];
  await context.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.hostname === 'tiles.openfreemap.org') {
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(mapStyle()) });
    }
    if (url.hostname === 'valhalla1.openstreetmap.de') {
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(valhalla(req.postDataJSON())) });
    }
    blocked.push(`${req.method()} ${url.href.slice(0, 100)}`);
    return route.abort('internetdisconnected');
  });

  const cfg = {
    permission,
    position: { latitude: ME.lat, longitude: ME.lng, accuracy: 18 },
    http: { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, data: TOILETS },
  };
  // WKWebView con capacitor:// no tiene service workers: app.js ni lo intenta.
  await context.addInitScript({ content: 'delete Navigator.prototype.serviceWorker;' });
  await context.addInitScript({ content: `window.__MOCK_CONFIG__ = ${JSON.stringify(cfg)};` });
  await context.addInitScript({ path: MOCK });
  await context.addInitScript(({ lang, theme, onboarded, filters, css, bar }) => {
    try {
      localStorage.clear();
      localStorage.setItem('247wc:lang', lang);
      localStorage.setItem('247wc:theme', JSON.stringify(theme));
      localStorage.setItem('247wc:filters', JSON.stringify(filters));
      if (onboarded) localStorage.setItem('247wc:onboarded', '1');
    } catch { /* nada */ }
    // Áreas seguras y barra de estado apenas termina de leerse el HTML, antes
    // de que corra app.js: así el primer encuadre del mapa ya las respeta.
    document.addEventListener('readystatechange', () => {
      if (document.readyState !== 'interactive') return;
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      document.body.insertAdjacentHTML('beforeend', bar);
    });
  }, { lang, theme, onboarded, filters, css: CHROME_CSS, bar: STATUSBAR });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/Failed to load resource|net::ERR_/.test(msg.text())) errors.push(`console: ${msg.text().slice(0, 200)}`); });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => window.WC?.ready === true, null, { timeout: 15000 });
  // Inter tiene que estar cargada antes de fotografiar: si llega tarde, los
  // textos cortan distinto de una corrida a otra.
  const fontOk = await page.evaluate(async () => {
    await document.fonts.load('600 16px Inter');
    await document.fonts.ready;
    return document.fonts.check('600 16px Inter');
  });
  if (!fontOk) throw new Error('Inter no cargó');
  return { context, page, errors, blocked };
}

const mapIdle = (page, which = 'map') => page.evaluate((which) => new Promise((resolve) => {
  const m = window.WC[which];
  if (!m) return resolve();
  const done = () => setTimeout(resolve, 250);
  if (m.loaded() && !m.isMoving()) { m.once('idle', done); m.triggerRepaint(); } else m.once('idle', done);
  setTimeout(resolve, 6000);
}), which);

async function addLabels(page) {
  await page.evaluate((labels) => {
    for (const l of labels) {
      const el = document.createElement('div');
      el.className = 'mk-label' + (l.park ? ' park' : '');
      el.textContent = l.name;
      new window.maplibregl.Marker({ element: el, rotation: l.rot, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(l.at).addTo(window.WC.map);
    }
    // Los rótulos van debajo de los marcadores de la app.
    document.querySelectorAll('.mk-label').forEach((n) => { n.style.zIndex = '0'; });
  }, streetLabels());
}

// Como un mapa de verdad: un rótulo que se pisa con otro, con un marcador o
// con la interfaz, no se muestra. Y cada calle se nombra una vez cada tanto.
async function cullLabels(page) {
  await page.evaluate(() => {
    const grow = (r, m) => ({ l: r.left - m, t: r.top - m, r: r.right + m, b: r.bottom + m });
    const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    // Un marcador cortado por la barra de estado o la de arriba ensucia la captura.
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    document.querySelectorAll('.maplibregl-marker:not(.mk-label)').forEach((m) => {
      const r = m.getBoundingClientRect();
      if (r.top < tb.bottom && r.bottom > 0) m.style.visibility = 'hidden';
    });
    const blockers = [...document.querySelectorAll('.maplibregl-marker:not(.mk-label), .mk-statusbar, .topbar, .scan-fab, .map-controls, .sheet, .toast')]
      .filter((e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0' && e.style.visibility !== 'hidden')
      .map((e) => grow(e.getBoundingClientRect(), 10));
    const kept = [];
    const lastByName = {};
    for (const el of document.querySelectorAll('.mk-label')) {
      el.style.visibility = 'visible';
      const box = grow(el.getBoundingClientRect(), 8);
      const c = { x: (box.l + box.r) / 2, y: (box.t + box.b) / 2 };
      const off = box.l < 0 || box.r > innerWidth || box.t < 0 || box.b > innerHeight;   // entero o nada
      const near = (lastByName[el.textContent] || []).some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 240);
      if (off || near || blockers.some((b) => hit(box, b)) || kept.some((k) => hit(box, k))) { el.style.visibility = 'hidden'; continue; }
      kept.push(box);
      (lastByName[el.textContent] ||= []).push(c);
    }
  });
}

// Con el permiso ya dado la app escanea sola al abrir: esperamos el resultado.
async function scanned(page) {
  await page.waitForFunction(() => document.querySelector('#scan').dataset.state === 'off', null, { timeout: 15000 });
  // La posición también llega por el watch nativo, como en el teléfono.
  await page.evaluate((p) => window.__mock.emit('WCNative', 'locationUpdate', {
    timestamp: Date.now(),
    coords: { latitude: p.lat, longitude: p.lng, accuracy: 18, altitude: null, altitudeAccuracy: null, heading: null, speed: null },
  }), ME);
  await page.waitForTimeout(1600);
}

// Lo que no puede salir en una captura del App Store.
async function healthy(page, errors, blocked, label, { map = true } = {}) {
  const r = await page.evaluate(() => ({
    fatal: document.getElementById('fatal')?.textContent || null,
    lang: document.documentElement.lang,
    style: !!window.WC.map?.getSource?.('city'),
    toast: (() => { const t = document.getElementById('toast'); return t && getComputedStyle(t).opacity !== '0' && !t.hidden ? t.textContent.trim() : ''; })(),
  }));
  check(!r.fatal, `${label}: pantalla de error fatal: ${r.fatal}`);
  check(errors.length === 0, `${label}: errores en la página: ${errors.join(' | ')}`);
  check(!blocked.some((b) => /overpass|interpreter|api\/toilets/.test(b)), `${label}: pidió a la red algo que tenía que ir por el nativo: ${blocked.join(', ')}`);
  if (map) check(r.style, `${label}: el mapa no cargó el barrio (quedaría en blanco)`);
  return r;
}

// light: barra de estado y de inicio blancas (fondo oscuro). homeLight: solo la
// de inicio, que iOS aclara sobre el azul del pie de la portada y la guía.
async function shot(page, lang, i, { light = false, homeLight = false } = {}) {
  await page.evaluate(([light, homeLight]) => {
    document.documentElement.classList.toggle('mk-light', light);
    document.documentElement.classList.toggle('mk-home-light', homeLight);
  }, [light, homeLight]);
  await page.waitForTimeout(300);
  const file = path.join(OUT, lang, `${SHOTS[lang][i]}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  return file;
}

/* ---------- Las cinco pantallas de un idioma ---------- */
async function screens(browser, base, lang) {
  const files = [];

  // 1 · Portada: primera vez, primer paso de la introducción.
  {
    const { context, page, errors, blocked } = await openApp(browser, base, lang, { onboarded: false, permission: 'prompt' });
    await page.waitForFunction(() => document.querySelector('#scan').dataset.state === 'onboarding', null, { timeout: 10000 });
    await page.waitForTimeout(1600);
    // Las entradas de la introducción ya terminaron: al cuadro final.
    await page.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    await page.waitForTimeout(300);
    await healthy(page, errors, blocked, `${lang} portada`, { map: false });
    files[0] = await shot(page, lang, 0, { homeLight: true });
    await context.close();
  }

  // 4 · Guía · 3 · El más cercano · 2 · Mapa (una sola sesión, como upstream)
  {
    const { context, page, errors, blocked } = await openApp(browser, base, lang);
    await addLabels(page);
    await scanned(page);
    // El baño queda a menos de 300 m: la app abre la guía sola. Si no, «Guiarme».
    if (!(await page.isVisible('#guide'))) await page.click('#best-guide');
    await page.locator('#guide').waitFor({ state: 'visible' });
    await page.waitForFunction(() => window.__mock.listenerCount('WCNative', 'heading') > 0, null, { timeout: 5000 });
    // CoreLocation manda lecturas seguidas: repetimos hasta que la guía la tome.
    await page.waitForFunction(() => {
      if (document.getElementById('guide').dataset.compass === '1') return true;
      window.__mock.emit('WCNative', 'heading', { heading: 33, accuracy: 5 });
      return false;
    }, null, { timeout: 5000, polling: 100 });
    await page.evaluate(() => window.__mock.emit('WCNative', 'heading', { heading: 33, accuracy: 5 }));
    await page.waitForTimeout(1400);
    const g = await page.evaluate(() => ({
      compass: document.getElementById('guide').dataset.compass,
      rot: document.getElementById('guide-arrow').style.getPropertyValue('--rot'),
    }));
    check(g.compass === '1' && g.rot !== '', `${lang} guía: la flecha no tomó la brújula (${JSON.stringify(g)})`);
    await healthy(page, errors, blocked, `${lang} guía`);
    files[3] = await shot(page, lang, 3, { homeLight: true });

    await page.click('#guide-close');
    await mapIdle(page, 'bestMap');
    // El mapa grande, detrás de la tarjeta, deja el pin cortado justo en el
    // borde de la hoja. Lo bajamos para que la ruta quede tapada (ya se ve
    // en el mapa chico) y arriba quede el barrio limpio.
    await page.evaluate((pts) => {
      const m = window.WC.map;
      const top = document.querySelector('.sheet').getBoundingClientRect().top;
      const b = new window.maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend(p));
      m.fitBounds(b, { padding: { top: top + 80, bottom: 60, left: 80, right: 80 }, maxZoom: m.getZoom(), animate: false });
    }, [[ME.lng, ME.lat], [TOILETS.elements[0].lon, TOILETS.elements[0].lat]]);
    await mapIdle(page);
    await cullLabels(page);
    await page.waitForTimeout(900);
    check(await page.isVisible('#view-best'), `${lang} más cercano: no se ve la tarjeta`);
    await healthy(page, errors, blocked, `${lang} más cercano`);
    files[2] = await shot(page, lang, 2);

    // Lista abierta y después baja: queda el mapa con la hoja en su lugar.
    await page.click('#status'); await page.waitForTimeout(500);
    await page.click('#status'); await page.waitForTimeout(700);
    // Encuadre: vos, el más cercano y otros baños, entre la barra de arriba y la hoja.
    await page.evaluate((pts) => {
      const b = new window.maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend(p));
      window.WC.map.fitBounds(b, { padding: { top: 210, bottom: 430, left: 60, right: 60 }, animate: false });
    }, [[ME.lng, ME.lat], ...TOILETS.elements.filter((e) => [1, 2, 4].includes(e.id)).map((e) => [e.lon, e.lat])]);
    await mapIdle(page);
    await page.waitForTimeout(500);
    await cullLabels(page);
    await healthy(page, errors, blocked, `${lang} mapa`);
    files[1] = await shot(page, lang, 1);
    await context.close();
  }

  // 5 · Lista en modo oscuro, con el filtro «Gratis».
  {
    const { context, page, errors, blocked } = await openApp(browser, base, lang, { theme: 'dark', filters: ['free'] });
    await addLabels(page);
    await scanned(page);
    if (await page.isVisible('#guide')) await page.click('#guide-close');
    await page.waitForTimeout(400);
    await page.click('#status'); await page.waitForTimeout(900);
    await mapIdle(page);
    await cullLabels(page);
    const dark = await page.evaluate(() => document.documentElement.dataset.theme || getComputedStyle(document.body).backgroundColor);
    check(/dark|rgb\((\d{1,2}), (\d{1,2}), (\d{1,2})\)/.test(dark), `${lang} lista oscura: la app no quedó en modo oscuro (${dark})`);
    check(await page.isVisible('#list .item'), `${lang} lista oscura: la lista está vacía`);
    await healthy(page, errors, blocked, `${lang} lista oscura`);
    files[4] = await shot(page, lang, 4, { light: true });
    await context.close();
  }
  return files;
}

/* ---------- Comprobaciones del PNG ----------
   App Store Connect quiere el tamaño exacto y sin transparencia. Se lee el
   encabezado del PNG (sin dependencias): tipo de color 2 = RGB, y sin tRNS. */
async function pngInfo(file) {
  const b = await readFile(file);
  const info = { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b[24], color: b[25], trns: false };
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8);
    if (type === 'tRNS') info.trns = true;
    if (type === 'IEND') break;
    o += 12 + len;
  }
  return info;
}

// Hoja de contacto: las diez miniaturas para revisar de un vistazo.
async function contactSheet(browser, all) {
  const cells = await Promise.all(all.map(async ({ lang, file }) => {
    const src = `data:image/png;base64,${(await readFile(file)).toString('base64')}`;
    return `<figure><img src="${src}"><figcaption>${lang.toUpperCase()} · ${path.basename(file)}</figcaption></figure>`;
  }));
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 32px; background: #e8ecf2; font: 500 14px/1.2 system-ui, sans-serif; color: #344054; }
    .grid { display: grid; grid-template-columns: repeat(5, 264px); gap: 24px; }
    figure { margin: 0; } img { display: block; width: 264px; height: 574px; border-radius: 22px; box-shadow: 0 6px 20px rgba(16, 24, 40, .18); }
    figcaption { margin-top: 10px; text-align: center; }
  </style><div class="grid">${cells.join('')}</div>`;
  const page = await browser.newPage({ viewport: { width: 5 * 264 + 4 * 24 + 64, height: 2 * (574 + 34) + 24 + 64 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const file = path.join(OUT, 'contact-sheet.png');
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

/* ---------- main ---------- */
async function main() {
  if (!existsSync(path.join(WWW, 'index.html'))) {
    console.error('✗ Falta www/. Corré «npm run screenshots» (hace el build) o «npm run build» primero.');
    process.exit(1);
  }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    // MapLibre necesita WebGL: en una compu sin GPU (o un contenedor) va por SwiftShader.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  const all = [];
  try {
    for (const lang of Object.keys(SHOTS)) {
      await mkdir(path.join(OUT, lang), { recursive: true });
      for (const file of await screens(browser, base, lang)) all.push({ lang, file });
    }
    for (const { file } of all) {
      const p = await pngInfo(file);
      check(p.w === SIZE.width * SCALE && p.h === SIZE.height * SCALE, `${path.relative(ROOT, file)}: mide ${p.w}×${p.h}`);
      check(p.color === 2 && !p.trns, `${path.relative(ROOT, file)}: tiene canal alfa (tipo de color ${p.color})`);
    }
    all.push({ lang: '', file: await contactSheet(browser, all) });
  } finally {
    await browser.close();
    server.close();
  }

  for (const { file } of all) console.log(`  ${path.relative(ROOT, file)}`);
  if (failures.length) {
    console.log(`\n✗ ${failures.length} chequeo(s) fallaron:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`\n✓ ${all.length - 1} capturas de ${SIZE.width * SCALE}×${SIZE.height * SCALE} en store/screenshots/ (más la hoja de contacto)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
