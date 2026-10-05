#!/usr/bin/env node
/* 247WC iOS — pruebas de punta a punta de la capa nativa (native/bridge.js).

   Sirve www/ (ya construido: npm test corre el build antes) desde 127.0.0.1,
   abre Chromium emulando un iPhone y, antes que cualquier script de la página,
   instala un mock de la capa nativa de Capacitor (tests/fixtures/capacitor-mock.js).
   Así se prueba el camino real: app.js → shims de bridge.js → capacitor.js →
   «nativo» (el mock registra cada llamada y contesta lo configurado).

   Toda la red de afuera está cortada, salvo dos respuestas falsas: el estilo
   del mapa (OpenFreeMap) y una ruta a pie (Valhalla).

   Uso: npm test   (o node tests/bridge.e2e.mjs [T2 T4 …] para correr algunas)
   Sale con código 1 si alguna falla. Capturas en tests/.output/<nombre>.png. */

import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');
const FIXTURES = path.join(ROOT, 'tests/fixtures');
const OUT = path.join(ROOT, 'tests/.output');

const MOCK = path.join(FIXTURES, 'capacitor-mock.js');
const TOILETS = JSON.parse(await readFile(path.join(FIXTURES, 'toilets.json'), 'utf8'));
const MAP_STYLE = await readFile(path.join(FIXTURES, 'map-style.json'), 'utf8');
const NEAREST = TOILETS.elements[0];   // a ~350 m del punto de partida (Obelisco)

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const VALHALLA = 'https://valhalla1.openstreetmap.de/route';
const API = 'https://247-wc.vercel.app/api/toilets?lat=';

const IPHONE = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 247WC-iOS',
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'es-AR',
  timezoneId: 'America/Argentina/Buenos_Aires',
  colorScheme: 'light',
};

const BANNED = /safari|navegador|copi[aá] el link|agregar a inicio/i;

/* ------------------------------------------------------------- servidor */

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
      const file = path.join(WWW, rel);
      if (!file.startsWith(WWW + path.sep) || !existsSync(file)) { res.writeHead(404).end('no'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(500).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ------------------------------------------------------------- red */

// Polilínea de precisión 6 (la que decodifica app.js para Valhalla).
function encodePolyline(coords, precision = 6) {
  const f = 10 ** precision;
  let out = '', pLat = 0, pLng = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = '';
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of coords) {
    const a = Math.round(lat * f), b = Math.round(lng * f);
    out += enc(a - pLat) + enc(b - pLng);
    pLat = a; pLng = b;
  }
  return out;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

async function blockNetwork(context, blocked, { overpass = false } = {}) {
  await context.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (url.startsWith(STYLE_URL)) {
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: MAP_STYLE });
    }
    if (url.startsWith(VALHALLA) && req.method() === 'POST') {
      const { locations: [a, b] } = req.postDataJSON();
      const mid = [a.lat, b.lon];
      const coords = [[a.lat, a.lon], mid, [b.lat, b.lon]];
      const km = 0.35;
      const body = {
        trip: {
          summary: { length: km },
          legs: [{
            shape: encodePolyline(coords),
            maneuvers: [
              { instruction: 'Caminá hacia el norte por Avenida Corrientes.', length: km, begin_shape_index: 0 },
              { instruction: 'Llegaste a tu destino.', length: 0, begin_shape_index: 2 },
            ],
          }],
        },
      };
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }
    if (overpass && /\/api\/interpreter$/.test(new URL(url).pathname) && req.method() === 'POST') {
      blocked.push(`OVERPASS ${url}`);
      return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(TOILETS) });
    }
    blocked.push(`${req.method()} ${url.slice(0, 100)}`);
    return route.abort('internetdisconnected');
  });
}

/* ------------------------------------------------------------- escenarios */

class Fail extends Error {}
const assert = (cond, msg) => { if (!cond) throw new Fail(msg); };

async function openApp(browser, base, { mock = true, config = {}, query = '', before = null, overpass = false } = {}) {
  const context = await browser.newContext(IPHONE);
  const blocked = [];
  const errors = [];
  await blockNetwork(context, blocked, { overpass });
  if (mock) {
    const cfg = {
      http: { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, data: TOILETS },
      ...config,
    };
    // WKWebView con capacitor:// no tiene service workers: app.js ni lo intenta.
    await context.addInitScript({ content: 'delete Navigator.prototype.serviceWorker;' });
    await context.addInitScript({ content: `window.__MOCK_CONFIG__ = ${JSON.stringify(cfg)};` });
    await context.addInitScript({ path: MOCK });
  }
  const page = await context.newPage();
  if (before) before(page);
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text().slice(0, 200)}`); });
  await page.goto(`${base}/index.html${query}`);
  await page.waitForFunction(() => window.WC?.ready === true, null, { timeout: 15000 });
  return { context, page, blocked, errors };
}

// Espera a que el mock registre una llamada a plugin.método y devuelve todas las que hubo.
const waitCall = (page, plugin, method, timeout = 8000) =>
  page.waitForFunction(([p, m]) => window.__mock.find(p, m).length > 0, [plugin, method], { timeout })
    .then(() => page.evaluate(([p, m]) => window.__mock.find(p, m), [plugin, method]));

const calls = (page, plugin, method) => page.evaluate(([p, m]) => window.__mock.find(p, m), [plugin, method]);

// Portada → «Saltar» la introducción → «Escanear baños» → la tarjeta del más cercano.
async function scanFlow(page) {
  const skip = page.locator('#onb-skip');
  if (await skip.isVisible()) await skip.click();
  await page.locator('#scan-go').click();
  await page.locator('#view-best').waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction((name) => document.getElementById('best-name')?.textContent === name, NEAREST.tags.name, { timeout: 5000 });
}

// Sin pantalla de error fatal ni excepciones de la página.
async function healthy(page, errors) {
  const fatal = await page.evaluate(() => document.getElementById('fatal')?.textContent || null);
  assert(!fatal, `pantalla de error fatal: ${fatal}`);
  const real = errors.filter((e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR_/.test(e));
  assert(real.length === 0, `errores en la página: ${real.join(' | ')}`);
}

const SCENARIOS = [
  ['T1', 'web-mode', 'Sin Capacitor nativo bridge.js no toca nada y la app arranca', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { mock: false });
    try {
      const r = await page.evaluate(() => ({
        gcp: navigator.geolocation.getCurrentPosition === Geolocation.prototype.getCurrentPosition,
        wp: navigator.geolocation.watchPosition === Geolocation.prototype.watchPosition,
        own: Object.getOwnPropertyNames(navigator.geolocation),
        native: document.documentElement.classList.contains('native'),
        vibrate: navigator.vibrate === Navigator.prototype.vibrate,
        query: navigator.permissions.query === Permissions.prototype.query,
        fetchNative: /native code/.test(Function.prototype.toString.call(window.fetch)),
        openNative: /native code/.test(Function.prototype.toString.call(window.open)),
        ready: window.WC.ready,
      }));
      assert(r.gcp && r.wp && r.own.length === 0, 'navigator.geolocation fue reemplazado en modo web');
      assert(!r.native, '<html> tiene la clase native en modo web');
      assert(r.vibrate && r.query && r.fetchNative && r.openNative, `algún shim quedó puesto en modo web: ${JSON.stringify(r)}`);
      await healthy(page, errors.filter((e) => !/sw\.js|api\/toilets|404/.test(e)));
      return page;
    } finally { await shot(page, 'T1-web-mode'); await context.close(); }
  }],

  ['T2', 'scan', 'Escaneo con permiso «prompt»: ubicación nativa + API por HTTP nativo', async (b, base) => {
    const { context, page, errors, blocked } = await openApp(b, base, { config: { permission: 'prompt' } });
    try {
      await scanFlow(page);
      assert(!blocked.some((r) => /overpass|interpreter/.test(r)), `cayó a Overpass: ${blocked.join(', ')}`);
      const order = await page.evaluate(() => window.__mock.calls.filter((c) => c.plugin === 'WCNative').map((c) => c.method));
      assert(order.includes('requestLocationPermission'), `no pidió permiso antes de ubicar: ${order.join(', ')}`);
      assert(order.indexOf('requestLocationPermission') < order.indexOf('getCurrentPosition'), 'pidió la posición antes que el permiso');
      const gcp = await calls(page, 'WCNative', 'getCurrentPosition');
      assert(gcp.length >= 1 && gcp[0].options.enableHighAccuracy === true, 'getCurrentPosition sin enableHighAccuracy');
      const http = await calls(page, 'CapacitorHttp', 'request');
      assert(http.length >= 1, 'no se llamó a CapacitorHttp.request');
      assert(http[0].options.url.startsWith(API), `URL inesperada: ${http[0].options.url}`);
      assert(http[0].options.method === 'GET' && http[0].options.responseType === 'text', 'método o responseType inesperados');
      const updates = await waitCall(page, 'WCNative', 'startLocationUpdates');
      assert(updates.length === 1, 'startLocationUpdates más de una vez');
      const name = await page.locator('#bc-name').textContent();
      assert(name === NEAREST.tags.name, `nombre inesperado: ${name}`);
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T2-scan'); await context.close(); }
  }],

  ['T3', 'denied', 'Permiso negado: ayuda nativa con «Abrir Ajustes» → openSettings', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'denied', positionError: 'PERMISSION_DENIED' } });
    try {
      const skip = page.locator('#onb-skip');
      if (await skip.isVisible()) await skip.click();
      await page.locator('#scan-go').click();
      const help = page.locator('#scan-help');
      await help.waitFor({ state: 'visible', timeout: 8000 });
      const text = await help.innerText();
      assert(!BANNED.test(text), `la ayuda tiene texto de navegador: ${text}`);
      assert(/247WC/.test(text) && /Al usar la app/.test(text) && /Localizaci[oó]n/.test(text), `la ayuda no es la nativa: ${text}`);
      const btn = help.locator('[data-native-action="settings"]');
      assert(await btn.count() === 1, 'falta el botón Abrir Ajustes');
      assert((await btn.textContent()).trim() === 'Abrir Ajustes', 'el botón no dice «Abrir Ajustes»');
      await btn.click();
      await waitCall(page, 'WCNative', 'openSettings');
      const title = await page.locator('#scan-title').textContent();
      assert(/No pudimos ubicarte/.test(title), `título inesperado: ${title}`);
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T3-denied'); await context.close(); }
  }],

  ['T4', 'guide', 'Guía: brújula nativa mueve la flecha y la pantalla no se apaga', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'prompt' } });
    try {
      await scanFlow(page);
      await page.locator('#best-guide').click();
      await page.locator('#guide').waitFor({ state: 'visible' });
      await waitCall(page, 'WCNative', 'startHeading');
      const awake = await waitCall(page, 'WCNative', 'setKeepAwake');
      assert(awake[0].options.enabled === true, 'setKeepAwake no fue { enabled: true }');
      const rot = () => page.evaluate(() => document.getElementById('guide-arrow').style.getPropertyValue('--rot'));
      await page.waitForFunction(() => window.__mock.listenerCount('WCNative', 'heading') > 0);
      const before = await rot();
      // CoreLocation manda lecturas seguidas; la primera puede llegar antes de
      // que app.js termine de engancharse (resuelve requestPermission → escucha).
      // Como el sensor real, repetimos la lectura hasta que la flecha se mueva.
      const delivered = await page.evaluate(() => window.__mock.emit('WCNative', 'heading', { heading: 90, accuracy: 5 }));
      assert(delivered === 1, `el evento heading llegó a ${delivered} listeners (esperaba 1)`);
      await page.waitForFunction((b0) => {
        if (document.getElementById('guide-arrow').style.getPropertyValue('--rot') !== b0) return true;
        window.__mock.emit('WCNative', 'heading', { heading: 90, accuracy: 5 });
        return false;
      }, before, { timeout: 3000, polling: 100 });
      const after = await rot();
      const compass = await page.evaluate(() => document.getElementById('guide').dataset.compass);
      assert(compass === '1', 'la guía no tomó la brújula');
      assert(Math.abs(parseFloat(before) - 90 - parseFloat(after)) < 0.01, `rotación inesperada: ${before} → ${after}`);
      // Un segundo pedido de permiso no arranca la brújula de nuevo.
      await page.evaluate(() => DeviceOrientationEvent.requestPermission());
      assert((await calls(page, 'WCNative', 'startHeading')).length === 1, 'startHeading más de una vez');

      // La app pasa a segundo plano y vuelve: la brújula se apaga y se prende;
      // app.js pide otro wake lock al volver y el viejo no queda colgado.
      const setVisibility = (state) => page.evaluate((st) => {
        Object.defineProperty(document, 'visibilityState', { value: st, configurable: true });
        Object.defineProperty(document, 'hidden', { value: st === 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      }, state);
      await setVisibility('hidden');
      await waitCall(page, 'WCNative', 'stopHeading');
      await setVisibility('visible');
      await page.waitForFunction(() => window.__mock.find('WCNative', 'startHeading').length === 2, null, { timeout: 3000 });
      await page.waitForFunction(() => window.__mock.find('WCNative', 'setKeepAwake').length === 2, null, { timeout: 3000 });

      await page.locator('#guide-close').click();
      await page.waitForFunction(() => window.__mock.find('WCNative', 'setKeepAwake').at(-1).options.enabled === false, null, { timeout: 3000 });
      const awakeSeq = (await calls(page, 'WCNative', 'setKeepAwake')).map((c) => c.options.enabled);
      assert(awakeSeq.join() === 'true,true,false', `setKeepAwake: ${awakeSeq.join(', ')}`);
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T4-guide'); await context.close(); }
  }],

  ['T5', 'haptics', 'navigator.vibrate → Haptics (escaneo, toque y llegada)', async (b, base) => {
    // Con permiso ya dado la app escanea sola al abrir y vibra al terminar (30 ms → HEAVY).
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'granted' } });
    try {
      await page.waitForFunction(() => window.__mock.find('Haptics', 'impact').length > 0, null, { timeout: 10000 });
      const scanTap = await calls(page, 'Haptics', 'impact');
      assert(scanTap[0].options.style === 'HEAVY', `el escaneo vibró con ${scanTap[0].options.style}`);
      const r = await page.evaluate(() => [navigator.vibrate(20), navigator.vibrate(10), navigator.vibrate([120, 60, 120, 60, 240]), navigator.vibrate(0)]);
      assert(r.every((x) => x === true), 'navigator.vibrate no devolvió true');
      await page.waitForFunction(() => window.__mock.find('Haptics', 'notification').length > 0);
      const impacts = (await calls(page, 'Haptics', 'impact')).map((c) => c.options.style);
      assert(impacts.slice(-2).join() === 'MEDIUM,LIGHT', `impactos: ${impacts.join(', ')}`);
      const notes = await calls(page, 'Haptics', 'notification');
      assert(notes.length === 1 && notes[0].options.type === 'SUCCESS', 'el patrón no fue notification SUCCESS');
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T5-haptics'); await context.close(); }
  }],

  ['T6', 'links', 'Mapas → openDirections; links externos → Browser.open', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'prompt' } });
    try {
      await scanFlow(page);
      const startUrl = page.url();
      const maps = page.locator('#best-maps');
      assert(await maps.getAttribute('aria-label') === 'Abrir en Mapas', `aria-label: ${await maps.getAttribute('aria-label')}`);
      await maps.click();
      const dir = await waitCall(page, 'WCNative', 'openDirections');
      assert(dir[0].options.latitude === NEAREST.lat && dir[0].options.longitude === NEAREST.lon,
        `coordenadas: ${JSON.stringify(dir[0].options)}`);
      assert((await calls(page, 'Browser', 'open')).length === 0, 'la ruta también abrió Browser');

      await page.locator('#best-all').click();
      const osm = page.locator('.credits a[href="https://www.openstreetmap.org/copyright"]');
      await osm.click();
      const opened = await waitCall(page, 'Browser', 'open');
      assert(opened[0].options.url === 'https://www.openstreetmap.org/copyright', `Browser.open: ${opened[0].options.url}`);

      await page.locator('#btn-contribute').click();
      await page.waitForFunction(() => window.__mock.find('Browser', 'open').length > 1);
      const note = (await calls(page, 'Browser', 'open'))[1].options.url;
      assert(note.startsWith('https://www.openstreetmap.org/note/new#map=19/'), `«¿Falta un baño?» abrió ${note}`);

      assert(page.url() === startUrl, `la página navegó a ${page.url()}`);
      assert(context.pages().length === 1, 'se abrió otra ventana');
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T6-links'); await context.close(); }
  }],

  ['T7', 'theme', 'Tema oscuro/claro → SystemBars.setStyle', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'prompt' } });
    try {
      const first = await waitCall(page, 'SystemBars', 'setStyle');
      assert(first[0].options.style === 'LIGHT', `al arrancar: ${first[0].options.style}`);
      await scanFlow(page);
      await page.locator('#btn-info').click();
      await page.locator('#info').waitFor({ state: 'visible' });
      await page.locator('.seg-btn[data-theme="dark"]').click();
      await page.waitForFunction(() => window.__mock.find('SystemBars', 'setStyle').at(-1).options.style === 'DARK', null, { timeout: 3000 });
      await shot(page, 'T7-theme-dark');
      await page.locator('.seg-btn[data-theme="light"]').click();
      await page.waitForFunction(() => window.__mock.find('SystemBars', 'setStyle').at(-1).options.style === 'LIGHT', null, { timeout: 3000 });
      const styles = (await calls(page, 'SystemBars', 'setStyle')).map((c) => c.options.style);
      assert(styles.join() === 'LIGHT,DARK,LIGHT', `secuencia: ${styles.join(', ')}`);
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T7-theme'); await context.close(); }
  }],

  ['T8', 'splash', 'SplashScreen.hide al arrancar', async (b, base) => {
    const { context, page, errors } = await openApp(b, base);
    try {
      const hide = await waitCall(page, 'SplashScreen', 'hide', 5000);
      assert(hide.length === 1, `hide se llamó ${hide.length} veces`);
      assert(hide[0].options.fadeOutDuration === 250, `fadeOutDuration: ${hide[0].options.fadeOutDuration}`);
      assert(hide[0].t < 3500, `tardó ${hide[0].t} ms (debería ser apenas arranca, no el respaldo de 4 s)`);
      await page.waitForTimeout(300);
      assert((await calls(page, 'SplashScreen', 'hide')).length === 1, 'hide se llamó más de una vez');
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T8-splash'); await context.close(); }
  }],

  ['T9', 'launch-action', 'Acceso directo «Urgente»: al abrir y con la app abierta, sin bucles', async (b, base) => {
    // a) Arranque en frío: getLaunchAction devuelve 'urgent' una sola vez.
    let navs = [];
    const track = (p) => p.on('framenavigated', (f) => { if (f === p.mainFrame()) navs.push(f.url()); });
    let { context, page, errors } = await openApp(b, base, { config: { launchAction: 'urgent', permission: 'prompt' }, before: track });
    try {
      await page.waitForURL(/[?&]urgent=1/, { timeout: 8000 });
      await page.waitForFunction(() => window.WC?.ready === true);
      await page.waitForFunction(() => window.__mock.find('WCNative', 'getLaunchAction').length > 0);
      await page.waitForTimeout(800);
      // La carga inicial y el replace a ?urgent=1: nada más.
      assert(navs.length === 2 && /urgent=1/.test(navs[1]), `navegó ${navs.length} veces: ${navs.join(' → ')}`);
      const all = await page.evaluate(() => window.__mock.allCalls().filter((c) => c.method === 'getLaunchAction'));
      assert(all.length === 2, `getLaunchAction se llamó ${all.length} veces`);
      await healthy(page, errors);
      await shot(page, 'T9-launch-cold');
    } finally { await context.close(); }

    // b) Con la app abierta: llega el evento launchAction.
    ({ context, page, errors } = await openApp(b, base, { config: { permission: 'prompt' } }));
    try {
      navs = [];
      track(page);
      await page.waitForFunction(() => window.__mock.listenerCount('WCNative', 'launchAction') > 0);
      await page.waitForTimeout(100);
      assert(!/urgent/.test(page.url()), 'navegó sin acción');
      await page.evaluate(() => window.__mock.emit('WCNative', 'launchAction', { action: 'urgent' }));
      await page.waitForURL(/[?&]urgent=1/, { timeout: 5000 });
      await page.waitForFunction(() => window.WC?.ready === true && window.__mock.listenerCount('WCNative', 'launchAction') > 0);
      // Otro toque del acceso directo ya en modo urgente: vuelve a escanear
      // (recarga una vez más, con otro t=) y no entra en bucle.
      const first = page.url();
      await page.evaluate(() => window.__mock.emit('WCNative', 'launchAction', { action: 'urgent' }));
      await page.waitForURL((u) => u.href !== first && /[?&]urgent=1/.test(u.href), { timeout: 5000 });
      await page.waitForFunction(() => window.WC?.ready === true);
      await page.waitForTimeout(600);
      assert(navs.length === 2, `navegó ${navs.length} veces: ${navs.join(' → ')}`);
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T9-launch-action'); await context.close(); }
  }],

  ['T10', 'info', 'Modal de info sin «Instalar» y permissions.query nativo', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'prompt' } });
    try {
      const states = [];
      for (const p of ['denied', 'granted', 'prompt']) {
        states.push(await page.evaluate(async (perm) => {
          window.__mock.config.permission = perm;
          return (await navigator.permissions.query({ name: 'geolocation' })).state;
        }, p));
      }
      assert(states.join() === 'denied,granted,prompt', `estados: ${states.join(', ')}`);
      const other = await page.evaluate(async () => {
        try { return (await navigator.permissions.query({ name: 'notifications' })).state; } catch (e) { return 'error: ' + e.message; }
      });
      assert(['granted', 'denied', 'prompt'].includes(other), `otros permisos no van al original: ${other}`);
      const secure = await page.evaluate(() => window.isSecureContext);
      assert(secure === true, 'isSecureContext no es true');
      const html = await page.evaluate(() => [...document.documentElement.classList]);
      assert(html.includes('native') && html.includes('native-ios'), `clases de <html>: ${html.join(' ')}`);

      await scanFlow(page);
      await page.locator('#btn-info').click();
      await page.locator('#info').waitFor({ state: 'visible' });
      const row = page.locator('#info .row', { has: page.locator('[data-i18n="installHow"]') });
      assert(await row.count() === 1, 'no encontré la fila Instalar');
      assert(!(await row.isVisible()), 'la fila «Instalar» se ve');
      const modalText = await page.locator('#info').innerText();
      assert(!BANNED.test(modalText) && !/Instalar/.test(modalText), `el modal tiene texto de navegador: ${modalText.slice(0, 200)}`);
      await page.waitForFunction(() => /permiso/.test(document.getElementById('diag-text')?.textContent || ''), null, { timeout: 3000 });
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T10-info'); await context.close(); }
  }],

  ['T11', 'api-fallback', 'Falla de red en /api → TypeError y la app cae a Overpass', async (b, base) => {
    const { context, page, errors, blocked } = await openApp(b, base, {
      config: { permission: 'granted', httpError: 'The Internet connection appears to be offline.' }, overpass: true,
    });
    try {
      await page.locator('#view-best').waitFor({ state: 'visible', timeout: 10000 });
      assert((await calls(page, 'CapacitorHttp', 'request')).length >= 1, 'no intentó la API');
      assert(blocked.some((r) => r.startsWith('OVERPASS')), 'no cayó a Overpass');
      const r = await page.evaluate(async () => {
        const out = {};
        try { await fetch('/api/toilets?lat=1&lon=2&r=3'); out.net = 'resolvió'; } catch (e) { out.net = e.constructor.name; }
        window.__mock.config.httpError = null;
        window.__mock.config.http = { status: 503, headers: { 'content-type': 'application/json' }, data: { error: 'x' } };
        const res = await fetch('/api/toilets?lat=1&lon=2&r=3', { headers: { Accept: 'application/json' } });
        out.status = res.status; out.ok = res.ok; out.body = await res.json();
        window.__mock.config.http = { status: 200, headers: { 'content-type': 'text/plain' }, data: '{"elements":[]}' };
        out.text = await (await fetch('/api/x')).json();
        out.other = await fetch('/index.html').then((x) => x.status);
        return out;
      });
      assert(r.net === 'TypeError', `error de red como ${r.net}`);
      assert(r.status === 503 && r.ok === false && r.body.error === 'x', `respuesta 503: ${JSON.stringify(r)}`);
      assert(Array.isArray(r.text.elements), 'cuerpo de texto mal convertido');
      assert(r.other === 200, 'un fetch local que no es /api pasó por el nativo');
      const urls = (await calls(page, 'CapacitorHttp', 'request')).map((c) => c.options.url);
      assert(!urls.some((u) => u.includes('index.html')), 'index.html fue por CapacitorHttp');
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T11-api-fallback'); await context.close(); }
  }],

  ['T12', 'geolocation', 'watchPosition compartido, clearWatch y errores con code 1/2/3', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'granted' } });
    try {
      const r = await page.evaluate(async () => {
        const m = window.__mock;
        const geo = navigator.geolocation;
        const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
        const got = { a: [], b: [], errA: [] };
        const startsBefore = m.find('WCNative', 'startLocationUpdates').length;
        const stopsBefore = m.find('WCNative', 'stopLocationUpdates').length;
        const a = geo.watchPosition((p) => got.a.push(p.coords.latitude), (e) => got.errA.push(e.code));
        const bId = geo.watchPosition((p) => got.b.push(p.coords.latitude));
        await wait(60);
        m.emit('WCNative', 'locationUpdate', { timestamp: Date.now(), coords: { latitude: 1.5, longitude: 2, accuracy: 5, altitude: null, altitudeAccuracy: null, heading: null, speed: null } });
        m.emit('WCNative', 'locationError', { code: 'SERVICES_DISABLED', message: 'off' });
        await wait(20);
        geo.clearWatch(a);
        await wait(30);
        const stopsMid = m.find('WCNative', 'stopLocationUpdates').length - stopsBefore;
        geo.clearWatch(bId);
        await wait(30);
        const out = {
          ids: [typeof a, typeof bId, a !== bId],
          starts: m.find('WCNative', 'startLocationUpdates').length - startsBefore,
          stopsMid, stops: m.find('WCNative', 'stopLocationUpdates').length - stopsBefore,
          got,
          listeners: m.listenerCount('WCNative', 'locationUpdate'),
        };
        const once = (cfg) => new Promise((ok) => {
          Object.assign(m.config, cfg);
          geo.getCurrentPosition(() => ok('ok'), (e) => ok([e.code, e.PERMISSION_DENIED, e.POSITION_UNAVAILABLE, e.TIMEOUT]), { timeout: 1000 });
        });
        out.timeout = await once({ positionError: 'TIMEOUT' });
        out.unavailable = await once({ positionError: 'POSITION_UNAVAILABLE' });
        out.services = await once({ positionError: 'SERVICES_DISABLED' });
        out.ok = await once({ positionError: null });
        // Si el nativo nunca contesta, el reloj de seguridad (timeout + 3 s) corta con TIMEOUT.
        const t0 = Date.now();
        out.hang = await new Promise((ok) => {
          m.config.hang = ['getCurrentPosition'];
          geo.getCurrentPosition(() => ok('ok'), (e) => ok(e.code), { timeout: 200 });
        });
        out.hangMs = Date.now() - t0;
        m.config.hang = [];
        return out;
      });
      assert(r.ids[0] === 'number' && r.ids[1] === 'number' && r.ids[2], `ids de watchPosition: ${r.ids}`);
      // La app ya tenía su propio watch (escaneo automático): no se arranca de nuevo.
      assert(r.starts === 0, `startLocationUpdates se llamó ${r.starts} veces más`);
      assert(r.listeners === 1, `${r.listeners} listeners de locationUpdate`);
      assert(r.got.a.join() === '1.5' && r.got.b.join() === '1.5', `posiciones: ${JSON.stringify(r.got)}`);
      assert(r.got.errA.join() === '1', `locationError SERVICES_DISABLED → ${r.got.errA}`);
      assert(r.stopsMid === 0 && r.stops === 0, 'paró las actualizaciones con el watch de la app todavía activo');
      assert(r.timeout.join() === '3,1,2,3', `TIMEOUT → ${r.timeout}`);
      assert(r.unavailable[0] === 2 && r.services[0] === 1 && r.ok === 'ok', `códigos: ${JSON.stringify(r)}`);
      assert(r.hang === 3 && r.hangMs >= 3100 && r.hangMs < 4500, `reloj de seguridad: ${r.hang} en ${r.hangMs} ms`);

      // Sin el watch de la app: el último clearWatch apaga el GPS.
      const r2 = await page.evaluate(async () => {
        const m = window.__mock;
        const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
        for (let id = 1; id < 50; id++) navigator.geolocation.clearWatch(id);
        await wait(30);
        const stops = m.find('WCNative', 'stopLocationUpdates').length;
        const starts = m.find('WCNative', 'startLocationUpdates').length;
        const id = navigator.geolocation.watchPosition(() => {});
        await wait(30);
        const starts2 = m.find('WCNative', 'startLocationUpdates').length;
        navigator.geolocation.clearWatch(id);
        await wait(30);
        return { stops, starts, starts2, stops2: m.find('WCNative', 'stopLocationUpdates').length };
      });
      assert(r2.stops === 1, `stopLocationUpdates tras el último clearWatch: ${r2.stops}`);
      assert(r2.starts2 === r2.starts + 1 && r2.stops2 === 2, `reinicio: ${JSON.stringify(r2)}`);
      await healthy(page, errors);
      return page;
    } finally { await shot(page, 'T12-geolocation'); await context.close(); }
  }],

  ['T13', 'pre-permission', 'Pantalla previa al permiso: «Continuar», sin «Ahora no» ni instrucciones de qué elegir', async (b, base) => {
    const { context, page, errors } = await openApp(b, base, { config: { permission: 'prompt' } });
    try {
      const next = page.locator('#onb-next');
      await next.waitFor({ state: 'visible', timeout: 5000 });
      assert(await page.locator('#onb-skip').isVisible(), 'en el primer paso «Saltar» tiene que verse');
      await next.click();
      await next.click();
      await page.waitForFunction(() => document.getElementById('scan')?.dataset.onb === '2');
      const label = (await next.innerText()).trim();
      assert(label === 'Continuar', `botón del último paso: «${label}»`);
      assert(!(await page.locator('#onb-skip').isVisible()), '«Ahora no» se ve en la pantalla previa al permiso');
      const sub = await page.locator('#scan-sub').innerText();
      assert(!/no guardamos nada/i.test(sub), `texto del paso 3: ${sub}`);
      await shot(page, 'T13-pre-permission');
      // «Continuar» va derecho al pedido de ubicación nativo.
      await next.click();
      await waitCall(page, 'WCNative', 'getCurrentPosition');
      const hint = await page.evaluate(() => window.WC_NATIVE_TEXT.es.scanLocatingSub);
      assert(!/elegí|choose/i.test(hint), `el texto mientras ubica le dice qué elegir: ${hint}`);
      // La atribución del estilo del mapa está en el modal de info.
      const datos = await page.evaluate(() => document.querySelector('[data-i18n="dataSources"]')?.closest('.row')?.textContent || '');
      assert(/OpenMapTiles/.test(datos) && /OpenStreetMap/.test(datos), `fila «Datos»: ${datos}`);
      await healthy(page, errors);
      return page;
    } finally { await context.close(); }
  }],
];

async function shot(page, name) {
  try { if (!page.isClosed()) await page.screenshot({ path: path.join(OUT, `${name}.png`) }); } catch { /* sin captura */ }
}

/* ------------------------------------------------------------- main */

async function main() {
  if (!existsSync(path.join(WWW, 'index.html'))) {
    console.error('✗ Falta www/. Corré «npm test» (hace el build) o «npm run build» primero.');
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const only = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    // MapLibre necesita WebGL: en un contenedor sin GPU va por SwiftShader.
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

  const results = [];
  const t0 = Date.now();
  for (const [id, name, desc, run] of SCENARIOS) {
    if (only.size && !only.has(id)) continue;
    const t = Date.now();
    let ok = true, detail = '';
    try {
      await run(browser, base);
    } catch (err) {
      ok = false;
      // Para errores de Playwright (timeouts), la línea de la prueba donde pasó.
      const where = /bridge\.e2e\.mjs:(\d+)/.exec(err?.stack || '')?.[1];
      detail = err instanceof Fail ? err.message : (err?.message || String(err)).split('\n')[0] + (where ? ` (línea ${where})` : '');
    }
    results.push({ id, name, desc, ok, ms: Date.now() - t, detail });
    console.log(`${ok ? '✓' : '✗'} ${id} ${desc} (${Date.now() - t} ms)${ok ? '' : `\n    → ${detail}`}`);
  }

  await browser.close();
  server.close();

  const w = Math.max(...results.map((r) => r.desc.length));
  console.log(`\n  ${'id'.padEnd(4)} ${'escenario'.padEnd(w)}  resultado  tiempo`);
  console.log(`  ${'-'.repeat(4)} ${'-'.repeat(w)}  ---------  ------`);
  for (const r of results) {
    console.log(`  ${r.id.padEnd(4)} ${r.desc.padEnd(w)}  ${(r.ok ? 'OK' : 'FALLÓ').padEnd(9)}  ${(r.ms / 1000).toFixed(1)} s`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} OK en ${((Date.now() - t0) / 1000).toFixed(1)} s · capturas en tests/.output/`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
