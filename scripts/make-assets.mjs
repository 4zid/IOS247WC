#!/usr/bin/env node
/* 247WC iOS — ícono de la app y pantalla de arranque, a partir de los SVG de
   marca (brand-src/).

   Genera dentro de ios/App/App/Assets.xcassets/:
     AppIcon.appiconset/AppIcon-1024.png         el ícono (Xcode solo pide 1024×1024)
     AppIcon.appiconset/AppIcon-1024-dark.png    variante oscura (iOS 18+)
     AppIcon.appiconset/AppIcon-1024-tinted.png  variante «tintada» (iOS 18+): grises sobre negro
     Splash.imageset/splash.png, splash-dark.png 2732×2732. Las usa LaunchScreen.storyboard
                                                 y el plugin SplashScreen muestra la misma
                                                 imagen después: el paso no se nota.
   con sus Contents.json, y una hoja de muestra para revisar a ojo en
   tests/.output/assets-contact.png.

   Chromium (Playwright) dibuja cada SVG al tamaño exacto en píxeles e
   ImageMagick lo aplana y le saca el canal alfa: App Store rechaza el ícono si
   el PNG tiene alfa, aunque sea todo opaco. Antes de tocar el catálogo se
   verifica cada PNG (tamaño, sin alfa, colores en puntos conocidos del
   dibujo) y después se borra toda imagen que no figure en los Contents.json.
   Si algo no da, falla en vez de dejar un ícono roto.

   Correrlo dos veces deja los mismos bytes: los PNG van sin fecha adentro.

   Uso: npm run assets
   Necesita Playwright con Chromium (npx playwright install chromium) e
   ImageMagick 6 o 7 (en la Mac: brew install imagemagick). */

import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = path.join(ROOT, 'brand-src');
const XCASSETS = path.join(ROOT, 'ios/App/App/Assets.xcassets');
const PREVIEW = path.join(ROOT, 'tests/.output/assets-contact.png');

// Colores de brand-src/*.svg. Con ellos se aplana y se verifica el dibujo: si
// la marca cambia de color, la verificación avisa y hay que cambiarlos acá.
const BLUE = '#0a6cff'; // fondo del ícono
const INK = '#0a0e17'; // fondo del ícono oscuro
const WHITE = '#ffffff'; // el símbolo
const DOT = '#9fd0ff'; // el punto del símbolo
const BLACK = '#000000';

// Fondos de la app (web/index.html, theme-color claro y oscuro): la pantalla
// de arranque usa los mismos para que la entrada a la web no pegue un salto.
const BG_LIGHT = '#ffffff';
const BG_DARK = '#0b0f19';

const ICON = 1024;
const SPLASH = 2732;
// Ancho del logo en la imagen de arranque. En iPhone el cuadrado se estira
// (aspect fill) hasta el alto de la pantalla: 450 px quedan en ~140 pt.
const SPLASH_LOGO = 450;
const LOGO_VIEWBOX = [148, 147]; // logo-stacked*.svg

// Puntos del símbolo para verificar el dibujo, en unidades del viewBox
// 100×100 del ícono (el símbolo va corrido 2 hacia arriba):
const TANK = [30, 26]; // adentro del rectángulo de arriba a la izquierda
const DOT_CENTER = [79, 82]; // centro del punto
const ICON_BG = [90, 30]; // fondo del ícono, lejos del símbolo

// Lo que App Store y Xcode necesitan ver en cada PNG.
const PNG_DEFINES = [
  // RGB de 8 bits siempre, también el tintado (que es todo gris): sin esto
  // ImageMagick puede elegir paleta o escala de grises.
  '-define', 'png:color-type=2',
  // Sin fecha ni metadatos: mismos bytes en cada corrida.
  '-define', 'png:exclude-chunks=date,time,tEXt,zTXt,iTXt,bKGD,cHRM,gAMA',
  '-define', 'png:compression-level=9',
];

export class AssetsError extends Error {}

/* ------------------------------------------------------------- SVG */

// Reemplaza un ancla que tiene que aparecer exactamente una vez, como los
// parches de build-web.mjs: si cambia un SVG de marca, fallamos acá y no con
// un ícono raro en el teléfono.
function replaceOnce(src, anchor, replacement, file) {
  const hits = src.split(anchor).length - 1;
  if (hits !== 1) {
    throw new AssetsError(
      `${file}: «${anchor}» aparece ${hits} ${hits === 1 ? 'vez' : 'veces'} y tiene que aparecer exactamente una.\n` +
      '  Cambió el SVG de marca: mirá qué cambió y ajustá scripts/make-assets.mjs.',
    );
  }
  return src.replace(anchor, () => replacement);
}

// iOS le pone sus propias esquinas al ícono: el PNG va cuadrado, a sangre.
const fullBleed = (svg, file) =>
  replaceOnce(svg, '<rect width="100" height="100" rx="23.5"', '<rect width="100" height="100"', file);

// El grupo del símbolo dentro del viewBox 100×100 (el mismo en icon.svg y en
// symbol-white.svg). No tiene grupos adentro: si algún día los tiene, el
// recorte de abajo no alcanza y preferimos enterarnos.
function glyphOf(svg, file) {
  const found = svg.match(/<g transform="translate\(0 -2\)">[\s\S]*?<\/g>/g) ?? [];
  if (found.length !== 1 || /<g[\s>]/.test(found[0].slice(2))) {
    throw new AssetsError(`${file}: no encuentro un único <g transform="translate(0 -2)"> simple con el símbolo.`);
  }
  return found[0];
}

// Forma sin colores, para comparar el símbolo de dos archivos.
const shapeOf = (g) => g.replace(/\s(?:fill|stroke)="#[0-9a-f]{3,8}"/gi, '');

// Gris con la luma Rec. 709 del color: lo mismo que «desaturar». En la
// variante tintada iOS usa el brillo como intensidad del tinte, así que el
// punto queda apenas más apagado que el resto, como en el ícono de color.
function gray(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b).toString(16).padStart(2, '0');
  return `#${y}${y}${y}`;
}
const grayscale = (svg) => svg.replace(/#[0-9a-f]{6}\b/gi, gray);

/* ------------------------------------------------------------- qué se genera */

async function defineAssets() {
  const read = (f) => readFile(path.join(BRAND, f), 'utf8');
  const [icon, iconDark, symbol, logo, logoDark] = await Promise.all(
    ['icon.svg', 'icon-dark.svg', 'symbol-white.svg', 'logo-stacked.svg', 'logo-stacked-on-dark.svg'].map(read),
  );

  // La variante tintada es el símbolo blanco puesto exactamente donde está en
  // el ícono. Si los dos archivos se desincronizan, mejor saberlo.
  const glyph = glyphOf(symbol, 'symbol-white.svg');
  if (shapeOf(glyph) !== shapeOf(glyphOf(icon, 'icon.svg'))) {
    throw new AssetsError('El símbolo de symbol-white.svg no es el mismo que el de icon.svg: actualizá brand-src/.');
  }
  const tinted = grayscale(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${BLACK}"/>${glyph}</svg>`,
  );

  // Logo centrado, en píxeles enteros (medio píxel no cambia nada a la vista
  // y así el resultado no depende del redondeo de Chromium).
  const lw = SPLASH_LOGO;
  const lh = Math.round((SPLASH_LOGO * LOGO_VIEWBOX[1]) / LOGO_VIEWBOX[0]);
  const logoBox = [(SPLASH - lw) / 2, Math.round((SPLASH - lh) / 2), lw, lh];
  // Un punto del ícono del logo (que va corrido 24 a la derecha) en píxeles.
  const inLogo = ([u, v]) => [
    Math.round(logoBox[0] + ((24 + u) * lw) / LOGO_VIEWBOX[0]),
    Math.round(logoBox[1] + (v * lh) / LOGO_VIEWBOX[1]),
  ];
  const inIcon = ([u, v]) => [Math.round((u * ICON) / 100), Math.round((v * ICON) / 100)];

  const icons = {
    set: 'AppIcon.appiconset',
    size: ICON,
    box: [0, 0, ICON, ICON],
    entry: (a) => ({ filename: a.file, idiom: 'universal', platform: 'ios', size: `${ICON}x${ICON}` }),
  };
  const splash = {
    set: 'Splash.imageset',
    size: SPLASH,
    box: logoBox,
    // Una sola imagen sin escala: el image view la estira igual (aspect fill).
    entry: (a) => ({ filename: a.file, idiom: 'universal' }),
  };

  return [
    {
      ...icons, file: 'AppIcon-1024.png', label: 'Ícono', appearance: null,
      svg: fullBleed(icon, 'icon.svg'), bg: BLUE,
      probes: [[[0, 0], BLUE], [inIcon(TANK), WHITE], [inIcon(DOT_CENTER), DOT]],
    },
    {
      ...icons, file: 'AppIcon-1024-dark.png', label: 'Ícono oscuro', appearance: 'dark',
      svg: fullBleed(iconDark, 'icon-dark.svg'), bg: INK,
      probes: [[[0, 0], INK], [inIcon(TANK), BLUE], [inIcon(DOT_CENTER), WHITE]],
    },
    {
      ...icons, file: 'AppIcon-1024-tinted.png', label: 'Ícono tintado', appearance: 'tinted',
      svg: tinted, bg: BLACK, grayscale: true,
      probes: [[[0, 0], BLACK], [inIcon(TANK), WHITE], [inIcon(DOT_CENTER), gray(DOT)]],
    },
    {
      ...splash, file: 'splash.png', label: 'Arranque', appearance: null,
      svg: logo, bg: BG_LIGHT,
      probes: [[[0, 0], BG_LIGHT], [[SPLASH - 1, SPLASH - 1], BG_LIGHT], [inLogo(ICON_BG), BLUE], [inLogo(TANK), WHITE]],
    },
    {
      ...splash, file: 'splash-dark.png', label: 'Arranque oscuro', appearance: 'dark',
      svg: logoDark, bg: BG_DARK,
      probes: [[[0, 0], BG_DARK], [[SPLASH - 1, SPLASH - 1], BG_DARK], [inLogo(ICON_BG), BLUE], [inLogo(TANK), WHITE]],
    },
  ];
}

/* ------------------------------------------------------------- ImageMagick */

// ImageMagick 7 se llama «magick»; el 6, «convert». Mismas opciones en los dos.
function findMagick() {
  for (const cmd of ['magick', 'convert']) {
    try {
      execFileSync(cmd, ['-version'], { stdio: 'pipe' });
      return (args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch { /* probamos el siguiente */ }
  }
  throw new AssetsError('Falta ImageMagick («magick» o «convert»). En la Mac: brew install imagemagick');
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');

// Mide el PNG ya terminado. Los colores salen con %[fx:…] y no con %[hex:…]
// porque este último cambia de formato entre versiones y compilaciones.
function inspect(magick, file, probes) {
  const fx = probes.flatMap(([[x, y]]) => ['r', 'g', 'b'].map((c) => `%[fx:int(255*p{${x},${y}}.${c}+0.5)]`));
  const fields = magick([file, '-format', ['%w', '%h', '%[channels]', '%[type]', ...fx].join('|'), 'info:']).trim().split('|');
  const [w, h, channels, type] = fields;
  const colors = probes.map((_, i) => fields.slice(4 + i * 3, 7 + i * 3).map(Number));
  return { width: Number(w), height: Number(h), channels: channels.trim(), type, colors };
}

function verify(magick, file, a) {
  const got = inspect(magick, file, a.probes);
  const fail = (msg) => { throw new AssetsError(`${a.file}: ${msg}`); };
  if (got.width !== a.size || got.height !== a.size) fail(`mide ${got.width}×${got.height}, tiene que medir ${a.size}×${a.size}.`);
  // «srgb» y no «srgba» (ImageMagick 7 agrega la cantidad de canales: «srgb  3.0»).
  if (!/^srgb\b/.test(got.channels)) fail(`canales «${got.channels}»: tiene que ser RGB sin alfa.`);
  if (a.grayscale && got.type !== 'Grayscale') fail(`tiene que ser gris puro y es «${got.type}».`);
  a.probes.forEach(([[x, y], want], i) => {
    const rgb = got.colors[i];
    // Un punto de tolerancia por canal: los rellenos planos salen exactos,
    // pero no queremos depender del último bit de cada versión de Chromium.
    if (rgb.some((c, k) => Math.abs(c - rgbOf(want)[k]) > 2)) {
      fail(`en (${x}, ${y}) hay ${hexOf(rgb)} y tendría que haber ${want}. ¿Cambió la marca o el dibujo se corrió?`);
    }
  });
  return got;
}

/* ------------------------------------------------------------- dibujo */

const dataUrl = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;

// El SVG va como <img> en una página del tamaño exacto del PNG (1 px = 1 px).
async function render(browser, a) {
  const [x, y, w, h] = a.box;
  const page = await browser.newPage({ viewport: { width: a.size, height: a.size }, deviceScaleFactor: 1 });
  try {
    await page.setContent(
      '<!doctype html><meta charset="utf-8"><style>' +
      `html,body{margin:0;height:100%;overflow:hidden;background:${a.bg}}` +
      `img{position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px}` +
      `</style><img alt="" src="${dataUrl('image/svg+xml', a.svg)}">`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    return await page.screenshot({ type: 'png' });
  } finally {
    await page.close();
  }
}

/* ------------------------------------------------------------- catálogo */

// Mismo formato que escribe Xcode («"clave" : valor», claves en orden), así
// abrir el catálogo en Xcode no ensucia el diff.
const xcodeJson = (o) => JSON.stringify(o, null, 2).replace(/^(\s*"[^"]*"):/gm, '$1 :') + '\n';

function contentsOf(assets) {
  const images = assets.map((a) => ({
    ...(a.appearance && { appearances: [{ appearance: 'luminosity', value: a.appearance }] }),
    ...a.entry(a),
  }));
  return { images, info: { author: 'xcode', version: 1 } };
}

const IMAGE_FILE = /\.(png|jpe?g|pdf|heic|svg)$/i;

// Cada imagen del set tiene que estar en Contents.json y viceversa: Xcode
// avisa con las sobrantes y una faltante es un ícono en blanco.
async function checkSet(dir) {
  const contents = JSON.parse(await readFile(path.join(dir, 'Contents.json'), 'utf8'));
  const listed = contents.images.map((i) => i.filename);
  const present = (await readdir(dir)).filter((f) => IMAGE_FILE.test(f));
  const missing = listed.filter((f) => !present.includes(f));
  const extra = present.filter((f) => !listed.includes(f));
  if (missing.length || extra.length) {
    throw new AssetsError(`${path.relative(ROOT, dir)}: faltan [${missing.join(', ')}], sobran [${extra.join(', ')}].`);
  }
}

/* ------------------------------------------------------------- muestra */

// Hoja para mirar el resultado como se va a ver: el ícono con la máscara de
// iOS (aprox.) y la pantalla de arranque recortada como en cada equipo.
async function contactSheet(browser, assets, sizes) {
  const src = Object.fromEntries(await Promise.all(
    assets.map(async (a) => [a.file, dataUrl('image/png', await readFile(path.join(XCASSETS, a.set, a.file)))]),
  ));
  const cap = (a) => `${a.label}<small>${a.file} · ${a.size}×${a.size} · ${sizes[a.file]}</small>`;
  const icon = (file, bg, extra = '') =>
    `<div class="home" style="background:${bg}"><img class="icon" src="${src[file]}" ${extra}><img class="icon small" src="${src[file]}" ${extra}></div>`;
  const device = (file, [w, h], label) =>
    `<figure><div class="device" style="width:${w}px;height:${h}px"><img src="${src[file]}"></div><figcaption>${label}</figcaption></figure>`;
  const [light, dark, tinted, splash, splashDark] = assets;
  const k = 0.42; // escala de los equipos en la hoja
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:28px;width:1100px;background:#e9e9ee;color:#1c1c1e;font:13px/1.35 -apple-system,system-ui,sans-serif}
    h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:26px 0 12px} p{margin:0;color:#636366}
    .row{display:flex;gap:22px;align-items:flex-end}
    figure{margin:0} figcaption{margin-top:8px;font-weight:600} small{display:block;font-weight:400;color:#636366}
    .home{display:flex;gap:18px;align-items:flex-end;padding:18px;border-radius:18px}
    .icon{width:160px;height:160px;border-radius:22.37%;display:block} .icon.small{width:60px;height:60px}
    .raw{width:84px;height:84px;display:block;outline:1px solid #0003}
    .device{border:6px solid #1c1c1e;border-radius:26px;overflow:hidden;background:#1c1c1e}
    .device img{width:100%;height:100%;object-fit:cover;display:block}
    .tint{background:#ff9f0a;display:inline-block;border-radius:22.37%;line-height:0}
    .tint img{mix-blend-mode:multiply}
  </style>
  <h1>247WC · ícono y pantalla de arranque</h1>
  <p>Generado por scripts/make-assets.mjs desde brand-src/. Esquinas y recorte simulados: iOS pone los suyos.</p>
  <h2>Ícono (a 160 y 60 px; el de 60 es el tamaño real en la pantalla de inicio)</h2>
  <div class="row">
    <figure>${icon(light.file, 'linear-gradient(160deg,#9ec5ff,#e6efff)')}<figcaption>${cap(light)}</figcaption></figure>
    <figure>${icon(dark.file, 'linear-gradient(160deg,#1b2133,#05070c)')}<figcaption>${cap(dark)}</figcaption></figure>
    <figure>${icon(tinted.file, '#111')}<figcaption>${cap(tinted)}</figcaption></figure>
    <figure><div class="home" style="background:#111"><span class="tint"><img class="icon" src="${src[tinted.file]}"></span></div>
      <figcaption>Tintado (simulado)<small>iOS multiplica el gris por el tinte</small></figcaption></figure>
  </div>
  <div class="row" style="margin-top:14px">
    ${[light, dark, tinted].map((a) => `<img class="raw" src="${src[a.file]}" title="${a.file}">`).join('')}
    <p>Los PNG tal cual: cuadrados, a sangre, sin alfa.</p>
  </div>
  <h2>Pantalla de arranque (aspect fill, igual que LaunchScreen.storyboard y SplashScreen)</h2>
  <div class="row">
    ${device(splash.file, [393 * k, 852 * k], `iPhone 15 · claro<small>${splash.file} · ${sizes[splash.file]}</small>`)}
    ${device(splashDark.file, [393 * k, 852 * k], `iPhone 15 · oscuro<small>${splashDark.file} · ${sizes[splashDark.file]}</small>`)}
    ${device(splash.file, [375 * k, 667 * k], 'iPhone SE · claro')}
    ${device(splashDark.file, [1366 * k * 0.62, 1024 * k * 0.62], 'iPad horizontal · oscuro')}
  </div>`;
  const page = await browser.newPage({ viewport: { width: 1156, height: 800 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(html);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await mkdir(path.dirname(PREVIEW), { recursive: true });
    await page.screenshot({ path: PREVIEW, type: 'png', fullPage: true });
  } finally {
    await page.close();
  }
}

/* ------------------------------------------------------------- principal */

export async function makeAssets({ quiet = false, preview = true } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const magick = findMagick();
  const assets = await defineAssets();

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new AssetsError('Falta Playwright: corré «npm install» en la raíz del proyecto.');
  }

  const tmp = await mkdtemp(path.join(os.tmpdir(), '247wc-assets-'));
  let browser;
  try {
    try {
      // Perfil de color fijo: sin esto Chromium puede convertir los colores al
      // perfil de la pantalla y el azul de marca deja de ser #0a6cff.
      browser = await chromium.launch({ args: ['--force-color-profile=srgb'] });
    } catch (err) {
      throw new AssetsError(`No arranca Chromium (${String(err?.message).split('\n')[0]}).\n  Probá: npx playwright install chromium`);
    }

    // 1) Todo a una carpeta temporal y verificado: el catálogo no se toca
    //    hasta que los cinco PNG están bien.
    const sizes = {};
    for (const a of assets) {
      const raw = path.join(tmp, `raw-${a.file}`);
      a.out = path.join(tmp, a.file);
      await writeFile(raw, await render(browser, a));
      // Aplanar sobre el fondo y apagar el canal alfa; PNG24 = RGB de 8 bits.
      magick([raw, '-background', a.bg, '-alpha', 'remove', '-alpha', 'off', '-strip', ...PNG_DEFINES, `PNG24:${a.out}`]);
      verify(magick, a.out, a);
      sizes[a.file] = `${Math.round((await stat(a.out)).size / 1024)} KB`;
    }

    // 2) Al catálogo: PNG, Contents.json y fuera lo que sobre (las imágenes
    //    de la plantilla de Capacitor, nombres viejos).
    for (const set of [...new Set(assets.map((a) => a.set))]) {
      const dir = path.join(XCASSETS, set);
      const mine = assets.filter((a) => a.set === set);
      await mkdir(dir, { recursive: true });
      for (const a of mine) await writeFile(path.join(dir, a.file), await readFile(a.out));
      await writeFile(path.join(dir, 'Contents.json'), xcodeJson(contentsOf(mine)));
      for (const f of await readdir(dir)) {
        if (IMAGE_FILE.test(f) && !mine.some((a) => a.file === f)) {
          await rm(path.join(dir, f));
          log(`  − ${set}/${f} (sobraba)`);
        }
      }
      await checkSet(dir);
      for (const a of mine) log(`  ✓ ${set}/${a.file}  ${a.size}×${a.size} RGB sin alfa, ${sizes[a.file]}`);
    }

    if (preview) {
      await contactSheet(browser, assets, sizes);
      log(`  ✓ muestra: ${path.relative(ROOT, PREVIEW)}`);
    }
    log('Ícono y pantalla de arranque listos.');
    return { files: assets.map((a) => path.join(XCASSETS, a.set, a.file)), preview: preview ? PREVIEW : null };
  } finally {
    await browser?.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

/* ------------------------------------------------------------- CLI */

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  makeAssets().catch((err) => {
    const msg = err instanceof AssetsError ? err.message
      : err?.stderr?.length ? `ImageMagick: ${err.stderr.toString().trim()}`
      : err?.stack || err;
    console.error(`\n✗ Assets fallidos: ${msg}\n`);
    process.exit(1);
  });
}
