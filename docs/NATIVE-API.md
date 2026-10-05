# Contrato entre la web y la capa nativa

La app iOS es la web app de `web/` empaquetada con Capacitor 8. La web **no se
modifica a mano**: `scripts/build-web.mjs` la copia a `www/`, le inyecta la capa
nativa (`native/`) y aplica dos parches chicos y verificados. La capa nativa
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

1. `index.html`: insertar el bloque de arriba después de la etiqueta
   `<meta name="viewport" …>`.
2. `index.html`: reemplazar el `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter…" …/>`
   (ocupa dos líneas) por un `<style>` con `@font-face` local
   (`fonts/inter.woff2`, `font-weight: 100 900`, `font-display: swap`) y quitar
   los `<link rel="preconnect">` a `fonts.googleapis.com` y `fonts.gstatic.com`.
3. `index.html`: quitar `<link rel="manifest" …>` (no hay PWA dentro de la app).
4. `lang.js`: en `t()`, la línea
   `const v = (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;`
   pasa a
   `const v = globalThis.WC_NATIVE_TEXT?.[LANG]?.[key] ?? (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;`

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
| `getCurrentPosition` | `{ enableHighAccuracy?: boolean, timeout?: number /*ms, def 20000*/, maximumAge?: number /*ms, def 0*/ }` | `Position` (abajo). Si el permiso no está decidido, lo pide primero y espera. Si `manager.location` tiene menos de `maximumAge` ms, la devuelve sin esperar. Si la precisión es «aproximada» (`accuracyAuthorization == .reducedAccuracy`) pide precisión completa temporal con la clave `NearestToilet` (no espera la respuesta). |
| `startLocationUpdates` | `{ enableHighAccuracy?: boolean }` | `{}` al arrancar. Las posiciones llegan por el evento `locationUpdate`; los errores por `locationError`. Si no hay permiso, rechaza con el código que corresponda (no pide permiso: eso lo hace `getCurrentPosition`, que la web siempre llama primero). Llamarlo dos veces no duplica nada. |
| `stopLocationUpdates` | — | `{}`. Deja de actualizar salvo que haya un `getCurrentPosition` pendiente. |
| `startHeading` | — | `{ available: boolean }` (`CLLocationManager.headingAvailable()`). `headingFilter = 1`, `headingOrientation = .portrait`. Las lecturas llegan por el evento `heading`. |
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
| `heading` | `{ heading: number /*0–360, norte verdadero si hay, si no magnético*/, accuracy: number /*grados, -1 si no es válida*/ }` |
| `launchAction` | `{ action: 'urgent' }` — con `retainUntilConsumed: true`, para no perderlo si la web todavía no escucha |

### Acceso directo «Urgente»

`Info.plist` → `UIApplicationShortcutItems` con tipo `$(PRODUCT_BUNDLE_IDENTIFIER).urgent`
(título «Baño más cercano», en inglés «Nearest toilet» vía `InfoPlist.strings`,
ícono de sistema `UIApplicationShortcutIconTypeLocation`).

`SceneDelegate`:
- arranque en frío (`connectionOptions.shortcutItem`): guarda `"urgent"` como
  pendiente **antes** de crear la ventana; la web lo levanta con `getLaunchAction()`.
- con la app abierta (`windowScene(_:performActionFor:completionHandler:)`):
  avisa al plugin, que emite `launchAction`.

La web reacciona con `location.replace('index.html?urgent=1')`, que es el mismo
camino que ya usa el acceso directo de la PWA.

## Shims de `bridge.js`

| API web | en la app |
|---|---|
| `navigator.geolocation.getCurrentPosition/watchPosition/clearWatch` | `WCNative` (errores con `code` 1/2/3 y constantes `PERMISSION_DENIED`… como en la web). Varios `watchPosition` comparten un solo `startLocationUpdates`. |
| `navigator.permissions.query({ name: 'geolocation' })` | `{ state }` desde `getLocationStatus`; el resto de los nombres va a la implementación original |
| `DeviceOrientationEvent.requestPermission()` | resuelve `'granted'` y arranca `startHeading`; cada lectura se despacha como evento `deviceorientation` en `window` con `webkitCompassHeading` |
| `navigator.wakeLock.request('screen')` | `setKeepAwake({ enabled: true })`; `release()` lo apaga |
| `navigator.vibrate(p)` | `Haptics`: patrón (array) → `notification({ type: 'SUCCESS' })`; número ≤ 15 → `impact LIGHT`, ≤ 25 → `MEDIUM`, más → `HEAVY` |
| `window.open(url)` | Google Maps `…/maps/dir/?api=1&destination=LAT,LNG…` → `openDirections`; otro `http(s)` → `Browser.open` (Safari dentro de la app) |
| click en `<a href="http…">` | `Browser.open` |
| `fetch('/api/…')` | `CapacitorHttp.request` contra `https://247-wc.vercel.app/api/…` (la función no manda CORS; el pedido nativo no lo necesita). Devuelve un `Response` real. |
| botón `[data-native-action="settings"]` (en los textos de permiso negado) | `openSettings()` |
| `<html data-theme>` | `SystemBars.setStyle({ style: 'DARK' })` con tema oscuro (texto claro), `'LIGHT'` con claro |
| `window.WC.ready` | `SplashScreen.hide()` |

También agrega las clases `native` y `native-ios` a `<html>`, oculta la fila
«Instalar» del modal de info y escucha `launchAction`.
