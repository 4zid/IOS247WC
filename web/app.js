/* 247WC — app.js
   Baños públicos cercanos con geolocalización, mapa y guía a pie.
   Sin backend: OpenStreetMap (Overpass) para los datos, Valhalla/OSRM para la ruta.
*/

import { t, LANG, setLang, applyI18n, MOUSE } from './lang.js?v=35';

window.WC = window.WC || { errors: [], fatal: (m) => console.error(m) };
window.WC.started = true;

// Si MapLibre no cargó, no hay nada que hacer: avisamos en pantalla en vez de
// reventar en silencio tres líneas más abajo.
if (typeof maplibregl === 'undefined') {
  window.WC.fatal(t('mapFail'));
  throw new Error('MapLibre no disponible');
}

const CFG = {
  // Espejos de Overpass: si uno falla o está saturado, probamos el siguiente.
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ],
  api: '/api/toilets',   // capa propia: varios espejos + Refuge Restrooms + caché
  radius: 3000,          // metros alrededor tuyo
  radiusSteps: [3000],
  maxWalk: 3000,         // lo que alguien está dispuesto a caminar con urgencia
  autoGuideWithin: 300,  // al abrir con permiso dado: si está así de cerca, guía directa
  maxResults: 40,
  walkSpeed: 1.3,        // m/s ≈ 4,7 km/h
  arriveAt: 25,          // metros para considerar que llegaste
  cacheTTL: 24 * 60 * 60 * 1000,
};

// Dos ejes separados: el ANCHO decide el layout (≥1024 pantalla dividida,
// ≥760 panel flotante) y la ENTRADA (MOUSE, de lang.js) decide la guía: con
// mouse no hay brújula, la ruta sigue en el teléfono con un QR.
const desk = matchMedia('(min-width: 1024px)');
const wide = matchMedia('(min-width: 760px)');
// Aire alrededor de lo que se encuadra en el mapa grande de escritorio:
// arriba va el botón azul, a la derecha los controles.
const DESK_PAD = { top: 88, right: 88, bottom: 48, left: 48 };

const $ = (sel) => document.querySelector(sel);
const el = {
  status: $('#status'), statusCount: $('#status-count'), statusDot: $('.status-dot'),
  srStatus: $('#sr-status'), fab: $('#btn-scan-again'), fabLabel: $('#fab-label'),
  fabIcon: $('#btn-scan-again .scan-fab-icon'), fabUse: $('#btn-scan-again use'),
  list: $('#list'), empty: $('#empty'), count: $('#count-pill'),
  sheet: $('#sheet'), viewList: $('#view-list'), viewDetail: $('#view-detail'),
  viewBest: $('#view-best'), bestMap: $('#best-map'), bestName: $('#best-name'),
  bestMeta: $('#best-meta'), bestAttrs: $('#best-attrs'),
  bestGuide: $('#best-guide'), bestAll: $('#best-all'),
  bcName: $('#bc-name'), bcMeta: $('#bc-meta'), bcGuide: $('#bc-guide'),
  dName: $('#d-name'), dMeta: $('#d-meta'), dAttrs: $('#d-attrs'),
  dSteps: $('#d-steps'), dStepsWrap: $('#d-steps-wrap'),
  guide: $('#guide'), gName: $('#guide-name'), gDist: $('#guide-dist'),
  gEta: $('#guide-eta'), gStep: $('#guide-step'), gArrow: $('#guide-arrow'),
  gCompass: $('#guide-compass'), gHint: $('#guide-hint'), gRing: $('#guide-ring'),
  toast: $('#toast'), info: $('#info'),
  scan: $('#scan'), scanTitle: $('#scan-title'), scanSub: $('#scan-sub'),
  scanHelp: $('#scan-help'), scanResult: $('#scan-result'),
  scanResultName: $('#scan-result-name'), scanResultMeta: $('#scan-result-meta'),
  scanGo: $('#scan-go'), scanGoLabel: $('#scan-go-label'),
  onbDots: $('#onb-dots'), onbStep: $('#onb-step'), onbNext: $('#onb-next'), onbSkip: $('#onb-skip'),
  scanGuide: $('#scan-guide'), scanList: $('#scan-list'),
  scanBusiness: $('#scan-business'), scanManual: $('#scan-manual'),
  scanDismiss: $('#scan-dismiss'), scanBottom: $('.scan-bottom'),
  optBusiness: $('#opt-business'),
  mapEl: $('#map'), mapControls: $('.map-controls'), topbarBtns: [$('#status'), $('#btn-info')],
  listTitle: $('#list-title'), listNote: $('#list-note'), welcome: $('#list-welcome'),
  btnGuide: $('#btn-guide'), handoff: $('#d-handoff'), qr: $('#d-qr'), qrFail: $('#d-qr-fail'),
};

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('247wc:' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('247wc:' + key, JSON.stringify(value)); } catch { /* modo privado */ }
  },
};

const state = {
  me: null,                 // {lat, lng}
  accuracy: null,
  heading: null,            // grados respecto del norte, si hay brújula
  compassOn: false,         // los listeners de orientación ya están puestos
  places: [],
  selected: null,
  route: null,
  filters: new Set(store.get('filters', [])),
  guiding: false,
  arrived: false,
  loading: false,
  lastQueryCenter: null,
  lastSource: null,
  lastRadius: null,
  searching: null,
  wakeLock: null,
  // Contexto del botón azul (ver fabMode).
  fabBusy: null,            // texto mientras escanea o busca
  guideTarget: null,        // saliste de la guía con "Ver en el mapa"
  userMoved: false,         // el mapa se movió con el dedo
  zoneSearch: false,        // lo que se ve es de otra zona, no de donde estás
  lastSearchFailed: false,
  hoverId: null,            // tarjeta o pin bajo el mouse (escritorio)
  listScroll: 0,            // scroll de la lista antes de abrir un detalle
  mapDragging: false,
};

/* ---------------------------------------------------------------- utilidades */

const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function distance(a, b) {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a, b) {
  const la1 = toRad(a.lat), la2 = toRad(b.lat), dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Números con el formato del idioma (coma decimal en español).
const NUM_LOCALE = LANG === 'es' ? 'es-AR' : 'en-US';
const fmtKm = new Intl.NumberFormat(NUM_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtMoney = new Intl.NumberFormat(NUM_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDistance(m) {
  if (m < 950) return `${Math.round(m / 10) * 10}\u00a0m`;
  return `${fmtKm.format(m / 1000)}\u00a0${t('km')}`;
}

function cardinal(deg) {
  return t('cardinals')[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

function fmtMinutes(m) {
  const min = Math.max(1, Math.round(m / CFG.walkSpeed / 60));
  return min < 60 ? `${min} ${t('min')}` : `${Math.floor(min / 60)} ${t('h')} ${min % 60} ${t('min')}`;
}

function toast(msg, ms = 2800) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
}

// El chip de arriba muestra inodoro + punto + cantidad. El texto completo va
// al lector de pantalla y al aria-label, que es lo que se lee en voz alta.
function setStatus(text, kind) {
  state.statusText = text;
  state.statusKind = kind;
  el.srStatus.textContent = text;
  renderBadge();
}

// ¿La última búsqueda fue alrededor tuyo o sobre una zona elegida a mano?
function isLive() {
  return Boolean(state.me && state.lastQueryCenter && distance(state.me, state.lastQueryCenter) < 400);
}

function renderBadge() {
  const kind = state.statusKind;
  let dot = 'off';                                      // anillo naranja: sin ubicación
  if (kind === 'loading' || state.scanning) dot = 'loading';
  else if (kind !== 'error' && isLive()) dot = 'live';  // punto verde: en vivo
  el.statusDot.dataset.state = dot;
  const n = visiblePlaces().length;
  el.statusCount.textContent = state.places.length || isLive() ? String(n) : '—';
  el.status.setAttribute('aria-label', t('statusTap', { text: state.statusText || '', list: n > 0 }));
}

function vibrate(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignorar */ } }
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/* ------------------------------------------------------------------ el mapa */

// Estilo vectorial minimalista (Positron, servido por OpenFreeMap: sin clave
// ni límites). Si no carga, caemos a las teselas raster de OSM para que el
// mapa nunca quede en blanco.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const RASTER_STYLE = {
  version: 8,
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19 } },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

// Como Uber: se desplaza y hace zoom, no rota ni se inclina.
function createMap(container, extra = {}) {
  const m = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: [-58.3816, -34.6037],
    zoom: 13,
    minZoom: 11,
    maxZoom: 19,
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    fadeDuration: 0,
    ...extra,
  });
  m.touchZoomRotate.disableRotation();
  if (m.keyboard) m.keyboard.disableRotation();
  m.__fellBack = false;
  m.on('error', (e) => {
    // Un fallo del estilo (red, servicio caído) → raster. Los de teselas
    // sueltas no cuentan: son normales sin conexión.
    const msg = String(e?.error?.message || '');
    if (m.__fellBack || m.isStyleLoaded()) return;
    if (/style|Failed to fetch|NetworkError|json/i.test(msg)) {
      m.__fellBack = true;
      m.setStyle(RASTER_STYLE);
    }
  });
  // Las capas propias (ruta, precisión) se reponen cada vez que cambia el estilo.
  m.on('style.load', () => ensureLayers(m));
  return m;
}

const routeColor = () => getComputedStyle(document.documentElement).getPropertyValue('--route-line').trim() || '#0a6cff';

function ensureLayers(m) {
  if (!m.getSource('route')) {
    m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'route-line', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': routeColor(), 'line-width': 5, 'line-opacity': 0.9 },
    });
    m.addLayer({
      id: 'route-dash', type: 'line', source: 'route',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': routeColor(), 'line-width': 5, 'line-opacity': 0.9, 'line-dasharray': [0.4, 2] },
      filter: ['==', ['get', 'dashed'], true],
    });
    m.setFilter('route-line', ['!=', ['get', 'dashed'], true]);
  }
  if (!m.getSource('accuracy')) {
    m.addSource('accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#0a6cff', 'fill-opacity': 0.08 } }, 'route-line');
  }
  if (m.__pendingRoute) { setRoute(m, ...m.__pendingRoute); }
  if (m.__pendingAccuracy) { setAccuracy(m, ...m.__pendingAccuracy); }
}

// coords: [[lat, lng], ...] — la app piensa en lat/lng, MapLibre en lng/lat.
function setRoute(m, coords, dashed = false) {
  if (!m.getSource('route')) { m.__pendingRoute = [coords, dashed]; return; }
  m.__pendingRoute = null;
  const features = coords?.length
    ? [{ type: 'Feature', properties: { dashed }, geometry: { type: 'LineString', coordinates: coords.map(([lat, lng]) => [lng, lat]) } }]
    : [];
  m.getSource('route').setData({ type: 'FeatureCollection', features });
}
const clearRoute = (m) => setRoute(m, []);

function circlePolygon(lat, lng, radius, steps = 48) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const dLat = (radius * Math.cos(a)) / 111320;
    const dLng = (radius * Math.sin(a)) / (111320 * Math.cos(toRad(lat)));
    ring.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function setAccuracy(m, lat, lng, radius) {
  if (!m.getSource('accuracy')) { m.__pendingAccuracy = [lat, lng, radius]; return; }
  m.__pendingAccuracy = null;
  m.getSource('accuracy').setData({ type: 'FeatureCollection', features: radius > 15 ? [circlePolygon(lat, lng, radius)] : [] });
}

function setView(m, lat, lng, zoom, animate = true) {
  const opts = { center: [lng, lat], zoom, duration: animate ? 600 : 0 };
  if (animate) m.easeTo(opts); else m.jumpTo(opts);
}

// pts: [[lat, lng], ...]; pad: {top, bottom, left, right}
function fitPoints(m, pts, { top = 40, bottom = 40, left = 40, right = 40, maxZoom = 17, animate = true } = {}) {
  if (!pts.length) return;
  const b = new maplibregl.LngLatBounds();
  for (const [lat, lng] of pts) b.extend([lng, lat]);
  m.fitBounds(b, { padding: { top, bottom, left, right }, maxZoom, duration: animate ? 600 : 0 });
}

// Marcadores como DOM: MapLibre transforma el contenedor, y el pin rota
// adentro sin pisarse con esa transformación.
function makeMarker(m, html, lat, lng, { anchor = 'center', className = '' } = {}) {
  const el = document.createElement('div');
  el.className = `mk ${className}`.trim();
  el.innerHTML = html;
  return new maplibregl.Marker({ element: el, anchor }).setLngLat([lng, lat]).addTo(m);
}

const map = createMap('map');
window.WC.map = map;   // para el diagnóstico y las pruebas

/* Tema: auto (sigue al sistema), claro u oscuro. El script inline del HTML
   ya lo aplicó antes del primer pintado; acá lo mantenemos vivo. */
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = store.get('theme', 'auto');
  const dark = pref === 'dark' || (pref === 'auto' && themeMedia.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0f19' : '#ffffff');
  // La ruta se pinta con un color compensado para el filtro del mapa nocturno.
  for (const m of [map, bestMap]) {
    if (!m || !m.getLayer('route-line')) continue;
    m.setPaintProperty('route-line', 'line-color', routeColor());
    m.setPaintProperty('route-dash', 'line-color', routeColor());
  }
  document.querySelectorAll('.seg-btn[data-theme]').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.theme === pref ? 'true' : 'false');
  });
}
themeMedia.addEventListener('change', applyTheme);

const layers = {
  me: null,
  markers: [],
  pulse: null,
  index: new Map(),         // id → { item, marker }: une cada tarjeta con su pin
};

function renderMe() {
  if (!state.me) return;
  if (!layers.me) {
    layers.me = makeMarker(map, '<div class="me-dot"></div>', state.me.lat, state.me.lng, { className: 'mk-me' });
  } else {
    layers.me.setLngLat([state.me.lng, state.me.lat]);
  }
  setAccuracy(map, state.me.lat, state.me.lng, state.accuracy || 0);
}

/* --------------------------------------------------------- datos de los baños */

// Mantener igual a buildQuery() en api/toilets.js: trae baños públicos,
// lugares con baño y negocios de una; qué se muestra lo decide normalize().
function overpassQuery(center, radius) {
  const around = `${Math.round(radius)},${center.lat.toFixed(5)},${center.lng.toFixed(5)}`;
  const parts = [
    `nwr["amenity"="toilets"](around:${around});`,
    `nwr["building"="toilets"](around:${around});`,
    `nwr["toilets"="yes"](around:${around});`,
    `nwr["toilets:access"="public"](around:${around});`,
    `nwr["toilets:access"="yes"](around:${around});`,
  ];
  // Ojo: `out center` ya incluye id + tags + coordenadas.
  // Agregarle `tags` las quita y los nodos vuelven sin lat/lon.
  return `[out:json][timeout:12];(${parts.join('')});out center 1500;`;
}

// El centro se redondea a una grilla de ~250 m: la misma zona pide la misma
// URL y le pega a la caché del edge. El radio suma ese margen para no perder
// borde; las distancias igual se miden desde tu posición real.
const GRID = 0.0025;
const snap = (v) => Math.round(v / GRID) * GRID;

// Primero nuestra API (varios espejos, segunda fuente y caché de un día).
// Si no está disponible, vamos directo a Overpass desde el navegador.
async function fetchPlaces(center, radius) {
  try {
    const url = `${CFG.api}?lat=${snap(center.lat).toFixed(4)}&lon=${snap(center.lng).toFixed(4)}` +
      `&r=${Math.round(radius) + 250}`;
    const res = await withTimeout(fetch(url, { headers: { Accept: 'application/json' } }), 15000);
    if (!res.ok) throw new Error('api HTTP ' + res.status);
    const json = await res.json();
    let elements = json.elements || [];
    if (json.parcial) {
      // OSM no contestó en el servidor: probamos desde el teléfono y sumamos.
      const directo = await overpassDirect(center, radius);
      const ids = new Set(elements.map((e) => `${e.type}/${e.id}`));
      elements = elements.concat(directo.elements.filter((e) => !ids.has(`${e.type}/${e.id}`)));
      return { elements, source: directo.elements.length ? 'api+overpass' : 'api:parcial' };
    }
    return { elements, source: `api:${json.fuentes?.espejo || 'caché'}` };
  } catch (err) {
    console.warn('[247WC] la API propia falló, vamos directo a Overpass', err);
    return overpassDirect(center, radius);
  }
}

// Respaldo: los espejos públicos, consultados desde el navegador.
async function overpassDirect(center, radius) {
  const query = overpassQuery(center, radius);
  let lastError;
  for (const url of CFG.overpass) {
    try {
      const res = await withTimeout(fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      }), 20000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      // Overpass avisa los errores de ejecución con 200 y un campo remark.
      if (json.remark) throw new Error(json.remark);
      const elements = (json.elements || []).filter((e) => (e.lat ?? e.center?.lat) != null);
      if (elements.length) return { elements, source: new URL(url).hostname };
      lastError = new Error('sin resultados en ' + new URL(url).hostname);
    } catch (err) {
      lastError = err;
    }
  }
  // Ningún espejo dio datos. Puede ser una zona sin baños o que todos fallaran:
  // lo marcamos como vacío poco confiable y que decida quien llama.
  return { elements: [], source: 'overpass', incierto: true, error: lastError };
}

function normalize(element) {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  const tg = element.tags || {};
  const access = tg.access || tg['toilets:access'] || null;
  // Cerrado al público: no es una opción, ni siquiera con negocios prendido.
  if (/^(private|no)$/.test(tg.access || '') || /^(private|no)$/.test(tg['toilets:access'] || '')) return null;
  const isToilet = tg.amenity === 'toilets' || tg.building === 'toilets';
  const kind = isPublic(tg, isToilet) ? 'toilet' : 'business';
  return {
    id: `${element.type}/${element.id}`,
    lat, lng,
    kind,
    name: tg.name || (isToilet ? (tg.operator ? t('publicToiletBy', { op: tg.operator }) : t('publicToilet')) : businessLabel(tg)),
    tags: tg,
    fee: tg.fee === 'yes' ? 'paid' : (tg.fee === 'no' || tg.fee === undefined ? 'free' : 'unknown'),
    charge: tg.charge || tg['fee:amount'] || null,
    open24: isOpen24(tg.opening_hours),
    hours: tg.opening_hours || null,
    wheelchair: tg.wheelchair === 'yes' || tg['toilets:wheelchair'] === 'yes',
    changing: tg.changing_table === 'yes',
    access,
    unisex: tg.unisex === 'yes',
    gender: genderOf(tg),
    checkDate: tg['check_date'] || tg['survey:date'] || null,
  };
}

// Lugares a los que cualquiera entra sin consumir: si tienen baño cargado,
// es un baño público aunque no esté mapeado como amenity=toilets.
const PUBLIC_VENUES = {
  amenity: ['bus_station', 'fuel', 'library', 'hospital', 'townhall', 'marketplace', 'community_centre'],
  railway: ['station'],
  public_transport: ['station'],
  shop: ['mall'],
  leisure: ['park'],
};

function isPublic(tg, isToilet) {
  const access = tg.access || tg['toilets:access'];
  if (isToilet) return access !== 'customers';
  if (tg['toilets:access'] === 'public' || tg['toilets:access'] === 'yes') return true;
  if (tg.toilets !== 'yes' || tg['toilets:access'] === 'customers') return false;
  return Object.entries(PUBLIC_VENUES).some(([k, vals]) => vals.includes(tg[k]));
}

// «24/7», «Mo-Su 00:00-24:00» y «00:00-24:00» son todos abierto siempre.
function isOpen24(h) {
  if (!h) return false;
  return /24\/7/.test(h) || /^\s*(Mo-Su\s+)?00:00-(24:00|00:00)\s*$/.test(h);
}

// unisex / hombres y mujeres / solo hombres / solo mujeres, si está cargado.
function genderOf(tg) {
  if (tg.unisex === 'yes') return 'unisex';
  const m = tg.male === 'yes', f = tg.female === 'yes';
  if (m && f) return 'both';
  if (m) return 'male';
  if (f) return 'female';
  return null;
}

// «0.50 EUR» → «0,50 €», «1 EUR» → «1 €». Lo demás queda como viene.
function fmtCharge(charge) {
  if (!charge) return '';
  return charge
    .replace(/(\d+)[.,](\d{2})\s*EUR/i, (_, e, c) => `${fmtMoney.format(Number(`${e}.${c}`))}\u00a0€`)
    .replace(/(\d+)\s*EUR/i, '$1\u00a0€');
}

// Horarios de OSM más legibles: días abreviados en el idioma y «24/7» → 24 h.
function fmtHours(h) {
  if (!h) return '';
  if (isOpen24(h)) return t('open24h');
  const days = t('days');
  return h
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => days[d] || d)
    .replace(/-/g, '–')
    .replace(/;\s*/g, ' · ');
}

// Atributos ordenados por lo que importa cuando tenés urgencia:
// costo, horario, acceso, género, accesibilidad, cambiador, extras.
function attrsFor(p) {
  const out = [];
  if (p.fee === 'paid') out.push({ icon: 'i-coin', key: 'aFee', value: p.charge ? fmtCharge(p.charge) : t('bPaid'), cls: 'paid' });
  else if (p.tags.fee === 'no') out.push({ icon: 'i-free', key: 'aFee', value: t('bFree'), cls: 'good' });
  if (p.hours) out.push({ icon: 'i-clock', key: 'aHours', value: fmtHours(p.hours), cls: p.open24 ? 'good' : '' });
  if (p.access === 'customers') out.push({ icon: 'i-lock', key: 'aAccess', value: t('bCustomers'), cls: '' });
  else if (p.access === 'private') out.push({ icon: 'i-lock', key: 'aAccess', value: t('bPrivate'), cls: 'paid' });
  else if (p.kind === 'business') out.push({ icon: 'i-lock', key: 'aAccess', value: t('bInside'), cls: '' });
  if (p.gender) out.push({ icon: 'i-gender', key: 'aGender', value: t('gender')[p.gender], cls: '' });
  // Los sí/no llevan el nombre como etiqueta y «Sí» como valor; en línea va el nombre corto.
  if (p.wheelchair) out.push({ icon: 'i-wheel', key: 'aWheel', value: t('yes'), short: t('bWheelchair'), cls: 'good' });
  if (p.changing) out.push({ icon: 'i-baby', key: 'aChanging', value: t('yes'), short: t('bChanging'), cls: '' });
  if (p.tags['toilets:disposal'] === 'flush') out.push({ icon: 'i-drop', key: 'aFlush', value: t('yes'), short: t('bFlush'), cls: '' });
  if (p.tags.level) out.push({ icon: 'i-note', key: 'aFloor', value: String(p.tags.level), cls: '' });
  if (p.tags.description) out.push({ icon: 'i-note', key: 'aNote', value: p.tags.description, cls: '' });
  return out;
}

const ico = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

// Ficha completa (tarjeta y detalle): una fila por dato.
function renderAttrList(node, p, { max = 8 } = {}) {
  node.innerHTML = attrsFor(p).slice(0, max)
    .map((x) => `<li>${ico(x.icon)}<span class="k">${t(x.key)}</span><span class="v ${x.cls}">${escapeHTML(x.value)}</span></li>`)
    .join('');
}

// En línea (filas de la lista): hasta tres, ícono + valor corto.
function attrInline(p) {
  const items = attrsFor(p).filter((x) => x.key !== 'aNote' && x.key !== 'aFloor').slice(0, 3);
  if (!items.length) return `<span>${t('noData')}</span>`;
  return items.map((x) => `<span class="${x.cls}">${ico(x.icon)}${escapeHTML(x.short || x.value)}</span>`).join('');
}

function businessLabel(tg) {
  const names = t('biz');
  return names[tg.amenity] || names[tg.shop] || names[tg.leisure] ||
    ((tg.railway === 'station' || tg.public_transport === 'station') && names.station) ||
    names[tg.building] || t('shopWithToilet');
}

// Los negocios vienen siempre en la misma respuesta: una sola entrada por zona.
function cacheKey(center, radius) {
  return `cache2:${center.lat.toFixed(2)}:${center.lng.toFixed(2)}:${radius}`;
}

// Devuelve { ok, places } — ok:false significa "no pudimos averiguarlo",
// que NO es lo mismo que "no hay baños acá". Confundir las dos cosas fue
// justo lo que hacía que la app dijera que Berlín no tiene baños.
function search(center, opciones = {}) {
  // Si ya hay una búsqueda en curso, devolvemos esa misma promesa en vez de
  // cortar en seco: antes el escaneo seguía de largo y leía un estado vacío.
  if (state.searching) return state.searching;
  state.searching = doSearch(center, opciones).finally(() => { state.searching = null; });
  return state.searching;
}

async function doSearch(center, { silent = false, fresh = false } = {}) {
  state.loading = true;
  if (!silent) syncListBusy();
  if (!silent) setStatus(t('statusSearching'), 'loading');

  // La caché solo sirve si tiene algo: guardar vacíos escondía los fallos.
  const cached = store.get(cacheKey(center, CFG.radius));
  if (!fresh && cached?.places?.length && Date.now() - cached.at < CFG.cacheTTL) {
    applyPlaces(cached.places, center);
    state.loading = false;
    state.lastSource = 'caché local';
    refreshInBackground(center);
    return { ok: true, places: cached.places };
  }

  try {
    let places = [];
    let incierto = false;
    for (const radius of CFG.radiusSteps) {
      const { elements, source, incierto: dudoso } = await fetchPlaces(center, radius);
      state.lastSource = source;
      incierto = Boolean(dudoso);
      places = elements.map(normalize).filter(Boolean);
      state.lastRadius = radius;
      if (places.length >= 3) break;
    }

    if (!places.length && incierto) throw new Error('Ninguna fuente de datos respondió');

    if (places.length) {
      store.set(cacheKey(center, CFG.radius), { at: Date.now(), places });
      store.set('last', { at: Date.now(), center, places });
    }
    // La búsqueda ya terminó antes de pintar: si no hay nada a la vista, el
    // chip tiene que decir "sin baños", no seguir pulsando como si buscara.
    state.loading = false;
    state.lastSearchFailed = false;
    applyPlaces(places, center);
    return { ok: true, places };
  } catch (err) {
    console.warn('[247WC] búsqueda fallida', err);
    window.WC.errors.push('búsqueda: ' + String(err.message || err).slice(0, 80));
    const last = store.get('last');
    if (last?.places?.length) {
      applyPlaces(last.places, center);
      setStatus(t('statusOffline'), 'error');
      return { ok: true, places: last.places, viejo: true };
    }
    setStatus(t('statusFail'), 'error');
    state.lastSearchFailed = true;
    return { ok: false, error: err };
  } finally {
    state.loading = false;
    syncListBusy();
    updateFab();
  }
}

async function refreshInBackground(center) {
  try {
    const { elements, source } = await fetchPlaces(center, CFG.radius);
    const places = elements.map(normalize).filter(Boolean);
    if (!places.length) return;
    state.lastSource = source;
    store.set(cacheKey(center, CFG.radius), { at: Date.now(), places });
    store.set('last', { at: Date.now(), center, places });
    applyPlaces(places, center);
  } catch { /* la caché ya se mostró */ }
}

function applyPlaces(places, center) {
  state.lastQueryCenter = center;
  state.places = places;
  render();
}

/* ----------------------------------------------------------------- filtrado */

function visiblePlaces() {
  // Alrededor tuyo, las distancias salen de tu posición. Si moviste el mapa
  // a otra zona y buscaste ahí, salen del centro de esa zona: el chip de
  // arriba ya avisa (anillo naranja) que no es desde donde estás.
  const origin = isLive() ? state.me : (state.lastQueryCenter || state.me);
  let list = state.places.map((p) => ({ ...p, dist: origin ? distance(origin, p) : Infinity }));

  // Nada más lejos que lo caminable: un baño a 4 km no es una opción real.
  if (origin) list = list.filter((p) => p.dist <= CFG.maxWalk);

  if (state.filters.has('free')) list = list.filter((p) => p.fee !== 'paid');
  if (state.filters.has('open24')) list = list.filter((p) => p.open24);
  if (state.filters.has('wheelchair')) list = list.filter((p) => p.wheelchair);
  if (state.filters.has('changing')) list = list.filter((p) => p.changing);
  if (!state.filters.has('business')) list = list.filter((p) => p.kind === 'toilet');

  list.sort((a, b) => a.dist - b.dist);
  return list.slice(0, CFG.maxResults);
}

/* ----------------------------------------------------------------- render UI */

function render() {
  const list = visiblePlaces();
  // Si el foco estaba en una tarjeta, vuelve a la misma después de reconstruir
  // (cada posición nueva del GPS redibuja la lista).
  const focusId = el.list.contains(document.activeElement) ? document.activeElement.dataset.id : null;
  el.list.innerHTML = '';
  for (const mk of layers.markers) mk.remove();
  layers.markers = [];
  layers.index.clear();

  el.count.textContent = String(list.length);
  // Sin ninguna búsqueda todavía no hay "vacío": va la bienvenida (escritorio).
  el.empty.hidden = list.length > 0 || !state.lastQueryCenter;
  el.welcome.hidden = Boolean(state.lastQueryCenter);
  // Ubicación aproximada (Wi‑Fi o IP en una compu): no prometemos "el más cercano".
  const precise = isLive() && (state.accuracy ?? Infinity) <= 250;
  el.listNote.hidden = !(list.length && isLive() && !precise);
  if (!list.length) {
    el.empty.textContent = state.places.length
      ? t('emptyFiltered')
      : t('emptyNone');
  }

  if (list.length) {
    const n = t('nToilets', { n: list.length });
    setStatus(isLive() ? t('nearYou', { n }) : t('inZone', { n }), 'ok');
  } else {
    if (!state.loading) {
      setStatus(
        state.places.length
          ? t('noneFilters')
          : t('noneZone'),
        'error',
      );
    }
  }

  list.forEach((p, i) => {
    const li = itemNode(p, i === 0 && precise);
    const marker = markerFor(p);
    el.list.appendChild(li);
    layers.markers.push(marker);
    layers.index.set(p.id, { item: li.firstElementChild, marker });
  });
  const hovered = state.hoverId && layers.index.get(state.hoverId);
  if (hovered) paintHover(hovered, true); else state.hoverId = null;
  if (focusId) layers.index.get(focusId)?.item.focus({ preventScroll: true });
  updateFab();
}

function itemNode(p, nearest = false) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.className = nearest ? 'item is-nearest' : 'item';
  btn.type = 'button';
  btn.dataset.id = p.id;
  btn.dataset.selected = state.selected?.id === p.id ? '1' : '0';

  btn.innerHTML = `
    <span class="dist-tile">
      <strong>${fmtDistance(p.dist)}</strong>
      <small>${fmtMinutes(p.dist)}</small>
    </span>
    <span class="item-body">
      ${nearest ? `<span class="item-badge">${t('nearest')}</span>` : ''}
      <h3>${escapeHTML(p.name)}</h3>
      <span class="attr-inline">${attrInline(p)}</span>
    </span>
    <span class="item-go" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </span>`;
  btn.addEventListener('click', () => selectPlace(p, { zoom: true }));
  li.appendChild(btn);
  return li;
}

// El nombre flotante va en .pin-wrap y no en .wc-pin, que está rotado.
function pinHTML(p, selected, tip = false) {
  return `<div class="pin-wrap"><div class="wc-pin" data-paid="${p.fee === 'paid' ? 1 : 0}" data-kind="${p.kind}" data-selected="${selected ? 1 : 0}"><span>WC</span></div>` +
    `${tip ? `<span class="pin-tip" aria-hidden="true">${escapeHTML(p.name)}</span>` : ''}</div>`;
}

function markerFor(p) {
  const selected = state.selected?.id === p.id;
  const mk = makeMarker(map, pinHTML(p, selected, true), p.lat, p.lng, { anchor: 'bottom', className: 'mk-pin' });
  const node = mk.getElement();
  node.setAttribute('role', 'button');
  // En escritorio el camino de teclado son las tarjetas: enfocar una resalta su pin.
  node.setAttribute('tabindex', desk.matches ? '-1' : '0');
  node.setAttribute('aria-label', p.name);
  node.dataset.id = p.id;
  if (selected) node.style.zIndex = '1';
  node.addEventListener('click', () => pinClick(p));
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pinClick(p); }
  });
  node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setHover(p.id); });
  node.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setHover(null); });
  return mk;
}

// En escritorio el mapa se ve con la portada abierta: un clic en un pin la
// cierra y abre el detalle. Mientras ubica, busca o explica, no hace nada.
function pinClick(p) {
  const mode = el.scan.dataset.state;
  if (mode !== 'off') {
    if (!desk.matches || !['idle', 'error', 'empty', 'done'].includes(mode)) return;
    closeScan();
  }
  selectPlace(p, { zoom: false });
}

// Tarjeta ↔ pin: lo que está bajo el mouse (o con foco) se resalta en los dos.
function paintHover({ item, marker }, on) {
  item.dataset.hover = on ? '1' : '0';
  const node = marker.getElement();
  node.dataset.hover = on ? '1' : '0';
  node.style.zIndex = on ? '2' : (state.selected && item.dataset.selected === '1' ? '1' : '');
}

function setHover(id) {
  if (state.hoverId === id) return;
  const prev = state.hoverId && layers.index.get(state.hoverId);
  if (prev) paintHover(prev, false);
  state.hoverId = id;
  const cur = id && layers.index.get(id);
  if (cur) paintHover(cur, true);
}

// Delegado en la lista: sobrevive a cada render().
el.list.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'mouse') setHover(e.target.closest('.item')?.dataset.id || null);
});
el.list.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setHover(null); });
el.list.addEventListener('focusin', (e) => setHover(e.target.closest('.item')?.dataset.id || null));
el.list.addEventListener('focusout', (e) => { if (!el.list.contains(e.relatedTarget)) setHover(null); });

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* --------------------------------------------------------- detalle + ruteo */

function openSheet(mode) {
  el.sheet.dataset.open = mode;
  document.body.dataset.sheet = mode;
  document.querySelector('.sheet-handle')?.setAttribute('aria-expanded', mode === 'full' ? 'true' : 'false');
}

// Teclado: la manija abre y cierra la hoja (el toque lo resuelve endDrag).
document.querySelector('.sheet-handle')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  openSheet(el.sheet.dataset.open === 'full' ? 'peek' : 'full');
});

const PEEK_BY_VIEW = { list: 214, best: 132, detail: 214 };
function showView(name) {
  el.viewList.hidden = name !== 'list';
  el.viewDetail.hidden = name !== 'detail';
  el.viewBest.hidden = name !== 'best';
  document.documentElement.style.setProperty('--sheet-peek', `${PEEK_BY_VIEW[name]}px`);
}

function showDetail(show) {
  showView(show ? 'detail' : 'list');
  openSheet(show ? 'full' : 'peek');
}

/* ------------------------------------------------------------ mejor opción */

// Minimapa fijo dentro de la tarjeta: tu posición, el baño y el recorrido.
// Es una imagen, no se toca: el gesto de arrastre se lo queda la hoja.
// Minimapa fijo dentro de la tarjeta. Se crea una sola vez (cuando el
// contenedor ya tiene tamaño) y después solo se actualiza: recrearlo en cada
// dato nuevo lo dejaba en blanco un instante y gastaba contextos WebGL.
let bestMap = null;
let bestMarkers = [];

function drawBest(p, route) {
  if (el.viewBest.hidden || !el.bestMap.clientHeight) return;   // todavía sin tamaño
  if (!bestMap) {
    bestMap = createMap(el.bestMap, { interactive: false });
    window.WC.bestMap = bestMap;
  } else {
    bestMap.resize();
  }
  for (const mk of bestMarkers) mk.remove();
  bestMarkers = [];

  const me = [state.me.lat, state.me.lng];
  const line = route?.coords?.length ? route.coords : [me, [p.lat, p.lng]];
  setRoute(bestMap, line, !route || route.fallback);
  bestMarkers.push(makeMarker(bestMap, '<div class="me-dot"></div>', me[0], me[1], { className: 'mk-me' }));
  bestMarkers.push(makeMarker(bestMap, pinHTML(p, false), p.lat, p.lng, { anchor: 'bottom', className: 'mk-pin' }));
  // Arriba va más aire: el pin mide 43 px y cuelga hacia arriba de su punto.
  fitPoints(bestMap, [...line, me, [p.lat, p.lng]], { top: 70, bottom: 36, left: 40, right: 40, maxZoom: 17, animate: false });
}

// Al terminar el escaneo: la hoja sube con el más cercano, el minimapa con el
// recorrido y dos salidas, la brújula o la lista completa.
async function showBest() {
  const list = visiblePlaces();
  const p = list[0];
  if (!p || !state.me) return;
  if (desk.matches) return showBestDesk(list);

  state.selected = p;
  render();
  el.bestName.textContent = p.name;
  el.bcName.textContent = p.name;
  el.bestMeta.textContent = `${fmtDistance(p.dist)} · ${fmtMinutes(p.dist)} ${t('walking')}`;
  el.bcMeta.textContent = `${fmtDistance(p.dist)} · ${fmtMinutes(p.dist)}`;
  renderAttrList(el.bestAttrs, p, { max: 4 });
  const allLabel = list.length > 1 ? t('seeN', { n: list.length }) : t('seeInList');
  el.bestAll.setAttribute('aria-label', allLabel);
  el.bestAll.title = allLabel;
  el.viewBest.scrollTop = 0;
  showView('best');
  openSheet('full');

  // El mapa grande queda encuadrado para cuando bajes la hoja.
  fitPoints(map, [[state.me.lat, state.me.lng], [p.lat, p.lng]], {
    top: 130, bottom: PEEK() + 110, left: 60, right: 60, maxZoom: 17,
  });

  // Primero la línea recta, enseguida; cuando llega el recorrido real, lo
  // reemplaza. Redibujamos al terminar la subida de la hoja porque Leaflet
  // necesita el tamaño final del contenedor.
  requestAnimationFrame(() => drawBest(p, null));
  setTimeout(() => { if (state.selected?.id === p.id && !el.viewBest.hidden) drawBest(p, state.routeFor === p.id ? state.route : null); }, 360);

  const route = await fetchRoute(state.me, p).catch(() => null);
  if (!route || state.selected?.id !== p.id) return;
  state.route = route;
  state.routeFor = p.id;
  if (!el.viewBest.hidden) drawBest(p, route);
  if (!route.fallback) {
    el.bestMeta.textContent = `${fmtDistance(route.distance)} · ${fmtMinutes(route.distance)} ${t('walking')}`;
    el.bcMeta.textContent = `${fmtDistance(route.distance)} · ${fmtMinutes(route.distance)}`;
  }

  setRoute(map, route.coords, route.fallback);
}

// Escritorio: no hay tarjeta aparte ni minimapa (un contexto WebGL menos).
// El más cercano queda marcado en la lista y el mapa grande muestra vos, los
// más cercanos y la ruta al primero.
async function showBestDesk(list) {
  const p = list[0];
  state.selected = p;
  render();
  showView('list');
  openSheet('full');
  el.viewList.scrollTop = 0;
  const me = [state.me.lat, state.me.lng];
  fitPoints(map, [me, ...list.slice(0, 6).map((q) => [q.lat, q.lng])], { ...DESK_PAD, maxZoom: 17 });

  const route = await fetchRoute(state.me, p).catch(() => null);
  if (!route || state.selected?.id !== p.id) return;
  state.route = route;
  state.routeFor = p.id;
  setRoute(map, route.coords, route.fallback);
  ensureVisible([...route.coords, me]);
}

// Encuadra solo si algo queda fuera de la parte visible del mapa: si ya se ve
// todo, no movemos nada. Espera a que termine un movimiento en curso para no
// medir a mitad de camino, y nunca le pelea el mapa a quien lo está arrastrando.
function ensureVisible(pts) {
  if (!pts.length || !desk.matches) return;
  if (state.mapDragging) return;
  if (map.isMoving()) { map.once('moveend', () => ensureVisible(pts)); return; }
  const c = map.getContainer();
  const w = c.clientWidth, h = c.clientHeight;
  const out = pts.some(([lat, lng]) => {
    const q = map.project([lng, lat]);
    return q.x < DESK_PAD.left || q.x > w - DESK_PAD.right || q.y < DESK_PAD.top || q.y > h - DESK_PAD.bottom;
  });
  if (out) fitPoints(map, pts, { ...DESK_PAD, maxZoom: 17 });
}

async function selectPlace(p, { zoom = false } = {}) {
  if (state.guideTarget && state.guideTarget.id !== p.id) state.guideTarget = null;
  // display:none resetea el scroll: lo guardamos para la vuelta.
  if (!el.viewList.hidden) state.listScroll = el.viewList.scrollTop;
  state.selected = p;
  render();
  showDetail(true);
  closeHandoff();

  el.dName.textContent = p.name;
  el.dMeta.textContent = `${fmtDistance(p.dist)} · ${fmtMinutes(p.dist)} ${t('walking')}`;
  renderAttrList(el.dAttrs, p);

  if (desk.matches) {
    ensureVisible(state.me ? [[state.me.lat, state.me.lng], [p.lat, p.lng]] : [[p.lat, p.lng]]);
    el.dName.focus({ preventScroll: true });
    el.viewDetail.scrollTop = 0;
  } else if (zoom) setView(map, p.lat, p.lng, Math.max(map.getZoom(), 17));

  el.dStepsWrap.hidden = true;
  el.dStepsWrap.open = desk.matches;   // en escritorio hay lugar: abiertas
  el.dSteps.innerHTML = '';
  if (state.me) drawRoute(p);
}

// Volver a la lista: mismo scroll y la tarjeta de recién, a la vista y con foco.
function goBackToList() {
  const id = state.selected?.id;
  state.selected = null;
  clearRoute(map);
  closeHandoff();
  showDetail(false);
  render();
  el.viewList.scrollTop = state.listScroll;
  const item = id && layers.index.get(id)?.item;
  if (item && desk.matches) {
    item.scrollIntoView({ block: 'nearest' });
    item.focus({ preventScroll: true });
  }
}

async function drawRoute(p) {
  const route = await fetchRoute(state.me, p).catch(() => null);
  // Si mientras tanto elegiste otro (o volviste a la lista), esta ruta ya no va.
  if (state.selected?.id !== p.id || el.viewDetail.hidden) return;
  state.route = route;
  state.routeFor = route ? p.id : null;
  clearRoute(map);
  if (!route) return;
  setRoute(map, route.coords, route.fallback);
  ensureVisible([...route.coords, [p.lat, p.lng]]);

  el.dMeta.textContent = route.fallback
    ? `${fmtDistance(p.dist)} · ${fmtMinutes(p.dist)} ${t('walking')} ${t('straightLine')}`
    : `${fmtDistance(route.distance)} · ${fmtMinutes(route.distance)} ${t('walking')}`;

  if (route.steps?.length) {
    el.dSteps.innerHTML = route.steps.slice(0, 8)
      .map((s) => `<li>${escapeHTML(s.text)}${s.distance ? ` <em>(${fmtDistance(s.distance)})</em>` : ''}</li>`)
      .join('');
    el.dStepsWrap.hidden = false;
  }
}

async function fetchRoute(from, to) {
  const valhalla = await routeValhalla(from, to).catch(() => null);
  if (valhalla) return valhalla;
  const osrm = await routeOSRM(from, to).catch(() => null);
  if (osrm) return osrm;
  return {
    coords: [[from.lat, from.lng], [to.lat, to.lng]],
    distance: distance(from, to),
    steps: [],
    fallback: true,
  };
}

async function routeValhalla(from, to) {
  const body = {
    locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
    costing: 'pedestrian',
    directions_options: { units: 'kilometers', language: t('valhallaLang') },
  };
  const res = await withTimeout(fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), 9000);
  if (!res.ok) throw new Error('valhalla ' + res.status);
  const json = await res.json();
  const leg = json.trip?.legs?.[0];
  if (!leg?.shape) throw new Error('valhalla sin ruta');
  const coords = decodePolyline(leg.shape, 6);
  return {
    coords,
    distance: (json.trip.summary?.length || 0) * 1000,
    steps: (leg.maneuvers || []).map((m) => {
      const c = coords[m.begin_shape_index] || null;
      return {
        text: m.instruction,
        distance: (m.length || 0) * 1000,
        loc: c ? { lat: c[0], lng: c[1] } : null,
      };
    }),
    fallback: false,
  };
}

async function routeOSRM(from, to) {
  const url = `https://router.project-osrm.org/route/v1/foot/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson&steps=true';
  const res = await withTimeout(fetch(url), 9000);
  if (!res.ok) throw new Error('osrm ' + res.status);
  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) throw new Error('osrm sin ruta');
  return {
    coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distance: route.distance,
    steps: (route.legs?.[0]?.steps || []).map((s) => ({
      text: osrmStepText(s),
      distance: s.distance,
      loc: s.maneuver?.location
        ? { lat: s.maneuver.location[1], lng: s.maneuver.location[0] }
        : null,
    })),
    fallback: false,
  };
}

function osrmStepText(step) {
  const dir = t('osrm')[step.maneuver?.modifier] || '';
  const street = step.name ? t('osrmVia', { name: step.name }) : '';
  if (step.maneuver?.type === 'depart') return t('osrmDepart', { street });
  if (step.maneuver?.type === 'arrive') return t('osrmArrive');
  return t('osrmTurn', { dir, street });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// Decodificador de polilíneas de Google/Valhalla (precisión 5 o 6).
function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  let index = 0, lat = 0, lng = 0;
  const coords = [];
  while (index < str.length) {
    let result = 1, shift = 0, b;
    do { b = str.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 1; shift = 0;
    do { b = str.charCodeAt(index++) - 63 - 1; result += b << shift; shift += 5; } while (b >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

/* -------------------------------------------------------------- modo guía */

async function startGuide(p) {
  if (!p) return;
  if (MOUSE) return phoneHandoff(p);   // en la compu no hay brújula: la ruta sigue en el teléfono
  state.guideTarget = null;
  askCompass();   // primero: iOS solo pregunta dentro del toque, antes de esperar nada
  el.gCompass.hidden = true;
  state.selected = p;
  state.guiding = true;
  state.arrived = false;
  el.guide.hidden = false;
  el.guide.dataset.arrived = '0';
  el.gName.textContent = p.name;
  el.gStep.textContent = t('calcRoute');
  updateGuide();

  if (!state.route || state.routeFor !== p.id) {
    state.route = await fetchRoute(state.me, p).catch(() => null);
    state.routeFor = p.id;
  }
  updateGuide();

  requestWakeLock();
}

// Desde "Ver en el mapa" la guía queda en pausa y el botón azul ofrece
// seguir; con la X es una salida a propósito.
function stopGuide(fromMap = false) {
  state.guideTarget = fromMap === true && !state.arrived ? state.selected : null;
  state.guiding = false;
  el.guide.hidden = true;
  releaseWakeLock();
}

function updateGuide() {
  if (!state.guiding || !state.me || !state.selected) return;
  const p = state.selected;
  const d = distance(state.me, p);
  el.gDist.textContent = fmtDistance(d);
  el.gEta.textContent = fmtMinutes(d);

  const brg = bearing(state.me, p);
  const hasCompass = state.heading != null;
  // Rotamos solo la flecha: la marca de norte tiene que quedarse quieta.
  el.gArrow.style.setProperty('--rot', `${hasCompass ? brg - state.heading : brg}deg`);
  el.gRing.style.setProperty('--ring', `${hasCompass ? -state.heading : 0}deg`);
  el.guide.dataset.compass = hasCompass ? '1' : '0';
  el.gHint.textContent = t(hasCompass ? 'guideHint' : 'noCompassHint');

  if (!state.arrived) el.gStep.textContent = currentStepText(brg, hasCompass);

  if (d <= CFG.arriveAt && !state.arrived) {
    state.arrived = true;
    el.guide.dataset.arrived = '1';
    el.gStep.textContent = t('arrived');
    vibrate([120, 60, 120, 60, 240]);
  } else if (d > CFG.arriveAt * 2 && state.arrived) {
    state.arrived = false;
    el.guide.dataset.arrived = '0';
  }

  maybeRecalculateRoute();
}

// Muestra la maniobra más cercana a donde estamos parados ahora.
function currentStepText(brg, hasCompass) {
  const steps = (state.route?.steps || []).filter((s) => s.loc);
  if (steps.length) {
    let best = steps[0], bestD = Infinity;
    for (const step of steps) {
      const dd = distance(state.me, step.loc);
      if (dd < bestD) { bestD = dd; best = step; }
    }
    if (best.text) return bestD > 30 ? t('untilStep', { dist: fmtDistance(bestD), text: best.text }) : best.text;
  }
  if (hasCompass) return t('followArrow');
  return t('walkTowards', { dir: cardinal(brg) });
}

// Si nos fuimos de la ruta, la recalculamos (como máximo cada 20 s).
async function maybeRecalculateRoute() {
  if (!state.route || state.route.fallback) return;
  const now = Date.now();
  if (now - (state.lastRecalc || 0) < 20000) return;
  const offRoute = state.route.coords
    .every((c) => distance(state.me, { lat: c[0], lng: c[1] }) > 45);
  if (!offRoute) return;
  state.lastRecalc = now;
  const fresh = await fetchRoute(state.me, state.selected).catch(() => null);
  if (!fresh) return;
  state.route = fresh;
  setRoute(map, fresh.coords, false);
}

function needsCompassPermission() {
  return typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';
}

// iOS solo deja pedir la brújula dentro de un toque, antes de cualquier
// espera. Por eso se llama primero, en el mismo instante en que se toca "Guiarme".
function askCompass() {
  if (state.compassOn) return;
  if (!needsCompassPermission()) { enableCompass(); return; }
  DeviceOrientationEvent.requestPermission()
    .then((res) => {
      if (res === 'granted') enableCompass();
      // Si dijo que no, iOS no vuelve a preguntar: el texto de la guía ya
      // explica que la flecha apunta según el norte del mapa.
      el.gCompass.hidden = true;
    })
    // Sin toque (la guía automática al abrir) iOS lo rechaza: queda el botón.
    .catch(() => { el.gCompass.hidden = !state.guiding; });
}

function enableCompass() {
  if (state.compassOn) return;   // una sola vez: si no, los listeners se duplican
  state.compassOn = true;
  const handler = (e) => {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha;
    if (heading != null && !Number.isNaN(heading)) {
      state.heading = heading;
      updateGuide();
    }
  };
  window.addEventListener('deviceorientationabsolute', handler, true);
  window.addEventListener('deviceorientation', handler, true);
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* no pasa nada si el navegador no deja */ }
}

function releaseWakeLock() {
  try { state.wakeLock?.release(); } catch { /* ignorar */ }
  state.wakeLock = null;
}

/* ------------------------------------------------- seguir en el teléfono */

// Con mouse, "Guiarme" abre el detalle con la ruta y un QR: se escanea con la
// cámara y la ruta a pie sigue en Google Maps, sin instalar nada.
async function phoneHandoff(p) {
  if (el.viewDetail.hidden || state.selected?.id !== p.id) await selectPlace(p, { zoom: true });
  const url = mapsUrl(p);
  el.handoff.hidden = false;
  el.handoff.dataset.url = url;
  el.btnGuide.setAttribute('aria-expanded', 'true');
  el.handoff.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  renderQR(url);
}

function closeHandoff() {
  el.handoff.hidden = true;
  delete el.handoff.dataset.url;
  if (MOUSE) el.btnGuide.setAttribute('aria-expanded', 'false');
}

// El QR se arma en el navegador (nada sale a un servicio externo) con una
// librería que se carga recién la primera vez. Si falla la carga, se puede
// reintentar: la promesa fallida no queda guardada.
let qrLib = null;
function loadQR() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  qrLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode/qrcode.js?v=35';
    s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error('qrcode')));
    s.onerror = () => { s.remove(); reject(new Error('qrcode')); };
    document.head.appendChild(s);
  }).catch((err) => { qrLib = null; throw err; });
  return qrLib;
}

async function renderQR(url) {
  el.qr.innerHTML = '';
  el.qr.hidden = false;
  el.qrFail.hidden = true;
  try {
    const qrcode = await loadQR();
    if (el.handoff.dataset.url !== url) return;   // ya se cerró o cambió de baño
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    el.qr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  } catch {
    if (el.handoff.dataset.url !== url) return;
    el.qr.hidden = true;
    el.qrFail.hidden = false;
  }
}

$('#d-copy').addEventListener('click', async () => {
  if (!state.selected) return;
  try {
    await navigator.clipboard.writeText(mapsUrl(state.selected));
    toast(t('toastLink'));
  } catch {
    toast(t('toastLinkFail'), 4500);
  }
});

/* ------------------------------------------------------------ geolocalización */

// iOS no muestra el diálogo de permiso si lo pedimos al cargar la página:
// tiene que salir de un toque del usuario. Por eso todo arranca en el escaneo.
function getFix({ timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout,
    });
  });
}

let watchId = null;
function startWatch() {
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    enableHighAccuracy: true,
    maximumAge: 4000,
    timeout: 25000,
  });
}

let firstFix = true;
function onPosition(pos) {
  const { latitude, longitude, accuracy, heading } = pos.coords;
  state.me = { lat: latitude, lng: longitude };
  state.accuracy = accuracy;
  if (typeof heading === 'number' && !Number.isNaN(heading) && state.heading == null) {
    state.heading = heading;
  }
  renderMe();

  if (firstFix) {
    firstFix = false;
    setView(map, latitude, longitude, 16);
    return;   // la búsqueda la dispara el escaneo, que es quien espera el resultado
  }

  render();
  updateGuide();
  // Si nos alejamos bastante del último punto de búsqueda, refrescamos.
  // Si estás mirando otra zona a propósito, no la pisamos con la tuya.
  if (!state.zoneSearch && state.lastQueryCenter && distance(state.lastQueryCenter, state.me) > 800) {
    search(state.me, { silent: true });
  }
}

function onPositionError(err) {
  const msgs = { 1: t('posDenied'), 2: t('posUnavailable'), 3: t('posTimeout') };
  setStatus(msgs[err.code] || t('posOther'), 'error');
}

/* ------------------------------------------------------ escaneo desde el mapa */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function showPulse(on, at) {
  if (layers.pulse) { layers.pulse.remove(); layers.pulse = null; }
  if (!on) return;
  const c = at || (state.me ? state.me : map.getCenter());
  layers.pulse = makeMarker(map, '<div class="scan-pulse"><span></span><span></span><span></span></div>', c.lat, c.lng, { className: 'mk-pulse' });
}

function setFabBusy(busy, label = t('scanning')) {
  state.fabBusy = busy ? label : null;
  el.fab.setAttribute('aria-busy', busy ? 'true' : 'false');
  syncListBusy();
  updateFab();
}

// Mientras escanea o busca, la lista vieja se atenúa (se nota en escritorio,
// donde el panel queda siempre a la vista).
function syncListBusy() {
  el.viewList.setAttribute('aria-busy', state.fabBusy || state.loading ? 'true' : 'false');
}

/* --------------------------------------------------------- el botón azul */

// Un solo botón que cambia según lo que hace falta en cada momento. El orden
// es la prioridad: el primero que se cumple gana.
const FAB = {
  busy: ['fab-scan', null],
  resume: ['i-nav', 'fabResume'],      // saliste de la guía para ver el mapa
  zone: ['fab-search', 'fabZone'],     // moviste el mapa lejos de donde se buscó
  retry: ['fab-retry', 'fabRetry'],    // la última búsqueda falló
  business: ['fab-store', 'fabBusiness'], // sin públicos, pero hay negocios con baño
  home: ['fab-home', 'fabHome'],       // estás viendo otra zona
  scan: ['fab-scan', 'scanFab'],
};
const FAB_ACTIONS = new Set(['resume', 'zone', 'retry', 'business']);
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function fabMode() {
  if (state.fabBusy) return 'busy';
  const g = state.guideTarget;
  if (g && !state.guiding && !(state.me && distance(state.me, g) <= CFG.arriveAt)) return 'resume';
  const origin = state.lastQueryCenter || state.me;
  if (state.userMoved && origin && distance(map.getCenter(), origin) > 1000) return 'zone';
  if (state.lastSearchFailed) return 'retry';
  if (!state.filters.has('business') && state.places.length && !visiblePlaces().length) {
    const from = isLive() ? state.me : (state.lastQueryCenter || state.me);
    if (from && state.places.some((p) => p.kind === 'business' && distance(from, p) <= CFG.maxWalk)) return 'business';
  }
  if (state.zoneSearch && state.me) return 'home';
  return 'scan';
}

function updateFab() {
  const mode = fabMode();
  const [icon, key] = FAB[mode];
  const label = mode === 'busy' ? state.fabBusy : t(key);
  const prev = el.fab.dataset.mode;
  if (prev === mode && el.fabLabel.textContent === label) return;

  const from = el.fab.getBoundingClientRect().width;
  const iconChanged = el.fabUse.getAttribute('href') !== `#${icon}`;
  el.fab.dataset.mode = mode;
  el.fabUse.setAttribute('href', `#${icon}`);
  el.fabLabel.textContent = label;
  if (reduceMotion.matches || !from) return;

  // El ancho acompaña al texto nuevo; el ícono entra girando y el texto sube.
  const to = el.fab.getBoundingClientRect().width;
  if (Math.abs(to - from) > 1) el.fab.animate({ width: [`${from}px`, `${to}px`] }, { duration: 280, easing: EASE });
  if (iconChanged) {
    el.fabIcon.animate([{ transform: 'rotate(-45deg) scale(.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 240, easing: EASE });
  }
  el.fabLabel.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE });
  // Cuando propone algo nuevo, un solo pulso para que se note.
  if (FAB_ACTIONS.has(mode) && prev !== mode) {
    el.fab.animate({ scale: [1, 1.05, 1] }, { duration: 360, delay: 120, easing: 'ease-out' });
    vibrate(10);
  }
}

async function searchZone() {
  const c = toPlain(map.getCenter());
  state.userMoved = false;
  setFabBusy(true, t('fabZoneBusy'));
  showPulse(true, c);
  try {
    const [r] = await Promise.all([search(c, { fresh: true }), sleep(900)]);
    if (r.ok) state.zoneSearch = true;
  } finally {
    showPulse(false);
    setFabBusy(false);
  }
}

el.fab.addEventListener('click', () => {
  switch (el.fab.dataset.mode) {
    case 'resume': return startGuide(state.guideTarget);
    case 'zone': return searchZone();
    case 'business':
      setBusiness(true);
      return render();
    default: return quickScan();   // scan, retry y home: escanear donde estás
  }
});

// El botón azul escanea ahí mismo, sin volver a la portada: ondas de radar
// sobre tu posición, el botón girando, y al terminar encuadra los resultados.
async function quickScan() {
  if (state.scanning) return;
  state.scanning = true;
  state.zoneSearch = false;
  state.userMoved = false;
  state.guideTarget = null;
  setFabBusy(true);
  openSheet('peek');
  setStatus(t('statusScanning'), 'loading');

  try {
    // Si ya te seguimos, la posición está fresca; si no, la pedimos.
    if (!state.me || watchId == null) {
      showPulse(true);
      let pos;
      try {
        pos = await getFix();
      } catch (err) {
        openScan();                      // la portada tiene la ayuda para el permiso
        scanProblem(locationHelp(err));
        return;
      }
      onPosition(pos);
      startWatch();
    }
    setView(map, state.me.lat, state.me.lng, Math.max(map.getZoom(), 16));
    showPulse(true);

    // Mínimo 1,4 s de animación: con la caché la respuesta llega al instante y
    // sin esto no se nota que buscó.
    const [r] = await Promise.all([search(state.me, { fresh: true }), sleep(1400)]);

    if (!r.ok) {
      toast(t('toastSources'), 4200);
      return;
    }
    vibrate(20);
    if (visiblePlaces().length) {
      showBest();
    } else {
      showView('list');
      openSheet('peek');
      toast(t('toastNoneNear'), 4200);
    }
  } finally {
    showPulse(false);
    setFabBusy(false);
    state.scanning = false;
    renderBadge();
  }
}

/* -------------------------------------------------------- pantalla de escaneo */

const SCAN_COPY = () => ({
  idle: { title: t('scanTitle'), sub: t('scanSub') },
  locating: { title: t('scanLocating'), sub: t('scanLocatingSub') },
  searching: { title: t('scanSearching'), sub: t('scanSearchingSub') },
});

function setScan(mode) {
  el.scan.dataset.state = mode;
  const copy = SCAN_COPY()[mode];
  if (copy) { el.scanTitle.textContent = copy.title; el.scanSub.textContent = copy.sub; }

  const scanning = mode === 'locating' || mode === 'searching';
  // La palabra encendida arriba acompaña el estado del escaneo.
  el.scan.dataset.word = { locating: 'encontrar', searching: 'encontrar', done: 'llegar' }[mode] || 'buscar';
  if (mode === 'idle') el.scanGoLabel.textContent = t('scanFab');
  el.scanGo.hidden = scanning || mode === 'done' || mode === 'onboarding';
  el.scanGo.disabled = scanning;
  el.scanDismiss.hidden = !(mode === 'empty' || (mode === 'idle' && desk.matches));
  el.scanResult.hidden = mode !== 'done';
  el.scanGuide.hidden = mode !== 'done';
  el.scanList.hidden = mode !== 'done';
  el.scanBusiness.hidden = !(mode === 'empty' && !state.filters.has('business'));
  el.scanManual.hidden = mode !== 'error';
  if (mode !== 'error' && mode !== 'empty') el.scanHelp.hidden = true;
  const onb = mode === 'onboarding';
  el.onbDots.hidden = !onb;
  el.onbNext.hidden = !onb;
  if (!onb) { el.onbSkip.hidden = true; el.onbStep.textContent = ''; delete el.scan.dataset.onb; }
  syncScanLayer();
}

// Con la portada abierta, lo de atrás no se alcanza con Tab ni con el lector.
// En escritorio el mapa queda a la vista y se puede usar (salvo en el
// onboarding, que lo tapa), así que ahí la portada no es modal.
function syncScanLayer() {
  const mode = el.scan.dataset.state;
  const open = mode !== 'off';
  document.body.dataset.scan = mode;
  for (const n of [el.sheet, el.mapControls, el.fab, ...el.topbarBtns]) n.inert = open;
  el.mapEl.inert = open && (!desk.matches || mode === 'onboarding');
  el.scanBottom.setAttribute('aria-modal', open && !desk.matches ? 'true' : 'false');
}

/* ------------------------------------------------------------- onboarding */

// Tres pasos sobre la misma portada, uno por palabra de arriba. Aparece solo
// la primera vez y siempre se puede saltar: quien abre con urgencia no puede
// quedar trabado. El último paso pide la ubicación justo después de explicar
// para qué sirve.
const ONB_WORDS = ['buscar', 'encontrar', 'llegar'];
let onbStep = -1;

function showOnboarding(step) {
  const prev = onbStep;
  onbStep = step;
  el.scan.hidden = false;
  setScan('onboarding');
  el.scan.dataset.word = ONB_WORDS[step];
  el.scan.dataset.onb = String(step);
  el.scanTitle.textContent = t(`onb${step + 1}Title`);
  el.scanSub.textContent = t(`onb${step + 1}Sub`);
  el.onbStep.textContent = t('onbStep', { n: step + 1 });
  el.onbNext.textContent = step === 2 ? t('onbAllow') : t('onbNext');
  // En el último paso el secundario es "Ahora no": mismo lugar, así el bloque
  // azul no cambia de alto entre pasos.
  el.onbSkip.hidden = false;
  el.onbSkip.textContent = step === 2 ? t('onbLater') : t('onbSkip');
  el.onbDots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i === step));
  if (prev !== step) {
    for (const n of [el.scanTitle, el.scanSub]) {
      n.classList.remove('onb-in');
      void n.offsetWidth;   // reinicia la animación de entrada
      n.classList.add('onb-in');
    }
  }
}

function endOnboarding() {
  onbStep = -1;
  store.set('onboarded', 1);
  el.scanTitle.classList.remove('onb-in');
  el.scanSub.classList.remove('onb-in');
}

// La escena se diseña en 300×240: se achica para entrar en el alto que
// quede libre entre las palabras y el bloque azul. Si queda muy chica, mejor
// no mostrarla.
const onbArt = $('#onb-art');
new ResizeObserver(() => {
  // 256: los 240 de la escena más el giro y la sombra de las cards.
  // En escritorio la escena flota sobre el mapa grande: puede crecer hasta 1,6.
  const s = Math.min(desk.matches ? 1.6 : 1, onbArt.clientHeight / 256, onbArt.clientWidth / 300);
  onbArt.style.setProperty('--onb-s', s.toFixed(3));
  onbArt.style.visibility = s < 0.45 ? 'hidden' : '';
}).observe(onbArt);

el.onbNext.addEventListener('click', () => {
  if (onbStep < 2) return showOnboarding(onbStep + 1);
  endOnboarding();
  runScan();
});
el.onbSkip.addEventListener('click', () => {
  endOnboarding();
  openScan();
});

// Deslizar de costado también pasa de paso.
let onbSwipe = null;
el.scan.addEventListener('pointerdown', (e) => {
  // Con mouse, arrastrar es seleccionar texto: los pasos van con flechas o botones.
  if (el.scan.dataset.state === 'onboarding' && e.pointerType !== 'mouse') onbSwipe = { x: e.clientX, y: e.clientY };
});
el.scan.addEventListener('pointerup', (e) => {
  if (!onbSwipe || el.scan.dataset.state !== 'onboarding') return;
  const dx = e.clientX - onbSwipe.x, dy = e.clientY - onbSwipe.y;
  onbSwipe = null;
  if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
  if (dx < 0 && onbStep < 2) showOnboarding(onbStep + 1);
  else if (dx > 0 && onbStep > 0) showOnboarding(onbStep - 1);
});
el.scan.addEventListener('pointercancel', () => { onbSwipe = null; });

// Teclado: ← → cambian de paso (no dentro de campos ni con los ajustes abiertos).
document.addEventListener('keydown', (e) => {
  if (el.scan.dataset.state !== 'onboarding' || el.info.open || e.defaultPrevented) return;
  if (e.target.closest?.('input, textarea, select')) return;
  if (e.key === 'ArrowRight' && onbStep < 2) showOnboarding(onbStep + 1);
  else if (e.key === 'ArrowLeft' && onbStep > 0) showOnboarding(onbStep - 1);
});

function openScan() {
  el.scan.hidden = false;
  el.scanGoLabel.textContent = t('scanFab');
  setScan('idle');
}

function closeScan() {
  const hadFocus = el.scan.contains(document.activeElement);
  el.scan.dataset.state = 'off';
  syncScanLayer();
  // En escritorio el foco sigue en el panel, no se cae al body.
  if (hadFocus && desk.matches) el.listTitle.focus({ preventScroll: true });
}

async function runScan() {
  if (!('geolocation' in navigator)) {
    return scanProblem(t('noGeo'));
  }
  if (!window.isSecureContext) {
    return scanProblem(t('noHttps'));
  }

  setScan('locating');
  let pos;
  try {
    pos = await getFix();
  } catch (err) {
    return scanProblem(locationHelp(err));
  }

  onPosition(pos);
  startWatch();

  setScan('searching');
  // En escritorio el mapa se ve al lado: el radar acompaña la búsqueda.
  if (desk.matches) showPulse(true);
  let r;
  try { r = await search(state.me); } finally { showPulse(false); }
  if (!r.ok) return dataProblem();
  if (!visiblePlaces().length) return showScanOutcome();   // vacío: la portada explica
  closeScan();
  vibrate(30);
  showBest();
}

function showScanOutcome() {
  const list = visiblePlaces();
  if (!list.length) {
    setScan('empty');
    el.scanTitle.textContent = t('emptyTitle');
    el.scanSub.textContent = state.filters.has('business')
      ? t('emptySubBiz')
      : t('emptySub');
    el.scanHelp.hidden = false;
    el.scanHelp.innerHTML = t('emptyHelp');
    el.scanGo.hidden = false;
    el.scanGo.disabled = false;
    el.scanGoLabel.textContent = t('scanAgain');
    el.scanDismiss.hidden = false;
    return;
  }

  const nearest = list[0];
  setScan('done');
  el.scanTitle.textContent = t('nearYou', { n: t('nToilets', { n: list.length }) });
  el.scanSub.textContent = '';
  el.scanResultName.textContent = nearest.name;
  el.scanResultMeta.textContent = `${fmtDistance(nearest.dist)} · ${fmtMinutes(nearest.dist)} ${t('walking')}`;
  el.scanDismiss.hidden = true;
  vibrate(30);
}

// Falla de datos, no de ubicación: el mensaje tiene que decir otra cosa.
function dataProblem() {
  setScan('error');
  el.scanTitle.textContent = t('dataTitle');
  el.scanSub.textContent = t('dataSub');
  el.scanHelp.hidden = false;
  el.scanHelp.innerHTML = t('dataHelp');
  el.scanGo.hidden = false;
  el.scanGo.disabled = false;
  el.scanGoLabel.textContent = t('retry');
  el.scanManual.hidden = true;
  el.scanDismiss.hidden = false;
  setStatus(t('dataStatus'), 'error');
}

function scanProblem(help) {
  setScan('error');
  el.scanTitle.textContent = t('locTitle');
  el.scanSub.textContent = t('locSub');
  el.scanHelp.hidden = false;
  el.scanHelp.innerHTML = help;
  el.scanGo.hidden = false;
  el.scanGo.disabled = false;
  el.scanGoLabel.textContent = t('retry');
  el.scanDismiss.hidden = true;
  setStatus(t('locStatus'), 'error');
  // En pantallas cortas el bloque entra recién scrolleando: lo acercamos.
  requestAnimationFrame(() => {
    el.scan.scrollTo({ top: el.scan.scrollHeight, behavior: 'smooth' });
  });
}

// El permiso denegado no se puede volver a pedir por código: hay que
// explicar dónde reactivarlo. Ojo: en iOS cada navegador de terceros necesita
// además su propio permiso de ubicación en los ajustes del sistema, y muchos
// vienen con el GPS apagado de fábrica.
function locationHelp(err) {
  if (err?.code !== 1) {
    return err?.code === 3 ? t('gpsTimeout') : t('gpsUnavailable');
  }

  const pasos = isIOS ? t('deniedIos') : t('deniedOther');
  return t('deniedHead') + pasos.join('<br>');
}

/* ------------------------------------------------------------------ eventos *//* ------------------------------------------------------------------ eventos */

$('#btn-locate').addEventListener('click', () => {
  state.userMoved = false;
  if (state.me) setView(map, state.me.lat, state.me.lng, 17);
  else quickScan();
});

// El chip del inodoro abre la lista; si todavía no hay nada para listar,
// escanea. Escanear de nuevo queda solo en el botón azul.
el.status.addEventListener('click', () => {
  if (!visiblePlaces().length) return quickScan();
  // Con el panel siempre a la vista: del detalle vuelve a la lista; si no,
  // la lista arriba de todo.
  if (wide.matches) {
    if (!el.viewDetail.hidden) return goBackToList();
    showView('list');
    openSheet('full');
    el.viewList.scrollTop = 0;
    return;
  }
  if (el.sheet.dataset.open === 'full' && !el.viewList.hidden) return openSheet('peek');
  showView('list');
  el.viewList.scrollTop = 0;
  openSheet('full');
});

el.scanGo.addEventListener('click', runScan);
el.scanDismiss.addEventListener('click', closeScan);

// Para abrir el link en otro navegador: la salida real cuando el de
// terceros tiene el GPS bloqueado por el sistema. El botón vive dentro de
// la ayuda, así que lo escuchamos por delegación.
el.scanHelp.addEventListener('click', async (e) => {
  if (!e.target.closest('#scan-copy')) return;
  try {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    toast(t('toastCopied'), 4500);
  } catch {
    toast(t('toastCopyManual', { host: location.host }), 6000);
  }
});

// Salida sin GPS: mover el mapa a mano y buscar en esa zona.
el.scanManual.addEventListener('click', async () => {
  closeScan();
  openSheet('peek');
  toast(t('toastManual'), 5200);
  await search(toPlain(map.getCenter()));
});

el.scanList.addEventListener('click', () => {
  closeScan();
  openSheet('full');
});

el.scanGuide.addEventListener('click', async () => {
  const nearest = visiblePlaces()[0];
  if (!nearest) return;
  if (!MOUSE) askCompass();   // antes del await: después iOS ya no deja preguntar
  closeScan();
  await selectPlace(nearest, { zoom: true });
  startGuide(nearest);
});

// Atajo desde la pantalla vacía: prender el switch y volver a escanear.
el.scanBusiness.addEventListener('click', async () => {
  setBusiness(true);
  await runScan();
});

el.bestGuide.addEventListener('click', () => {
  if (state.selected) startGuide(state.selected);
});
el.bcGuide.addEventListener('click', () => {
  if (state.selected) startGuide(state.selected);
});

el.bestAll.addEventListener('click', () => {
  showView('list');
  el.viewList.scrollTop = 0;
  openSheet('full');
});

$('#btn-back').addEventListener('click', goBackToList);

$('#btn-guide').addEventListener('click', () => {
  if (!state.me) { openScan(); return; }
  if (MOUSE && !el.handoff.hidden) return closeHandoff();
  startGuide(state.selected);
});

$('#guide-close').addEventListener('click', () => { stopGuide(false); updateFab(); });
$('#guide-map').addEventListener('click', () => { stopGuide(true); updateFab(); });
$('#guide-maps').addEventListener('click', () => openInMaps(state.selected));

el.gCompass.addEventListener('click', async () => {
  try {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res === 'granted') { enableCompass(); el.gCompass.hidden = true; }
    else toast(t('noCompass'));
  } catch { toast(t('compassFail')); }
});

// Siempre Google Maps: con la app instalada abre la app; si no, la web.
const mapsUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=walking`;
function openInMaps(p) {
  if (!p) return;
  window.open(mapsUrl(p), '_blank', 'noopener');
}
$('#btn-maps').addEventListener('click', () => openInMaps(state.selected));
$('#best-maps').addEventListener('click', () => openInMaps(state.selected));

$('#btn-contribute').addEventListener('click', () => {
  const c = state.me || map.getCenter();
  const lat = c.lat.toFixed(5), lng = (c.lng ?? c.lon).toFixed(5);
  window.open(`https://www.openstreetmap.org/note/new#map=19/${lat}/${lng}`, '_blank', 'noopener');
  toast(t('toastContribute'));
});

document.querySelectorAll('.chip').forEach((chip) => {
  const key = chip.dataset.filter;
  chip.setAttribute('aria-pressed', state.filters.has(key) ? 'true' : 'false');
  chip.addEventListener('click', () => {
    if (state.filters.has(key)) state.filters.delete(key);
    else state.filters.add(key);
    chip.setAttribute('aria-pressed', state.filters.has(key) ? 'true' : 'false');
    store.set('filters', [...state.filters]);
    render();
  });
});

// «Bares y negocios» vive en un switch a la vista. Los negocios ya vienen en
// la misma respuesta, así que la búsqueda sale de la caché al instante.
function setBusiness(on) {
  if (on) state.filters.add('business');
  else state.filters.delete('business');
  el.optBusiness.checked = on;
  store.set('filters', [...state.filters]);
}

el.optBusiness.checked = state.filters.has('business');
el.optBusiness.addEventListener('change', async (e) => {
  setBusiness(e.target.checked);
  await search(state.me || toPlain(map.getCenter()));
  if (el.scan.dataset.state !== 'off') showScanOutcome();
});

const toPlain = (latlng) => ({ lat: latlng.lat, lng: latlng.lng });

$('#btn-info').addEventListener('click', () => el.info.showModal());
$('#info-close').addEventListener('click', () => el.info.close());
$('#btn-onb').addEventListener('click', () => {
  el.info.close();
  showOnboarding(0);
});
/* Hoja inferior: se arrastra desde el handle o la cabecera, siguiendo el
   dedo, y encaja arriba o abajo según hacia dónde iba. Un toque sin mover
   la abre o la cierra. */
const PEEK = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek')) || 200;
const offsetPeek = () => Math.max(0, el.sheet.getBoundingClientRect().height - PEEK());
let drag = null;

el.sheet.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.drag-zone') || wide.matches) return;
  // Los controles siguen siendo controles; la manija es botón (por teclado) pero se arrastra.
  const ctrl = e.target.closest('button, a, input, label');
  if (ctrl && !ctrl.classList.contains('sheet-handle')) return;
  drag = {
    id: e.pointerId,
    startY: e.clientY,
    lastY: e.clientY,
    lastT: performance.now(),
    velocity: 0,
    base: el.sheet.dataset.open === 'full' ? 0 : offsetPeek(),
    moved: false,
  };
  el.sheet.classList.add('dragging');
  el.sheet.setPointerCapture(e.pointerId);
});

el.sheet.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dy) > 6) drag.moved = true;
  const now = performance.now();
  drag.velocity = (e.clientY - drag.lastY) / Math.max(1, now - drag.lastT);
  drag.lastY = e.clientY;
  drag.lastT = now;
  const y = Math.min(offsetPeek(), Math.max(0, drag.base + dy));
  el.sheet.style.transform = `translateY(${y}px)`;
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.startY;
  const wasFull = el.sheet.dataset.open === 'full';
  let target;
  if (!drag.moved) target = wasFull ? 'peek' : 'full';              // toque
  else if (Math.abs(drag.velocity) > 0.35) target = drag.velocity < 0 ? 'full' : 'peek';
  else target = (drag.base + dy) < offsetPeek() / 2 ? 'full' : 'peek';
  el.sheet.classList.remove('dragging');
  el.sheet.style.transform = '';
  openSheet(target);
  drag = null;
}
el.sheet.addEventListener('pointerup', endDrag);
el.sheet.addEventListener('pointercancel', endDrag);

// Solo cuenta lo que mueve la persona (arrastrar, pellizcar): lo que mueve la
// app al centrar o encuadrar no trae originalEvent.
map.on('movestart', (e) => { if (e.originalEvent) state.userMoved = true; });
map.on('moveend', () => updateFab());

map.on('dragstart', () => {
  state.mapDragging = true;
  // La hoja del celular baja al arrastrar el mapa; el panel de ≥760 no se toca.
  if (!wide.matches && el.sheet.dataset.open === 'full' && el.viewDetail.hidden) openSheet('peek');
});
map.on('dragend', () => { state.mapDragging = false; });

$('#btn-zoom-in').addEventListener('click', () => map.zoomIn());
$('#btn-zoom-out').addEventListener('click', () => map.zoomOut());
$('#welcome-scan').addEventListener('click', () => quickScan());

// Esc: cierra el QR y, si ya está cerrado, vuelve a la lista. No toca nada si
// hay otra capa arriba (ajustes, portada, guía) o si alguien ya usó la tecla.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (el.info.open || el.scan.dataset.state !== 'off' || !el.guide.hidden) return;
  if (!el.handoff.hidden) { closeHandoff(); el.btnGuide.focus(); return; }
  if (wide.matches && !el.viewDetail.hidden) goBackToList();
});

// Cruzar los 1024 px (ventana que se achica o agranda) en medio del uso.
function onLayoutChange() {
  syncScanLayer();
  if (el.scan.dataset.state === 'idle') el.scanDismiss.hidden = !desk.matches;
  if (desk.matches && !el.viewBest.hidden) showView('list');
  if (state.lastQueryCenter) render();   // tabindex de los marcadores
}
desk.addEventListener('change', onLayoutChange);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.guiding) requestWakeLock();
});

/* ------------------------------------------------------------------- arranque */

const lastSaved = store.get('last');
if (lastSaved?.places?.length && lastSaved.center) {
  applyPlaces(lastSaved.places, lastSaved.center);
  setView(map, lastSaved.center.lat, lastSaved.center.lng, 15, false);
}

document.body.dataset.sheet = el.sheet.dataset.open;
applyI18n();
setStatus(t('statusIdle'), 'idle');
updateFab();
openScan();

// Si ya dio permiso antes, no la hacemos tocar de nuevo: escaneamos solos.
// La primera vez, sin permiso y sin urgencia, va la introducción.
(async () => {
  const auto = new URLSearchParams(location.search).has('urgent');
  let granted = false;
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    granted = perm?.state === 'granted';
    if (granted) {
      await runScan();
      // Con urgencia, el baño de la esquina no necesita tarjeta: directo a la guía.
      // Con mouse no hay guía que abrir: queda la lista con el más cercano
      // (con ?urgent, directo a su detalle con la ruta).
      const cerca = state.selected && state.selected.dist <= CFG.autoGuideWithin;
      if (MOUSE) { if (auto && state.selected) selectPlace(state.selected); }
      else if ((auto || cerca) && state.selected) startGuide(state.selected);
      return;
    }
  } catch { /* Safari viejo no soporta permissions.query para geolocation */ }
  if (auto) return runScan();
  if (!granted && !store.get('onboarded') && el.scan.dataset.state === 'idle') showOnboarding(0);
})();

window.WC.ready = true;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* sin offline, pero funciona */ });
  });

  // Cuando entra una versión nueva, recargamos una sola vez para no quedar
  // con el HTML nuevo y el JS viejo conviviendo.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

/* --------------------------------------------------------------- diagnóstico */

async function diagnostics() {
  const rows = [['build', window.WC.build || '?']];
  rows.push(['ubicación', state.me ? 'ok' : 'sin fix']);
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    rows.push(['permiso', perm?.state || 'desconocido']);
  } catch { rows.push(['permiso', 'no consultable']); }
  rows.push(['https', window.isSecureContext ? 'sí' : 'no']);
  rows.push(['baños cargados', String(state.places.length)]);
  rows.push(['fuente', state.lastSource || '—']);
  rows.push(['radio', `${state.lastRadius || '—'} m`]);
  try {
    const regs = await navigator.serviceWorker?.getRegistrations();
    rows.push(['service workers', String(regs ? regs.length : 0)]);
  } catch { /* nada */ }
  if (window.WC.errors.length) rows.push(['errores', window.WC.errors.join(' | ')]);
  return rows;
}

$('#btn-info').addEventListener('click', async () => {
  const rows = await diagnostics();
  $('#diag-text').innerHTML = rows.map(([k, v]) => `<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd>`).join('');
});

document.querySelectorAll('.seg-btn[data-theme]').forEach((b) => {
  b.addEventListener('click', () => {
    store.set('theme', b.dataset.theme);
    applyTheme();
  });
});
applyTheme();
$('#btn-reset').addEventListener('click', () => window.WC.reset());

// Selector de idioma: se guarda y se recarga (cambiar todo en caliente no vale la pena).
document.querySelectorAll('.seg-btn[data-lang]').forEach((b) => {
  b.setAttribute('aria-pressed', b.dataset.lang === LANG ? 'true' : 'false');
  b.addEventListener('click', () => {
    if (b.dataset.lang === LANG) return;
    setLang(b.dataset.lang);
    location.reload();
  });
});
