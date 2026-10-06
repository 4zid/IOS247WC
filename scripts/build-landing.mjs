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
    replace: () => "thanks: 'Se abrió un mail: mandalo y te avisamos el día que salga.',",
  },
  {
    name: 'aviso de Android (en): the email has to be sent',
    anchor: exact("thanks: 'Done. We’ll write to you the day it ships.',"),
    replace: () => "thanks: 'We opened an email: send it and we’ll let you know the day it ships.',",
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
      const width = isShot ? SHOT_WIDTH : 240;
      const out = path.join(tmp, `${uuid}.webp`);
      execFileSync('convert', [src, '-resize', `${width}x>`, '-strip', '-quality', String(SHOT_QUALITY), out]);
      const webp = await readFile(out);
      const name = isShot ? `${id}.${sha(webp)}.webp` : `icon.${sha(webp)}.webp`;
      const pub = await put('img', name, webp);
      if (isShot) resources[id] = pub; else urlOf.set(uuid, pub);
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
  t = injectHead(t, { resources, icon: [...urlOf.values()].find((u) => /icon\./.test(u)) });

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
    const page = await browser.newPage({ viewport: { width: 1920, height: 1008 }, deviceScaleFactor: 0.625, reducedMotion: 'reduce' });
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

function injectHead(t, { resources, icon }) {
  const es = TEXT.es;
  const head = [
    `<title>${es.title}</title>`,
    `<meta name="description" content="${es.description}">`,
    '<meta name="theme-color" content="#0a6cff">',
    `<link rel="canonical" href="${SITE_URL}/">`,
    icon ? `<link rel="icon" type="image/webp" href="${icon}">` : '',
    icon ? `<link rel="apple-touch-icon" href="${icon}">` : '',
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
    // React y React DOM desde el sitio (el motor los busca acá antes que en unpkg).
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
