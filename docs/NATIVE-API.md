# Contrato entre la web y la capa nativa

La app iOS es la web app de `web/` empaquetada con Capacitor 8. La web **no se
modifica a mano**: `scripts/build-web.mjs` la copia a `www/`, le inyecta la capa
nativa (`native/`) y aplica diez parches chicos y verificados. La capa nativa
reemplaza las APIs del navegador que en una app no alcanzan o se ven mal
(diálogos de permiso con «localhost», sin vibración, sin bloqueo de pantalla,
links que salen a Safari).

```
web/            copia de 4zid/247wc (index.html, app.js, lang.js, styles.css…)
native/         capa nativa en JS, se inyecta en www/index.html
  capacitor.js  (lo copia el build desde node_modules/@capacitor/core/dist/capacitor.js)
  text.js       window.WC_NATIVE_TEXT: textos que cambian en la app (es/en)
  bridge.js     shims de APIs del navegador → plugins nativos
  native.css    retoques mínimos de estilo para la app
ios/App/App/    proyecto Xcode
  WCNativePlugin.swift   plugin propio «WCNative» (ubicación, brújula, mapas…)
  MainViewController.swift  subclase de CAPBridgeViewController que lo registra
  SceneDelegate.swift    acceso directo «Urgente» del ícono
```

## Orden de carga en `www/index.html`

Justo después de `<meta name="viewport">`, en este orden y como scripts
clásicos (sin `type="module"`, sin `defer`), para que corran antes que
`app.js` (módulo, se ejecuta al final del parseo):

```html
<link rel="stylesheet" href="native/native.css" />
<script src="native/capacitor.js"></script>
<script src="native/text.js"></script>
<script src="native/bridge.js"></script>
```

En el dispositivo, Capacitor inyecta `native-bridge.js` al inicio del documento
(define `window.Capacitor` con `nativePromise`, `nativeCallback` y
`PluginHeaders`). `capacitor.js` (el bundle de `@capacitor/core`) le agrega
`registerPlugin`. `bridge.js` usa `Capacitor.registerPlugin(nombre)`.

Si `Capacitor.isNativePlatform()` es falso (abrir `www/` en un navegador),
`bridge.js` no toca nada.

## Parches del build (todos verificados: si el ancla no aparece exactamente una vez, el build falla)

Son diez, en `PATCHES` de `scripts/build-web.mjs`. Se aplican en memoria: si
uno falla, `www/` queda como estaba.

`index.html` (7):

1. Insertar el bloque de arriba después de la etiqueta `<meta name="viewport" …>`.
2. Reemplazar el `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter…" …/>`
   (ocupa dos líneas) por un `<style>` con `@font-face` local
   (`fonts/inter.woff2`, `font-weight: 100 900`, `font-display: swap`).
3. Quitar el `<link rel="preconnect">` a `fonts.googleapis.com`.
4. Quitar el `<link rel="preconnect">` a `fonts.gstatic.com`.
5. Quitar `<link rel="manifest" …>` (no hay PWA dentro de la app).
6. Quitar `<link rel="icon" href="icons/…">` (`icons/` no se copia: el ícono lo pone Xcode).
7. Quitar `<link rel="apple-touch-icon" …>`.

`lang.js` (1):

8. En `t()`, la línea
   `const v = (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;`
   pasa a
   `const v = globalThis.WC_NATIVE_TEXT?.[LANG]?.[key] ?? (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;`

`app.js` (2), para el respaldo directo a Overpass desde el teléfono (solo
cuando `/api/toilets` falla o contesta `parcial`). Así la posición exacta
solo sale hacia el servicio de rutas (Valhalla u OSRM), como dice la política:

9. Quitar de `CFG.overpass` la línea del espejo
   `'https://maps.mail.ru/osm/tools/overpass/api/interpreter',` (VK, Rusia).
   Quedan `overpass-api.de`, `overpass.kumi.systems` y `overpass.private.coffee`.
10. En `overpassDirect`, `const query = overpassQuery(center, radius);` pasa a
    `const query = overpassQuery({ lat: snap(center.lat), lng: snap(center.lng) }, radius + 250);`:
    el mismo punto redondeado a ~250 m (y el mismo margen de radio) que va a la API.

El build además verifica que todo `href`/`src` local de `www/index.html`
exista en `www/`.

Archivos que se copian a `www/`: `index.html`, `app.js`, `lang.js`,
`styles.css`, `favicon.svg`, `brand/logo/*.svg`, `vendor/**`, `fonts/inter.woff2`
y `native/*` (más `native/capacitor.js`). No van `sw.js`, `manifest.webmanifest`,
la landing ni `api/`.

## Plugin nativo `WCNative`

`jsName = "WCNative"`, `identifier = "WCNativePlugin"`. Se registra en
`MainViewController.capacitorDidLoad()` con
`bridge?.registerPluginInstance(WCNativePlugin())`.

Capacitor llama a los métodos de los plugins en una cola de fondo: todo lo que
toque `CLLocationManager`, `UIApplication` o UIKit va en `DispatchQueue.main`.
`CLLocationManager.locationServicesEnabled()` se consulta fuera del hilo
principal (Apple avisa que puede trabar la interfaz).

Errores: `call.reject(mensaje, código)` con estos códigos (string):

| código | cuándo | en JS (`GeolocationPositionError.code`) |
|---|---|---|
| `PERMISSION_DENIED` | el usuario negó o el permiso está restringido | 1 |
| `SERVICES_DISABLED` | Localización apagada en todo el sistema | 1 |
| `POSITION_UNAVAILABLE` | CoreLocation falló (no `locationUnknown`, que es transitorio) | 2 |
| `TIMEOUT` | no llegó una posición dentro de `timeout` | 3 |

### Métodos (todos devuelven promesa)

| método | argumentos | resuelve con |
|---|---|---|
| `getLocationStatus` | — | `{ permission: 'granted'\|'denied'\|'prompt', servicesEnabled: boolean, precise: boolean }` |
| `requestLocationPermission` | — | igual que arriba, **después** de que la persona contesta el diálogo del sistema (si ya había decidido, al instante). Pide «Al usar la app» (`requestWhenInUseAuthorization`). |
| `getCurrentPosition` | `{ enableHighAccuracy?: boolean, timeout?: number /*ms, def 20000*/, maximumAge?: number /*ms, def 0*/ }` | `Position` (abajo). Si el permiso no está decidido, lo pide primero y espera; **el `timeout` empieza a correr recién cuando la persona contestó el diálogo** (leerlo no cuenta). Si `manager.location` es válida (`horizontalAccuracy >= 0`) y tiene menos de `maximumAge` ms, la devuelve sin esperar. Si la precisión es «aproximada» (`accuracyAuthorization == .reducedAccuracy`) pide precisión completa temporal con la clave `NearestToilet` (una vez por uso de la app; no espera la respuesta). |
| `startLocationUpdates` | `{ enableHighAccuracy?: boolean }` | `{}` al arrancar. Las posiciones llegan por el evento `locationUpdate` (nunca una cacheada de más de **10 s**: CoreLocation suele mandar primero la última que tenía guardada); los errores por `locationError`. Si no hay permiso, rechaza con el código que corresponda (no pide permiso: eso lo hace `getCurrentPosition`, que la web siempre llama primero). Llamarlo dos veces no duplica nada. Una vez arrancado, el watch **sobrevive a los cambios de permiso** (ver abajo). |
| `stopLocationUpdates` | — | `{}`. Termina el watch (es, con una recarga de la página, lo único que lo termina). Las actualizaciones siguen si hay un `getCurrentPosition` pendiente. |
| `startHeading` | — | `{ available: boolean }` (`CLLocationManager.headingAvailable()`). `headingFilter = 1`, `headingOrientation = .portrait`. Las lecturas llegan por el evento `heading`. Sin magnetómetro (`available: false`), `bridge.js` le contesta `'denied'` a la web. |
| `stopHeading` | — | `{}` |
| `setKeepAwake` | `{ enabled: boolean }` | `{}` — `UIApplication.shared.isIdleTimerDisabled` |
| `openDirections` | `{ latitude: number, longitude: number, name?: string }` | `{ app: 'google'\|'apple' }`. Con Google Maps instalado (`canOpenURL("comgooglemaps://")`, requiere `LSApplicationQueriesSchemes`): `comgooglemaps://?daddr=LAT,LNG&directionsmode=walking`. Si no, Apple Maps: `maps://?daddr=LAT,LNG&dirflg=w`. `name` se ignora por ahora (con `q=` Apple Maps busca el texto en vez de ir a las coordenadas). Coordenadas con punto decimal, 6 decimales, armadas con `URLComponents`. |
| `openSettings` | — | `{}` — abre `UIApplication.openSettingsURLString` (los ajustes de 247WC) |
| `getLaunchAction` | — | `{ action: 'urgent' \| null }` y lo consume (la segunda llamada devuelve `null`) |

`Position`:

```js
{
  timestamp: number,            // ms desde epoch
  coords: {
    latitude, longitude,        // grados
    accuracy,                   // m (horizontalAccuracy)
    altitude: number|null,      // null si verticalAccuracy < 0
    altitudeAccuracy: number|null,
    heading: number|null,       // course si >= 0, si no null
    speed: number|null          // si >= 0, si no null
  }
}
```

### Eventos (`notifyListeners`)

| evento | datos |
|---|---|
| `locationUpdate` | `Position` |
| `locationError` | `{ code, message }` (mismos códigos que arriba) |
| `heading` | `{ heading: number /*0–360, norte verdadero si hay, si no magnético*/, accuracy: number /*grados, -1 si no es válida*/ }`. `bridge.js` descarta las de precisión negativa (brújula sin calibrar): mejor la flecha quieta que apuntando para cualquier lado. |
| `launchAction` | `{ action: 'urgent' }` — con `retainUntilConsumed: true`, para no perderlo si la web todavía no escucha |

### Permiso y watch

- **Venció un «Permitir una vez»** (iOS vuelve el permiso a «sin decidir»
  cuando la app deja de usarse) con un watch o un `getCurrentPosition` en
  curso: el plugin vuelve a pedir permiso, en el momento si la app está
  activa o al volver a primer plano (`didBecomeActive`). Si no, la guía
  quedaría congelada en la última posición sin ningún aviso.
- **Revocado** (Ajustes → Nunca, o `CLError.denied`): rechaza los pedidos
  pendientes y emite `locationError` `PERMISSION_DENIED`, pero el watch
  **queda pedido**: si el permiso vuelve, las posiciones retoman solas.
- Lo único que termina un watch: `stopLocationUpdates` o una recarga de la
  página (abajo).

### Reinicio al navegar dentro de la app

Cada navegación del marco principal al mismo origen (recarga, cambio de
idioma, acceso directo «Urgente»; no los cambios de `#fragmento`) significa
que la web vieja se va y Capacitor suelta sus listeners. El plugin escucha
`capacitorDecidePolicyForNavigationAction` y apaga lo que había pedido esa
página: termina el watch, apaga la brújula y la pantalla encendida
(`isIdleTimerDisabled = false`) y descarta los `getCurrentPosition`
pendientes (sin contestarlos: la página que los esperaba ya no existe).

### Acceso directo «Urgente»

`Info.plist` → `UIApplicationShortcutItems` con tipo `$(PRODUCT_BUNDLE_IDENTIFIER).urgent`
(título «Baño más cercano», en inglés «Nearest toilet» vía `InfoPlist.strings`,
ícono de sistema `UIApplicationShortcutIconTypeLocation`).

`SceneDelegate`:
- arranque en frío (`connectionOptions.shortcutItem`): guarda `"urgent"` como
  pendiente **antes** de crear la ventana; la web lo levanta con `getLaunchAction()`.
- con la app abierta (`windowScene(_:performActionFor:completionHandler:)`):
  avisa al plugin, que emite `launchAction`.

La web reacciona recargando con `?urgent=1`, el mismo camino que ya usa el
acceso directo de la PWA:

- **Arranque en frío** (`getLaunchAction()` devuelve `'urgent'`):
  `location.replace('index.html?urgent=1')`, una sola vez. Si la página ya
  tiene `?urgent`, no recarga.
- **Con la app abierta** (evento `launchAction`): **cada** toque recarga con
  `index.html?urgent=1&t=<timestamp>`, aunque ya esté en modo urgente, para
  que vuelva a escanear desde donde está la persona.

## Shims de `bridge.js`

| API web | en la app |
|---|---|
| `navigator.geolocation.getCurrentPosition/watchPosition/clearWatch` | `WCNative` (errores con `code` 1/2/3 y constantes `PERMISSION_DENIED`… como en la web). `getCurrentPosition` primero resuelve el permiso (`getLocationStatus` → `requestLocationPermission` si está en `prompt`) y recién después arranca su reloj de seguridad en JS (`timeout` + 3 s). Varios `watchPosition` comparten un solo `startLocationUpdates`; el `clearWatch` del último llama a `stopLocationUpdates`. |
| `navigator.permissions.query({ name: 'geolocation' })` | `{ state }` desde `getLocationStatus`; el resto de los nombres va a la implementación original |
| `DeviceOrientationEvent.requestPermission()` | arranca `startHeading` y resuelve `'granted'`; sin magnetómetro, `'denied'` (la guía usa el norte del mapa). Cada lectura se despacha como evento `deviceorientation` en `window` con `webkitCompassHeading`; las de precisión negativa se descartan. Se apaga al ir a segundo plano y vuelve al volver. |
| `navigator.wakeLock.request('screen')` | `setKeepAwake({ enabled: true })`; `release()` lo apaga. Si llega con la guía ya cerrada (`#guide` oculto: app.js lo pide recién cuando llega la ruta), devuelve un sentinel ya liberado y no prende nada. |
| `window.matchMedia` | Las consultas `(hover: hover) and (pointer: fine)` dan siempre `matches: false`: en un iPad con trackpad (modo compatible) lang.js creería que es una compu (QR en vez de brújula, textos de «hacé clic»). En la app siempre es un teléfono. |
| `window.isSecureContext` | `true` si el WebView dice que no (`capacitor://` puede no contar como seguro, y app.js lo exige antes de pedir la ubicación, que en la app es nativa). |
| `navigator.vibrate(p)` | `Haptics`: patrón (array) → `notification({ type: 'SUCCESS' })`; número ≤ 15 → `impact LIGHT`, ≤ 25 → `MEDIUM`, más → `HEAVY` |
| `window.open(url)` | Google Maps `…/maps/dir/?api=1&destination=LAT,LNG…` → `openDirections`; otro `http(s)` → `Browser.open` (Safari dentro de la app) |
| click en `<a href="http…">` | `Browser.open` |
| `fetch('/api/…')` | `CapacitorHttp.request` contra `https://247-wc.vercel.app/api/…` (la función no manda CORS; el pedido nativo no lo necesita). Devuelve un `Response` real. |
| botón `[data-native-action="settings"]` (en los textos de permiso negado) | `openSettings()` |
| `<html data-theme>` | `SystemBars.setStyle({ style: 'DARK' })` con tema oscuro (texto claro), `'LIGHT'` con claro |
| `window.WC.ready` | `SplashScreen.hide()` |

También:

- agrega las clases `native` y `native-ios` a `<html>`;
- oculta la fila «Instalar» del modal de info;
- **ícono de mapas:** reemplaza el contenido del símbolo SVG `#i-gmaps` (el pin
  de colores de Google Maps) por un ícono neutro de «indicaciones», un rombo
  azul con flecha de giro: el botón abre Google Maps o Mapas de Apple;
- **atribución del mapa:** suma ` · OpenFreeMap © OpenMapTiles` a la fila
  «Datos» del modal de info (el estilo del mapa la pide y el control de
  atribución del mapa está apagado);
- escucha `launchAction` (ver «Acceso directo»).

### Textos (`native/text.js`)

`window.WC_NATIVE_TEXT[es|en]` pisa claves de `lang.js` (parche 8). Además de
los textos de permiso negado (con el botón `data-native-action="settings"`),
el modal de info (`infoP`) trae el link **«Política de privacidad»** a
`PRIVACY_URL` (`https://247-wc.vercel.app/privacy.html`, una constante al
principio del archivo; App Review 5.1.1), que se abre en Safari dentro de la
app como cualquier link `https://`. En el último paso de la introducción el
botón dice «Continuar» y `native.css` oculta «Ahora no» (5.1.1: nada de
salidas ni «más tarde» justo antes del diálogo del sistema).
