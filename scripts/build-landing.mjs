// Arma la landing de promo (site/index.html + site/assets/) a partir del
// export de Claude Design que está en landing/247WC_Landing.html.
//
// Ese export es un solo HTML de ~6 MB que se desarma en el navegador: trae
// adentro las fuentes, las capturas, React, el motor de componentes de Claude
// Design y Babel (3 MB, para traducir un componente .jsx en cada visita).
// Acá se desarma una sola vez y queda un sitio estático liviano:
//   - cada recurso en su archivo, con un hash en el nombre (se puede cachear);
//   - las capturas achicadas a 960 px de ancho y en WebP;
//   - el componente del iPhone ya traducido a JS (sin Babel);
//   - React y el motor servidos desde el mismo sitio (sin unpkg ni Google Fonts);
//   - título, descripción, vista previa para redes e íconos;
//   - unos pocos parches de contenido (abajo, en PATCHES), anclados: si el
//     export cambia y un ancla no aparece exactamente una vez, el build falla.
//
// Para actualizar la landing: exportá de nuevo desde Claude Design, reemplazá
// landing/247WC_Landing.html y corré «npm run landing». Después, commit y push:
// Vercel publica site/ solo.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'landing', '247WC_Landing.html');
const SITE = path.join(ROOT, 'site');
const ASSETS = path.join(SITE, 'assets');
const SITE_URL = 'https://ios247.vercel.app';

// El link del App Store. Vacío, los botones «Descargar» bajan a la sección
// final. Cuando Apple apruebe la app: App Store Connect → App Information →
// Apple ID (un número) y poné acá https://apps.apple.com/app/id<ese número>.
const APP_STORE_ID = '';
const APP_STORE_URL = APP_STORE_ID ? `https://apps.apple.com/app/id${APP_STORE_ID}` : '';
// Mientras no hay Apple ID (la app todavía no está publicada), los botones y
// el texto dicen «Muy pronto» en vez de «Descargala» / «Gratis en el App Store».
const PRELAUNCH = !APP_STORE_ID;

const SHOT_WIDTH = 960;     // las capturas se ven a ~320 px de ancho: 3x
const SHOT_QUALITY = 80;

class BuildError extends Error {}

/* ------------------------------------------------------------ el export */

function readBundle(html) {
  const grab = (type) => {
    const m = new RegExp(`<script type="__bundler/${type}">\\s*([\\s\\S]*?)\\s*</script>`).exec(html);
    if (!m) throw new BuildError(`El export no tiene el bloque __bundler/${type}. ¿Es un export de Claude Design?`);
    return JSON.parse(m[1]);
  };
  return { manifest: grab('manifest'), template: grab('template'), ext: grab('ext_resources') };
}

const sha = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 8);
const CDN = {
  react: 'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  reactDom: 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  babel: 'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js',
};

/* --------------------------------------------------- parches de contenido */

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exact = (s) => new RegExp(esc(s), 'g');

const PATCHES = [
  {
    // Sin ubicación la app busca en la zona que muestra el mapa, que en una
    // instalación nueva es Buenos Aires y no deja alejarse mucho: «mové el
    // mapa a cualquier zona» no es cierto (lo mismo se corrigió en la ficha y
    // en las notas para App Review).
    name: 'sin ubicación (es): sin «cualquier zona»',
    anchor: exact("{ t: 'Sin ubicación', d: 'Mové el mapa a cualquier zona y buscá ahí.' },"),
    replace: () => "{ t: 'Sin ubicación', d: 'Buscá en la zona que se ve en el mapa.' },",
  },
  {
    name: 'sin ubicación (en): sin «any area»',
    anchor: exact("{ t: 'No location', d: 'Move the map to any area and search there.' },"),
    replace: () => "{ t: 'No location', d: 'Search the area shown on the map.' },",
  },
  {
    // Sin un servicio que guarde los emails (formAction vacío), el formulario
    // de Android decía «Listo» sin mandar nada. Ahora abre un mail ya escrito
    // para que la persona lo envíe: no se pierde ningún email en silencio.
    name: 'aviso de Android: un mail de verdad',
    anchor: exact("    if (!url) { this.setState({ emailDone: true }); return; }"),
    replace: () => [
      '    if (!url) {',
      "      const en = this.lang === 'en';",
      "      const subject = en ? '247WC for Android: let me know' : '247WC para Android: avisame';",
      "      const body = (en ? 'Let me know when 247WC is out on Android. My email: ' : 'Avisame cuando salga 247WC para Android. Mi email: ') + this.state.email;",
      "      window.location.href = 'mailto:lautarolacazeok@gmail.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);",
      '      this.setState({ emailDone: true });',
      '      return;',
      '    }',
    ].join('\n'),
  },
  {
    name: 'aviso de Android (es): el mail hay que mandarlo',
    anchor: exact("thanks: 'Listo. Te escribimos el día que salga.',"),
    replace: () => "thanks: 'Te abrimos un mail para que lo mandes. ¿No se abrió? Escribinos a lautarolacazeok@gmail.com.',",
  },
  {
    name: 'aviso de Android (en): the email has to be sent',
    anchor: exact("thanks: 'Done. We’ll write to you the day it ships.',"),
    replace: () => "thanks: 'We opened an email for you to send. Didn’t open? Write to lautarolacazeok@gmail.com.',",
  },
  {
    // El idioma y el título de la pestaña siguen al botón ES / EN (lectores
    // de pantalla, traductores y la pestaña del navegador).
    name: 'idioma y título del documento',
    anchor: exact('    const lang = this.lang, t = T[lang], motion = this.motion, st = this.state, step = st.step, shots = SHOTS[lang];'),
    replace: (m) => `${m}\n    try { document.documentElement.lang = lang; document.title = TITLES[lang]; } catch (e) {}`,
  },
  {
    name: 'títulos por idioma',
    anchor: exact('const FK = '),
    replace: (m) => `const TITLES = { es: ${JSON.stringify(TEXT.es.title)}, en: ${JSON.stringify(TEXT.en.title)} };\n${m}`,
  },
  {
    // Las imágenes de la plantilla tienen la ruta como «{{ shotMap }}» hasta
    // que el motor la completa, y el navegador igual intentaba bajarlas
    // (tres 404). Con sc-camel-src el motor pone el src y el navegador no
    // pide nada antes de tiempo.
    name: 'imágenes de la plantilla sin pedidos de más',
    anchor: /<img src="(\{\{[^"]+\}\})"/g,
    count: 3,
    replace: (_m, v) => `<img sc-camel-src="${v}"`,
  },
  {
    // Las fuentes van en el sitio: sin conexiones a Google.
    name: 'sin preconnect a Google Fonts',
    anchor: /^[ \t]*<link rel="preconnect" href="https:\/\/fonts\.(?:googleapis|gstatic)\.com"[^>]*>\r?\n/gm,
    count: 2,
    replace: () => '',
  },
  {
    // El mensaje del aviso de Android es más largo: alto mínimo en vez de fijo,
    // y que el lector de pantalla lo anuncie.
    name: 'aviso de Android: confirmación anunciada, sin alto fijo',
    anchor: exact('<div style="margin-top:16px;display:flex;align-items:center;gap:12px;height:50px;animation:wcIn .4s ease both">'),
    replace: () => '<div role="status" style="margin-top:16px;display:flex;align-items:center;gap:12px;min-height:50px;animation:wcIn .4s ease both">',
  },
  {
    name: 'aviso de Android: el campo entra en 320 px',
    anchor: exact('min-width:200px;height:50px'),
    replace: () => 'min-width:min(200px,100%);height:50px',
  },
  {
    // Las pautas de marketing de Apple no dejan usar su logo en botones
    // propios que imitan el badge «Descargalo en el App Store». Sin el logo
    // (cuando la app esté publicada, se puede poner el badge oficial).
    name: 'botones del App Store sin el logo de Apple',
    anchor: /<svg width="(?:16|24)" height="(?:16|24)" sc-camel-view-box="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12\.152 6\.896c[^"]*"><\/path><\/svg>\s*/g,
    count: 4,
    replace: () => '',
  },
  {
    name: 'botones grandes del App Store: relleno parejo sin el logo',
    anchor: /(<a href="\{\{ storeHref \}\}" style="display:inline-flex;align-items:center;gap:11px;height:58px;padding:)0 24px 0 18px/g,
    count: 3,
    replace: (_m, a) => `${a}0 26px`,
  },
  {
    name: 'botón del encabezado: relleno parejo sin el logo',
    anchor: exact('height:40px;padding:0 16px 0 14px'),
    replace: () => 'height:40px;padding:0 16px',
  },
  ...(PRELAUNCH ? [
    { name: 'antes de publicar (es): botón', anchor: exact("storeSmall: 'Descargala en el', storeBig: 'App Store',"), replace: () => "storeSmall: 'Muy pronto en el', storeBig: 'App Store'," },
    { name: 'antes de publicar (en): botón', anchor: exact("storeSmall: 'Download on the', storeBig: 'App Store',"), replace: () => "storeSmall: 'Coming soon to the', storeBig: 'App Store'," },
    { name: 'antes de publicar (es): encabezado', anchor: exact("navCta: 'Descargar'"), replace: () => "navCta: 'Muy pronto'" },
    { name: 'antes de publicar (en): encabezado', anchor: exact("navCta: 'Download'"), replace: () => "navCta: 'Coming soon'" },
    { name: 'antes de publicar (es): cierre', anchor: exact("ctaSub: 'Gratis en el App Store."), replace: () => "ctaSub: 'Muy pronto, gratis en el App Store." },
    { name: 'antes de publicar (en): cierre', anchor: exact("ctaSub: 'Free on the App Store."), replace: () => "ctaSub: 'Coming soon, free on the App Store." },
  ] : []),
  {
    // El acceso rápido abre la app (la página de soporte lo dice bien).
    name: 'acceso rápido (es): abre la app',
    anchor: exact("shortText: 'Sin abrir la app: desde la pantalla de inicio, «Baño más cercano»"),
    replace: () => "shortText: 'Directo desde la pantalla de inicio: «Baño más cercano» abre la app,",
  },
  {
    name: 'acceso rápido (en): opens the app',
    anchor: exact("shortText: 'Without opening the app: from your home screen, “Nearest toilet”"),
    replace: () => "shortText: 'Straight from your Home Screen: “Nearest toilet” opens the app,",
  },
  {
    // La posición exacta sí sale del teléfono: al servicio de ruta a pie (lo
    // dice la política de privacidad y la etiqueta del App Store).
    name: 'privacidad (es): la zona es para buscar',
    anchor: exact("{ big: '~250 m', title: 'Una zona, no un punto', text: 'A nuestro servidor llega solo un área redondeada. No guardamos tu ubicación.' },"),
    replace: () => "{ big: '~250 m', title: 'Para buscar, una zona', text: 'Para buscar, a nuestro servidor llega solo un área redondeada. Tu posición exacta va solo al servicio de ruta a pie. No guardamos tu ubicación.' },",
  },
  {
    name: 'privacidad (en): the area is for searching',
    anchor: exact("{ big: '~250 m', title: 'An area, not a point', text: 'Our server only receives a rounded area. We don’t store your location.' },"),
    replace: () => "{ big: '~250 m', title: 'To search, an area', text: 'To search, our server only gets a rounded area. Your exact position only goes to the walking-route service. We don’t store your location.' },",
  },
  {
    name: 'FAQ (es): «necesitan»',
    anchor: exact('las calles del mapa y la ruta a pie necesita internet.'),
    replace: () => 'las calles del mapa y la ruta a pie necesitan internet.',
  },
  {
    // Las capturas muestran el mapa de OpenFreeMap (OpenMapTiles), que pide
    // el crédito donde se ve el mapa.
    name: 'créditos del mapa (es)',
    anchor: exact("footOsm: 'Datos del mapa © colaboradores de OpenStreetMap',"),
    replace: () => "footOsm: 'Datos del mapa © colaboradores de OpenStreetMap · OpenFreeMap © OpenMapTiles',",
  },
  {
    name: 'créditos del mapa (en)',
    anchor: exact("footOsm: 'Map data © OpenStreetMap contributors',"),
    replace: () => "footOsm: 'Map data © OpenStreetMap contributors · OpenFreeMap © OpenMapTiles',",
  },
  {
    // Privacidad y soporte: en este mismo sitio y en el idioma elegido (las
    // páginas tienen la versión en inglés en #en).
    name: 'pie: privacidad en el idioma elegido',
    anchor: exact('<a href="https://ios247.vercel.app/privacy.html" target="_blank"'),
    replace: () => '<a href="{{ privacyHref }}" target="_blank"',
  },
  {
    name: 'pie: soporte en el idioma elegido',
    anchor: exact('<a href="https://ios247.vercel.app/support.html" target="_blank"'),
    replace: () => '<a href="{{ supportHref }}" target="_blank"',
  },
  {
    name: 'pie: rutas de privacidad y soporte',
    anchor: exact("storeHref: this.props.appStoreUrl || '#download',"),
    replace: (m) => `${m}\n      privacyHref: 'privacy.html' + (lang === 'en' ? '#en' : ''), supportHref: 'support.html' + (lang === 'en' ? '#en' : ''),`,
  },
  {
    // La primera visita sale en el idioma del navegador (como la app con el
    // del iPhone); el botón ES / EN y lo guardado mandan.
    name: 'idioma inicial según el navegador',
    anchor: exact("langOverride: saved === 'es' || saved === 'en' ? saved : null,"),
    replace: () => "langOverride: saved === 'es' || saved === 'en' ? saved : (/^es\\b/i.test((navigator.languages && navigator.languages[0]) || navigator.language || 'es') ? null : 'en'),",
  },
  {
    // Con «reducir movimiento» los pasos no avanzan solos: que se lean todos.
    name: 'pasos legibles sin animación',
    anchor: exact('opacity: on ? 1 : .5,'),
    replace: () => 'opacity: on || !motion ? 1 : .5,',
  },
  {
    // En el celu el encabezado fijo tapaba el título de cada sección al tocar
    // el menú o al volver con Mayús + Tab: el scroll deja su alto libre.
    name: 'anclas y foco debajo del encabezado fijo',
    anchor: exact("    document.addEventListener('pointerdown', this._onDoc);"),
    replace: (m) => `${m}\n    const hdr = this.rootRef.current && this.rootRef.current.querySelector('header');\n    if (hdr && 'ResizeObserver' in window) { this._ro = new ResizeObserver(() => { document.documentElement.style.scrollPaddingTop = hdr.offsetHeight + 'px'; }); this._ro.observe(hdr); }`,
  },
  {
    name: 'anclas: desconectar el observer',
    anchor: exact("    document.removeEventListener('pointerdown', this._onDoc);"),
    replace: (m) => `${m}\n    if (this._ro) this._ro.disconnect();`,
  },
  {
    // El ícono de la demo se anuncia como botón: que ande con teclado.
    name: 'ícono de la demo: teclado (atributos)',
    anchor: exact('sc-camel-on-context-menu="{{ onIconContext }}"'),
    replace: (m) => `${m} sc-camel-on-key-down="{{ onIconKey }}" aria-expanded="{{ menuExpanded }}"`,
  },
  {
    name: 'ícono de la demo: teclado (Enter, espacio, Escape)',
    anchor: exact('  onIconContext = e => e.preventDefault();'),
    replace: (m) => `${m}\n  onIconKey = e => {\n    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.setState(s => ({ pressing: false, menuOpen: !s.menuOpen })); }\n    else if (e.key === 'Escape') this.setState({ menuOpen: false });\n  };`,
  },
  {
    name: 'ícono de la demo: teclado (valores)',
    anchor: exact('onIconDown: this.onIconDown, onIconUp: this.onIconUp, onIconContext: this.onIconContext,'),
    replace: (m) => `${m} onIconKey: this.onIconKey, menuExpanded: String(st.menuOpen),`,
  },
  {
    // Estado de los botones para lectores de pantalla: idioma y filtros
    // (presionado) y preguntas (abierta), y las respuestas cerradas no se leen.
    name: 'idioma: aria-pressed',
    anchor: exact('<button type="button" sc-camel-on-click="{{ l.select }}"'),
    replace: (m) => `${m} aria-pressed="{{ l.pressed }}"`,
  },
  {
    name: 'idioma: valor de aria-pressed',
    anchor: exact('label: l, select: () => this.setLang(c),'),
    replace: (m) => `${m} pressed: String(lang === c),`,
  },
  {
    name: 'filtros: aria-pressed',
    anchor: exact('<button type="button" sc-camel-on-click="{{ c.toggle }}"'),
    replace: (m) => `${m} aria-pressed="{{ c.pressed }}"`,
  },
  {
    name: 'filtros: valor de aria-pressed',
    anchor: exact("bg: on ? '#0a6cff' : '#fff', color: on ? '#fff' : '#6d7789',"),
    replace: (m) => `pressed: String(on), ${m}`,
  },
  {
    name: 'preguntas: aria-expanded',
    anchor: exact('<button type="button" sc-camel-on-click="{{ q.toggle }}"'),
    replace: (m) => `${m} aria-expanded="{{ q.expanded }}"`,
  },
  {
    name: 'preguntas: respuesta cerrada oculta para lectores',
    anchor: exact('<div style="display:grid;grid-template-rows:{{ q.rows }};'),
    replace: () => '<div aria-hidden="{{ q.hidden }}" style="display:grid;grid-template-rows:{{ q.rows }};',
  },
  {
    name: 'preguntas: valores de aria',
    anchor: exact("num: '0' + (i + 1), q: f.q, a: f.a,"),
    replace: (m) => `${m} expanded: String(on), hidden: String(!on),`,
  },
  {
    // Las etiquetas flotantes del iPhone del encabezado van a distancia fija
    // del centro: en pantallas chicas quedaban cortadas en el borde.
    name: 'etiquetas flotantes: marca',
    anchor: exact("const chip = (i, pos, bg, color, icon, text) => el('div', { key: i, ref: this.chipRefs[i], style:"),
    replace: () => "const chip = (i, pos, bg, color, icon, text) => el('div', { key: i, ref: this.chipRefs[i], 'data-chip': '', style:",
  },
  {
    name: 'etiqueta «Accesible» dentro del escenario',
    anchor: exact("{ right: 'calc(50% - 350px)', top: 480 }"),
    replace: () => "{ right: 'calc(50% - 350px)', top: 'min(480px, calc(100% - 64px))' }",
  },
  {
    name: 'iPhone del encabezado: marca',
    anchor: exact('<div style="position:absolute;left:50%;top:44px;transform:translateX(-50%)">'),
    replace: () => '<div data-hero-phone="" style="position:absolute;left:50%;top:44px;transform:translateX(-50%)">',
  },
  {
    // CSS para teléfonos y «reducir movimiento», al final del <style> de la
    // plantilla (el ancla es su última animación).
    name: 'CSS: encabezado en teléfonos, etiquetas, iPhone y movimiento',
    anchor: exact('@keyframes wcPulse{0%,100%{box-shadow:0 0 0 0 rgba(10,160,110,.45)}70%{box-shadow:0 0 0 7px rgba(10,160,110,0)}}'),
    replace: (m) => m + `
/* Encabezado en teléfonos: logo y botones arriba, los enlaces en una fila */
@media (max-width:759px){
header>div{row-gap:4px !important;padding-top:8px !important;padding-bottom:4px !important}
header nav{order:3;flex:1 0 100% !important;flex-wrap:nowrap !important;justify-content:flex-start !important;overflow-x:auto;scrollbar-width:none;margin:0 -12px}
header nav::-webkit-scrollbar{display:none}
header nav a{flex:none;white-space:nowrap}
header>div>div:last-child{margin-left:auto}
[data-chip]{display:none !important}
}
@media (max-width:400px){header>div{padding-left:16px !important;padding-right:16px !important}}
@media (max-width:379px){
header nav{margin:0 -7px}
header nav a{padding:8px 7px !important;font-size:14px !important}
header>div>div:last-child>a{display:none !important}
}
@media (max-width:360px){[data-hero-phone]{transform:translateX(-50%) scale(.88) !important;transform-origin:50% 0}}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}[style*="wcPulse"]{animation:none !important}}`,
  },
];

const TEXT = {
  es: {
    title: '247WC · El baño más cercano, a un toque',
    description: 'Escaneá 3 km a la redonda, elegí el mejor baño público y seguí la flecha hasta la puerta. Gratis, sin cuenta y sin publicidad. Para iPhone.',
  },
  en: {
    title: '247WC · The closest toilet, one tap away',
  },
};

function applyPatches(template) {
  let out = template;
  for (const p of PATCHES) {
    const n = (out.match(p.anchor) || []).length;
    const want = p.count ?? 1;
    if (n !== want) throw new BuildError(`Parche «${p.name}»: el ancla aparece ${n} veces (esperaba ${want}). ¿Cambió el export?`);
    out = out.replace(p.anchor, (...a) => p.replace(...a));
    console.log(`  ✓ ${p.name}`);
  }
  return out;
}

/* ------------------------------------------------------------- el build */

async function main() {
  if (!existsSync(SRC)) throw new BuildError(`Falta ${path.relative(ROOT, SRC)}.`);
  const html = await readFile(SRC, 'utf8');
  const { manifest, template: rawTemplate, ext } = readBundle(html);
  const idOf = new Map(ext.map((e) => [e.uuid, e.id]));

  await rm(ASSETS, { recursive: true, force: true });
  for (const d of ['fonts', 'img', 'js']) await mkdir(path.join(ASSETS, d), { recursive: true });
  const tmp = await mkdirTemp();

  const urlOf = new Map();       // uuid → ruta pública
  const resources = {};          // window.__resources: id o URL de CDN → ruta
  let babelSrc = null;
  let jsx = null;
  let touchIcon = null;

  for (const [uuid, entry] of Object.entries(manifest)) {
    let bytes = Buffer.from(entry.data, 'base64');
    if (entry.compressed) bytes = gunzipSync(bytes);
    const id = idOf.get(uuid) || '';
    const put = async (dir, name, buf) => {
      await writeFile(path.join(ASSETS, dir, name), buf);
      return `assets/${dir}/${name}`;
    };

    if (id === CDN.babel) { babelSrc = bytes.toString('utf8'); continue; }   // solo para traducir el .jsx acá
    if (id === CDN.react) { resources[id] = await put('js', `react.${sha(bytes)}.js`, bytes); continue; }
    if (id === CDN.reactDom) { resources[id] = await put('js', `react-dom.${sha(bytes)}.js`, bytes); continue; }

    if (entry.mime === 'text/jsx') { jsx = { uuid, src: bytes.toString('utf8') }; continue; }
    if (entry.mime === 'text/javascript') {
      // El motor de componentes de Claude Design (el único JS que no es CDN).
      if (!bytes.toString('utf8', 0, 200).includes('dc-runtime')) throw new BuildError(`JS desconocido en el export: ${uuid} (${id || 'sin id'}).`);
      urlOf.set(uuid, await put('js', `dc-runtime.${sha(bytes)}.js`, bytes));
      continue;
    }
    if (/^font\//.test(entry.mime)) { urlOf.set(uuid, await put('fonts', `${sha(bytes)}.woff2`, bytes)); continue; }
    if (entry.mime === 'image/svg+xml') { urlOf.set(uuid, await put('img', `logo.${sha(bytes)}.svg`, bytes)); continue; }
    if (entry.mime === 'image/png') {
      const src = path.join(tmp, `${uuid}.png`);
      await writeFile(src, bytes);
      const isShot = Boolean(id);   // las capturas son los ext_resources (esMap, enGuide…)
      // El ícono de la app (sin id) se ve a 112 px: 360 px y sin pérdida.
      const width = isShot ? SHOT_WIDTH : 360;
      const out = path.join(tmp, `${uuid}.webp`);
      execFileSync('convert', [src, '-resize', `${width}x>`, '-strip', ...(isShot ? ['-quality', String(SHOT_QUALITY)] : ['-define', 'webp:lossless=true']), out]);
      const webp = await readFile(out);
      const name = isShot ? `${id}.${sha(webp)}.webp` : `icon.${sha(webp)}.webp`;
      const pub = await put('img', name, webp);
      if (isShot) resources[id] = pub; else urlOf.set(uuid, pub);
      if (!isShot) {
        // El ícono para «Agregar a inicio» en el iPhone tiene que ser PNG (y
        // Safari también lo busca en /apple-touch-icon.png).
        const touchSrc = path.join(tmp, 'touch.png');
        execFileSync('convert', [src, '-resize', '180x180', '-strip', touchSrc]);
        const touch = await readFile(touchSrc);
        touchIcon = await put('img', `apple-touch-icon.${sha(touch)}.png`, touch);
        await writeFile(path.join(SITE, 'apple-touch-icon.png'), touch);
      }
      continue;
    }
    throw new BuildError(`Recurso de tipo desconocido en el export: ${entry.mime} (${uuid}).`);
  }

  // El componente del iPhone (.jsx), traducido acá con el mismo Babel y las
  // mismas opciones que usaba el motor en el navegador.
  if (!jsx) throw new BuildError('El export no trae el componente del iPhone (.jsx).');
  if (!babelSrc) throw new BuildError('El export no trae Babel para traducir el .jsx.');
  const req = createRequire(import.meta.url);
  const babelFile = path.join(tmp, 'babel.cjs');
  await writeFile(babelFile, babelSrc);
  const Babel = req(babelFile);
  const code = Babel.transform(jsx.src, { filename: 'ios-frame.jsx', presets: ['react', 'typescript'] }).code;
  const frameBuf = Buffer.from(code);
  const framePath = `assets/js/ios-frame.${sha(frameBuf)}.js`;
  await writeFile(path.join(SITE, framePath), frameBuf);

  // La plantilla: rutas, parches y la cabecera.
  let t = rawTemplate;
  const jsxRef = new RegExp(`${jsx.uuid}#/ios-frame\\.jsx`, 'g');
  if (!jsxRef.test(t)) throw new BuildError('La plantilla no importa ios-frame.jsx como se esperaba.');
  t = t.replace(jsxRef, framePath);
  for (const [uuid, url] of urlOf) t = t.split(uuid).join(url);
  t = applyPatches(t);
  t = setDefaultProp(t, 'appStoreUrl', APP_STORE_URL);
  t = injectHead(t, { resources, icon: [...urlOf.values()].find((u) => /icon\./.test(u)), touchIcon });

  // Nada debería quedar apuntando afuera ni a un recurso del export.
  const leftovers = [...new Set(t.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || [])];
  if (leftovers.length) throw new BuildError(`Quedaron referencias sin resolver: ${leftovers.join(', ')}`);
  // (Las URLs de unpkg sí aparecen como claves de window.__resources: son el
  // nombre con el que el motor pide React, y el valor es la copia local.)
  const outside = t.replace(/<script>window\.__resources = [^<]*<\/script>/, '');
  for (const host of ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
    if (outside.includes(host)) throw new BuildError(`La página todavía apunta a ${host}.`);
  }
  for (const ref of t.match(/(?:src|href)="(assets\/[^"]+)"/g) || []) {
    const p = ref.replace(/^(?:src|href)="|"$/g, '');
    if (!existsSync(path.join(SITE, p))) throw new BuildError(`Falta ${p}`);
  }

  await writeFile(path.join(SITE, 'index.html'), t);
  await rm(tmp, { recursive: true, force: true });
  console.log(`\n✓ site/index.html (${(t.length / 1024).toFixed(0)} KB) y site/assets/`);
  await makeOgImage();
}

// La vista previa al compartir el link (og:image, 1200 × 630): la parte de
// arriba de la landing ya armada, sin animaciones, vista como en una pantalla
// de 1920 px (achicada a 1200) para que entren el título y el iPhone.
async function makeOgImage() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch {
    console.warn('  (sin Playwright: no se rehízo site/og.png)');
    return;
  }
  const { createServer } = await import('node:http');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    try {
      const b = await readFile(path.join(SITE, path.normalize(p)));
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      res.end(b);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1008 }, deviceScaleFactor: 0.625, reducedMotion: 'reduce', locale: 'es-AR' });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent?.length > 5, null, { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete), null, { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SITE, 'og.png') });
    console.log('✓ site/og.png (1200 × 630)');
  } finally {
    await browser.close();
    server.close();
  }
}

function setDefaultProp(t, name, value) {
  if (!value) return t;
  const m = /data-props="([^"]*)"/.exec(t);
  if (!m) throw new BuildError('La plantilla no tiene data-props.');
  const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const props = JSON.parse(unesc(m[1]));
  if (!props[name]) throw new BuildError(`La plantilla no tiene la propiedad ${name}.`);
  props[name].default = value;
  const back = JSON.stringify(props).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return t.replace(m[0], `data-props="${back}"`);
}

function injectHead(t, { resources, icon, touchIcon }) {
  const es = TEXT.es;
  const head = [
    `<title>${es.title}</title>`,
    `<meta name="description" content="${es.description}">`,
    '<meta name="theme-color" content="#0a6cff">',
    `<link rel="canonical" href="${SITE_URL}/">`,
    icon ? `<link rel="icon" type="image/webp" href="${icon}">` : '',
    touchIcon ? `<link rel="apple-touch-icon" sizes="180x180" href="${touchIcon}">` : '',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="247WC">',
    `<meta property="og:url" content="${SITE_URL}/">`,
    `<meta property="og:title" content="${es.title}">`,
    `<meta property="og:description" content="${es.description}">`,
    `<meta property="og:image" content="${SITE_URL}/og.png">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:locale" content="es_AR">',
    '<meta property="og:locale:alternate" content="en_US">',
    '<meta name="twitter:card" content="summary_large_image">',
    APP_STORE_ID ? `<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}">` : '',
    // Sin JavaScript no se ve la plantilla cruda con sus «{{ … }}».
    '<noscript><style>x-dc{display:none!important}</style></noscript>',
    // React y React DOM desde el sitio (el motor los busca acá antes que en
    // unpkg). Se precargan: el navegador no los ve hasta que corre el motor.
    `<link rel="preload" href="${resources[CDN.react]}" as="script">`,
    `<link rel="preload" href="${resources[CDN.reactDom]}" as="script">`,
    `<script>window.__resources = ${JSON.stringify(resources)};</script>`,
  ].filter(Boolean).join('\n');
  const vp = '<meta name="viewport" content="width=device-width, initial-scale=1">';
  const i = t.indexOf(vp);
  if (i < 0 || t.indexOf('<html>') < 0) throw new BuildError('La cabecera de la plantilla no es la esperada.');
  t = t.replace('<html>', '<html lang="es">');
  const j = t.indexOf(vp) + vp.length;
  t = `${t.slice(0, j)}\n${head}${t.slice(j)}`;
  const noscript = [
    '<noscript><p style="font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:560px;margin:48px auto;padding:0 24px">',
    '247WC: el baño público más cercano, a un toque. Para iPhone. ',
    '<a href="support.html">Soporte</a> · <a href="privacy.html">Privacidad</a></p></noscript>',
  ].join('');
  if (!t.includes('<body>')) throw new BuildError('La plantilla no tiene <body>.');
  return t.replace('<body>', `<body>\n${noscript}`);
}

async function mkdirTemp() {
  const d = path.join(os.tmpdir(), `landing-${process.pid}`);
  await mkdir(d, { recursive: true });
  return d;
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof BuildError ? err.message : err?.stack || err}\n`);
  process.exit(1);
});
