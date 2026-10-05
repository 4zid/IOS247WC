#!/usr/bin/env node
/* 247WC iOS — trae la última versión de la web app a web/.

   web/ es una copia exacta de https://github.com/4zid/247wc: nunca se edita a
   mano. Este script la reemplaza por la del upstream, anota de qué commit
   vino (web/UPSTREAM.json) y corre el build para confirmar que los parches de
   scripts/build-web.mjs siguen aplicando.

   Uso:
     npm run web:update                         clona el repo (git clone --depth 1)
     npm run web:update -- --from ../247wc      usa una copia local ya clonada
     npm run web:update -- --repo <url> --ref <rama|tag>

   Corrido dos veces contra el mismo commit deja web/ idéntico, byte a byte. */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, BuildError, expandFiles } from './build-web.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const DEFAULT_REPO = 'https://github.com/4zid/247wc';
const NOTE = "Copia de la web app. No editar a mano: se actualiza con 'npm run web:update'.";

// Qué se trae del upstream y dónde queda en web/. Si cambia, cambiá también
// WEB_FILES en scripts/build-web.mjs.
const COPY = [
  ['index.html', 'index.html'],
  ['app.js', 'app.js'],
  ['lang.js', 'lang.js'],
  ['styles.css', 'styles.css'],
  ['favicon.svg', 'favicon.svg'],
  ['brand/logo/logo-horizontal.svg', 'brand/logo/logo-horizontal.svg'],
  ['brand/logo/logo-horizontal-on-dark.svg', 'brand/logo/logo-horizontal-on-dark.svg'],
  ['vendor/maplibre/*', 'vendor/maplibre/'],
  ['vendor/qrcode/*', 'vendor/qrcode/'],
  // Inter: la web la pide a Google Fonts; la app la lleva empaquetada.
  ['tools/mockups/fonts/inter.woff2', 'fonts/inter.woff2'],
];

// Referencias locales que existen en la web pero a propósito no van a la app.
const KNOWN_SKIPPED = new Map([
  ['sw.js', 'service worker: en la app no hay (app.js lo saltea si no existe navigator.serviceWorker)'],
  ['manifest.webmanifest', 'PWA: el build quita el <link rel="manifest">'],
  ['icons/', 'íconos de la PWA: el build quita esos <link>; el ícono de la app lo pone Xcode'],
]);

class UpdateError extends Error {}

function parseArgs(argv) {
  const args = { from: null, repo: DEFAULT_REPO, ref: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new UpdateError(`Falta el valor de ${a}.`);
      return v;
    };
    if (a === '--from') args.from = path.resolve(value());
    else if (a === '--repo') args.repo = value();
    else if (a === '--ref') args.ref = value();
    else if (a === '-h' || a === '--help') args.help = true;
    else throw new UpdateError(`Opción desconocida: ${a}`);
  }
  return args;
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

// Lista final [origen absoluto, destino relativo a web/], expandiendo los «*».
async function plan(src) {
  const out = [];
  for (const [from, to] of COPY) {
    let files;
    try {
      files = await expandFiles(src, [from]);
    } catch (err) {
      // Antes de tocar web/: si el upstream movió o borró algo, no copiamos nada.
      throw new UpdateError(`El upstream ya no tiene «${from}» (${err.message}). Revisá COPY en scripts/update-web.mjs.`);
    }
    for (const f of files) {
      out.push([path.join(src, f), to.endsWith('/') ? path.posix.join(to, path.posix.basename(f)) : to]);
    }
  }
  return out;
}

async function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

async function pruneEmptyDirs(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const sub = path.join(dir, e.name);
    await pruneEmptyDirs(sub);
    if (!(await readdir(sub)).length) await rmdir(sub);
  }
}

// Referencias a archivos locales en el HTML, el JS y el CSS del upstream que
// no estén en la lista de copia: si aparece una nueva, la app la pediría y
// daría 404 dentro del teléfono.
async function newLocalRefs(src, copied) {
  const have = new Set(copied);
  const refs = new Map();   // ref → archivo donde aparece
  const add = (ref, file) => {
    const clean = ref.split(/[?#]/)[0].replace(/^\.\//, '').replace(/^\//, '');
    if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('#')) return;
    if (clean.startsWith('api/')) return;   // la API: en la app va por HTTP nativo
    if (!refs.has(clean)) refs.set(clean, file);
  };
  const html = await readFile(path.join(src, 'index.html'), 'utf8');
  for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) add(ref, 'index.html');
  const js = await readFile(path.join(src, 'app.js'), 'utf8');
  const ASSET = /['"`]((?:\.{0,2}\/)?[\w./-]+\.(?:js|mjs|css|svg|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|json|webmanifest|html|mp3|wav|m4a))(?:\?[^'"`]*)?['"`]/g;
  for (const [, ref] of js.matchAll(ASSET)) add(ref, 'app.js');
  const css = await readFile(path.join(src, 'styles.css'), 'utf8');
  for (const [, ref] of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) add(ref.trim(), 'styles.css');

  const warnings = [];
  for (const [ref, file] of refs) {
    if (have.has(ref)) continue;
    const known = [...KNOWN_SKIPPED.keys()].find((k) => (k.endsWith('/') ? ref.startsWith(k) : ref === k));
    if (known) continue;
    warnings.push(`${file} usa «${ref}», que no se copia a web/`);
  }
  return warnings;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Uso: node scripts/update-web.mjs [--from <checkout local>] [--repo <url>] [--ref <rama|tag>]');
    return;
  }

  let src = args.from;
  let tmp = null;
  try {
    if (src) {
      if (!existsSync(path.join(src, 'index.html'))) throw new UpdateError(`${src} no parece una copia de 247wc (no tiene index.html).`);
    } else {
      tmp = await mkdtemp(path.join(os.tmpdir(), '247wc-'));
      src = path.join(tmp, 'repo');
      console.log(`Clonando ${args.repo}${args.ref ? ` (${args.ref})` : ''}…`);
      const cloneArgs = ['clone', '--depth', '1', '--quiet'];
      if (args.ref) cloneArgs.push('--branch', args.ref);
      execFileSync('git', [...cloneArgs, args.repo, src], { stdio: 'inherit' });
    }

    let commit = null, committedAt = null, repo = args.repo;
    try {
      commit = git(src, 'rev-parse', 'HEAD');
      committedAt = git(src, 'log', '-1', '--format=%cI');
      if (args.from) {
        const dirty = git(src, 'status', '--porcelain');
        if (dirty) console.warn(`⚠ ${src} tiene cambios sin commitear: web/ no va a coincidir con el commit ${commit.slice(0, 7)}.`);
      }
    } catch {
      console.warn(`⚠ ${src} no es un repo git: UPSTREAM.json queda sin commit.`);
    }

    const files = await plan(src);
    const wanted = new Set([...files.map(([, to]) => to), 'UPSTREAM.json']);

    // Lo que ya no está en el upstream se borra; el resto se pisa.
    await mkdir(WEB, { recursive: true });
    const removed = [];
    for (const f of await listFiles(WEB)) {
      if (!wanted.has(f)) { await rm(path.join(WEB, f)); removed.push(f); }
    }
    for (const [from, to] of files) {
      await mkdir(path.dirname(path.join(WEB, to)), { recursive: true });
      await cp(from, path.join(WEB, to));
    }
    await pruneEmptyDirs(WEB);

    const upstream = { repo, commit, committedAt, note: NOTE };
    await writeFile(path.join(WEB, 'UPSTREAM.json'), JSON.stringify(upstream, null, 2) + '\n');

    console.log(`web/ actualizado: ${files.length} archivos de ${repo}` + (commit ? ` @ ${commit.slice(0, 7)} (${committedAt})` : ''));
    if (removed.length) console.log(`  borrados (ya no están en el upstream): ${removed.join(', ')}`);

    const warnings = await newLocalRefs(src, files.map(([from]) => path.relative(src, from).split(path.sep).join('/')));
    for (const w of warnings) console.warn(`⚠ ${w}. Sumalo a COPY (acá) y a WEB_FILES (build-web.mjs), o confirmá que no hace falta.`);

    console.log('\nVerificando que los parches sigan aplicando…');
    await build();

    const changed = (() => { try { return git(ROOT, 'status', '--porcelain', '--', 'web'); } catch { return ''; } })();
    console.log(changed
      ? '\nweb/ cambió: revisá el diff (git diff web/), probá con «npm test» y commiteá.'
      : '\nweb/ ya estaba al día: no hay cambios.');
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  if (err instanceof BuildError) {
    console.error(`\n✗ web/ se actualizó, pero el build ya no aplica:\n${err.message}\n`);
  } else if (err instanceof UpdateError) {
    console.error(`\n✗ ${err.message}\n`);
  } else {
    console.error(`\n✗ No se pudo actualizar web/: ${err?.stack || err}\n`);
  }
  process.exit(1);
});
