# 247WC para iPhone

**La web app 247WC (el baño público más cercano, con guía caminando) convertida
en una app de iPhone lista para el App Store.**

Esta guía está pensada para alguien que diseña en Figma, Framer o Webflow y
nunca abrió Xcode. Hay dos caminos para subir la app: **con una Mac** (Camino A)
o **sin Mac**, dejando que una Mac de GitHub haga el trabajo (Camino B). Elegí
uno; todo lo demás es igual para los dos.

Los textos para el App Store, la política de privacidad y las notas para la
revisión ya están escritos en [`store/`](store/). Antes de enviar a revisión,
recorré [`store/CHECKLIST.md`](store/CHECKLIST.md).

## Índice

1. [Qué es esto](#qué-es-esto)
2. [Qué cambia respecto de la web](#qué-cambia-respecto-de-la-web)
3. [Requisitos](#requisitos)
4. [Paso 0: registrar el Bundle ID y crear la app en App Store Connect](#paso-0-registrar-el-bundle-id-y-crear-la-app-en-app-store-connect)
5. [Camino A: con Mac y Xcode](#camino-a-con-mac-y-xcode)
6. [Camino B: subir sin Mac](#camino-b-subir-sin-mac)
7. [Completar la ficha del App Store](#completar-la-ficha-del-app-store)
8. [Enviar a revisión](#enviar-a-revisión)
9. [Actualizar la app cuando cambia la web](#actualizar-la-app-cuando-cambia-la-web)
10. [Cambiar nombre, ícono, bundle id o versión](#cambiar-nombre-ícono-bundle-id-o-versión)
11. [El dominio de la API](#el-dominio-de-la-api)
12. [Costos de GitHub Actions](#costos-de-github-actions)
13. [Problemas comunes](#problemas-comunes)
14. [Pruebas](#pruebas)
15. [Estructura del repo](#estructura-del-repo)

---

## Qué es esto

La app es **la misma web** de [4zid/247wc](https://github.com/4zid/247wc)
metida adentro de una app de iOS con [Capacitor](https://capacitorjs.com/) 8, más
una **capa nativa** que reemplaza lo que en una app no anda bien desde el
navegador: el permiso de ubicación, la brújula, la vibración, la pantalla
encendida y los links.

```
web/      la web, copiada tal cual de 4zid/247wc (no se edita a mano)
native/   la capa nativa del lado web: bridge.js, text.js, native.css
   │
   │  npm run build   copia web/ + native/ a www/ y aplica 4 parches chiquitos
   ▼
www/      la web lista para la app (se genera, no está en git)
   │
   │  npm run sync    además copia www/ adentro del proyecto de Xcode
   ▼
ios/      el proyecto de Xcode: la app de verdad, con el plugin nativo
          WCNativePlugin.swift (ubicación, brújula, mapas, acceso directo)
```

**Regla de oro:** `web/` nunca se toca a mano. Si querés cambiar la app, lo
cambiás en la web (repo 4zid/247wc) y lo traés con `npm run web:update`
([ver más abajo](#actualizar-la-app-cuando-cambia-la-web)). Lo propio de la app
vive en `native/` y en `ios/`.

El contrato exacto entre la web y la parte nativa (cada método, cada evento,
cada parche) está en [`docs/NATIVE-API.md`](docs/NATIVE-API.md). Para usar este
repo no hace falta leerlo; sirve si algún día alguien tiene que tocar el código.

## Qué cambia respecto de la web

| En la web | En la app |
|---|---|
| El navegador pide la ubicación con un cartel que dice «localhost» o el dominio | **Ubicación nativa** (Core Location): el cartel es el de iOS, dice «247WC» y explica para qué la usa. Pide «Al usar la app», nunca en segundo plano. Si el iPhone tiene la ubicación en «aproximada», pide la exacta solo para esa vez. |
| Si negaste el permiso, la ayuda habla de Safari, del botón «aA» y de copiar el link | Textos propios de la app con un botón **Abrir Ajustes** que va directo a Ajustes → 247WC. |
| Brújula del navegador (con su propio permiso) | **Brújula con Core Location**: la flecha gira sin pedir otro permiso. Se apaga sola cuando salís de la app, para no gastar batería. |
| `navigator.vibrate` (en iPhone no existe) | **Vibración háptica**: toquecitos en algunas acciones (por ejemplo, cuando termina el escaneo) y una vibración de «éxito» al llegar al baño. |
| La pantalla se puede apagar mientras caminás | La pantalla **queda encendida durante la guía** y vuelve a lo normal al salir. |
| «Abrir en Google Maps» abre la web de Google | **«Abrir en Mapas»**: abre Google Maps si está instalada y, si no, **Mapas de Apple**, en modo a pie. |
| Los links (OpenStreetMap, «¿Falta un baño?», créditos) abren otra pestaña | Se abren en **Safari dentro de la app** (con el botón «Listo» para volver). |
| Acceso directo «Urgente» de la PWA | **Mantené apretado el ícono → «Baño más cercano»** (en inglés, «Nearest toilet»): escanea y, si ya diste el permiso, arranca la guía directo. |
| Instalar como PWA, service worker, fuente de Google Fonts | No hay nada de eso: **todo viene adentro de la app** (HTML, código, el motor del mapa y la tipografía Inter). Solo necesita internet para buscar baños, para las calles del mapa y para la ruta a pie. |
| La búsqueda va a `/api/toilets` del mismo sitio | Va a `https://247-wc.vercel.app/api/toilets` por una conexión nativa. Si esa API no responde, la app consulta OpenStreetMap directo, igual que la web. |
| Barra de estado del navegador | La barra de estado sigue el tema claro u oscuro de la app; ícono con variantes oscura y «tintada» de iOS 18; pantalla de arranque con el logo. |

Además: es **solo para iPhone**, en vertical, desde **iOS 15**. El idioma
(español o inglés) sigue al del iPhone, y también se traducen el cartel de
permiso y el acceso directo.

## Requisitos

**Para los dos caminos**

- **Apple Developer Program activo** (la membresía paga, 99 USD por año) y los
  últimos acuerdos aceptados en [App Store Connect](https://appstoreconnect.apple.com)
  → **Business** (Negocios). Si hay un acuerdo pendiente, Apple rechaza las subidas.
- Un iPhone para probar (recomendado, no obligatorio).

**Camino A: con Mac**

- Una Mac con **Xcode 26 o más nuevo** (gratis en la Mac App Store). Desde abril
  de 2026 Apple solo acepta apps compiladas con el SDK de iOS 26.
- **Node.js 22 o más nuevo** ([nodejs.org](https://nodejs.org), la versión LTS).
- Git (viene con Xcode; si la Terminal te lo pide, aceptá instalar las
  «herramientas de línea de comandos»).
- No hace falta CocoaPods: el proyecto usa Swift Package Manager.

**Camino B: sin Mac**

- Este repo en GitHub, con **Actions** habilitado.
- Leé [Costos de GitHub Actions](#costos-de-github-actions) si el repo es privado.

## Paso 0: registrar el Bundle ID y crear la app en App Store Connect

Se hace **una sola vez**, antes de la primera subida (por cualquiera de los dos
caminos).

### 1. Registrar el Bundle ID `com.wc247.app`

El Bundle ID es el «documento» de la app: único en todo el App Store y no se
puede cambiar después de publicar.

- **Si vas por el Camino A**, Xcode lo registra solo la primera vez que elegís tu
  Team ([paso 2 del Camino A](#2-firmar-con-tu-cuenta-signing--capabilities)).
  Podés saltear esto.
- **Si vas por el Camino B** (o preferís hacerlo a mano):
  1. Entrá a [developer.apple.com/account](https://developer.apple.com/account) →
     **Certificates, Identifiers & Profiles** → **Identifiers** → botón **+**.
  2. Elegí **App IDs** → Continue → **App** → Continue.
  3. Description: `247WC`. Bundle ID: **Explicit** → `com.wc247.app`.
  4. No marques ninguna «Capability» (la app no usa ninguna) → Continue → Register.

Si Apple dice que `com.wc247.app` **no está disponible**, es que otra cuenta ya
lo usa: elegí otro (por ejemplo `com.tunombre.wc247`) y seguí
[Cambiar el bundle id](#cambiar-nombre-ícono-bundle-id-o-versión).

### 2. Crear la app

1. [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → botón **+** → **New App** (Nueva app).
2. Completá:
   - **Platforms:** iOS.
   - **Name:** el nombre en el App Store, **hasta 30 caracteres** y único en
     toda la tienda. Propuesta: `247WC: Baños públicos cerca` (27). Si está
     tomado, probá `247WC`. Los textos están en
     [`store/listing-es.md`](store/listing-es.md).
   - **Primary Language:** **Spanish (Mexico)** (es el español que Apple usa
     para Latinoamérica, Argentina incluida).
   - **Bundle ID:** `com.wc247.app` (si no aparece en la lista, falta el paso 1;
     si lo registró Xcode, puede figurar como «XC com wc247 app»).
   - **SKU:** un código interno tuyo que nadie ve, por ejemplo `247WC-IOS`.
   - **User Access:** Full Access.
3. Ya adentro de la app, en **App Information** (Información de la app):
   - **Category:** Primary **Navigation** (Navegación), Secondary **Travel** (Viajes).
   - Arriba a la derecha, en el selector de idioma, agregá **English (U.S.)**
     y cargá la ficha en inglés ([`store/listing-en.md`](store/listing-en.md)).
   - **Content Rights:** «Does your app contain, show, or access third-party
     content?» → **Yes**, y confirmá que tenés los derechos: los datos son de
     OpenStreetMap (licencia ODbL) y la app muestra la atribución.
4. En **Pricing and Availability**: precio **Free** (gratis) y todos los países.
5. Una vez por cuenta: en **Business** (Negocios), declará tu **estatus de
   comerciante (trader) para la Unión Europea** (Digital Services Act). Sin eso
   la app no se publica en los países de la UE. Si declarás que sos
   comerciante, Apple muestra en la ficha una dirección, un teléfono y un email
   de contacto.

## Camino A: con Mac y Xcode

### 1. Bajar el proyecto e instalar

Abrí la app **Terminal** y pegá, de a una línea:

```bash
git clone https://github.com/4zid/IOS247WC.git
cd IOS247WC
npm install
npm run ios
```

Si el repo es privado, Git te va a pedir que inicies sesión en GitHub; lo más
simple es clonarlo con [GitHub Desktop](https://desktop.github.com) (**File →
Clone repository**) y después correr en la Terminal, dentro de esa carpeta,
`npm install` y `npm run ios`.

`npm run ios` arma la web (`npm run build`), la copia al proyecto
(`npx cap sync ios`) y abre Xcode. La primera vez Xcode tarda un minuto en
bajar los paquetes de Capacitor (se ve «Fetching…» o «Resolving packages» a la
izquierda): esperá a que termine.

> Cada vez que cambies algo en `web/` o en `native/`, corré **`npm run sync`**
> antes de darle Play en Xcode. Xcode no arma la web por su cuenta.

### 2. Firmar con tu cuenta (Signing & Capabilities)

1. En la columna de la izquierda, hacé clic en **App** (el ícono azul de arriba de todo).
2. En el panel del medio, debajo de **TARGETS**, elegí **App**.
3. Pestaña **Signing & Capabilities**:
   - Dejá marcado **Automatically manage signing**.
   - **Team:** elegí tu equipo. Si no aparece: **Xcode → Settings → Accounts →
     + → Apple ID** e iniciá sesión con la cuenta del Developer Program.
   - **Bundle Identifier:** `com.wc247.app`.
4. Si abajo aparece un error rojo de firma, mirá
   [Problemas comunes](#problemas-comunes).

### 3. Probar en el simulador

1. Arriba al centro, elegí un simulador, por ejemplo **iPhone 17 Pro** (si no
   hay ninguno: **Xcode → Settings → Components** e instalá iOS).
2. Botón **▶** (o `Cmd + R`). Se abre el simulador con 247WC.
3. **El simulador no tiene GPS:** la ubicación se simula desde el menú del
   simulador **Features → Location**:
   - **Apple**: Apple Park, en Cupertino.
   - **Custom Location…**: cualquier punto. Por ejemplo, el Obelisco de Buenos
     Aires: latitud `-34.6037`, longitud `-58.3816`.
4. Tocá **Escanear baños** y aceptá el permiso de ubicación.

En el simulador **no hay brújula ni vibración**: la flecha de la guía apunta
según el norte del mapa (la app lo avisa). Para probarlas, usá tu iPhone.

### 4. Probar en tu iPhone

1. Conectá el iPhone con el cable a la Mac. En el iPhone, tocá **Confiar**.
2. Activá el **modo de desarrollador** (iOS 16 o más nuevo): en el iPhone,
   **Ajustes → Privacidad y seguridad → Modo de desarrollador** → activalo. El
   iPhone se reinicia y te pide confirmar. (La opción aparece recién después de
   conectar el iPhone a Xcode una vez.)
3. En Xcode, arriba al centro, elegí **tu iPhone** y dale **▶**. Xcode lo
   registra en tu cuenta y firma la app solo.
4. Si al abrirla el iPhone dice que el desarrollador no es de confianza:
   **Ajustes → General → VPN y gestión de dispositivos** → tu cuenta → **Confiar**.

Probá todo: escanear, la guía con la brújula (caminá un poco), la vibración al
llegar, «Abrir en Mapas», y el acceso directo (mantené apretado el ícono →
**Baño más cercano**).

### 5. Subir a App Store Connect

1. Revisá la versión: **TARGETS → App → General → Identity**. **Version**
   es la que ve la gente (`1.0.0`) y **Build** es un número que tiene que
   crecer en cada subida (`1`, `2`, `3`…).
2. Arriba al centro, elegí **Any iOS Device (arm64)** como destino.
3. Menú **Product → Archive**. Tarda unos minutos; al terminar se abre el **Organizer**.
4. Elegí el archivo recién creado → **Distribute App** → **App Store Connect**
   → **Distribute**. Xcode firma con tu certificado de distribución (lo crea si
   no existe) y sube la app.
5. Apple la procesa (unos 15 a 30 minutos) y te llega un mail. Después aparece
   en **App Store Connect → Apps → 247WC → TestFlight**.
6. Para instalarla en tu iPhone como la va a ver la gente: en **TestFlight →
   Internal Testing** creá un grupo, sumate como tester y abrí la app
   **TestFlight** en el iPhone.

Seguí con [Completar la ficha del App Store](#completar-la-ficha-del-app-store).

## Camino B: subir sin Mac

Una Mac de GitHub arma la app, la firma y la sube a TestFlight. Vos solo cargás
cuatro datos de tu cuenta de Apple como «secretos» del repo y apretás un botón.

**Antes:** hacé el [Paso 0](#paso-0-registrar-el-bundle-id-y-crear-la-app-en-app-store-connect).
La app tiene que existir en App Store Connect con el Bundle ID `com.wc247.app`
ya registrado; si no, la subida falla.

### 1. Crear una clave de API de App Store Connect

1. [App Store Connect](https://appstoreconnect.apple.com) → **Users and Access**
   (Usuarios y acceso) → pestaña **Integrations** (Integraciones) → **App Store
   Connect API** → **Team Keys** (Claves del equipo).
   - La primera vez, el **Account Holder** (titular de la cuenta) tiene que
     tocar **Request Access** y aceptar los términos.
2. Botón **+** (Generate API Key). Nombre: `GitHub 247WC`. Acceso: **Admin**.
   Tiene que ser Admin: con un rol menor Apple no deja crear el certificado de
   distribución en la nube que usa el workflow.
3. **Descargá el archivo `.p8`** (se llama `AuthKey_XXXXXXXXXX.p8`). **Se puede
   bajar una sola vez**: guardalo en un lugar seguro (por ejemplo, tu gestor de
   contraseñas). Nunca lo subas al repo.
4. Anotá dos datos de esa misma página:
   - **Key ID**: 10 letras y números, en la fila de la clave.
   - **Issuer ID**: el código largo con guiones que está arriba de la lista.

### 2. Buscar tu Team ID

[developer.apple.com/account](https://developer.apple.com/account) → **Membership
details** → **Team ID** (10 letras y números).

### 3. Cargar los 4 secretos en GitHub

En el repo de GitHub: **Settings → Secrets and variables → Actions → New
repository secret**. Creá estos cuatro, con estos nombres exactos:

| Nombre | Qué va |
|---|---|
| `APPLE_TEAM_ID` | El Team ID |
| `ASC_KEY_ID` | El Key ID de la clave |
| `ASC_ISSUER_ID` | El Issuer ID |
| `ASC_PRIVATE_KEY` | **Todo** el contenido del `.p8`: abrilo con TextEdit (o el Bloc de notas) y copiá desde `-----BEGIN PRIVATE KEY-----` hasta `-----END PRIVATE KEY-----` inclusive |

Si se cuela un espacio o un salto de línea de más al pegar, no pasa nada: el
workflow lo limpia, valida la clave antes de gastar minutos y, si algo está mal,
te dice en castellano qué secreto revisar.

### 4. Correr el workflow TestFlight

1. Pestaña **Actions** del repo → a la izquierda **TestFlight** → botón **Run workflow**.
   - El botón aparece solo cuando el archivo `.github/workflows/testflight.yml`
     ya está en la rama principal del repo (normalmente `main`).
2. Dos campos opcionales:
   - **Qué probar**: un texto para TestFlight (sin emojis).
   - **Versión**: por ejemplo `1.0.1`. Vacío = la del proyecto (`1.0.0`). El
     número de build se pone solo (número de corrida + 100), así que nunca choca.
3. **Run workflow**. El trabajo **Archivar, firmar y subir** tarda unos 10
   minutos; después **Esperar a Apple** espera a que Apple termine de procesar
   el build (unos 15 minutos más) y carga el texto de «Qué probar».
4. Cuando termina: **App Store Connect → Apps → 247WC → TestFlight**. Sumate
   como tester interno y abrí la app **TestFlight** en el iPhone.

**Si falla:** entrá a la corrida (Actions → la corrida en rojo). En el
**Summary** hay una explicación en castellano de los errores conocidos (falta
la app en App Store Connect, acuerdos sin aceptar, clave sin permisos, número
de build repetido…) y abajo, en **Artifacts**, los logs completos
(`testflight-logs`).

**Cómo firma (por si te lo preguntan):** la Mac de GitHub arma la app sin
firmar y la firma recién al exportarla, con un certificado de distribución que
Apple administra en la nube y la clave de API. Así no hace falta tener una Mac,
ni certificados `.p12`, ni iPhones registrados.

### El otro workflow: «iOS build»

`.github/workflows/ios.yml` corre solo en cada push a `main` (y en los pull
requests) que toque la app. Primero corre las pruebas en Linux (barato) y, si
pasan, compila la app en una Mac, sin firmar, para avisarte enseguida si algo se
rompió. No sube nada a Apple. Las capturas de las pruebas quedan como artifact
(`capturas-pruebas`).

## Completar la ficha del App Store

Todo esto está en la página de la versión (**1.0 Prepare for Submission**) y en
el menú de la izquierda de la app en App Store Connect.

### Textos de la ficha

Copiá y pegá de [`store/listing-es.md`](store/listing-es.md) (Spanish (Mexico))
y [`store/listing-en.md`](store/listing-en.md) (English (U.S.)): nombre,
subtítulo, texto promocional, descripción, palabras clave, URL de soporte y de
marketing, y derechos de autor. Cada campo tiene contados los caracteres.

### Privacidad

Apple pide dos cosas: **la URL de una política de privacidad** y **el
cuestionario «App Privacy»** (la «etiqueta nutricional» de la ficha).

**1. Publicar la política.** Ya está escrita, en español y en inglés:
[`store/privacy.html`](store/privacy.html). Antes de publicarla, buscá
`[TU EMAIL DE CONTACTO]` y reemplazalo por tu email. Después, una de estas:

- **En la web de 247WC (recomendado):** en GitHub, entrá al repo de la web
  ([4zid/247wc](https://github.com/4zid/247wc)) → **Add file → Upload files** →
  arrastrá `privacy.html` → **Commit changes**. Vercel la publica sola en unos
  segundos en **https://247-wc.vercel.app/privacy.html**. Abrí esa URL para
  confirmar que carga.
- **En Framer (o Webflow):** creá una página (por ejemplo `/privacidad`) y pegá
  el texto. Tiene que ser pública y no pedir login.

La URL va en **App Privacy → Privacy Policy URL**.

**2. El cuestionario «App Privacy».** Las respuestas exactas, paso a paso,
están en [`store/app-privacy.md`](store/app-privacy.md). En corto: **sí** se
recopilan datos, solo **Ubicación precisa** y **Ubicación aproximada**, solo
para **funcionalidad de la app**, **no** vinculadas a tu identidad y **no**
usadas para rastreo. Es lo mismo que declara el archivo
`ios/App/App/PrivacyInfo.xcprivacy` que va adentro de la app, y las dos cosas
tienen que coincidir.

**3. Link a la política dentro de la app.** Apple también pide (pauta 5.1.1)
que la política se pueda abrir desde la app. Hoy el modal de Info no tiene ese
link. Se agrega pisando el texto `infoP` en `native/text.js`, en `es` y en `en`,
por ejemplo:

```js
infoP: 'El baño público más cercano, sin vueltas. <strong>Tu ubicación no se guarda</strong>: se usa en el teléfono para ordenar por cercanía, y a nuestra búsqueda solo llega una zona aproximada. <a href="https://247-wc.vercel.app/privacy.html">Política de privacidad</a>',
```

(`bridge.js` ya abre los links `https://` en Safari dentro de la app.) Después:
`npm test`, `npm run sync` y subir de nuevo.

### Clasificación por edad

**App Information → Age Rating → Set Up / Edit.** Respondé **No** o **None**
(Ninguno) a **todas** las preguntas. El resultado es **4+**. Las que pueden
generar dudas:

- **Unrestricted Web Access** (acceso web sin restricciones): **No**. La app
  abre páginas puntuales (OpenStreetMap, los créditos) en Safari dentro de la
  app; no es un navegador.
- **User-Generated Content** (contenido de usuarios): **No**. Muestra datos
  públicos de OpenStreetMap, pero nadie publica nada adentro de la app: «¿Falta
  un baño?» abre la web de OpenStreetMap.
- **Advertising, Messaging and Chat, Parental Controls, Age Assurance**: **No**.
- **Alcohol, Tobacco, or Drug Use or References**: **None**. Que aparezcan
  bares como lugares con baño no es una referencia al consumo.

### Cumplimiento de exportación (encriptación)

**Ya está resuelto.** `ios/App/App/Info.plist` declara
`ITSAppUsesNonExemptEncryption = NO` (la app solo usa HTTPS, que está exento),
así que App Store Connect no pregunta nada y TestFlight no muestra «Missing
Compliance».

### Capturas de pantalla

- **Obligatorias:** las de **iPhone de 6,9"**: **1320 × 2868 px** o
  **1290 × 2796 px**, en vertical. Entre 1 y 10 por idioma, en PNG o JPG, sin
  transparencia. Con esas, App Store Connect arma solo las de los iPhone más chicos.
- **iPad: no hace falta.** La app es solo para iPhone, así que App Store Connect
  no las pide.
- Si no cargás capturas en inglés, la ficha en inglés usa las del idioma principal.

Dos formas de hacerlas:

1. **Desde el simulador (Camino A):** elegí el simulador **iPhone 17 Pro Max**
   (su pantalla mide justo 1320 × 2868), simulá una ubicación con muchos baños
   (**Features → Location → Custom Location…**, por ejemplo el Obelisco) y en
   cada pantalla apretá **`Cmd + S`**: la captura queda en el Escritorio, ya en
   el tamaño correcto. Para cambiar de idioma: botón de ajustes (arriba a la
   derecha de la app) → Idioma. Opcional, para que la hora diga 9:41 y la
   batería esté llena, en la Terminal:
   ```bash
   xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100
   ```
2. **En Figma (o Framer):** frames de **1320 × 2868** (o 1290 × 2796), con las
   capturas adentro y un título arriba si querés. Exportá a 1x en **JPG**, que
   nunca lleva transparencia (lo más seguro). Sin Mac, sacá las capturas en tu
   iPhone, con la app instalada desde TestFlight, y llevalas a esos frames.

Las capturas tienen que mostrar la app de verdad, en uso. Las pantallas que
mejor la venden: el escaneo, la tarjeta del más cercano con el minimapa, la
guía con la flecha, la lista con los filtros y el modo oscuro.

### Notas para la revisión

En la página de la versión, sección **App Review Information**:

- **Sign-in required:** desmarcado (la app no tiene login).
- **Contact Information:** tu nombre, teléfono y email (Apple los usa solo si
  necesita hablar con vos).
- **Notes:** pegá el bloque en inglés de [`store/review-notes.md`](store/review-notes.md).
  Explica para qué se usa la ubicación, cómo probar la app en un minuto y qué
  tiene de nativo (eso ayuda contra el rechazo por «es solo una web»,
  pauta 4.2).

## Enviar a revisión

1. En la página de la versión, en **Build**, tocá **+** (Add Build) y elegí el
   build que subiste (tiene que haber terminado de procesarse).
2. Revisá que no quede nada en rojo: capturas, textos en los dos idiomas, URL
   de soporte, derechos de autor, App Privacy publicado, clasificación por
   edad, precio.
3. **Save** → **Add for Review** → **Submit for Review** (Enviar a revisión).
4. La revisión suele tardar entre 24 y 48 horas. Te llegan mails con cada
   cambio de estado. En **Version Release** podés elegir que se publique sola
   al aprobarse o publicarla vos a mano.
5. Si la rechazan, el motivo aparece en **App Review** (Resolution Center).
   Podés contestar ahí mismo; muchas veces alcanza con una explicación.

## Actualizar la app cuando cambia la web

La app **no se actualiza sola** cuando publicás cambios en la web: el HTML y el
código van adentro de la app. (De la web, lo único que la app usa en vivo es la
API `/api/toilets`; ver [El dominio de la API](#el-dominio-de-la-api).) Para
llevar los cambios de la web a la app:

1. **Traer la web nueva:**
   ```bash
   npm run web:update
   ```
   Baja la última versión de [4zid/247wc](https://github.com/4zid/247wc), la
   copia a `web/`, anota de qué commit vino (`web/UPSTREAM.json`) y prueba que
   la app se siga armando.
2. **Probar:** `npm test` (ver [Pruebas](#pruebas)).
3. **Guardar el cambio en git:** `git add -A && git commit -m "Web al día" && git push`
   (o, en GitHub Desktop, **Commit to main** y **Push origin**).
4. **Subir la versión:** cada subida necesita un **Build** más alto; si la
   versión anterior ya se publicó, también una **Version** más alta (por
   ejemplo `1.0.1`).
   - **Camino A:** `npm run sync`, cambiá Version y Build en Xcode (General →
     Identity) y repetí **Product → Archive → Distribute App**.
   - **Camino B:** corré el workflow **TestFlight** con la versión nueva en el
     campo **Versión** (el build se pone solo).
5. En App Store Connect: botón **+** al lado de «iOS App» → nueva versión
   (`1.0.1`) → «What's New in This Version» → elegí el build → **Submit for Review**.

**Si el paso 1 dice que cambió el upstream.** Cada parche que la app le aplica
a la web busca un texto exacto (un «ancla»). Si la web cambió justo ahí, el
build frena con un mensaje como este, en vez de armar una app rota:

```
✗ web/ se actualizó, pero el build ya no aplica:
Parche «…» en index.html: el ancla … aparece 0 veces y tiene que aparecer exactamente una.
```

Qué hacer:

- **No edites `web/` a mano** (se pisa en la próxima actualización).
- Para volver a la versión anterior, que sí funciona: `git restore web/`.
- Para adaptar la app: hay que ajustar el ancla de ese parche en
  `scripts/build-web.mjs`. Es un cambio chico para alguien que programe (o para
  Claude Code: pasale el mensaje de error completo). Después, `npm test`.
- Si en cambio aparece un aviso `⚠ … usa «archivo», que no se copia a web/`, la
  web empezó a usar un archivo nuevo: hay que sumarlo a la lista `COPY` de
  `scripts/update-web.mjs` y a `WEB_FILES` de `scripts/build-web.mjs`.

## Cambiar nombre, ícono, bundle id o versión

| Qué | Dónde |
|---|---|
| **Nombre en el App Store** | App Store Connect → App Information → Name (por idioma). No toca la app. |
| **Nombre debajo del ícono** (`247WC`) | `CFBundleDisplayName` en `ios/App/App/Info.plist` y en los dos `InfoPlist.strings` (`ios/App/App/en.lproj/` y `ios/App/App/es.lproj/`). Cortito: con más de 12 caracteres, más o menos, iOS lo corta con «…». |
| **Ícono y pantalla de arranque** | Editá los SVG de `brand-src/` (`icon.svg`, `icon-dark.svg`, `symbol-white.svg`, `logo-stacked*.svg`) y corré `npm run assets`. Genera los PNG en `ios/App/App/Assets.xcassets/` y una hoja para revisarlos en `tests/.output/assets-contact.png`. Necesita ImageMagick (`brew install imagemagick`) y Chromium (`npx playwright install chromium`). Si cambiaste los colores de la marca, el script frena: actualizá los colores al principio de `scripts/make-assets.mjs`. Sin Mac ni script: reemplazá los PNG de `ios/App/App/Assets.xcassets/AppIcon.appiconset/` por otros de 1024 × 1024, **sin transparencia**, con los mismos nombres. |
| **Bundle ID** | Xcode → TARGETS → App → General → **Bundle Identifier**, y el mismo valor en `appId` de `capacitor.config.json`. Registralo en developer.apple.com (Paso 0). Ojo: una vez publicada, cambiar el Bundle ID es crear **otra app**. |
| **Versión y build** | Xcode → TARGETS → App → General → Identity (**Version** y **Build**). En el Camino B, el campo **Versión** del workflow TestFlight (el build es automático). |
| **Textos del permiso de ubicación** | `NSLocationWhenInUseUsageDescription` y `NSLocationTemporaryUsageDescriptionDictionary` en `ios/App/App/Info.plist` (inglés) y en los dos `InfoPlist.strings` (inglés y español). |
| **Título del acceso directo** | `UIApplicationShortcutItemTitle` en `Info.plist` (`Nearest toilet`) y la línea `"Nearest toilet" = …` de cada `InfoPlist.strings`. |
| **Textos de la web que cambian en la app** | `native/text.js` (español e inglés). |

Después de cualquier cambio: `npm run sync` y volver a compilar. iOS guarda en
caché el ícono y la pantalla de arranque: para ver los nuevos, **borrá la app**
del iPhone o del simulador y volvé a instalarla (a veces también hay que
reiniciar el iPhone).

## El dominio de la API

La búsqueda de baños va a la función de Vercel de la web. La dirección está en
una constante al principio de `native/bridge.js`:

```js
const API_BASE = 'https://247-wc.vercel.app';
```

- **Confirmá que ese es el dominio real** donde está publicada la web (abrí
  `https://247-wc.vercel.app/landing` en el navegador). Si la web se muda a un
  dominio propio, cambiá esa línea, corré `npm test` (la prueba T2 también
  busca ese dominio, en `tests/bridge.e2e.mjs`), `npm run sync` y publicá una
  versión nueva.
- **Si la API no responde, la app sigue funcionando:** consulta OpenStreetMap
  (Overpass) directo desde el teléfono, como hace la web.
- **Cuidado al cambiar la API en la web:** las apps ya instaladas la usan en
  vivo. Si cambiás el formato de la respuesta de `/api/toilets`, que siga
  siendo compatible con lo que espera `app.js` (una lista `elements` con la
  forma de Overpass). Si no, las versiones ya instaladas podrían decir «No hay
  baños mapeados acá» aunque los haya: el plan B solo entra cuando la API falla,
  no cuando contesta otra cosa.

## Costos de GitHub Actions

- **Repo público:** las Mac de GitHub son gratis.
- **Repo privado:** el plan gratis trae **2000 minutos por mes**, y **cada
  minuto de macOS cuenta como 10**. Más o menos:
  - **iOS build** (en cada push a `main` que toque la app): ~3 min de Linux + 4 a
    6 de macOS ≈ **40 a 60 minutos** de los incluidos.
  - **TestFlight** (cuando lo corrés vos): ~10 min de macOS ≈ **60 a 100
    minutos**, más la espera en Linux, que cuesta poco.
  - Con 2000 minutos te alcanzan unas 35 compilaciones o unas 20 subidas a
    TestFlight por mes (o una mezcla).
- Mirá el consumo en GitHub → tu foto → **Settings → Billing and licensing →
  Usage**. Si no cargaste un medio de pago (o el presupuesto está en 0), cuando
  se acaban los minutos los workflows dejan de correr hasta el mes siguiente:
  no hay cobros sorpresa.
- Si te quedás corto: **Actions → iOS build → ⋯ → Disable workflow** apaga la
  compilación automática; el workflow TestFlight sigue andando.

## Problemas comunes

**«Signing for "App" requires a development team»**
Falta elegir el Team: [Camino A, paso 2](#2-firmar-con-tu-cuenta-signing--capabilities).

**«Failed to register bundle identifier» / «The app identifier "com.wc247.app" cannot be registered to your development team»**
Otra cuenta ya usa ese Bundle ID. Elegí otro y seguí
[Cambiar el bundle id](#cambiar-nombre-ícono-bundle-id-o-versión).

**«No such module 'Capacitor'», «Missing package product 'CapApp-SPM'» o errores de paquetes que mencionan `@capacitor/status-bar`**
Los paquetes de Swift salen de `node_modules/`. Cerrá Xcode y corré:
```bash
npm install
npm run sync
```
Si sigue: en Xcode, **File → Packages → Reset Package Caches** y después
**File → Packages → Resolve Package Versions**.

**La app abre en blanco**
Faltó `npm run sync`: la carpeta con la web adentro del proyecto
(`ios/App/App/public/`) se genera y no está en git. Corré `npm run sync` y
volvé a darle ▶.

**Cambié algo en `web/` o `native/` y no se ve**
Lo mismo: `npm run sync` y ▶ de nuevo.

**En el simulador dice «No pudimos ubicarte»**
Simulá una ubicación: menú del simulador **Features → Location → Apple** (o
Custom Location…). Si negaste el permiso, en el simulador: **Ajustes → 247WC →
Ubicación → Al usar la app**.

**La flecha no gira en el simulador**
Es normal: no tiene brújula. Probalo en un iPhone.

**El ícono o la pantalla de arranque no cambian**
iOS los guarda en caché. Borrá la app, en Xcode **Product → Clean Build Folder**
(`Shift + Cmd + K`) y volvé a instalar. En el simulador también sirve
**Device → Erase All Content and Settings**.

**«Developer Mode disabled» o el iPhone no aparece en Xcode**
Activá el modo de desarrollador ([Camino A, paso 4](#4-probar-en-tu-iphone)),
desbloqueá el iPhone y tocá **Confiar** al conectarlo.

**Al subir: «The bundle version must be higher than the previously uploaded version»**
Subí el **Build** (Xcode → General → Identity). En el Camino B no pasa: el
número sale de la corrida.

**Al subir: «Invalid Pre-Release Train» o la versión ya está cerrada**
Esa **Version** ya se publicó o está en revisión: usá una más alta (`1.0.1`).

**El workflow TestFlight falla**
Leé el **Summary** de la corrida: explica en castellano los errores conocidos
y deja los logs en **Artifacts**. Lo más común: falta crear la app en App Store
Connect, un acuerdo sin aceptar en **Business**, o la clave de API sin rol
**Admin**.

**`npm test` dice que falta Chromium («Executable doesn't exist»)**
Corré una vez `npx playwright install chromium`.

**Quiero ver la consola de la web adentro de la app**
Con la app corriendo desde Xcode (simulador o iPhone): en Safari de la Mac,
**Desarrollo** (activalo en Safari → Ajustes → Avanzado) → tu simulador o
iPhone → **247WC**.

## Pruebas

```bash
npx playwright install chromium   # solo la primera vez
npm test
```

`npm test` arma `www/` y corre `tests/bridge.e2e.mjs`: abre la app en Chromium
simulando un iPhone, con la parte nativa de Capacitor imitada
(`tests/fixtures/capacitor-mock.js`), y revisa 12 escenarios (T1 a T12):
ubicación, permiso negado con el botón Abrir Ajustes, la guía con brújula y
pantalla encendida, vibración, links y mapas, tema claro y oscuro, pantalla de
arranque, acceso directo, el modal de Info, la API con su plan B y los detalles
de la ubicación. Si algo falla, sale con error. Deja capturas en `tests/.output/`.

Para correr solo algunas: `node tests/bridge.e2e.mjs T2 T4`.

Estas pruebas no compilan el Swift; eso lo hacen Xcode (Camino A) y el
workflow **iOS build** (Camino B).

## Estructura del repo

```
README.md                  esta guía
package.json               scripts: build, sync, ios, test, assets, web:update
capacitor.config.json      id de la app (com.wc247.app), nombre y ajustes de Capacitor

web/                       copia de la web 4zid/247wc. NO se edita a mano
  UPSTREAM.json            de qué commit vino
native/                    capa nativa del lado web (se inyecta en www/index.html)
  bridge.js                reemplaza ubicación, brújula, vibración, links, fetch… por lo nativo
  text.js                  textos de la web que cambian en la app (es/en)
  native.css               retoques mínimos de estilo
www/                       la web armada para la app (se genera; no está en git)

ios/App/
  App.xcodeproj            el proyecto de Xcode (se abre con npm run ios)
  App/
    WCNativePlugin.swift   plugin propio: ubicación, brújula, pantalla, mapas, ajustes, acceso directo
    MainViewController.swift  registra el plugin
    SceneDelegate.swift    arma la ventana y atiende el acceso directo del ícono
    AppDelegate.swift      el de Capacitor, sin cambios
    Info.plist             permisos, acceso directo, orientación, encriptación
    PrivacyInfo.xcprivacy  manifiesto de privacidad (qué datos se usan y para qué)
    en.lproj/, es.lproj/   textos del sistema traducidos (InfoPlist.strings)
    Assets.xcassets/       ícono (claro, oscuro, tintado) e imagen de arranque
    Base.lproj/            pantalla de arranque (LaunchScreen.storyboard)
    public/                la web copiada por npm run sync (no está en git)
  CapApp-SPM/              paquetes de Swift de los plugins (lo reescribe npm run sync)

brand-src/                 SVG de marca de donde salen el ícono y el arranque
scripts/
  build-web.mjs            arma www/ (npm run build)
  update-web.mjs           trae la web nueva (npm run web:update)
  make-assets.mjs          genera ícono y arranque (npm run assets)
  dev/configure-xcode.rb   deja el proyecto de Xcode configurado (para desarrolladores)
tests/
  bridge.e2e.mjs           pruebas de la capa nativa (npm test)
  fixtures/                datos falsos para las pruebas
.github/
  workflows/ios.yml        compila en cada push a main
  workflows/testflight.yml sube a TestFlight sin Mac
  ci/                      ayudantes de esos workflows
docs/NATIVE-API.md         contrato entre la web y la capa nativa
store/                     todo para el App Store
  listing-es.md            ficha en español (con los caracteres contados)
  listing-en.md            ficha en inglés
  privacy.html             política de privacidad lista para publicar
  app-privacy.md           respuestas del cuestionario App Privacy
  review-notes.md          notas para la revisión de Apple (inglés + traducción)
  CHECKLIST.md             lista para revisar antes de enviar
```
