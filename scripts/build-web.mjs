#!/usr/bin/env node
/* 247WC iOS — arma www/ a partir de web/ (copia intacta de 4zid/247wc) y native/.

   La web no se toca a mano: acá se copia, se le inyecta la capa nativa y se
   le aplican unos pocos parches chicos (ver docs/NATIVE-API.md, «Parches del
   build»). Cada parche busca un ancla que tiene que aparecer EXACTAMENTE una
   vez: si no está o está repetida, el build falla en vez de generar una app
   que en el teléfono se rompe en silencio. Eso pasa cuando cambia el upstream:
   hay que mirar el cambio y ajustar el ancla acá.

   Uso: node scripts/build-web.mjs   (o npm run build)
   Sin dependencias: solo Node ≥ 20. */

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const NATIVE = path.join(ROOT, 'native');
const WWW = path.join(ROOT, 'www');
const CAPACITOR_JS = path.join(ROOT, 'node_modules/@capacitor/core/dist/capacitor.js');

// Lo que va a www/ desde web/. Ni sw.js, ni el manifest, ni la landing, ni api/:
// dentro de la app no hay PWA ni servidor propio.
export const WEB_FILES = [
  'index.html',
  'app.js',
  'lang.js',
  'styles.css',
  'favicon.svg',
  'brand/logo/*.svg',
  'vendor/**',
  'fonts/inter.woff2',
];

// Archivos propios de la capa nativa (más capacitor.js, que sale de node_modules).
const NATIVE_FILES = ['native.css', 'text.js', 'bridge.js', 'gestures.js', 'guide.js'];

export class BuildError extends Error {}

/* ------------------------------------------------------------- parches */

// El bloque que carga la capa nativa: scripts clásicos, en este orden, para
// que corran antes que app.js (módulo, que se ejecuta al final del parseo).
const NATIVE_BLOCK = [
  '<!-- Capa nativa de la app iOS (la agrega scripts/build-web.mjs) -->',
  '<link rel="stylesheet" href="native/native.css" />',
  '<script src="native/capacitor.js"></script>',
  '<script src="native/text.js"></script>',
  '<script src="native/bridge.js"></script>',
  '<script src="native/gestures.js"></script>',
  '<script src="native/guide.js"></script>',
].join('\n');

// Inter va empaquetada: en la app no dependemos de Google Fonts (ni de red
// para la tipografía).
const LOCAL_FONT = [
  '<style>',
  "@font-face { font-family: 'Inter'; src: url('fonts/inter.woff2') format('woff2'); font-weight: 100 900; font-style: normal; font-display: swap; }",
  '</style>',
].join('\n');

// «Mi ubicación»: en vez de la flecha de navegación, un anillo con un punto
// azul adentro (como tu punto en el mapa). El ancla es el botón entero, porque
// la flecha también la usa el botón azul.
const LOCATE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="7.6"/>' +
  '<circle cx="12" cy="12" r="3.9" style="fill: var(--blue); stroke: none"/></svg>';

// Al tocarlo, en la web: tu punto solo, a zoom 17. En la app: vos en el centro
// y alrededor los baños más cercanos, para ver si hay uno a mano.
const LOCATE_HANDLER_OLD = [
  "$('#btn-locate').addEventListener('click', () => {",
  '  state.userMoved = false;',
  '  if (state.me) setView(map, state.me.lat, state.me.lng, 17);',
  '  else quickScan();',
  '});',
].join('\n');
const LOCATE_HANDLER_NEW = [
  '// App iOS: «Mi ubicación» te deja en el centro de lo que se ve del mapa (entre',
  '// el borde de arriba y la hoja) y encuadra alrededor los baños más cercanos',
  '// (hasta 3, a menos de 1 km). Si no hay ninguno, igual ves unos 600 m a tu',
  '// alrededor, para ubicarte en el barrio.',
  'function locateMe() {',
  '  const me = state.me;',
  '  const near = visiblePlaces()',
  '    .map((p) => ({ p, d: distance(me, p) }))',
  '    .filter((x) => x.d <= 1000)',
  '    .sort((a, b) => a.d - b.d)',
  '    .slice(0, 3);',
  '  const pts = [[me.lat, me.lng]];',
  '  if (near.length) {',
  '    // Cada baño y su reflejo respecto de vos: el encuadre queda centrado en tu punto.',
  '    for (const { p } of near) pts.push([p.lat, p.lng], [2 * me.lat - p.lat, 2 * me.lng - p.lng]);',
  '  } else {',
  '    const dLat = 600 / 111320;',
  '    const dLng = dLat / Math.cos((me.lat * Math.PI) / 180);',
  '    pts.push([me.lat + dLat, me.lng + dLng], [me.lat - dLat, me.lng - dLng]);',
  '  }',
  '  fitPoints(map, pts, { top: 130, bottom: PEEK() + 110, left: 60, right: 60, maxZoom: 16 });',
  '}',
  '',
  "$('#btn-locate').addEventListener('click', () => {",
  '  state.userMoved = false;',
  '  if (state.me) locateMe();',
  '  else quickScan();',
  '});',
].join('\n');

const LANG_LINE_OLD = 'const v = (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;';
const LANG_LINE_NEW = 'const v = globalThis.WC_NATIVE_TEXT?.[LANG]?.[key] ?? (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;';

// Una línea entera (con su sangría y su salto) que contiene el patrón.
const wholeLine = (inner) => new RegExp(`^[ \\t]*${inner}[ \\t]*\\r?\\n`, 'gm');

const PATCHES = {
  'index.html': [
    {
      name: 'capa nativa después de <meta name="viewport">',
      anchor: /<meta name="viewport"[^>]*>/g,
      replace: (m) => `${m}\n${NATIVE_BLOCK}`,
    },
    {
      name: 'Inter local en vez de Google Fonts',
      // Ocupa dos líneas: el [^>]* cruza el salto de línea.
      anchor: wholeLine('<link rel="stylesheet" href="https://fonts\\.googleapis\\.com/css2\\?family=Inter[^>]*>'),
      replace: () => `${LOCAL_FONT}\n`,
    },
    {
      name: 'sin preconnect a fonts.googleapis.com',
      anchor: wholeLine('<link rel="preconnect" href="https://fonts\\.googleapis\\.com"[^>]*>'),
      replace: () => '',
    },
    {
      name: 'sin preconnect a fonts.gstatic.com',
      anchor: wholeLine('<link rel="preconnect" href="https://fonts\\.gstatic\\.com"[^>]*>'),
      replace: () => '',
    },
    {
      name: 'sin <link rel="manifest"> (no hay PWA dentro de la app)',
      anchor: wholeLine('<link rel="manifest"[^>]*>'),
      replace: () => '',
    },
    {
      // icons/ no se copia: el ícono de la app lo pone Xcode.
      name: 'sin <link rel="icon"> a icons/',
      anchor: wholeLine('<link rel="icon" href="icons/[^"]*"[^>]*>'),
      replace: () => '',
    },
    {
      name: 'sin <link rel="apple-touch-icon">',
      anchor: wholeLine('<link rel="apple-touch-icon"[^>]*>'),
      replace: () => '',
    },
    {
      name: 'ícono de «Mi ubicación»: tu punto azul',
      anchor: /(<button id="btn-locate"[^>]*>\s*)<svg[^>]*>[\s\S]*?<\/svg>/g,
      replace: (_m, open) => `${open}${LOCATE_ICON}`,
    },
  ],
  'lang.js': [
    {
      name: 'textos nativos primero en t()',
      anchor: new RegExp(LANG_LINE_OLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      replace: () => LANG_LINE_NEW,
    },
  ],
  // Privacidad del respaldo directo a Overpass (cuando nuestra API no
  // responde): desde el teléfono sale el mismo punto redondeado (~250 m) que
  // le mandamos a la API, no la posición exacta, y no va al espejo de Mail.ru
  // (VK, Rusia). Así la política puede decir que la posición exacta solo va
  // al servicio de rutas.
  'app.js': [
    {
      name: 'respaldo a Overpass sin el espejo de Mail.ru',
      anchor: wholeLine("'https://maps\\.mail\\.ru/osm/tools/overpass/api/interpreter',"),
      replace: () => '',
    },
    {
      name: '«Mi ubicación» con los baños cercanos a la vista',
      anchor: new RegExp(LOCATE_HANDLER_OLD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      replace: () => LOCATE_HANDLER_NEW,
    },
    {
      name: 'respaldo a Overpass con el punto redondeado',
      anchor: /const query = overpassQuery\(center, radius\);/g,
      replace: () => 'const query = overpassQuery({ lat: snap(center.lat), lng: snap(center.lng) }, radius + 250);',
    },
    // Guía con el mapa (native/guide.js): la guía pasa a ser un panel abajo y
    // arriba se ve el mapa siguiéndote, con el recorrido que se acorta a
    // medida que caminás. guide.js necesita piezas internas de app.js (que es
    // un módulo): se las pasamos al final, y lo avisamos en cada vuelta de la
    // guía y cuando llega una ruta recalculada. El aviso va a window.WCGuide y
    // no a window.WC, porque index.html crea window.WC de nuevo después de los
    // scripts nativos.
    {
      name: 'guía con el mapa: piezas para native/guide.js',
      anchor: /^window\.WC\.ready = true;$/gm,
      replace: (m) => [
        '// App iOS: native/guide.js arma la guía con el mapa con estas piezas.',
        'window.WC.guideKit = { state, el, map, setRoute, fitPoints, distance, fmtDistance, fmtMinutes, t };',
        m,
      ].join('\n'),
    },
    {
      name: 'guía con el mapa: aviso en cada vuelta de la guía',
      anchor: /^( {2})maybeRecalculateRoute\(\);\n\}/gm,
      replace: (_m, ind) => `${ind}maybeRecalculateRoute();\n${ind}window.WCGuide?.tick();\n}`,
    },
    // app.js da por desviado al que está a más de 45 m de todos los vértices
    // del recorrido, pero en una cuadra larga (o una avenida recta) los
    // vértices quedan lejos: a mitad de cuadra, sobre el recorrido, ya estás a
    // más de 45 m de los dos y recalculaba cada 20 s sin motivo (y la
    // indicación volvía a «Caminá hacia…»). Ahora además tenés que estar a
    // más de 45 m de la línea misma.
    {
      name: 'guía con el mapa: desvío medido contra la línea del recorrido',
      anchor: /\.every\(\(c\) => distance\(state\.me, \{ lat: c\[0\], lng: c\[1\] \}\) > 45\);/g,
      replace: () => '.every((c) => distance(state.me, { lat: c[0], lng: c[1] }) > 45) &&\n    (window.WCGuide?.offRoute?.(state.me, state.route.coords, 45) ?? true);',
    },
    {
      name: 'guía con el mapa: aviso al recalcular la ruta',
      anchor: /^( {2})setRoute\(map, fresh\.coords, false\);$/gm,
      replace: (m, ind) => `${m}\n${ind}window.WCGuide?.tick();`,
    },
  ],
};

function applyPatch(file, src, { name, anchor }) {
  const hits = src.match(anchor)?.length ?? 0;
  if (hits !== 1) {
    throw new BuildError(
      `Parche «${name}» en ${file}: el ancla ${anchor} aparece ${hits} ${hits === 1 ? 'vez' : 'veces'} y tiene que aparecer exactamente una.\n` +
      '  Cambió la web de upstream (web/). Mirá qué cambió y ajustá el ancla en scripts/build-web.mjs;\n' +
      '  no edites web/ a mano: se pisa con «npm run web:update».',
    );
  }
}

/* ------------------------------------------------------------- copia */

// Expande los patrones simples de WEB_FILES ('dir/*.ext', 'dir/**', archivo).
export async function expandFiles(base, patterns) {
  const out = [];
  for (const pat of patterns) {
    if (pat.endsWith('/**')) {
      const dir = pat.slice(0, -3);
      out.push(...(await walk(path.join(base, dir))).map((f) => path.posix.join(dir, f)));
    } else if (pat.includes('*')) {
      const dir = path.posix.dirname(pat);
      const re = new RegExp('^' + path.posix.basename(pat).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
      const names = existsSync(path.join(base, dir)) ? await readdir(path.join(base, dir)) : [];
      const matched = names.filter((n) => re.test(n)).sort().map((n) => path.posix.join(dir, n));
      if (!matched.length) throw new BuildError(`No hay archivos para «${pat}» en ${path.relative(ROOT, base) || base}.`);
      out.push(...matched);
    } else {
      if (!existsSync(path.join(base, pat))) throw new BuildError(`Falta ${pat} en ${path.relative(ROOT, base) || base}.`);
      out.push(pat);
    }
  }
  return out;
}

async function walk(dir, prefix = '') {
  if (!existsSync(dir)) throw new BuildError(`Falta la carpeta ${path.relative(ROOT, dir)}.`);
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), rel)));
    else out.push(rel);
  }
  return out;
}

/* --------------------------------------------- verificación de index.html */

// Todo href/src local de www/index.html tiene que existir en www/: si el
// upstream suma un archivo nuevo y nadie lo agrega a WEB_FILES, mejor
// enterarse acá que con una pantalla rota en el teléfono.
function missingLocalRefs(html, files) {
  const have = new Set(files);
  const missing = [];
  for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"#]+)"/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue;   // externo (https:, data:…)
    const clean = ref.split('?')[0].replace(/^\.\//, '');
    if (clean && !have.has(clean)) missing.push(ref);
  }
  return missing;
}

/* ------------------------------------------------------------- build */

export async function build({ quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  if (!existsSync(CAPACITOR_JS)) {
    throw new BuildError('Falta node_modules/@capacitor/core/dist/capacitor.js. Corré «npm install» primero.');
  }

  const webFiles = await expandFiles(WEB, WEB_FILES);
  const nativeFiles = await expandFiles(NATIVE, NATIVE_FILES);

  // Primero los parches, en memoria: si alguno falla, www/ queda como estaba.
  const patched = {};
  const applied = [];
  for (const [file, patches] of Object.entries(PATCHES)) {
    let src = await readFile(path.join(WEB, file), 'utf8');
    for (const p of patches) {
      applyPatch(file, src, p);
      p.anchor.lastIndex = 0;
      src = src.replace(p.anchor, p.replace);
      applied.push(`${file}: ${p.name}`);
    }
    patched[file] = src;
  }

  const outFiles = [...webFiles, ...nativeFiles.map((f) => `native/${f}`), 'native/capacitor.js'];
  const missing = missingLocalRefs(patched['index.html'], outFiles);
  if (missing.length) {
    throw new BuildError(
      `www/index.html apunta a archivos locales que no se copian: ${missing.join(', ')}.\n` +
      '  Sumalos a WEB_FILES en scripts/build-web.mjs (y a la lista de scripts/update-web.mjs) o quitá la referencia con un parche.',
    );
  }

  await rm(WWW, { recursive: true, force: true });
  await mkdir(WWW, { recursive: true });
  for (const f of webFiles) {
    const dest = path.join(WWW, f);
    await mkdir(path.dirname(dest), { recursive: true });
    if (patched[f] != null) await writeFile(dest, patched[f]);
    else await cp(path.join(WEB, f), dest);
  }
  await mkdir(path.join(WWW, 'native'), { recursive: true });
  for (const f of nativeFiles) await cp(path.join(NATIVE, f), path.join(WWW, 'native', f));
  await cp(CAPACITOR_JS, path.join(WWW, 'native/capacitor.js'));

  let bytes = 0;
  for (const f of outFiles) bytes += (await stat(path.join(WWW, f))).size;

  let upstream = null;
  try { upstream = JSON.parse(await readFile(path.join(WEB, 'UPSTREAM.json'), 'utf8')); } catch { /* opcional */ }

  log(`www/ listo: ${outFiles.length} archivos, ${(bytes / 1024 / 1024).toFixed(2)} MB` +
    (upstream?.commit ? ` (web ${upstream.commit.slice(0, 7)})` : ''));
  for (const a of applied) log(`  ✓ ${a}`);
  return { files: outFiles, bytes, patches: applied, upstream };
}

/* ------------------------------------------------------------- CLI */

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().catch((err) => {
    console.error(`\n✗ Build fallido: ${err instanceof BuildError ? err.message : err?.stack || err}\n`);
    process.exit(1);
  });
}
