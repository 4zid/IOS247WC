# Contrato entre la web y la capa nativa

La app iOS es la web app de `web/` empaquetada con Capacitor 8. La web **no se
modifica a mano**: `scripts/build-web.mjs` la copia a `www/`, le inyecta la capa
nativa (`native/`) y aplica doce parches chicos y verificados. La capa nativa
reemplaza las APIs del navegador que en una app no alcanzan o se ven mal
(diálogos de permiso con «localhost», sin vibración, sin bloqueo de pantalla,
links que salen a Safari) y suma lo que se espera de una app de iPhone
(deslizar desde el borde para volver).

```
web/            copia de 4zid/247wc (index.html, app.js, lang.js, styles.css…)
native/         capa nativa en JS, se inyecta en www/index.html
  capacitor.js  (lo copia el build desde node_modules/@capacitor/core/dist/capacitor.js)
  text.js       window.WC_NATIVE_TEXT: textos que cambian en la app (es/en)
  bridge.js     shims de APIs del navegador → plugins nativos
  gestures.js   deslizar desde el borde izquierdo para volver
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
<script src="native/gestures.js"></script>
```

En el dispositivo, Capacitor inyecta `native-bridge.js` al inicio del documento
(define `window.Capacitor` con `nativePromise`, `nativeCallback` y
`PluginHeaders`). `capacitor.js` (el bundle de `@capacitor/core`) le agrega
`registerPlugin`. `bridge.js` usa `Capacitor.registerPlugin(nombre)`.

`gestures.js` va después de `bridge.js` pero no depende de él: solo usa
`window.Capacitor` y el DOM de la web (sus listeners van en `document`, así
que no necesita esperar a que app.js arme la página).

Si `Capacitor.isNativePlatform()` es falso (abrir `www/` en un navegador),
`bridge.js` y `gestures.js` no tocan nada. `native.css` se carga igual, pero
todas sus reglas van con `html.native`, la clase que pone `bridge.js`.

## Parches del build (todos verificados: si el ancla no aparece exactamente una vez, el build falla)

Son doce, en `PATCHES` de `scripts/build-web.mjs`. Se aplican en memoria: si
uno falla, `www/` queda como estaba.

`index.html` (8):

1. Insertar el bloque de arriba después de la etiqueta `<meta name="viewport" …>`.
2. Reemplazar el `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter…" …/>`
   (ocupa dos líneas) por un `<style>` con `@font-face` local
   (`fonts/inter.woff2`, `font-weight: 100 900`, `font-display: swap`).
3. Quitar el `<link rel="preconnect">` a `fonts.googleapis.com`.
4. Quitar el `<link rel="preconnect">` a `fonts.gstatic.com`.
5. Quitar `<link rel="manifest" …>` (no hay PWA dentro de la app).
6. Quitar `<link rel="icon" href="icons/…">` (`icons/` no se copia: el ícono lo pone Xcode).
7. Quitar `<link rel="apple-touch-icon" …>`.
8. **Ícono de «Mi ubicación».** Dentro de `<button id="btn-locate" …>`, el
   `<svg>` de la flecha de navegación (`<path d="M4 12.5 20 4l-8.5 16-1.8-6.2L4 12.5Z" …>`)
   pasa a ser un anillo con un punto azul adentro (como tu punto en el mapa):
   `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.9" style="fill: var(--blue); stroke: none"/></svg>`.
   El anillo usa el trazo de todos los íconos (`svg { fill: none; stroke: currentColor; stroke-width: 1.8 }`
   de `styles.css`); el punto va relleno de `--blue`, sin trazo. El ancla es el
   botón más su `<svg>` (`/(<button id="btn-locate"[^>]*>\s*)<svg[^>]*>[\s\S]*?<\/svg>/`)
   y no el `<path>` solo, porque la misma flecha está también en el símbolo
   `#fab-home` (el botón azul cuando estás viendo otra zona) y en la palabra
   «Llegar» de la portada. El `aria-label`
   («Centrar en mi ubicación», `locateAria`) no cambia.

`lang.js` (1):

9. En `t()`, la línea
   `const v = (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;`
   pasa a
   `const v = globalThis.WC_NATIVE_TEXT?.[LANG]?.[key] ?? (MOUSE ? dict.mouse?.[key] : undefined) ?? dict[key] ?? DICT.es[key] ?? key;`

`app.js` (3). El 10 y el 12 son para el respaldo directo a Overpass desde el
teléfono (solo cuando `/api/toilets` falla o contesta `parcial`): así la
posición exacta solo sale hacia el servicio de rutas (Valhalla u OSRM), como
dice la política.

10. Quitar de `CFG.overpass` la línea del espejo
    `'https://maps.mail.ru/osm/tools/overpass/api/interpreter',` (VK, Rusia).
    Quedan `overpass-api.de`, `overpass.kumi.systems` y `overpass.private.coffee`.
11. **«Mi ubicación» con los baños cercanos a la vista.** El ancla es el
    handler de `#btn-locate` entero, estas cinco líneas exactas:

    ```js
    $('#btn-locate').addEventListener('click', () => {
      state.userMoved = false;
      if (state.me) setView(map, state.me.lat, state.me.lng, 17);
      else quickScan();
    });
    ```

    Queda igual, salvo que con posición llama a `locateMe()` en vez de
    `setView(…, 17)`. `locateMe` se define justo antes:
    - toma `visiblePlaces()` (los baños de la lista, con los filtros puestos),
      mide la distancia de cada uno a `state.me` con `distance()`, deja los de
      ≤ 1000 m y, de esos, los 3 más cercanos;
    - encuadra con `fitPoints(map, pts, { top: 130, bottom: PEEK() + 110, left: 60, right: 60, maxZoom: 16 })`,
      con `pts` = tu posición y:
      - si hay baños: cada uno y su reflejo respecto de vos
        (`[2·me.lat − p.lat, 2·me.lng − p.lng]`);
      - si no queda ninguno: dos esquinas a 600 m de vos
        (`me ± [600 / 111320, 600 / 111320 / cos(me.lat)]`), o sea unos 600 m a
        tu alrededor (zoom ~14,8 en un iPhone de 390 px).

      Con los reflejos (o las esquinas), el centro del encuadre es tu punto y no
      el medio de los baños; con el relleno de arriba
      (la barra con el chip) y de abajo (la hoja, que mide `--sheet-peek`, más
      el botón azul y «Mi ubicación»), tu punto queda en el centro de lo que se
      ve del mapa. Mueve el mapa con la misma animación de 600 ms de la web.
    - Sin posición (`state.me` vacío) sigue como la web: `quickScan()`.
      `state.userMoved = false` también queda.

    `locateMe` usa por nombre funciones de app.js (`visiblePlaces`,
    `distance`, `setView`, `fitPoints`, `PEEK`; `PEEK` se declara más abajo,
    pero `locateMe` corre recién al tocar el botón). El build solo verifica el
    ancla: si el upstream renombra alguna, el build pasa y el botón falla al
    tocarlo. Lo atrapa la prueba T14.
12. En `overpassDirect`, `const query = overpassQuery(center, radius);` pasa a
    `const query = overpassQuery({ lat: snap(center.lat), lng: snap(center.lng) }, radius + 250);`:
    el mismo punto redondeado a ~250 m (y el mismo margen de radio) que va a la API.

El build además verifica que todo `href`/`src` local de `www/index.html`
exista en `www/`.

Archivos que se copian a `www/`: `index.html`, `app.js`, `lang.js`,
`styles.css`, `favicon.svg`, `brand/logo/*.svg`, `vendor/**`, `fonts/inter.woff2`
y `native/` (`native.css`, `text.js`, `bridge.js`, `gestures.js`, más
`capacitor.js`, que sale de `node_modules/@capacitor/core`). No van `sw.js`,
`manifest.webmanifest`, la landing ni `api/`.

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
- **botón azul y «Mi ubicación» sin pisarse:** con `max-width: 759px`,
  mantiene `--fab-shift` en `<html>` = `max(0, ⌈ancho/2 + ancho del botón
  azul/2 − (borde izquierdo de #btn-locate − 10)⌉)` px, que `native.css` usa
  como `margin-left` negativo del botón azul (ver «Retoques de
  `native.css`»). Lo recalcula con un `ResizeObserver` sobre `.scan-fab`
  (cuadro a cuadro mientras app.js anima el ancho al cambiar el texto), al
  cambiar el tamaño de la ventana y al cruzar los 760 px (ahí vuelve a `0px`);
- escucha `launchAction` (ver «Acceso directo»).

### Textos (`native/text.js`)

`window.WC_NATIVE_TEXT[es|en]` pisa claves de `lang.js` (parche 9). Además de
los textos de permiso negado (con el botón `data-native-action="settings"`),
el modal de info (`infoP`) trae el link **«Política de privacidad»** a
`PRIVACY_URL` (`https://ios247.vercel.app/privacy.html`, una constante al
principio del archivo; App Review 5.1.1), que se abre en Safari dentro de la
app como cualquier link `https://`. En el último paso de la introducción el
botón dice «Continuar» y `native.css` oculta «Ahora no» (5.1.1: nada de
salidas ni «más tarde» justo antes del diálogo del sistema).

## Gesto de volver (`native/gestures.js`)

Deslizar desde el borde izquierdo para volver, como en las apps de iOS. La web
no usa el historial del navegador para sus vistas (no hay `pushState`), así
que no hay un «atrás» del WebView que sirva: el gesto se arma a mano y vuelve
**tocando los mismos controles que ya tiene la web**, sin parchear `app.js`.
Solo en la app: si `Capacitor.isNativePlatform()` es falso, no registra nada.

### Destinos

Se decide una sola vez, en el `touchstart`, con el elemento donde apoya el dedo
(`backTarget(e.target)`); gana la primera fila que se cumple:

| cuándo | qué sigue al dedo | qué hace al confirmar |
|---|---|---|
| `<dialog id="info">` abierto (Info / ajustes) y el dedo apoya en él. Como es modal, el borde de la pantalla cae en su fondo (`::backdrop`, que cuenta como el `<dialog>`) o en el borde de la tarjeta | `#info` se corre a la derecha y se aclara (`opacity` hasta 0,6) | sale de la pantalla y recién ahí `#info-close.click()` (app.js: `el.info.close()`) |
| el dedo apoya en `#sheet` y `#view-detail` está visible (sin `hidden`), con la hoja entera o abajo | `#view-detail` se corre a la derecha y deja ver **la lista debajo**: `#view-list` se muestra en posición absoluta, del mismo tamaño y en el mismo lugar que el detalle, con el scroll en el que la dejaste, y se desplaza del 30 % a la izquierda hasta su lugar (paralaje, como en iOS) | el detalle sale, la lista llega a su lugar y recién ahí `#btn-back.click()` (app.js: `goBackToList()`, que deja la lista con la hoja en `peek`). La altura de la hoja queda fija durante ese cambio (la lista es más alta que el detalle) y se suelta a los 340 ms, así la hoja baja derecho en vez de estirarse primero |
| el dedo apoya en `#sheet`, la hoja está entera (`data-open="full"`) y no hay detalle (lista o tarjeta del más cercano) | **la hoja baja siguiendo al dedo**: `translate: 0 <recorrido · dx / innerWidth · 1,4>`, con recorrido = alto de la hoja − `--sheet-peek` | despacha `keydown` `Enter` (`bubbles`, `cancelable`) en `.sheet-handle` (el handler de teclado de app.js alterna `full` → `peek`, así que solo si sigue en `full`), y anima juntos el `transform` de la web y el `translate` del gesto: la hoja sigue bajando desde donde la dejó el dedo, sin saltos |
| cualquier otro lugar | — | nada |

«Cualquier otro lugar» incluye la portada y la introducción (`#scan`), la guía
(`#guide`: se cierra con la X, para no salir sin querer mientras caminás), el
mapa y la hoja abajo sin detalle. `#scan` y `#guide` están fuera de `#sheet`
y la tapan, así que el dedo nunca apoya en la hoja mientras están abiertas.

### Umbrales

| constante | valor | qué controla |
|---|---|---|
| `EDGE` | 24 px | el toque tiene que empezar con `clientX ≤ 24` (el margen de la hoja) |
| `LOCK` | 10 px | hasta moverse 10 px en algún eje no decide nada. Después sigue solo si va hacia la derecha (`dx > 0`) y es más horizontal que vertical (en valor absoluto, `dx` al menos 1,2 veces `dy`); si no, lo suelta (por ejemplo, para que la lista se desplace) y no lo vuelve a intentar hasta el próximo toque |
| `COMMIT` | 1/3 | al soltar, confirma si `dx > innerWidth / 3`… |
| `FLING` | 0,45 px/ms | …o si iba a más de 0,45 px/ms y `dx > 30` (un deslizamiento corto pero rápido) |
| `FLING_WINDOW` | 100 ms | la velocidad sale de las muestras de los últimos 100 ms (se ignoran las que llegan con el mismo `timeStamp`); si el dedo se quedó quieto más de 100 ms antes de soltar, la velocidad es 0 |
| `MS` | 220 ms | la salida o la vuelta del detalle y del modal |
| `SHEET_MS` | 340 ms | la hoja (la web tarda 0,32 s en subir o bajar) |

- Curva: `cubic-bezier(.22, 1, .36, 1)` (la opacidad del modal, `ease`).
- Un solo dedo: el gesto empieza con `touches.length === 1`; si apoya un
  segundo dedo durante el gesto, todo vuelve a su lugar como si no
  confirmara.
- Mientras sigue: `translate` en línea con `transition: none`;
  `preventDefault()` en cada `touchmove` (listener no pasivo) para que la
  lista no se desplace mientras volvés.
- Al soltar (`touchend`; un `touchcancel` nunca confirma) anima la salida o la
  vuelta. Mientras dura esa animación (`busy`) no empieza otro gesto, y los
  toques en el borde no llegan a la hoja: dos gestos seguidos no vuelven a
  abrir la lista.
- Al terminar limpia todos los estilos en línea que puso (`translate`,
  `opacity`, `will-change`, `position`, medidas, `z-index`, fondo,
  `pointer-events`; `transition: none` durante un cuadro y después la de la
  web), así todo queda como lo dejó la web.
- Con `prefers-reduced-motion: reduce` no anima: limpia y, si confirma, corre
  la acción en el momento.

### Para que la hoja no se arrastre

app.js arrastra la hoja hacia arriba o abajo desde un listener común de
`pointerdown` en `el.sheet` (fase de burbuja; arranca si el dedo apoya en una
`.drag-zone`). `gestures.js` registra un
`pointerdown` en `document` **en fase de captura**: si `pointerType` es
`'touch'`, `clientX ≤ 24` y hay un gesto terminando o `backTarget` encuentra
un destino, llama a `stopPropagation()`, así ese toque no llega a la hoja ni a
ningún otro listener de `pointerdown`. No llama a `preventDefault()`: un
toque sin mover sigue generando su `click`. Fuera del borde, o donde no hay a
dónde volver, no toca nada.

Los `touchstart`, `touchmove`, `touchend` y `touchcancel` van solo en `#sheet`
y en `#info` (`touchmove` **no** pasivo, por el `preventDefault()`; los demás,
pasivos). En el mapa no hay listeners del gesto, así que su desplazamiento no
espera a este código. Un listener pasivo de `scroll` en `#view-list` guarda
hasta dónde bajaste, para mostrar la lista igual detrás del detalle.

### Si cambia la web

El gesto depende de estos nombres de la web: `#sheet` y su `data-open`,
`--sheet-peek`, `#view-detail`, `#view-list`, `#btn-back`, `.sheet-handle` (y
que su `keydown` con Enter alterne la hoja), `<dialog id="info">` e
`#info-close`. No son anclas del build: si el upstream cambia alguno, el build
pasa y el gesto deja de andar en silencio. Lo atrapa la prueba T16.

## Retoques de `native.css`

Todas las reglas van con `html.native` (la clase la pone `bridge.js`): en un
navegador común no cambian nada.

- Sin el resaltado gris al tocar (`-webkit-tap-highlight-color`) ni la
  selección de texto o el menú de mantener apretado en la interfaz; sí en
  campos de texto y en el diagnóstico (`.diag-list`, para soporte).
- Oculta la fila «Instalar» del modal de info (respaldo de `bridge.js`, iOS 15.4+).
- Los links de `.about` (la política de privacidad) en `--blue`.
- Oculta «Ahora no» (`#onb-skip`, con `visibility` para no mover nada) en el
  último paso de la introducción (`#scan[data-onb="2"]`).
- **El botón azul más cerca de la hoja y «Mi ubicación» en su fila** (solo
  con `max-width: 759px`: desde 760 px la web pasa al panel lateral, `wide`
  en app.js; en un iPhone en vertical siempre se cumple):

  | elemento | en la web | en la app |
  |---|---|---|
  | `.scan-fab` (el botón azul) | `bottom: calc(var(--sheet-peek) + 18px + var(--safe-b))` | `calc(var(--sheet-peek) + 12px)`; además `line-height: 18px`, `width: max-content`, `max-width: calc(100vw - 80px)` y `margin-left: calc(-1 * var(--fab-shift, 0px))` |
  | `#fab-label` (su texto) | — | `min-width: 0; overflow: hidden; text-overflow: ellipsis` |
  | `.map-controls` («Mi ubicación») | `calc(var(--sheet-peek) + 88px + var(--safe-b))`, arriba del botón azul | `calc(var(--sheet-peek) + 13px)`: a la derecha del botón azul, en la misma fila |
  | `.toast` | `calc(var(--sheet-peek) + 86px + var(--safe-b))` | `calc(var(--sheet-peek) + 76px)` |

  `--safe-b` es `env(safe-area-inset-bottom)`: 34 px en los iPhone con Face
  ID. La web se lo suma, pero en el iPhone la hoja ya cubre esa franja (le
  agrega `--safe-b` a su propio relleno de abajo y su parte visible mide
  `--sheet-peek`), así que el botón azul quedaba a 18 + 34 = 52 px del borde
  de la hoja. Ahora queda a 12 px.

  «Mi ubicación» va en la misma fila, con los centros alineados: el botón azul
  mide 48 px de alto (15 de relleno arriba y abajo y 18 de alto de línea,
  fijado para que no dependa de cómo mide la fuente cada motor) y «Mi
  ubicación» 46, así que su borde de abajo va 1 px más arriba (12 + 1 = 13).
  El aviso (`.toast`) sigue arriba del botón azul.

  Sin pisarse: el botón azul va centrado en la pantalla y «Mi ubicación»
  ocupa los últimos 58 px de la derecha (46 + 12 de margen). Con un texto
  largo en un iPhone angosto se tocarían (en 375 px, «Buscando en esta
  zona…» mide 260 px y quedaría a −0,5 px). Para eso `bridge.js` calcula
  `--fab-shift` (ver «Shims de `bridge.js`»): los px que el botón azul tiene
  que correrse a la izquierda para dejar 10 px hasta «Mi ubicación», o `0px`
  si centrado ya los deja (el caso de casi todos los textos desde 375 px y de
  todos desde 402). Si ni corriéndose entra (en 320 px, el iPhone SE de 1.ª
  generación con iOS 15), `max-width` lo limita al lugar libre
  (`100vw − 80px`: 12 de margen izquierdo, 10 de separación y 58 de «Mi
  ubicación») y el texto termina en «…». `width: max-content` hace falta
  porque, con el texto recortable (`min-width: 0`), el ancho automático de un
  `position: fixed` con `left: 50%` sería la mitad de la pantalla.

  `--sheet-peek` lo cambia app.js según la vista (214 px con la lista o el
  detalle, 132 con la tarjeta del más cercano) y todo lo sigue solo. Con la
  hoja entera, la web oculta el botón azul y «Mi ubicación» como siempre
  (`body[data-sheet="full"]`).
