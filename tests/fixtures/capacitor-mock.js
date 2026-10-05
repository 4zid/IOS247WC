/* Mock de la capa nativa de Capacitor para las pruebas E2E (tests/bridge.e2e.mjs).

   Imita lo que en el iPhone inyecta native-bridge.js antes que cualquier
   script de la página: window.webkit.messageHandlers.bridge (así capacitor.js
   detecta 'ios'), window.Capacitor con nativePromise / nativeCallback y
   PluginHeaders armados como JSExport.swift (addListener y removeListener sin
   rtype → nativeCallback; el resto 'promise' → nativePromise).

   Los rechazos tienen la forma que deja native-bridge.js (returnResult): un
   Error con .message, .errorMessage y .code = el string de call.reject().

   La configuración llega en window.__MOCK_CONFIG__ (otro init script, antes
   que este). Para la prueba expone window.__mock: llamadas registradas,
   respuestas configurables y emit(plugin, evento, datos). Lo que tiene que
   sobrevivir a una navegación (acción de inicio consumida, historial de
   llamadas) va en sessionStorage, como el estado del lado nativo. */

(() => {
  const cfg = Object.assign({
    permission: 'prompt',            // getLocationStatus().permission
    permissionAfterRequest: 'granted',
    servicesEnabled: true,
    position: { latitude: -34.6037, longitude: -58.3816, accuracy: 12 },
    positionError: null,             // p. ej. 'PERMISSION_DENIED' → getCurrentPosition rechaza
    headingAvailable: true,
    launchAction: null,              // 'urgent' → getLaunchAction lo devuelve una vez
    http: null,                      // { status, headers, data } para CapacitorHttp.request
    httpError: null,                 // mensaje → CapacitorHttp.request rechaza (error de red)
    hang: [],                        // métodos que nunca contestan (p. ej. 'getCurrentPosition')
    delay: 5,                        // ms de «ida y vuelta» al nativo
  }, window.__MOCK_CONFIG__ || {});

  const PROMISE_METHODS = {
    WCNative: ['getLocationStatus', 'requestLocationPermission', 'getCurrentPosition', 'startLocationUpdates',
      'stopLocationUpdates', 'startHeading', 'stopHeading', 'setKeepAwake', 'openDirections', 'openSettings',
      'getLaunchAction'],
    Haptics: ['impact', 'notification', 'selectionStart', 'selectionChanged', 'selectionEnd', 'vibrate'],
    Browser: ['open', 'close'],
    SplashScreen: ['show', 'hide'],
    SystemBars: ['setStyle', 'setAnimation', 'show', 'hide'],
    CapacitorHttp: ['request', 'get', 'post', 'put', 'patch', 'delete'],
  };

  // Igual que JSExport.createPluginHeader: rtype nil se omite al codificar.
  const PluginHeaders = Object.entries(PROMISE_METHODS).map(([name, methods]) => ({
    name,
    methods: [
      { name: 'addListener' },
      { name: 'removeListener' },
      { name: 'removeAllListeners', rtype: 'promise' },
      { name: 'checkPermissions', rtype: 'promise' },
      { name: 'requestPermissions', rtype: 'promise' },
      ...methods.map((m) => ({ name: m, rtype: 'promise' })),
    ],
  }));

  const ss = {
    get(k, d) { try { const v = sessionStorage.getItem('__mock:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { sessionStorage.setItem('__mock:' + k, JSON.stringify(v)); } catch { /* nada */ } },
  };

  const calls = [];
  const listeners = new Map();   // 'Plugin:evento' → [{ id, cb }]
  let seq = 0;
  const start = performance.now();

  const clone = (v) => { try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } catch { return String(v); } };
  function record(plugin, method, options) {
    const c = { plugin, method, options: clone(options), t: Math.round(performance.now() - start), page: location.pathname + location.search };
    calls.push(c);
    ss.set('calls', [...ss.get('calls', []), c]);
    return c;
  }

  const nativeError = (message, code) => Object.assign(new Error(message), { message, errorMessage: message, code });
  const status = () => ({ permission: cfg.permission, servicesEnabled: cfg.servicesEnabled, precise: true });

  function respond(plugin, method, o = {}) {
    const key = `${plugin}.${method}`;
    switch (key) {
      case 'WCNative.getLocationStatus': return status();
      case 'WCNative.requestLocationPermission':
        if (cfg.permission === 'prompt') cfg.permission = cfg.permissionAfterRequest;
        return status();
      case 'WCNative.getCurrentPosition': {
        if (cfg.permission === 'prompt') cfg.permission = cfg.permissionAfterRequest;
        if (cfg.positionError) throw nativeError('Ubicación no disponible (mock)', cfg.positionError);
        if (cfg.permission === 'denied') throw nativeError('Permiso negado (mock)', 'PERMISSION_DENIED');
        return position();
      }
      case 'WCNative.startLocationUpdates':
        if (cfg.permission !== 'granted') throw nativeError('Sin permiso (mock)', 'PERMISSION_DENIED');
        return {};
      case 'WCNative.startHeading': return { available: cfg.headingAvailable };
      case 'WCNative.openDirections': return { app: 'apple' };
      case 'WCNative.getLaunchAction': {
        const action = ss.get('launchConsumed', false) ? null : cfg.launchAction;
        ss.set('launchConsumed', true);
        return { action: action || null };
      }
      case 'CapacitorHttp.request': {
        if (cfg.httpError) throw nativeError(cfg.httpError, 'NSURLErrorDomain');
        const r = cfg.http || { status: 200, headers: {}, data: '' };
        return { status: r.status, headers: r.headers || {}, data: clone(r.data), url: o.url };
      }
      default: return {};
    }
  }

  function position() {
    const p = cfg.position;
    return {
      timestamp: Date.now(),
      coords: {
        latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy ?? 10,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
      },
    };
  }

  const nativePromise = (plugin, method, options) => {
    record(plugin, method, options);
    return new Promise((resolve, reject) => {
      if (cfg.hang.includes(method)) return;   // el nativo nunca contesta
      setTimeout(() => {
        try { resolve(respond(plugin, method, options || {})); } catch (err) { reject(err); }
      }, cfg.delay);
    });
  };

  const nativeCallback = (plugin, method, options, callback) => {
    record(plugin, method, options);
    const id = String(++seq);
    if (method === 'addListener') {
      const k = `${plugin}:${options?.eventName}`;
      listeners.set(k, [...(listeners.get(k) || []), { id, cb: callback }]);
    } else if (method === 'removeListener') {
      const k = `${plugin}:${options?.eventName}`;
      listeners.set(k, (listeners.get(k) || []).filter((l) => l.id !== options?.callbackId));
    }
    return id;
  };

  window.webkit = { messageHandlers: { bridge: { postMessage() {} } } };
  window.Capacitor = {
    DEBUG: false,
    isLoggingEnabled: false,
    Plugins: {},
    PluginHeaders,
    nativePromise,
    nativeCallback,
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  };

  window.__mock = {
    config: cfg,
    calls,
    allCalls: () => ss.get('calls', []),
    find: (plugin, method) => calls.filter((c) => c.plugin === plugin && c.method === method),
    listenerCount: (plugin, event) => (listeners.get(`${plugin}:${event}`) || []).length,
    // Como notifyListeners en nativo: cada callback recibe los datos.
    emit(plugin, event, data) {
      const ls = listeners.get(`${plugin}:${event}`) || [];
      for (const l of ls) l.cb(clone(data));
      return ls.length;
    },
  };
})();
