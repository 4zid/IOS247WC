/* 247WC iOS — textos que cambian dentro de la app.

   La web habla de navegadores, de Safari, de instalarla en la pantalla de
   inicio y de copiar el link: nada de eso existe en la app. El build parchea
   t() en lang.js para que mire primero acá (WC_NATIVE_TEXT[LANG][clave]); lo
   que no está acá sale igual que en la web.

   Mismas convenciones que lang.js: rioplatense, HTML simple (<strong>, <em>,
   <br>), los valores con variables son funciones y deniedIos/deniedOther son
   listas que la app une con <br>. El botón con data-native-action="settings"
   lo atiende bridge.js: abre la página de 247WC en Ajustes. */

// La política de privacidad tiene que poder abrirse desde la app (App Review
// 5.1.1). Es site/privacy.html, que publica el proyecto de Vercel de este repo
// (independiente del de la web).
const PRIVACY_URL = 'https://ios247.vercel.app/privacy.html';

window.WC_NATIVE_TEXT = {
  es: {
    // Modal de info: además del resumen, el link a la política completa. A la
    // búsqueda llega un punto redondeado de la zona (grilla de ~250 m).
    infoP: 'El baño público más cercano, sin vueltas. <strong>Tu ubicación no se guarda en nuestros servidores</strong>: se usa en el teléfono para ordenar por cercanía, a nuestra búsqueda llega solo un punto aproximado de la zona y, para la ruta a pie, tu posición va a un servicio de rutas. ' +
      `<a href="${PRIVACY_URL}">Política de privacidad</a>`,

    // Pantalla previa al diálogo de ubicación del sistema. App Review rechaza
    // los botones tipo «Activar ubicación» o «Ahora no» justo antes del
    // pedido (5.1.1): acá va «Continuar» y native.css oculta el secundario en
    // este paso. Tampoco se le dice a la persona qué opción elegir.
    onb3Sub: 'Te guiamos caminando hasta la puerta. Para eso usamos tu ubicación mientras usás la app; no la guardamos en nuestros servidores.',
    onbAllow: 'Continuar',

    // Fila «Instalar» del modal de info: bridge.js la oculta. Por si algún día
    // vuelve a verse, que diga algo cierto en la app (el acceso directo del ícono).
    install: 'Acceso rápido',
    installHow: 'Mantené apretado el ícono → «Baño más cercano»',
    infoInstall: '<strong>Acceso rápido.</strong> Mantené apretado el ícono de 247WC → «Baño más cercano».',

    // En la app el botón abre Google Maps si está instalado y si no, Mapas de Apple.
    openMaps: 'Abrir en Mapas',
    handoffNoQr: 'No pudimos generar el QR. Copiá el link o abrí la ruta en Mapas.',
    toastLinkFail: 'No pudimos copiar el link. Abrí la ruta con el botón de Mapas.',

    scanLocatingSub: 'Buscando tu ubicación…',
    noGeo: 'No pudimos acceder a la ubicación del iPhone. Revisá que Localización esté activada en Ajustes → Privacidad y seguridad.',
    noHttps: 'No pudimos acceder a la ubicación. Cerrá la app y volvé a abrirla.',

    // Permiso negado (o Localización apagada en todo el sistema): en la app no
    // hay barra de direcciones ni otro navegador; se arregla en Ajustes.
    deniedHead: '<strong>247WC no tiene permiso para usar tu ubicación.</strong><br>',
    deniedIos: [
      '<strong>1.</strong> <button type="button" class="linkish" data-native-action="settings">Abrir Ajustes</button> (o andá a <strong>Ajustes → 247WC</strong>) → <strong>Ubicación</strong> → <em>Al usar la app</em>. Dejá prendida <em>Ubicación exacta</em>.',
      '<strong>2.</strong> Si ahí no aparece Ubicación, revisá que <strong>Localización</strong> esté activada en <strong>Ajustes → Privacidad y seguridad</strong>.',
      '<strong>3.</strong> Volvé a 247WC y tocá <em>Reintentar</em>.',
    ],
    // locationHelp() elige esta en vez de deniedIos si no detecta iOS (un iPad
    // que se presenta como Mac, por ejemplo): en la app es el mismo camino.
    deniedOther: [
      '<strong>1.</strong> <button type="button" class="linkish" data-native-action="settings">Abrir Ajustes</button> (o andá a <strong>Ajustes → 247WC</strong>) → <strong>Ubicación</strong> → <em>Al usar la app</em>. Dejá prendida <em>Ubicación exacta</em>.',
      '<strong>2.</strong> Si ahí no aparece Ubicación, revisá que <strong>Localización</strong> esté activada en <strong>Ajustes → Privacidad y seguridad</strong>.',
      '<strong>3.</strong> Volvé a 247WC y tocá <em>Reintentar</em>.',
    ],

    // Solo los usaba el botón «copiá el link» de la ayuda web, que en la app no está.
    toastCopied: 'Link copiado',
    toastCopyManual: () => 'No pudimos copiar el link',
  },

  en: {
    infoP: 'The closest public toilet, no fuss. <strong>Your location is not stored on our servers</strong>: it is used on your phone to sort by distance, our search only receives an approximate point of the area and, for the walking route, your position goes to a routing service. ' +
      `<a href="${PRIVACY_URL}">Privacy Policy</a>`,

    onb3Sub: "We guide you on foot to the door. For that we use your location while you use the app; we don't store it on our servers.",
    onbAllow: 'Continue',

    install: 'Quick action',
    installHow: 'Touch and hold the icon → “Nearest toilet”',
    infoInstall: '<strong>Quick action.</strong> Touch and hold the 247WC icon → “Nearest toilet”.',

    openMaps: 'Open in Maps',
    handoffNoQr: "Couldn't create the QR code. Copy the link or open the route in Maps.",
    toastLinkFail: "Couldn't copy the link. Open the route with the Maps button.",

    scanLocatingSub: 'Getting your location…',
    noGeo: "Couldn't access your iPhone's location. Check that Location Services is on in Settings → Privacy & Security.",
    noHttps: "Couldn't access your location. Close the app and open it again.",

    deniedHead: "<strong>247WC doesn't have permission to use your location.</strong><br>",
    deniedIos: [
      '<strong>1.</strong> <button type="button" class="linkish" data-native-action="settings">Open Settings</button> (or go to <strong>Settings → 247WC</strong>) → <strong>Location</strong> → <em>While Using the App</em>. Keep <em>Precise Location</em> on.',
      "<strong>2.</strong> If Location isn't listed there, check that <strong>Location Services</strong> is on in <strong>Settings → Privacy & Security</strong>.",
      '<strong>3.</strong> Come back to 247WC and tap <em>Try again</em>.',
    ],
    deniedOther: [
      '<strong>1.</strong> <button type="button" class="linkish" data-native-action="settings">Open Settings</button> (or go to <strong>Settings → 247WC</strong>) → <strong>Location</strong> → <em>While Using the App</em>. Keep <em>Precise Location</em> on.',
      "<strong>2.</strong> If Location isn't listed there, check that <strong>Location Services</strong> is on in <strong>Settings → Privacy & Security</strong>.",
      '<strong>3.</strong> Come back to 247WC and tap <em>Try again</em>.',
    ],

    toastCopied: 'Link copied',
    toastCopyManual: () => "Couldn't copy the link",
  },
};
