/* 247WC iOS — bridge.js
   Reemplaza las APIs del navegador que dentro de la app no alcanzan o se ven
   mal (diálogos de permiso que dicen «localhost», sin vibración, sin bloqueo
   de pantalla, links que se abren adentro del WebView) por los plugins
   nativos. El contrato completo está en docs/NATIVE-API.md.

   Script clásico: corre antes que app.js (módulo, se ejecuta al final del
   parseo), así app.js ya encuentra todo reemplazado. En un navegador común
   (Capacitor.isNativePlatform() falso) no toca nada.

   Cada reemplazo va aislado en su try/catch: si uno falla, los demás siguen
   y la app arranca igual. Nunca tira errores al cargar. */

(() => {
  'use strict';

  // Nuestra API (función de Vercel). Desde la app, fetch('/api/…') apuntaría a
  // capacitor://localhost, y la función no manda CORS: el pedido va por HTTP
  // nativo (CapacitorHttp), que no lo necesita.
  const API_BASE = 'https://247-wc.vercel.app';

  const Cap = window.Capacitor;
  let isNative = false;
  try { isNative = Boolean(Cap?.isNativePlatform?.()); } catch { /* sin Capacitor */ }
  if (!isNative || typeof Cap.registerPlugin !== 'function') return;

  const TAG = '[247WC nativo]';
  const safe = (name, fn) => {
    try { fn(); } catch (err) { console.warn(TAG, name, err); }
  };
  // Llamadas que no esperan respuesta: sin catch, un rechazo llega a
  // 'unhandledrejection' y index.html muestra la pantalla de error fatal.
  const fire = (promise, what) => {
    Promise.resolve(promise).catch((err) => console.warn(TAG, what, err));
  };
  // Los callbacks de la web se llaman como lo haría el navegador: si tiran un
  // error, que aparezca como error de la página, no que se pierda acá.
  const call = (fn, arg) => {
    if (typeof fn !== 'function') return;
    try { fn(arg); } catch (err) { setTimeout(() => { throw err; }); }
  };
  const onReady = (fn) => {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  };

  // capacitor.js ya registra CapacitorHttp y SystemBars; registrarlos de nuevo
  // solo dispara un aviso, así que usamos los suyos.
  const exportsCap = window.capacitorExports || {};
  const plugin = (name) => exportsCap[name] || Cap.registerPlugin(name);
  let WCNative, Haptics, Browser, SplashScreen, Http, SystemBars;
  try {
    WCNative = Cap.registerPlugin('WCNative');
    Haptics = Cap.registerPlugin('Haptics');
    Browser = Cap.registerPlugin('Browser');
    SplashScreen = Cap.registerPlugin('SplashScreen');
    Http = plugin('CapacitorHttp');
    SystemBars = plugin('SystemBars');
  } catch (err) {
    console.warn(TAG, 'no se pudieron registrar los plugins', err);
    return;
  }

  const define = (obj, key, value) => {
    Object.defineProperty(obj, key, { value, configurable: true, writable: true, enumerable: true });
  };

  safe('clases', () => document.documentElement.classList.add('native', 'native-ios'));

  // La app es solo para iPhone, pero en un iPad con trackpad corre en modo
  // compatible y matchMedia('(hover: hover) and (pointer: fine)') puede dar
  // verdadero: lang.js creería que es una compu (QR en vez de brújula, textos
  // de «hacé clic»). En la app siempre es un teléfono.
  safe('matchMedia', () => {
    const original = window.matchMedia;
    if (typeof original !== 'function') return;
    const MOUSE_QUERY = /\(\s*hover\s*:\s*hover\s*\)[\s\S]*\(\s*pointer\s*:\s*fine\s*\)/;
    define(window, 'matchMedia', function matchMedia(query) {
      const mql = original.call(window, query);
      if (!MOUSE_QUERY.test(String(query))) return mql;
      return {
        matches: false, media: mql.media, onchange: null,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
      };
    });
  });

  // capacitor:// puede no contar como contexto seguro, y app.js lo exige antes
  // de pedir la ubicación (en la app la ubicación es nativa, no del WebView).
  safe('isSecureContext', () => {
    if (!window.isSecureContext) Object.defineProperty(window, 'isSecureContext', { get: () => true, configurable: true });
  });

  /* ------------------------------------------------------- ubicación */

  // Mismos números que GeolocationPositionError.
  const GEO = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
  // Códigos (string) con los que rechaza el plugin → código de la web.
  const NATIVE_CODES = { PERMISSION_DENIED: 1, SERVICES_DISABLED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };

  const geoError = (code, message) => ({ code, message: message || '', ...GEO });

  // Un rechazo nativo llega como Error con .code (el string de call.reject) y
  // .message; un evento locationError trae { code, message } plano.
  const toGeoError = (err) => {
    const raw = err?.code;
    const code = NATIVE_CODES[raw] ?? (raw === 1 || raw === 2 || raw === 3 ? raw : GEO.POSITION_UNAVAILABLE);
    return geoError(code, err?.message || err?.errorMessage || String(raw || ''));
  };

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const toPosition = (p) => {
    const c = p?.coords || {};
    const coords = {
      latitude: num(c.latitude), longitude: num(c.longitude), accuracy: num(c.accuracy) ?? 0,
      altitude: num(c.altitude), altitudeAccuracy: num(c.altitudeAccuracy),
      heading: num(c.heading), speed: num(c.speed),
    };
    return { coords, timestamp: num(p?.timestamp) ?? Date.now() };
  };
  const validPosition = (pos) => pos.coords.latitude != null && pos.coords.longitude != null;

  // Si el permiso no está decidido, primero el diálogo del sistema (sin
  // apuro: la persona puede tardar en leerlo) y recién después la posición
  // con su timeout. Si no, el reloj de seguridad podría cortar con el
  // diálogo todavía abierto.
  async function ensurePermission() {
    let status;
    try { status = await WCNative.getLocationStatus(); } catch { return; }   // que decida getCurrentPosition
    if (status?.permission !== 'prompt') return;
    const after = await WCNative.requestLocationPermission();
    if (after?.permission === 'denied') throw geoError(GEO.PERMISSION_DENIED, 'denied');
  }

  function getCurrentPosition(success, error, options = {}) {
    const opts = { enableHighAccuracy: Boolean(options?.enableHighAccuracy) };
    const timeout = num(options?.timeout);
    const maximumAge = num(options?.maximumAge);
    if (timeout != null) opts.timeout = Math.max(0, timeout);
    if (maximumAge != null) opts.maximumAge = Math.max(0, maximumAge);

    let done = false;
    let timer = null;
    const finish = (ok, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      call(ok ? success : error, value);
    };

    ensurePermission()
      .then(() => {
        if (done) return;
        // Reloj de seguridad en JS por si el lado nativo nunca contesta.
        timer = setTimeout(() => finish(false, geoError(GEO.TIMEOUT, 'timeout')), (opts.timeout ?? 20000) + 3000);
        return WCNative.getCurrentPosition(opts).then((p) => {
          const pos = toPosition(p);
          if (validPosition(pos)) finish(true, pos);
          else finish(false, geoError(GEO.POSITION_UNAVAILABLE, 'sin coordenadas'));
        });
      })
      .catch((err) => finish(false, toGeoError(err)));
  }

  // Varios watchPosition comparten un solo startLocationUpdates y un solo par
  // de listeners; clearWatch del último apaga las actualizaciones.
  const watchers = new Map();
  let watchSeq = 0;
  let updatesOn = false;
  let listenersReady = null;

  function attachLocationListeners() {
    listenersReady ??= Promise.all([
      WCNative.addListener('locationUpdate', (data) => {
        if (!data) return;
        const pos = toPosition(data);
        if (!validPosition(pos)) return;
        for (const w of [...watchers.values()]) call(w.success, pos);
      }),
      WCNative.addListener('locationError', (data) => {
        if (!data) return;
        const err = toGeoError(data);
        for (const w of [...watchers.values()]) call(w.error, err);
      }),
    ]).catch((err) => { listenersReady = null; throw err; });
    return listenersReady;
  }

  function startUpdates(enableHighAccuracy) {
    if (updatesOn) return;
    updatesOn = true;
    attachLocationListeners()
      .then(() => (updatesOn ? WCNative.startLocationUpdates({ enableHighAccuracy }) : null))
      .catch((err) => {
        updatesOn = false;   // el próximo watchPosition lo vuelve a intentar
        const e = toGeoError(err);
        for (const w of [...watchers.values()]) call(w.error, e);
      });
  }

  function watchPosition(success, error, options = {}) {
    const id = ++watchSeq;
    watchers.set(id, { success, error });
    startUpdates(Boolean(options?.enableHighAccuracy));
    return id;
  }

  function clearWatch(id) {
    if (!watchers.delete(Number(id))) return;
    if (watchers.size === 0 && updatesOn) {
      updatesOn = false;
      fire(WCNative.stopLocationUpdates(), 'stopLocationUpdates');
    }
  }

  safe('geolocation', () => {
    const geo = { getCurrentPosition, watchPosition, clearWatch };
    if (navigator.geolocation) {
      for (const [k, fn] of Object.entries(geo)) define(navigator.geolocation, k, fn);
    } else {
      Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
    }
  });

  // permissions.query({ name: 'geolocation' }) sale del permiso nativo; app.js
  // lo usa al arrancar para escanear solo si ya lo diste.
  safe('permissions', () => {
    const perms = navigator.permissions;
    const original = perms?.query ? perms.query.bind(perms) : null;
    const status = (state) => ({
      state, name: 'geolocation', onchange: null,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    });
    const query = (desc) => {
      if (desc?.name === 'geolocation') {
        return WCNative.getLocationStatus()
          .then((s) => status(['granted', 'denied', 'prompt'].includes(s?.permission) ? s.permission : 'prompt'))
          .catch(() => status('prompt'));
      }
      return original ? original(desc) : Promise.reject(new TypeError('permissions.query no disponible'));
    };
    if (perms) define(perms, 'query', query);
    else Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true });
  });

  /* ------------------------------------------------------- brújula */

  // app.js pide permiso con DeviceOrientationEvent.requestPermission() y
  // escucha 'deviceorientation' leyendo webkitCompassHeading, como en Safari.
  // Acá cada lectura de CoreLocation se despacha como ese mismo evento.
  let headingWanted = false;   // la web la pidió
  let headingOn = false;       // está corriendo en nativo
  let headingListener = null;

  function onHeading(data) {
    const heading = num(data?.heading);
    if (heading == null) return;
    // Precisión negativa = iOS no pudo determinar el rumbo (brújula sin
    // calibrar): mejor no mover la flecha que apuntar para cualquier lado.
    if ((num(data?.accuracy) ?? 0) < 0) return;
    const ev = new Event('deviceorientation');
    Object.defineProperty(ev, 'webkitCompassHeading', { value: heading });
    Object.defineProperty(ev, 'webkitCompassAccuracy', { value: num(data?.accuracy) ?? -1 });
    Object.defineProperty(ev, 'absolute', { value: false });
    Object.defineProperty(ev, 'alpha', { value: null });
    Object.defineProperty(ev, 'beta', { value: null });
    Object.defineProperty(ev, 'gamma', { value: null });
    window.dispatchEvent(ev);
  }

  async function startHeading() {
    headingListener ??= WCNative.addListener('heading', onHeading).catch((err) => { headingListener = null; throw err; });
    await headingListener;
    const res = await WCNative.startHeading();
    headingOn = true;
    return res;
  }

  safe('brújula', () => {
    if (typeof window.DeviceOrientationEvent === 'undefined') return;
    let request = null;   // un solo arranque aunque la web pida varias veces
    define(window.DeviceOrientationEvent, 'requestPermission', () => {
      request ??= (async () => {
        headingWanted = true;
        try {
          const res = await startHeading();
          if (res?.available === false) {
            // Sin magnetómetro: la guía ya explica que la flecha usa el norte del mapa.
            headingWanted = false;
            headingOn = false;
            request = null;
            return 'denied';
          }
          return 'granted';
        } catch (err) {
          headingWanted = false;
          request = null;
          throw err;   // app.js muestra «Activar brújula» para reintentar
        }
      })();
      return request;
    });
  });

  /* ------------------------------------------- bloqueo de pantalla */

  // navigator.wakeLock → UIApplication.isIdleTimerDisabled. Como en el
  // navegador, un sentinel por pedido; la pantalla se apaga sola de nuevo
  // cuando no queda ninguno activo.
  const active = new Map();   // sentinel → sus listeners de 'release'
  let keepAwake = false;

  function setKeepAwake(enabled) {
    keepAwake = enabled;
    return WCNative.setKeepAwake({ enabled });
  }

  function drop(sentinel) {
    const listeners = active.get(sentinel) || [];
    active.delete(sentinel);
    sentinel.released = true;
    const ev = { type: 'release', target: sentinel };
    call(sentinel.onrelease, ev);
    for (const fn of listeners) call(fn, ev);
  }

  function makeSentinel() {
    const listeners = new Set();
    const sentinel = {
      released: false,
      type: 'screen',
      onrelease: null,
      addEventListener(type, fn) { if (type === 'release' && typeof fn === 'function') listeners.add(fn); },
      removeEventListener(type, fn) { listeners.delete(fn); },
      // Nunca rechaza: app.js lo llama sin await.
      async release() {
        if (sentinel.released) return;
        drop(sentinel);
        if (active.size === 0 && keepAwake) {
          try { await setKeepAwake(false); } catch (err) { console.warn(TAG, 'setKeepAwake(false)', err); }
        }
      },
    };
    active.set(sentinel, listeners);
    return sentinel;
  }

  safe('wakeLock', () => {
    const wakeLock = {
      async request(type = 'screen') {
        if (type !== 'screen') throw new TypeError(`wakeLock: tipo no soportado «${type}»`);
        // app.js lo pide recién cuando llega la ruta: si la guía se cerró antes,
        // el pedido llega tarde y la pantalla quedaría prendida sin guía.
        if (document.getElementById('guide')?.hidden === true) {
          const late = makeSentinel();
          drop(late);
          return late;
        }
        // El sentinel cuenta como activo desde ya, no recién cuando contesta
        // el nativo: si no, el chequeo al volver a primer plano lo vería vacío.
        const sentinel = makeSentinel();
        try {
          await setKeepAwake(true);
        } catch (err) {
          active.delete(sentinel);
          sentinel.released = true;
          throw err;
        }
        return sentinel;
      },
    };
    Object.defineProperty(navigator, 'wakeLock', { value: wakeLock, configurable: true });

    // En el navegador, ocultar la página suelta los sentinels y app.js pide
    // uno nuevo al volver (si sigue guiando). Lo imitamos para no dejar
    // sentinels huérfanos que mantengan la pantalla prendida para siempre,
    // pero sin tocar el nativo al ocultarse: el bloqueo sigue hasta un
    // release(). Al volver, si nadie pidió uno nuevo, lo apagamos.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        for (const s of [...active.keys()]) drop(s);
      } else {
        setTimeout(() => {
          if (active.size === 0 && keepAwake) fire(setKeepAwake(false), 'setKeepAwake(false)');
        }, 0);
      }
    });
  });

  /* ------------------------------------------------------- vibración */

  // navigator.vibrate no existe en iOS: lo traducimos a Haptics. Un patrón
  // (llegaste) es una notificación de éxito; un toque suelto, un golpe según
  // la duración.
  safe('vibrate', () => {
    define(navigator, 'vibrate', (pattern) => {
      try {
        if (Array.isArray(pattern)) {
          if (pattern.some((ms) => Number(ms) > 0)) fire(Haptics.notification({ type: 'SUCCESS' }), 'haptics');
          return true;
        }
        const ms = Number(pattern);
        if (!(ms > 0)) return true;   // 0 cancela: no hay nada que cancelar
        const style = ms <= 15 ? 'LIGHT' : ms <= 25 ? 'MEDIUM' : 'HEAVY';
        fire(Haptics.impact({ style }), 'haptics');
      } catch (err) { console.warn(TAG, 'vibrate', err); }
      return true;
    });
  });

  /* ------------------------------------------------------- links */

  const toUrl = (u) => { try { return new URL(String(u), location.href); } catch { return null; } };
  const isExternal = (u) => u && /^https?:$/.test(u.protocol) && !(u.protocol === location.protocol && u.host === location.host);

  // https://www.google.com/maps/dir/?api=1&destination=LAT,LNG… → { latitude, longitude }
  function directionsTarget(u) {
    if (!/^(www\.)?google\.[a-z.]+$|^maps\.google\.[a-z.]+$/.test(u.hostname)) return null;
    if (!u.pathname.startsWith('/maps/dir')) return null;
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(u.searchParams.get('destination') || '');
    if (!m) return null;
    const latitude = Number(m[1]), longitude = Number(m[2]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { latitude, longitude };
  }

  // Safari dentro de la app (SFSafariViewController); las rutas, en la app de
  // mapas (Google Maps si está instalada, si no Mapas de Apple).
  function openExternal(u) {
    const dest = directionsTarget(u);
    if (dest) {
      fire(WCNative.openDirections(dest).catch(() => Browser.open({ url: u.href })), 'openDirections');
    } else {
      fire(Browser.open({ url: u.href }), 'Browser.open');
    }
  }

  safe('window.open', () => {
    const original = window.open;
    define(window, 'open', function open(url, ...rest) {
      const u = url == null ? null : toUrl(url);
      if (isExternal(u)) {
        openExternal(u);
        return null;
      }
      return original.call(window, url, ...rest);
    });
  });

  // Links comunes (créditos de OpenStreetMap y Refuge, etc.): en captura, antes
  // de que el WebView intente navegar.
  safe('links', () => {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      const a = e.target?.closest?.('a[href^="http"]');
      if (!a) return;
      const u = toUrl(a.href);
      if (!isExternal(u)) return;
      e.preventDefault();
      openExternal(u);
    }, true);
  });

  // El botón «Abrir Ajustes» de los textos de permiso negado (native/text.js).
  safe('ajustes', () => {
    document.addEventListener('click', (e) => {
      const btn = e.target?.closest?.('[data-native-action="settings"]');
      if (!btn) return;
      e.preventDefault();
      fire(WCNative.openSettings(), 'openSettings');
    });
  });

  /* ------------------------------------------------------- fetch /api */

  const NULL_BODY = new Set([101, 103, 204, 205, 304]);

  async function apiFetch(u, input, init) {
    const req = input instanceof Request ? input : null;
    const method = String(init?.method || req?.method || 'GET').toUpperCase();
    const headers = {};
    new Headers(init?.headers || req?.headers || undefined).forEach((v, k) => { headers[k] = v; });
    const opts = {
      url: API_BASE + u.pathname + u.search,
      method,
      headers,
      responseType: 'text',
      connectTimeout: 15000,
      readTimeout: 15000,
    };
    if (typeof init?.body === 'string') opts.data = init.body;

    let res;
    try {
      res = await Http.request(opts);
    } catch (err) {
      // Igual que fetch ante un error de red: TypeError. app.js cae a Overpass.
      throw new TypeError(`Load failed (${err?.message || err})`);
    }
    const status = Number(res?.status) || 0;
    if (status < 200 || status > 599) throw new TypeError(`Load failed (HTTP ${status})`);
    // Con Content-Type JSON el plugin ya devuelve el objeto parseado.
    let body = res.data;
    if (body == null) body = '';
    else if (typeof body !== 'string') body = JSON.stringify(body);
    const out = new Headers();
    for (const [k, v] of Object.entries(res.headers || {})) {
      try { out.set(k, Array.isArray(v) ? v.join(', ') : String(v)); } catch { /* cabecera inválida */ }
    }
    return new Response(NULL_BODY.has(status) ? null : body, { status, headers: out });
  }

  safe('fetch', () => {
    const original = window.fetch;
    if (typeof original !== 'function') return;
    define(window, 'fetch', function fetch(input, init) {
      const u = toUrl(input instanceof Request ? input.url : input);
      if (u && u.protocol === location.protocol && u.host === location.host && u.pathname.startsWith('/api/')) {
        return apiFetch(u, input, init);
      }
      return original.call(window, input, init);
    });
  });

  /* ------------------------------------------------------- barra de estado */

  // Tema oscuro → texto claro ('DARK'); claro → texto oscuro ('LIGHT').
  safe('barra de estado', () => {
    let last = null;
    const sync = () => {
      const theme = document.documentElement.dataset.theme;
      if (theme !== 'dark' && theme !== 'light') return;
      const style = theme === 'dark' ? 'DARK' : 'LIGHT';
      if (style === last) return;
      last = style;
      fire(SystemBars.setStyle({ style }), 'SystemBars.setStyle');
    };
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    sync();
    onReady(sync);
  });

  /* ------------------------------------------------------- splash */

  // Se va apenas la app arrancó (o mostró su pantalla de error); a los 4 s
  // se va igual, para no quedar nunca tapando todo.
  safe('splash', () => {
    let hidden = false;
    const started = Date.now();
    const hide = () => {
      if (hidden) return;
      hidden = true;
      fire(SplashScreen.hide({ fadeOutDuration: 250 }), 'SplashScreen.hide');
    };
    const poll = setInterval(() => {
      if (window.WC?.ready || document.getElementById('fatal') || Date.now() - started >= 4000) {
        clearInterval(poll);
        hide();
      }
    }, 50);
  });

  /* ------------------------------------------------------- ícono de mapas */

  // Los botones de ruta usan el pin de colores de Google Maps, pero en la app
  // abren Mapas de Apple si Google Maps no está instalado: va un ícono neutro
  // de «indicaciones» (rombo azul con flecha de giro) en el mismo símbolo.
  safe('ícono de mapas', () => {
    onReady(() => safe('ícono de mapas', () => {
      const symbol = document.getElementById('i-gmaps');
      if (!symbol) return;
      symbol.innerHTML =
        '<path d="M10.59 2.91a2 2 0 0 1 2.82 0l7.68 7.68a2 2 0 0 1 0 2.82l-7.68 7.68a2 2 0 0 1-2.82 0L2.91 13.41a2 2 0 0 1 0-2.82Z" fill="#0a6cff" stroke="none"/>' +
        '<path d="M9.2 15.6v-2.8a2 2 0 0 1 2-2h4.3" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="m13.4 8.4 2.4 2.4-2.4 2.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }));
  });

  /* ------------------------------------------------------- modal de info */

  // «Instalar → Compartir → Agregar a inicio» no aplica en la app.
  safe('fila instalar', () => {
    onReady(() => safe('fila instalar', () => {
      const row = document.querySelector('[data-i18n="installHow"]')?.closest('.row');
      if (row) row.hidden = true;
    }));
  });

  // El estilo del mapa (OpenFreeMap, basado en OpenMapTiles, CC-BY) pide
  // atribución, y el mapa tiene el control de atribución apagado: va en la
  // fila «Datos» del modal de info, junto a las fuentes de los baños.
  safe('atribución del mapa', () => {
    onReady(() => safe('atribución del mapa', () => {
      const value = document.querySelector('[data-i18n="dataSources"]')?.closest('.row')?.querySelector('.row-value');
      if (value && !/OpenMapTiles/.test(value.textContent)) value.textContent += ' · OpenFreeMap © OpenMapTiles';
    }));
  });

  /* ------------------------------------------------------- acceso directo */

  // «Baño más cercano» desde el ícono: mismo camino que el acceso directo de
  // la PWA (index.html?urgent=1). Si ya estamos en modo urgente, no recargamos
  // (getLaunchAction se consume en nativo, pero mejor no arriesgar un bucle).
  //
  // Arranque en frío: la página recién cargada no tiene ?urgent, así que
  // recargamos con él (getLaunchAction se consume: no hay bucle). Con la app
  // abierta, cada toque del acceso directo vuelve a escanear aunque ya esté en
  // modo urgente (el evento llega una sola vez).
  safe('acceso directo', () => {
    let going = false;
    const urgent = (force) => {
      if (going) return;
      if (!force && new URLSearchParams(location.search).has('urgent')) return;
      going = true;
      location.replace(`index.html?urgent=1${force ? `&t=${Date.now()}` : ''}`);
    };
    fire(WCNative.addListener('launchAction', (data) => { if (data?.action === 'urgent') urgent(true); }), 'launchAction');
    fire(WCNative.getLaunchAction().then((data) => { if (data?.action === 'urgent') urgent(false); }), 'getLaunchAction');
  });

  /* ------------------------------------------- app en segundo plano */

  // La brújula gasta batería: se apaga al salir de la app y vuelve al entrar,
  // solo si la web la había pedido.
  safe('visibilidad', () => {
    document.addEventListener('visibilitychange', () => {
      if (!headingWanted) return;
      if (document.visibilityState === 'hidden') {
        if (headingOn) {
          headingOn = false;
          fire(WCNative.stopHeading(), 'stopHeading');
        }
      } else if (!headingOn) {
        fire(startHeading(), 'startHeading');
      }
    });
  });
})();
