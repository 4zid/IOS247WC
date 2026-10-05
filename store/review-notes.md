# Notas para la revisión de Apple

Van en la página de la versión → **App Review Information**:

- **Sign-in required:** desmarcado. La app no tiene login ni cuentas.
- **Contact Information:** tu nombre, apellido, teléfono (con código de país,
  por ejemplo +54 9 11 …) y email. Apple los usa solo si necesita hablar con vos.
- **Notes:** el bloque en inglés de abajo, tal cual. Tiene 3322 caracteres; el
  límite de Apple es 4000.
- **Attachment:** no hace falta. Si te rechazan por «no pudimos probar la
  función principal», un video corto grabado en el iPhone (escanear → Guiarme)
  ayuda mucho.

Antes de enviar, probá vos mismo lo que dice el paso 3 con el simulador en la
ubicación **Apple** (Features → Location → Apple): si en esa zona no aparece
ningún baño, cambiá la última sección por una ciudad donde sí aparezcan.

## Para pegar (inglés)

```text
247WC finds the nearest public toilet and guides you there on foot. There is no login, no account, no in-app purchase and no advertising.

WHY THE APP ASKS FOR LOCATION
Location ("While Using the App") is the core of the app: it is used to find the toilets within 3 km and to point the guidance arrow at the chosen one. Once permission is granted, the app scans automatically each time it opens. Location is never used in the background and is not stored on our servers: to search, only an approximate point (rounded to a ~250 m grid) is sent to our own search service; the exact position only goes to the walking-route service (Valhalla by FOSSGIS e.V., or OSRM) to calculate the route. No account or identifier is involved.

HOW TO TEST (about one minute)
1. Open the app. A 3-step intro appears: tap "Next" twice, then "Continue".
2. In the iOS dialog, choose "Allow While Using App".
3. The app scans the area and shows a card with the closest public toilet: name, distance, a mini-map and the walking route.
4. Tap "Guide me". The map shows your walking route, follows you and shortens the route as you walk; below it, an arrow points to the toilet using the iPhone compass, with the live remaining distance, walking time and next turn. The screen stays on during guidance and the phone vibrates on arrival. Tap the X to exit.
5. Optional: the list icon shows all toilets, with filters (Free, 24 h, Accessible, Changing table) and "Include bars and shops". The blue directions icon (a diamond with a turn arrow, "Open in Maps") opens the walking route in Google Maps if installed, otherwise in Apple Maps.
6. Home Screen quick action: touch and hold the app icon and choose "Nearest toilet". The app scans and starts guidance right away.

WITHOUT LOCATION
If location is denied, the app explains how to enable it, with an "Open Settings" button, and offers "Search without location": move the map to any area and tap "Search this area". "See the map without scanning", on the first screen, works the same way.

ABOUT THE DATA
Toilets come from OpenStreetMap and Refuge Restrooms (community data), so coverage varies by city. The Cupertino / Apple Park area has mapped public toilets. If an area shows none, tap "Also search bars and shops", or move the map to a city center (for example, San Francisco) and tap "Search this area".

NATIVE FUNCTIONALITY (Guideline 4.2)
The interface is bundled inside the app (it does not load our website) and works together with native iOS features:
- Core Location for the user's position, with the "While Using the App" permission and a temporary Precise Location request with its own purpose string. If an "Allow Once" grant expires during guidance, the app asks again and guidance resumes.
- Core Location heading (magnetometer) for the compass arrow.
- Haptic feedback on taps and on arrival.
- Keeps the screen awake only during guidance.
- Home Screen quick action "Nearest toilet".
- Hands off walking directions to Apple Maps or Google Maps.
- Opens external links (OpenStreetMap, credits) in an in-app Safari view.
- "Open Settings" deep link when location permission is denied.
- Light and dark mode, with matching status bar, launch screen and dark/tinted app icons.
- The latest results are kept on the device and shown when there is no connection.
- English and Spanish, following the device language.

The app is designed for iPhone. On iPad it runs in iPhone compatibility mode.
```

## Traducción (para vos, no se pega)

> 247WC encuentra el baño público más cercano y te guía caminando hasta él. No
> hay login, ni cuentas, ni compras dentro de la app, ni publicidad.
>
> **POR QUÉ LA APP PIDE LA UBICACIÓN**
> La ubicación («Al usar la app») es el centro de la app: se usa para encontrar
> los baños a menos de 3 km y para que la flecha de la guía apunte al elegido.
> Una vez dado el permiso, la app escanea sola cada vez que se abre. Nunca se
> usa en segundo plano y no se guarda en nuestros servidores: para buscar, a
> nuestro propio servicio de búsqueda solo llega un punto aproximado
> (redondeado a una grilla de ~250 m); la posición exacta solo va al servicio
> de ruta a pie (Valhalla, de FOSSGIS e.V., u OSRM) para calcular la ruta. No
> hay cuentas ni identificadores de por medio.
>
> **CÓMO PROBARLA (más o menos un minuto)**
> 1. Abrí la app. Aparece una introducción de 3 pasos: tocá «Siguiente» dos
>    veces y después «Continuar».
> 2. En el cartel de iOS, elegí «Permitir al usar la app».
> 3. La app escanea la zona y muestra una tarjeta con el baño público más
>    cercano: nombre, distancia, un minimapa y la ruta a pie.
> 4. Tocá «Guiarme». El mapa muestra el recorrido a pie, te sigue y lo va
>    acortando mientras caminás; abajo, una flecha apunta al baño con la
>    brújula del iPhone, con la distancia y el tiempo que faltan y la próxima
>    indicación, en vivo. La pantalla queda encendida durante la guía y el
>    teléfono vibra al llegar. Tocá la X para salir.
> 5. Opcional: el ícono de lista muestra todos los baños, con filtros (Gratis,
>    24 h, Accesible, Cambiador) e «Incluir bares y negocios». El ícono azul de
>    indicaciones (un rombo con una flecha de giro, «Abrir en Mapas») abre la
>    ruta a pie en Google Maps si está instalada y, si no, en Mapas de Apple.
> 6. Acceso rápido desde la pantalla de inicio: mantené apretado el ícono de la
>    app y elegí «Baño más cercano». La app escanea y arranca la guía enseguida.
>
> **SIN UBICACIÓN**
> Si se niega la ubicación, la app explica cómo activarla, con un botón «Abrir
> Ajustes», y ofrece «Buscar sin ubicación»: mové el mapa a cualquier zona y
> tocá «Buscar en esta zona». «Ver el mapa sin escanear», en la primera
> pantalla, funciona igual.
>
> **SOBRE LOS DATOS**
> Los baños salen de OpenStreetMap y Refuge Restrooms (datos de la comunidad),
> así que la cobertura cambia según la ciudad. La zona de Cupertino / Apple
> Park tiene baños públicos mapeados. Si en una zona no aparece ninguno, tocá
> «Buscar también en bares y negocios», o mové el mapa al centro de una ciudad
> (por ejemplo, San Francisco) y tocá «Buscar en esta zona».
>
> **FUNCIONES NATIVAS (pauta 4.2)**
> La interfaz viene adentro de la app (no carga nuestra web) y trabaja junto
> con funciones nativas de iOS:
> - Core Location para la posición, con el permiso «Al usar la app» y un pedido
>   temporal de ubicación exacta con su propio texto explicativo. Si un
>   «Permitir una vez» vence durante la guía, la app lo vuelve a pedir y la
>   guía sigue.
> - La orientación de Core Location (magnetómetro) para la flecha de la brújula.
> - Respuesta háptica al tocar y al llegar.
> - Mantiene la pantalla encendida solo durante la guía.
> - Acceso rápido «Baño más cercano» desde la pantalla de inicio.
> - Pasa la ruta a pie a Mapas de Apple o a Google Maps.
> - Abre los links externos (OpenStreetMap, créditos) en Safari dentro de la app.
> - Link directo a Ajustes cuando se negó el permiso de ubicación.
> - Modo claro y oscuro, con la barra de estado, la pantalla de arranque y el
>   ícono (oscuro y tintado) acordes.
> - Los últimos resultados quedan en el dispositivo y se muestran sin conexión.
> - Inglés y español, según el idioma del dispositivo.
>
> La app está pensada para iPhone. En iPad funciona en el modo de
> compatibilidad de iPhone.

## Por qué estas notas

- **Pauta 4.2 (funcionalidad mínima):** Apple rechaza las apps que son «solo
  una web dentro de una app». La lista de funciones nativas está para que quien
  revisa vea enseguida qué hace la app que una web no puede.
- **Pauta 5.1.1 (datos y permisos):** explica para qué se usa la ubicación y
  que la app sigue funcionando sin ella.
- **Pauta 2.1 (que se pueda probar):** quien revisa puede estar en cualquier
  lugar; si no ve baños, cree que la app no funciona. Por eso van los planes B
  (bares y negocios, mover el mapa).
