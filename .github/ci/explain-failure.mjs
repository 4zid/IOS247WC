#!/usr/bin/env node
/* 247WC iOS — cuando falla el workflow TestFlight, busca en los logs de
   xcodebuild los errores conocidos y los explica en castellano, con qué
   hacer, en el resumen de la corrida (y como anotaciones). Los logs completos
   quedan en el artefacto «testflight-logs».

   Uso: node .github/ci/explain-failure.mjs <carpeta de logs>

   Lee los *.log de la carpeta (también los de exportación, *.xcdistributionlogs)
   menos los «verbose», que repiten todo y confunden. Nunca falla: si algo sale
   mal acá, la corrida ya está en rojo por el error de verdad. */

import { existsSync, readdirSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function bundleId() {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8')).appId || 'com.wc247.app';
  } catch {
    return 'com.wc247.app';
  }
}

const BUNDLE = bundleId();
const README = 'README, sección «Subir sin Mac»';

// En orden de prioridad: lo más específico primero.
const HINTS = [
  {
    re: /No suitable application records|Cannot determine the Apple ID from Bundle ID/i,
    text: `Todavía no existe la app en App Store Connect. Creala en App Store Connect → Apps → «+» → Nueva app, con el bundle ID ${BUNDLE} (${README}).`,
  },
  {
    re: /cannot be registered to your development team|identifier .* is not available/i,
    text: `El bundle ID ${BUNDLE} está registrado en otra cuenta de Apple. Hay que elegir otro (appId en capacitor.config.json y PRODUCT_BUNDLE_IDENTIFIER en el proyecto de Xcode).`,
  },
  {
    re: /Redundant Binary Upload|bundle version must be higher|already uploaded a build with build number/i,
    text: 'Ya hay un build subido con ese número. Lanzá el workflow de nuevo con «Run workflow» (no con «Re-run»: repite el mismo número); cada corrida nueva usa un número más alto.',
  },
  {
    re: /Invalid Pre-Release Train|train version .* is closed|higher version than that of the previously approved/i,
    text: 'Esa versión ya está publicada (o cerrada) en el App Store. Lanzá el workflow con una versión más alta en el campo «version» (por ejemplo 1.0.1).',
  },
  {
    re: /SDK version issue|must be built with the iOS [\d.]+ SDK/i,
    text: 'Apple exige un Xcode más nuevo que el de este Mac de GitHub. Hay que subir runs-on (macos-…) en .github/workflows/testflight.yml.',
  },
  {
    re: /required agreement|agreement .*(missing|expired)|PLA Update|Program License Agreement/i,
    text: 'Apple necesita que aceptes un acuerdo nuevo. Entrá a developer.apple.com/account y a App Store Connect → Business (Acuerdos) y aceptalo; después volvé a lanzar el workflow.',
  },
  {
    re: /NOT_AUTHORIZED|Authentication credentials are missing or invalid|Failed to authenticate|Unable to authenticate|401 Unauthorized|invalid (issuer|key id)/i,
    text: 'Apple rechazó la clave de API. Revisá que ASC_KEY_ID, ASC_ISSUER_ID y ASC_PRIVATE_KEY sean de la misma clave y que no esté revocada (App Store Connect → Users and Access → Integrations).',
  },
  {
    re: /Cloud signing permission|FORBIDDEN|forbidden for security reasons|does not have (the )?(required )?permission|insufficient (permission|privilege)|not allowed to (perform|create)/i,
    text: 'La clave de API no tiene permisos suficientes. Tiene que ser una clave de equipo (Team Key) con acceso Admin: los certificados administrados en la nube solo los puede usar ese rol.',
  },
  {
    re: /maximum number of (certificates|.*certificates)|already have a current .*certificate|certificate limit/i,
    text: 'La cuenta llegó al máximo de certificados. En developer.apple.com → Certificates, revocá los «Apple Development» o «Apple Distribution» viejos que digan «Created via API» y volvé a lanzar el workflow.',
  },
  {
    re: /No profiles for|No signing certificate|No Accounts|requires a provisioning profile|provisioning profile .*(doesn't|does not|failed)|Signing for .* requires a development team/i,
    text: `Xcode no pudo firmar para el App Store. Revisá que exista el identificador ${BUNDLE} en developer.apple.com → Identifiers, que la clave sea Admin y que APPLE_TEAM_ID sea el del mismo equipo que la clave.`,
  },
  {
    re: /Missing required icon|CFBundleIconName|alpha channel|Invalid (large )?app icon/i,
    text: 'Falta el ícono de la app o está mal (Assets.xcassets/AppIcon: 1024×1024, sin transparencia). Se regenera con npm run assets.',
  },
  {
    re: /\.swift:\d+:\d+: error:|Swift Compiler Error|Command SwiftCompile failed/i,
    text: 'Falló la compilación del código Swift. El primer error está abajo; el workflow «iOS build» compila lo mismo en cada push y muestra el error en el archivo.',
  },
  {
    re: /Could not resolve package dependencies|Failed to resolve dependencies|Couldn.t (fetch|clone|update)|unable to fetch/i,
    text: 'Xcode no pudo bajar las dependencias (Swift Package Manager). Suele ser un problema de red pasajero: volvé a lanzarlo. Si se repite, corré npm run sync y commiteá ios/App/CapApp-SPM/Package.swift.',
  },
  {
    re: /network connection was lost|Could not connect to the server|request timed out|timed out while/i,
    text: 'Se cortó la conexión con Apple durante la subida. Volvé a lanzar el workflow.',
  },
  {
    re: /ITMS-\d+/,
    text: 'Apple rechazó el paquete al recibirlo (error ITMS, el detalle está abajo).',
  },
];

// Líneas que parecen errores (sin los comandos larguísimos de clang/swiftc,
// que mencionan -Werror y similares).
const ERRORISH = /(^|[^-\w])(error|ITMS-\d+)|\bFAILED\b|failed to/i;
const scrub = (line) => line.replace(/(Bearer\s+)[\w.~+/=-]+/g, '$1***').trim();

function logFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.log') && !/verbose/i.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  // Primero los nuestros (archive, export), después los de exportación de Xcode.
  return out.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
}

function main(dir) {
  const summary = [];
  const files = dir && existsSync(dir) && statSync(dir).isDirectory() ? logFiles(dir) : [];

  // errorLines: las que se muestran. context: esas más las 3 siguientes,
  // porque los mensajes de Apple suelen seguir en otro renglón. Las pistas se
  // buscan solo ahí, no en todo el log (que menciona AppIcon, perfiles, etc.
  // aunque todo ande bien).
  const errorLines = [];
  const context = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.length >= 1500 || !ERRORISH.test(line)) return;
      const clean = scrub(line);
      if (clean && !errorLines.includes(clean)) errorLines.push(clean);
      context.push(...lines.slice(i, i + 4).filter((l) => l.length < 1500));
    });
  }

  const hints = HINTS.filter((hint) => context.some((line) => hint.re.test(line))).map((hint) => hint.text);

  summary.push('## Falló la subida a TestFlight', '');
  if (!files.length) {
    summary.push('Falló antes de llegar a xcodebuild: mirá el paso marcado en rojo en esta corrida.');
  } else if (hints.length) {
    summary.push('Lo que encontré en los logs:', '', ...hints.map((text) => `- ${text}`));
  } else {
    summary.push(
      'No reconocí el error. Mirá las líneas de abajo, o descargá el artefacto **testflight-logs** y pasáselo a Claude.',
    );
  }

  if (errorLines.length) {
    summary.push('', '<details><summary>Primeras líneas con error</summary>', '', '```', ...errorLines.slice(0, 25), '```', '', '</details>');
  }
  if (files.length) {
    summary.push('', 'Los logs completos están en el artefacto **testflight-logs** de esta corrida (al pie de la página, en «Artifacts»).');
  }

  for (const text of hints.slice(0, 5)) console.log(`::error title=TestFlight::${text}`);
  console.log(summary.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join('\n')}\n`);
}

try {
  main(process.argv[2]);
} catch (err) {
  console.log(`::warning::No pude analizar los logs: ${err.message}`);
}
