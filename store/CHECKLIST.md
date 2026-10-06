# Checklist antes de enviar a revisión

Marcá cada casilla (en GitHub podés editar este archivo y cambiar `[ ]` por
`[x]`). El detalle de cada paso está en el [README](../README.md).

## 1. Cuenta de Apple (una sola vez)

- [ ] El **Apple Developer Program** está activo (developer.apple.com → Account muestra la membresía vigente).
- [ ] Los **acuerdos** están aceptados: App Store Connect → **Business**, sin avisos pendientes.
- [ ] Declaraste tu **estatus de comerciante de la UE** (Digital Services Act) en **Business**.
- [ ] El Bundle ID **`com.wc247.app`** está registrado en developer.apple.com → Identifiers, **antes** de crear la app.
- [ ] La app está **creada en App Store Connect** con ese Bundle ID, idioma principal **Spanish (Mexico)** y la localización **English (U.S.)** agregada.

## 2. Lo que tenés que completar vos

- [x] El email de contacto (lautarolacazeok@gmail.com) ya está en `site/privacy.html` y `site/support.html`.
- [ ] Importaste el repo en Vercel (README → «Privacidad y soporte») y las dos páginas están publicadas: **`https://ios247.vercel.app/privacy.html`** y **`https://ios247.vercel.app/support.html`** (o tus URLs) abren desde el celular, sin login, en español y en inglés.
- [ ] Si publicaste la política en otra URL, cambiaste `PRIVACY_URL` en `native/text.js`, corriste `npm test` y `npm run sync`, y subiste un build nuevo.
- [ ] En **Derechos de autor** reemplazaste `[TU NOMBRE O EL DE TU EMPRESA]` por el nombre que figura como vendedor en tu cuenta.
- [ ] Buscaste `[TU` en todo lo que vas a pegar o publicar y no quedó ningún marcador.

## 3. El build

- [ ] `npm test` pasa (17 de 17).
- [ ] En `native/bridge.js`, `API_BASE` es el dominio real de la web (`https://247-wc.vercel.app`).
- [ ] **Camino A:** `npm run sync` corrió sin errores antes de archivar, y tu cuenta tiene al menos un iPhone registrado (lo conectaste y le diste ▶ una vez). **Camino B:** el workflow **iOS build** está en verde.
- [ ] **Version** `1.0.0` y un **Build** que no se haya usado antes. En App Store Connect, el campo **Version** de la página de la versión tiene que decir exactamente `1.0.0` (Apple la crea como `1.0`): si no coinciden, el build no aparece para elegirlo.
- [ ] El build terminó de procesarse y aparece en **TestFlight**, sin «Missing Compliance».

## 4. Probar en un iPhone de verdad (TestFlight o Xcode)

- [ ] **Primera vez:** aparece la introducción → en el último paso, «Continuar» (sin «Ahora no») → el cartel de iOS dice **247WC** y explica el uso en tu idioma.
- [ ] **Segunda vez:** con el permiso ya dado, al abrir la app de nuevo escanea sola, sin tocar nada.
- [ ] **Escanear:** aparece el más cercano con minimapa, distancia y ruta.
- [ ] **Guiarme:** la flecha gira con la brújula sin pedir otro permiso, la pantalla no se apaga y el iPhone vibra al llegar.
- [ ] Al **salir de la guía**, la pantalla se vuelve a apagar sola después del tiempo normal.
- [ ] **Abrir en Mapas** (el ícono azul con forma de rombo) abre Google Maps (si la tenés) o Mapas de Apple, en modo a pie.
- [ ] **¿Falta un baño?** y los créditos de OpenStreetMap abren Safari dentro de la app (con «Listo» para volver).
- [ ] En la app, Info → «Política de privacidad» abre la política publicada (no un 404).
- [ ] **Permiso negado** (Ajustes → 247WC → Ubicación → Nunca): aparece la ayuda con **Abrir Ajustes**, el botón funciona y **Buscar sin ubicación** permite buscar moviendo el mapa.
- [ ] Ninguna pantalla habla de Safari, del navegador, de «Agregar a inicio» ni de copiar el link.
- [ ] **Acceso rápido:** mantener apretado el ícono → **Baño más cercano**, con la app cerrada y con la app abierta.
- [ ] **Modo avión:** la app abre y muestra los últimos baños encontrados.
- [ ] **Inglés y modo oscuro:** Info → Idioma → English, y el tema oscuro. Textos, barra de estado e ícono se ven bien.
- [ ] Con el iPhone en inglés, el cartel de permiso y el acceso directo salen en inglés («Nearest toilet»).
- [ ] Con el simulador en **Features → Location → Apple** (Apple Park) aparecen baños: es lo que probablemente vea Apple. Si no aparecen, ajustá la sección «ABOUT THE DATA» de `store/review-notes.md`.
- [ ] (Opcional) En un iPad o en el simulador de iPad, la app abre en modo compatibilidad de iPhone y funciona.

## 5. Ficha en App Store Connect

**App Information**

- [ ] Nombre y subtítulo en español y en inglés (`store/listing-es.md`, `store/listing-en.md`).
- [ ] Categorías: **Navigation** (principal) y **Travel** (secundaria).
- [ ] **Content Rights:** «Yes», y confirmaste que tenés los derechos (datos de OpenStreetMap con atribución).
- [ ] **Age Rating:** todo «No» / «None» → **4+**.

**Pricing and Availability**

- [ ] Precio **gratis**, disponible en todos los países **menos China continental** (pide un número de registro ICP, y los servicios de mapas y rutas pueden no andar ahí).
- [ ] **Desmarcada** la disponibilidad en Mac con Apple silicon y en Apple Vision Pro (la guía necesita la brújula y el GPS del iPhone).

**App Privacy**

- [ ] **Privacy Policy URL** cargada, en español y también en **English (U.S.)** (se carga por idioma).
- [ ] Cuestionario completo según `store/app-privacy.md` (Precise + Coarse Location, App Functionality, no vinculada, sin rastreo) y **publicado**.

**Versión 1.0**

- [ ] **Capturas** de iPhone 6,9" (1320 × 2868 o 1290 × 2796 px), al menos 1 (mejor entre 4 y 6), sin transparencia. `npm run screenshots` las genera en `store/screenshots/es/` y `store/screenshots/en/`. Subí primero las de la app en uso y dejá afuera la portada (dice «Gratis», y Apple no quiere precios en las capturas): español `03-mas-cercano`, `04-guia`, `02-mapa`, `05-lista-oscuro`; inglés `03-nearest`, `04-guide`, `02-map`, `05-list-dark`.
- [ ] **Texto promocional, descripción y palabras clave** en los dos idiomas.
- [ ] **URL de soporte:** `https://ios247.vercel.app/support.html` (o tu URL). **URL de marketing:** vacía en la 1.0; desde la próxima versión, `https://ios247.vercel.app/` (la landing de la app de iPhone, no la de la web; ver `store/listing-es.md`).
- [ ] **Derechos de autor.**
- [ ] **Build** elegido.
- [ ] **App Review Information:** «Sign-in required» desmarcado, tus datos de contacto y las notas de `store/review-notes.md`.
- [ ] **Version Release:** elegiste si se publica sola al aprobarse o la publicás vos.

## 6. Enviar

- [ ] **Save → Add for Review → Submit for Review.**
- [ ] Estás atento al mail y a **App Review** en App Store Connect por si Apple pregunta algo.

## Después de publicar

- [ ] Bajá la app desde el App Store y abrila una vez.
- [ ] Para la próxima versión: README → «Actualizar la app cuando cambia la web».
