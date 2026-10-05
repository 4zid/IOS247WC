#!/usr/bin/env node
/* 247WC iOS — espera a que Apple procese el build recién subido y, si se
   pasaron notas, las carga como «Qué probar» en TestFlight.

   Después de la subida, App Store Connect tarda unos minutos en mostrar el
   build y otros 5–30 en procesarlo. Este script corre en Linux (el minuto
   cuesta 10 veces menos que en macOS) y consulta la API de App Store Connect
   cada 30 s:
   - VALID: listo para probar → carga las notas (si hay) y lo avisa.
   - INVALID / FAILED: Apple lo rechazó al procesarlo → falla (a la cuenta
     de desarrollador llega un mail con el motivo).
   - Si se pasa el tiempo o la API no contesta, deja un warning y NO falla:
     la subida ya salió bien y no tiene sentido teñir de rojo la corrida.

   Variables de entorno: ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY, BUNDLE_ID,
   BUILD_NUMBER, APP_VERSION, NOTES (opcional), WAIT_MINUTES (def. 45),
   POLL_SECONDS (def. 30) y ASC_API_URL (solo para probarlo contra un mock).

   Sin dependencias: Node ≥ 20 (fetch y crypto). */

import { sign } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { normalizeKey } from './asc-key.mjs';

const env = process.env;
const API = (env.ASC_API_URL || 'https://api.appstoreconnect.apple.com').replace(/\/+$/, '');
// Mismo arreglo que «Revisar los secretos» en testflight.yml: sin espacios y en mayúsculas.
const KEY_ID = (env.ASC_KEY_ID ?? '').replace(/\s+/g, '').toUpperCase();
const ISSUER_ID = (env.ASC_ISSUER_ID ?? '').replace(/\s+/g, '');
const BUNDLE_ID = (env.BUNDLE_ID ?? '').trim();
const BUILD_NUMBER = (env.BUILD_NUMBER ?? '').trim();
const APP_VERSION = (env.APP_VERSION ?? '').trim();
const WAIT_MS = Number(env.WAIT_MINUTES || 45) * 60_000;
const POLL_MS = Number(env.POLL_SECONDS || 30) * 1000;
const RAW_NOTES = String(env.NOTES ?? '').trim();
const NOTES = cleanNotes(RAW_NOTES);
const LABEL = `247WC ${APP_VERSION || '?'} (${BUILD_NUMBER || '?'})`;

const STATES = {
  MISSING: 'todavía no aparece en App Store Connect',
  PROCESSING: 'Apple lo está procesando',
  VALID: 'procesado',
  INVALID: 'Apple lo rechazó',
  FAILED: 'falló el procesamiento',
};

/* ------------------------------------------------------------- salida */

const say = (msg) => console.log(msg);
const warn = (msg) => say(`::warning title=TestFlight::${msg}`);
const error = (msg) => say(`::error title=TestFlight::${msg}`);
const summary = (...lines) => {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n\n`);
};

// Espacios y saltos prolijos («\n» escrito en el campo cuenta como salto).
// (Declaraciones de función: NOTES se calcula más arriba, al cargar.)
function tidy(text) {
  return text
    .replace(/\\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// TestFlight rechaza emojis y varios símbolos en «Qué probar» (y el pedido
// falla entero): los sacamos antes. Flechas, ™ y acentos pasan.
function cleanNotes(raw) {
  const stripped = raw
    .replace(/[\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/[\u200D\uFE00-\uFE0F\u2500-\u257F\u2600-\u27BF\u2800-\u28FF\uE000-\uF8FF\uFFFD]/g, '');
  return tidy(stripped).slice(0, 4000);
}

/* ---------------------------------------------------------------- API */

class ApiError extends Error {
  constructor(status, detail) {
    super(`HTTP ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

let signingKey;

// JWT ES256 de App Store Connect: dura 15 min (el máximo es 20), así que se
// firma uno nuevo por pedido y la espera puede durar lo que haga falta.
function token() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${encode({
    iss: ISSUER_ID,
    iat: now,
    exp: now + 15 * 60,
    aud: 'appstoreconnect-v1',
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: signingKey, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${signature.toString('base64url')}`;
}

const query = (params) => new URLSearchParams(params).toString();

async function api(method, resource, body) {
  const res = await fetch(`${API}${resource}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta que no es JSON: queda el texto */
  }
  if (!res.ok) {
    const first = json?.errors?.[0];
    const detail = first ? [first.title, first.detail].filter(Boolean).join(': ') : text.slice(0, 200);
    throw new ApiError(res.status, detail);
  }
  return json;
}

// Red caída, timeout, 429 o 5xx: vale la pena reintentar.
const transient = (err) => !(err instanceof ApiError) || err.status === 429 || err.status >= 500;

/* ----------------------------------------------------------- consultas */

async function findApp() {
  const res = await api('GET', `/v1/apps?${query({
    'filter[bundleId]': BUNDLE_ID,
    'fields[apps]': 'bundleId,name,primaryLocale',
    limit: '20',
  })}`);
  return res.data.find((app) => app.attributes?.bundleId === BUNDLE_ID) ?? null;
}

async function findBuild(app) {
  const res = await api('GET', `/v1/builds?${query({
    'filter[app]': app.id,
    'filter[version]': BUILD_NUMBER,
    'fields[builds]': 'version,processingState,uploadedDate,expired',
    limit: '10',
  })}`);
  const uploaded = (build) => Date.parse(build.attributes?.uploadedDate ?? '') || 0;
  return res.data.sort((a, b) => uploaded(b) - uploaded(a))[0] ?? null;
}

// Carga «Qué probar» en todos los idiomas del build. TestFlight solo acepta
// idiomas que ya tengan «Información de prueba» (betaAppLocalizations): si la
// app no tiene ninguno, se crea el del idioma principal.
async function setNotes(app, build) {
  const existing = await api('GET', `/v1/builds/${build.id}/betaBuildLocalizations?${query({
    'fields[betaBuildLocalizations]': 'locale,whatsNew',
    limit: '50',
  })}`);
  if (existing.data.length) {
    for (const loc of existing.data) {
      await api('PATCH', `/v1/betaBuildLocalizations/${loc.id}`, {
        data: { type: 'betaBuildLocalizations', id: loc.id, attributes: { whatsNew: NOTES } },
      });
    }
    return existing.data.map((loc) => loc.attributes?.locale);
  }

  const appLocales = await api('GET', `/v1/apps/${app.id}/betaAppLocalizations?${query({
    'fields[betaAppLocalizations]': 'locale',
    limit: '50',
  })}`);
  let locales = appLocales.data.map((loc) => loc.attributes?.locale).filter(Boolean);
  if (!locales.length) {
    const locale = app.attributes?.primaryLocale || 'es-ES';
    await api('POST', '/v1/betaAppLocalizations', {
      data: {
        type: 'betaAppLocalizations',
        attributes: { locale },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    locales = [locale];
  }
  for (const locale of locales) {
    await api('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale, whatsNew: NOTES },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
  }
  return locales;
}

// Con ITSAppUsesNonExemptEncryption = NO en Info.plist no debería pasar, pero
// si falta la declaración de cifrado nadie puede instalar el build: avisamos.
async function internalState(build) {
  try {
    const res = await api('GET', `/v1/builds/${build.id}/buildBetaDetail?${query({
      'fields[buildBetaDetails]': 'internalBuildState',
    })}`);
    return res?.data?.attributes?.internalBuildState ?? null;
  } catch {
    return null; // es solo informativo
  }
}

/* --------------------------------------------------------------- main */

async function main() {
  const missing = Object.entries({ ASC_KEY_ID: KEY_ID, ASC_ISSUER_ID: ISSUER_ID, BUNDLE_ID, BUILD_NUMBER })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`faltan variables: ${missing.join(', ')}`);
  signingKey = normalizeKey(env.ASC_PRIVATE_KEY);

  if (RAW_NOTES && NOTES !== tidy(RAW_NOTES).slice(0, 4000)) {
    warn('Saqué de las notas emojis o símbolos que TestFlight no acepta.');
  }

  const app = await findApp();
  if (!app) throw new Error(`no encuentro la app ${BUNDLE_ID} en App Store Connect`);
  const appUrl = `https://appstoreconnect.apple.com/apps/${app.id}/testflight/ios`;

  const start = Date.now();
  const deadline = start + WAIT_MS;
  const minutes = () => Math.round((Date.now() - start) / 60_000);
  let build = null;
  let shown = '';
  let shownAt = 0;
  let failures = 0;

  say(`Esperando a que Apple procese ${LABEL} (hasta ${Math.round(WAIT_MS / 60_000)} min)…`);
  for (;;) {
    try {
      build = await findBuild(app);
      failures = 0;
      const state = build?.attributes?.processingState ?? 'MISSING';
      // Un renglón cuando cambia el estado y, si no, uno cada 5 min.
      if (state !== shown || Date.now() - shownAt > 5 * 60_000) {
        say(`[${minutes()} min] ${STATES[state] ?? state}`);
        shown = state;
        shownAt = Date.now();
      }
      if (state === 'VALID') break;
      if (state === 'INVALID' || state === 'FAILED') {
        error(`Apple rechazó ${LABEL} al procesarlo (estado ${state}). El motivo llega por mail a la cuenta de desarrollador (suele empezar con «ITMS-»).`);
        summary(
          '## Apple rechazó el build',
          `**${LABEL}** se subió, pero App Store Connect lo marcó como \`${state}\` al procesarlo.`,
          'Apple manda el motivo por mail a la cuenta de desarrollador (suele empezar con «ITMS-»). ' +
            `También se ve en [App Store Connect → TestFlight](${appUrl}).`,
        );
        process.exitCode = 1;
        return;
      }
    } catch (err) {
      if (!transient(err) || ++failures >= 10) throw err;
      say(`[${minutes()} min] la API no contestó (${err.message}); reintento`);
    }

    if (Date.now() + POLL_MS > deadline) {
      warn(`Después de ${minutes()} min Apple sigue con ${LABEL} (${STATES[shown] ?? shown}). No es un error de la subida: cuando termine llega un mail.`);
      summary(
        '## Apple sigue procesando',
        `**${LABEL}** se subió bien, pero después de ${minutes()} minutos ${STATES[shown] ?? shown}. ` +
          `A veces tarda más: cuando termine llega un mail y aparece en [App Store Connect → TestFlight](${appUrl}).`,
        ...(NOTES ? ['Las notas no se cargaron: escribilas a mano en el build («Qué probar»).'] : []),
      );
      return;
    }
    await sleep(POLL_MS);
  }

  const lines = [
    '## Lista para probar en TestFlight',
    `**${LABEL}** ya está procesada. Abrila en [App Store Connect → TestFlight](${appUrl}) ` +
      'o, si sos tester interno, directo en la app TestFlight del iPhone.',
  ];

  if (NOTES) {
    try {
      const locales = await setNotes(app, build);
      say(`Notas cargadas en «Qué probar» (${locales.join(', ')}).`);
      lines.push(`«Qué probar» (${locales.join(', ')}): ${NOTES.replace(/\n/g, ' / ')}`);
    } catch (err) {
      warn(`No pude cargar las notas (${err.message}). Escribilas a mano en el build, campo «Qué probar».`);
      lines.push(`No pude cargar las notas (${err.message}): escribilas a mano en el build, campo «Qué probar».`);
    }
  }

  if ((await internalState(build)) === 'MISSING_EXPORT_COMPLIANCE') {
    warn('TestFlight pide responder la pregunta de cifrado (export compliance) antes de poder instalar el build.');
    lines.push('Falta responder la pregunta de cifrado (export compliance) en el build: sin eso no se puede instalar.');
  }

  say(`${LABEL}: lista para probar.`);
  summary(...lines);
}

main().catch((err) => {
  // Cualquier otra cosa (clave, red, la API cambió): aviso sin fallar, porque
  // la subida ya terminó bien en el trabajo anterior.
  const reason = err.message.replace(/\.+$/, '');
  const hint = err instanceof ApiError && (err.status === 401 || err.status === 403)
    ? ' Apple no aceptó la clave para consultar TestFlight.'
    : '';
  warn(`No pude seguir el procesamiento de ${LABEL}: ${reason}.${hint} La subida salió bien: revisá App Store Connect → TestFlight.`);
  summary(
    '## No pude seguir el procesamiento',
    `**${LABEL}** se subió bien, pero no pude consultar su estado (${reason}).${hint} ` +
      'Revisalo en App Store Connect → TestFlight; cuando esté listo llega un mail.',
  );
});
