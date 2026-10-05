#!/usr/bin/env node
/* 247WC iOS — la clave privada de App Store Connect (el .p8) en la CI.

   El secreto ASC_PRIVATE_KEY tiene que ser el contenido del archivo
   AuthKey_XXXXXXXXXX.p8. Como se pega a mano en GitHub, aceptamos las formas
   en que suele llegar: con saltos de línea de Windows, todo en una sola
   línea, con «\n» escritos como texto o codificado en base64. Se valida con
   la criptografía de Node antes de gastar minutos de macOS y se escribe
   normalizada (PKCS#8, lo que espera xcodebuild).

   Uso:
     node .github/ci/asc-key.mjs check          valida (sale con 1 si no sirve)
     node .github/ci/asc-key.mjs write <ruta>   valida y la escribe (permisos 600)

   La clave sale de la variable de entorno ASC_PRIVATE_KEY y nunca se imprime.
   testflight-wait.mjs importa normalizeKey() para firmar sus pedidos. */

import { createPrivateKey } from 'node:crypto';
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class KeyError extends Error {}

const PEM = /-----BEGIN ((?:EC )?PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// Devuelve la clave en PEM PKCS#8 o tira KeyError con el motivo (en castellano,
// para terminar la frase «La clave ASC_PRIVATE_KEY …»).
export function normalizeKey(raw) {
  let text = String(raw ?? '').replace(/\r/g, '').replace(/\\n/g, '\n').trim();
  if (!text) throw new KeyError('está vacía');

  if (!text.includes('PRIVATE KEY-----')) {
    // ¿La pegaron en base64 (por ejemplo con `base64 -i AuthKey.p8`)?
    const compact = text.replace(/\s+/g, '');
    if (BASE64.test(compact)) {
      const decoded = Buffer.from(compact, 'base64').toString('utf8').replace(/\r/g, '').trim();
      if (decoded.includes('PRIVATE KEY-----')) text = decoded;
    }
  }

  const match = text.match(PEM);
  if (!match) throw new KeyError('no parece un archivo .p8: falta la línea «-----BEGIN PRIVATE KEY-----» o la del final');

  // El cuerpo se rearma en líneas de 64: así da igual cómo se haya pegado.
  const body = match[2].replace(/\s+/g, '');
  if (!BASE64.test(body)) throw new KeyError('tiene caracteres de más entre las líneas BEGIN y END');
  const pem = `-----BEGIN ${match[1]}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${match[1]}-----\n`;

  let key;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new KeyError('está incompleta o dañada (¿se cortó al copiarla?)');
  }
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new KeyError('no es una clave de App Store Connect (esas son de tipo EC P-256)');
  }
  return key.export({ type: 'pkcs8', format: 'pem' });
}

function main([command, out]) {
  if (!['check', 'write'].includes(command) || (command === 'write' && !out)) {
    console.error('uso: node .github/ci/asc-key.mjs check | write <ruta>');
    process.exit(2);
  }
  let pem;
  try {
    pem = normalizeKey(process.env.ASC_PRIVATE_KEY);
  } catch (err) {
    if (!(err instanceof KeyError)) throw err;
    const message =
      `La clave ASC_PRIVATE_KEY ${err.message}. Pegá en el secreto el contenido completo del archivo ` +
      'AuthKey_….p8, desde «-----BEGIN PRIVATE KEY-----» hasta «-----END PRIVATE KEY-----» ' +
      '(README, sección «Subir sin Mac»).';
    console.log(`::error title=ASC_PRIVATE_KEY no sirve::${message}`);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## La clave de App Store Connect no sirve\n\n${message}\n`);
    }
    process.exit(1);
  }
  if (command === 'write') {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, pem, { mode: 0o600 });
    chmodSync(out, 0o600); // por si el archivo ya existía con otros permisos
    console.log(`Clave de App Store Connect lista en ${out}`);
  } else {
    console.log('La clave ASC_PRIVATE_KEY es válida.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
