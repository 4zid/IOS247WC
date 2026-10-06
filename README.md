# 247WC para iPhone

**La web app 247WC (el baño público más cercano, con guía caminando) convertida
en una app de iPhone lista para el App Store.**

Esta guía está pensada para alguien que diseña en Figma, Framer o Webflow y
nunca abrió Xcode. Hay dos caminos para subir la app: **con una Mac** (Camino A)
o **sin Mac**, dejando que una Mac de GitHub haga el trabajo (Camino B). Elegí
uno; todo lo demás es igual para los dos.

Los textos para el App Store, la política de privacidad, la página de soporte
y las notas para la revisión ya están escritos en [`store/`](store/). Antes de
enviar a revisión, recorré [`store/CHECKLIST.md`](store/CHECKLIST.md).

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
15. [La landing de promo](#la-landing-de-promo)
16. [Estructura del repo](#estructura-del-repo)

---

## Qué es esto

La app es **la misma web** de [4zid/247wc](https://github.com/4zid/247wc)
metida adentro de una app de iOS con [Capacitor](https://capacitorjs.com/) 8, más
una **capa nativa** que reemplaza lo que en una app no anda bien desde el
navegador: el permiso de ubicación, la brújula, la vibración, la pantalla
encendida y los links. También suma el gesto de iOS de deslizar desde el borde
para volver, y la guía muestra el mapa con el recorrido mientras caminás.

```
web/      la web, copiada tal cual de 4zid/247wc (no se edita a mano)
native/   la capa nativa del lado web: bridge.js, text.js, gestures.js, guide.js, native.css
   │
   │  npm run build   copia web/ + native/ a www/ y aplica 17 parches chiquitos
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
| El navegador pide la ubicación con un cartel que dice «localhost» o el dominio | **Ubicación nativa** (Core Location): el cartel es el de iOS, dice «247WC» y explica para qué la usa. Pide «Al usar la app», nunca en segundo plano. Si el iPhone tiene la ubicación en «aproximada», pide la exacta solo para esa vez. Si un «Permitir una vez» vence en plena guía, lo vuelve a pedir, y si sacás el permiso y lo volvés a dar, la guía sigue sola. |
| Si negaste el permiso, la ayuda habla de Safari, del botón «aA» y de copiar el link | Textos propios de la app con un botón **Abrir Ajustes** que va directo a Ajustes → 247WC. |
| Brújula del navegador (con su propio permiso) | **Brújula con Core Location**: la flecha gira sin pedir otro permiso. Se apaga sola cuando salís de la app, para no gastar batería. |
| `navigator.vibrate` (en iPhone no existe) | **Vibración háptica**: toquecitos en algunas acciones (por ejemplo, cuando termina el escaneo) y una vibración de «éxito» al llegar al baño. |
| La pantalla se puede apagar mientras caminás | La pantalla **queda encendida durante la guía** y vuelve a lo normal al salir. |
| «Abrir en Google Maps» abre la web de Google | **«Abrir en Mapas»** (con un ícono neutro de indicaciones, un rombo azul, en vez del pin de Google): abre Google Maps si está instalada y, si no, **Mapas de Apple**, en modo a pie. |
| Los links (OpenStreetMap, «¿Falta un baño?», créditos) abren otra pestaña | Se abren en **Safari dentro de la app** (con el botón «Listo» para volver). |
| Acceso directo «Urgente» de la PWA | **Mantené apretado el ícono → «Baño más cercano»** (en inglés, «Nearest toilet»): escanea y, si ya diste el permiso, arranca la guía directo. |
| Instalar como PWA, service worker, fuente de Google Fonts | No hay nada de eso: **todo viene adentro de la app** (HTML, código, el motor del mapa y la tipografía Inter). Solo necesita internet para buscar baños, para las calles del mapa y para la ruta a pie. |
| La búsqueda va a `/api/toilets` del mismo sitio | Va a `https://247-wc.vercel.app/api/toilets` por una conexión nativa. Si esa API no responde, la app consulta OpenStreetMap directo, igual que la web. |
| Barra de estado del navegador | La barra de estado sigue el tema claro u oscuro de la app; ícono con variantes oscura y «tintada» de iOS 18; pantalla de arranque con el logo. |
| El botón redondo de la derecha, arriba del botón azul («Centrar en mi ubicación»), tiene una flecha de navegación y te muestra solo tu punto, muy de cerca (zoom 17) | **«Mi ubicación»**: el ícono es un anillo con un punto azul adentro (como tu punto en el mapa) y al tocarlo quedás en el centro del mapa, un poco más de lejos, con los **baños más cercanos a la vista**: hasta 3, a menos de 1 km, de los que muestra la lista (con tus filtros). Si no hay ninguno a menos de 1 km, igual quedás en el centro, con unos 600 m a tu alrededor a la vista (unas 6 cuadras para cada lado). Si la app todavía no sabe dónde estás, escanea, igual que la web. |
| En los iPhone con Face ID, el botón azul («Escanear baños») queda a unos 50 px de la hoja de abajo: la web le suma el área segura de abajo (la barra de inicio), que en el iPhone ya tapa la hoja | **El botón azul queda a 12 px de la hoja, y «Mi ubicación» a su derecha, en la misma fila** (alineados por el centro). Los avisos de abajo bajan con ellos. Si el texto del botón azul es largo y el iPhone angosto («Buscando en esta zona…» en un iPhone SE o mini), el botón azul se corre un poco a la izquierda para no tocar a «Mi ubicación»; en pantallas de 320 px (el iPhone SE de 1.ª generación y, con el «Zoom de pantalla» de iOS en «Texto más grande», el SE de 2.ª/3.ª generación, los mini y los de 6,1"), además, los textos más largos («Buscando en esta zona…», «Sumar bares y negocios») terminan en «…». |
| Para volver hay que tocar «Lista», bajar la hoja o tocar la X | **Deslizar desde el borde izquierdo para volver**, como en las apps de iOS: del detalle de un baño a la lista (mientras deslizás, el detalle se corre y deja ver la lista debajo, donde la habías dejado); la lista o la tarjeta del más cercano abiertas enteras bajan siguiendo al dedo y queda el mapa; el modal de Info (ajustes) se corre y se cierra. Si la soltás antes de un tercio de la pantalla (y sin envión), todo vuelve a su lugar; lo mismo si apoyás un segundo dedo. Mientras termina un gesto no empieza otro, así dos deslizamientos seguidos no vuelven a abrir la lista. El dedo tiene que arrancar pegado al borde (los primeros 24 px). **No** funciona en la portada, en la introducción ni en la guía (la guía se cierra con la X, para no salir sin querer mientras caminás), ni con la hoja abajo y sin un baño abierto (ahí no hay a dónde volver). |
| La guía tapa toda la pantalla con la brújula grande; para ver el mapa hay que tocar «Ver en el mapa» (y la guía queda en pausa). La distancia es en línea recta y la indicación es la maniobra más cercana, aunque ya la hayas pasado | **La guía con el mapa**: arriba, el mapa te sigue mientras caminás y el recorrido se va acortando desde tu punto (lo caminado desaparece). Abajo, un panel con la brújula más chica al centro, la distancia y los minutos que faltan **por el recorrido** a los costados, la **próxima** indicación («Seguí hasta 120 m: girá a la derecha…») y un solo botón, «Abrir en Mapas». Si movés el mapa con el dedo deja de seguirte y aparece un botón para volver a centrar. Los otros baños se ven tenues y no se pueden tocar (para no cambiar de destino sin querer). Si te desviás, recalcula la ruta midiendo la distancia a la línea del recorrido (la web, solo a sus esquinas, y en una cuadra larga recalculaba sin motivo). |

Además: es **solo para iPhone**, en vertical, desde **iOS 15**. El idioma
(español o inglés) sigue al del iPhone, y también se traducen el cartel de
permiso y el acceso directo.

## Requisitos

**Para los dos caminos**

- **Apple Developer Program activo** (la membresía paga, 99 USD por año) y los
  últimos acuerdos aceptados en [App Store Connect](https://appstoreconnect.apple.com)
  → **Business** (Negocios). Si hay un acuerdo pendiente, Apple rechaza las subidas.
- Un iPhone para probar. En el **Camino A** hace falta conectarlo a Xcode al
  menos una vez antes de archivar (sin un iPhone registrado, Xcode no puede
  firmar); en el **Camino B** no es obligatorio, pero conviene probar con
  TestFlight antes de enviar a revisión.

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

Se hace **una sola vez**, antes de la primera subida, sea cual sea el camino, y
**en este orden**: primero el Bundle ID y después la app, porque App Store
Connect solo deja elegir Bundle IDs que ya están registrados.

### 1. Registrar el Bundle ID `com.wc247.app`

El Bundle ID es el «documento» de la app: único en todo el App Store y no se
puede cambiar después de publicar. Lo registrás a mano, también si vas por el
Camino A (después Xcode usa este mismo):

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
   - **Bundle ID:** `247WC - com.wc247.app`. Si no aparece en la lista, falta
     el paso 1 (o lo acabás de registrar: esperá unos minutos y recargá la página).
   - **SKU:** un código interno tuyo que nadie ve, por ejemplo `247WC-IOS`.
   - **User Access:** Full Access.
3. Ya adentro de la app, en **App Information** (Información de la app):
   - **Category:** Primary **Navigation** (Navegación), Secondary **Travel** (Viajes).
   - Arriba a la derecha, en el selector de idioma, agregá **English (U.S.)**
     y cargá la ficha en inglés ([`store/listing-en.md`](store/listing-en.md)).
   - **Content Rights:** «Does your app contain, show, or access third-party
     content?» → **Yes**, y confirmá que tenés los derechos: los datos son de
     OpenStreetMap (licencia ODbL) y la app muestra la atribución.
4. En **Pricing and Availability**: precio **Free** (gratis) y todos los países
   menos **China continental** (pide un número de registro ICP).
   Más abajo, en la misma página, **desmarcá** la disponibilidad en **Mac con
   Apple silicon** («iPhone and iPad Apps on Apple Silicon Macs») y en **Apple
   Vision Pro**: la guía depende de la brújula y el GPS del iPhone, que ahí no
   existen, y Apple podría probarla (y rechazarla) en una Mac.
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
   registra en tu cuenta y firma la app solo. **Hacelo al menos una vez antes
   del paso 5:** con la firma automática, Xcode no puede archivar si tu cuenta
   no tiene ningún iPhone registrado.
4. Si al abrirla el iPhone dice que el desarrollador no es de confianza:
   **Ajustes → General → VPN y gestión de dispositivos** → tu cuenta → **Confiar**.

Probá todo: escanear, la guía con la brújula (caminá un poco), la vibración al
llegar, «Abrir en Mapas», «Mi ubicación», deslizar desde el borde izquierdo
para volver (desde el detalle de un baño o la lista abierta) y el acceso
directo (mantené apretado el ícono → **Baño más cercano**).

### 5. Subir a App Store Connect

> **Antes de archivar:** tu cuenta tiene que tener al menos un iPhone
> registrado. Si hiciste el [paso 4](#4-probar-en-tu-iphone), ya está. Si no
> tenés un iPhone para conectar, subí la app por el
> [Camino B](#camino-b-subir-sin-mac), que no lo necesita.

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

En el repo de GitHub: **Settings → Environments → APPLE → Add environment
secret** (si el environment `APPLE` no existe, crealo con **New environment**).
El workflow lee los secretos de ahí; si preferís cargarlos como secretos del
repo (**Settings → Secrets and variables → Actions → New repository secret**),
también funciona. Creá estos cuatro, con estos nombres exactos:

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
     ya está en la rama principal del repo (`prod`).
2. Dos campos opcionales:
   - **Qué probar**: un texto para TestFlight (sin emojis).
   - **Versión**: por ejemplo `1.0.1`. Vacío = la del proyecto (`1.0.0`). El
     número de build se pone solo (número de corrida + 100), así que no choca
     con los que subas desde Xcode (1, 2, 3…). Si alguna vez choca igual (por
     ejemplo, subiste builds desde otro repo), creá la **variable**
     `BUILD_NUMBER_OFFSET` en **Settings → Secrets and variables → Actions →
     pestaña Variables → New repository variable**, con un número más alto que
     el último build subido (por ejemplo `1000`). Sin esa variable vale 100.
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
ni certificados `.p12`, ni iPhones registrados. Si esa firma en la nube falla
y no hay forma de destrabarla, está el plan B de abajo.

### Plan B: firma manual con tu propio certificado (opcional)

Solo si la firma en la nube no anda (por ejemplo, la clave no puede ser Admin,
o el Summary dice que la firma falló una y otra vez). Si en el repo existen
**los tres** secretos `DIST_CERT_P12`, `DIST_CERT_PASSWORD` y `DIST_PROFILE`,
el workflow firma con ellos; si no hay ninguno, firma en la nube como siempre.
Con uno o dos sueltos, la corrida frena al principio y te dice cuál falta. En
el **Summary** de cada corrida dice qué firma usó.

Se arma una vez, **sin Mac**, en unos 15 minutos. Necesitás una terminal con
OpenSSL:

- **Mac o Linux:** la app **Terminal**.
- **Windows:** **Git Bash**, que viene con [Git for Windows](https://git-scm.com/download/win)
  (Inicio → «Git Bash»). Trae `openssl` y `base64`.

**1. Crear la clave privada y el pedido de certificado (CSR).** En la terminal,
de a una línea (cambiá el email y el nombre por los tuyos):

```bash
mkdir -p ~/247wc-firma && cd ~/247wc-firma
openssl genrsa -out distribucion.key 2048
MSYS_NO_PATHCONV=1 openssl req -new -key distribucion.key -out distribucion.csr -subj "/emailAddress=tu@email.com/CN=Tu Nombre/C=AR"
```

(`MSYS_NO_PATHCONV=1` es para Git Bash, que si no confunde `/emailAddress…`
con una carpeta; en Mac y Linux no molesta.) La carpeta queda en tu usuario:
en Windows, `C:\Users\<tu usuario>\247wc-firma`. **`distribucion.key` es la
clave privada: no la compartas ni la subas al repo.**

**2. Pedirle el certificado a Apple.**
[developer.apple.com/account](https://developer.apple.com/account) →
**Certificates, Identifiers & Profiles** → **Certificates** → botón **+** →
**Apple Distribution** → Continue → **Choose File** → `distribucion.csr` →
Continue → **Download**. Se baja `distribution.cer`: movelo a la carpeta
`247wc-firma`. (Si Apple dice que llegaste al máximo de certificados,
revocá uno viejo que no uses.)

**3. Armar el `.p12`** (certificado + clave, protegidos con una contraseña):

```bash
openssl x509 -inform DER -in distribution.cer -out distribution.pem
openssl pkcs12 -export -legacy -inkey distribucion.key -in distribution.pem -name "247WC Apple Distribution" -out distribucion.p12
```

Te pide una contraseña (**Export Password**) dos veces: inventá una y anotala,
es el secreto `DIST_CERT_PASSWORD`. El `-legacy` es para que el llavero de
macOS (el de la Mac de GitHub) pueda abrir el archivo: OpenSSL 3 cifra por
defecto de una forma que macOS a veces rechaza. Si la terminal contesta que
no conoce `-legacy` (OpenSSL viejo, que ya usa el formato compatible), corré
la misma línea sin `-legacy`. Si dice que no puede cargar el «legacy provider»,
usá esta otra, que da el mismo formato compatible:

```bash
openssl pkcs12 -export -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 -inkey distribucion.key -in distribution.pem -name "247WC Apple Distribution" -out distribucion.p12
```

**4. Crear el perfil de aprovisionamiento.** En developer.apple.com →
**Profiles** → botón **+** → en **Distribution**, **App Store Connect** →
Continue → **App ID**: `247WC (com.wc247.app)` → Continue → elegí el
certificado del paso 2 (el de la fecha de hoy) → Continue → nombre
`247WC App Store` → **Generate** → **Download**. Se baja un
`.mobileprovision`: movelo a `247wc-firma`.

**5. Pasar los dos archivos a texto (base64).** Los secretos de GitHub son
texto, así que el `.p12` y el perfil van codificados:

- **Mac, Linux o Git Bash:**
  ```bash
  base64 -i distribucion.p12 > p12.txt
  base64 -i 247WC_App_Store.mobileprovision > perfil.txt
  ```
  (usá el nombre real del `.mobileprovision` que bajaste). Abrí cada `.txt`
  con un editor de texto y copiá todo.
- **Windows, en PowerShell** (Inicio → «PowerShell»), cada línea copia el
  resultado al portapapeles:
  ```powershell
  cd ~\247wc-firma
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\distribucion.p12")) | Set-Clipboard
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\247WC_App_Store.mobileprovision")) | Set-Clipboard
  ```
  Corré la primera, pegá en el secreto `DIST_CERT_P12`; después la segunda y
  pegá en `DIST_PROFILE`.

Los saltos de línea que se cuelen al pegar no importan: el workflow los limpia.

**6. Cargar los 3 secretos** (en el environment `APPLE`, igual que los otros
cuatro: **Settings → Environments → APPLE → Add environment secret**):

| Nombre | Qué va |
|---|---|
| `DIST_CERT_P12` | El `.p12` en base64 (paso 5) |
| `DIST_CERT_PASSWORD` | La contraseña que pusiste al armar el `.p12` (paso 3) |
| `DIST_PROFILE` | El perfil `.mobileprovision` en base64 (paso 5) |

Listo: corré el workflow **TestFlight** como siempre. Antes de compilar
revisa que el certificado sea de distribución, que el perfil sea «App Store
Connect» de `com.wc247.app` y que los dos sean del equipo de `APPLE_TEAM_ID`;
si algo no coincide, te lo dice en castellano. Los cuatro secretos de antes
siguen haciendo falta (la clave de API se usa para subir; con firma manual
alcanza con rol **App Manager**).

- **Para volver a la firma en la nube:** borrá los tres secretos `DIST_*`.
- **Cada año:** el certificado vence a los 12 meses y el perfil con él.
  Repetí los pasos 2 a 6 (la clave del paso 1 sirve de nuevo).
- Guardá `distribucion.key`, `distribucion.p12` y la contraseña en un lugar
  seguro (tu gestor de contraseñas) y **nunca** los subas al repo.

### El otro workflow: «iOS build»

`.github/workflows/ios.yml` corre en cada push (a cualquier rama) que toque la
app, y a mano desde Actions → iOS build → Run workflow. Primero corre las pruebas en Linux (barato) y, si
pasan, compila la app en una Mac, sin firmar, para avisarte enseguida si algo se
rompió. No sube nada a Apple. Las capturas de las pruebas quedan como artifact
(`capturas-pruebas`).

## Completar la ficha del App Store

Todo esto está en la página de la versión (**1.0 Prepare for Submission**) y en
el menú de la izquierda de la app en App Store Connect.

### Textos de la ficha

Copiá y pegá de [`store/listing-es.md`](store/listing-es.md) (Spanish (Mexico))
y [`store/listing-en.md`](store/listing-en.md) (English (U.S.)): nombre,
subtítulo, texto promocional, descripción, palabras clave, URL de soporte (y,
opcional, de marketing) y derechos de autor. Cada campo tiene contados los
caracteres.

### Privacidad y soporte

Apple pide tres cosas: **la URL de una política de privacidad**, **la URL de
una página de soporte** (con una forma de contactarte) y **el cuestionario
«App Privacy»** (la «etiqueta nutricional» de la ficha).

**1. Publicar la política y la página de soporte.** Ya están escritas, en
español y en inglés: [`site/privacy.html`](site/privacy.html) y
[`site/support.html`](site/support.html), con tu email de contacto
(lautarolacazeok@gmail.com) ya puesto. Se publican con **un proyecto de
Vercel propio de este repo**, independiente del de la web:

1. En [vercel.com/new](https://vercel.com/new), importá el repo
   **4zid/IOS247WC**.
2. Nombre del proyecto: `ios247` (es el que está creado). No cambies nada más: el
   archivo [`vercel.json`](vercel.json) ya le dice que publique solo la
   carpeta `site/`, sin instalar ni compilar nada. Tocá **Deploy**.
3. Quedan en **https://ios247.vercel.app/privacy.html** y **https://ios247.vercel.app/support.html** (en la raíz,
   https://ios247.vercel.app, está la landing de promo: ver
   [La landing de promo](#la-landing-de-promo)). Abrilas desde el celular, en una pestaña
   privada, para confirmar que cargan sin pedir login de Vercel.

Vercel vuelve a publicar con cada push a `prod`; las páginas solo cambian si
tocás `site/`. Si algún día cambia el dominio (por ejemplo, si le ponés uno
propio), cambiá `PRIVACY_URL` (punto 3) y las URLs de
`store/listing-es.md`, `store/listing-en.md`, `store/app-privacy.md` y
`store/CHECKLIST.md`.

Otra opción es armarlas **en Framer (o Webflow)**: dos páginas (por ejemplo
`/privacidad` y `/soporte`) con estos textos, públicas y sin login. En ese
caso también hay que cambiar `PRIVACY_URL` y esas URLs.

La URL de la política va en **App Privacy → Privacy Policy URL**; la de
soporte, en la página de la versión → **Support URL** (y está en
`store/listing-es.md` y `store/listing-en.md`).

**2. El cuestionario «App Privacy».** Las respuestas exactas, paso a paso,
están en [`store/app-privacy.md`](store/app-privacy.md). En corto: **sí** se
recopilan datos, solo **Ubicación precisa** (la posición exacta va a los
servicios de ruta a pie) y **Ubicación aproximada** (a nuestra búsqueda llega
un punto redondeado), solo para **funcionalidad de la app**, **no**
vinculadas a tu identidad y **no** usadas para rastreo. Es lo mismo que declara el archivo
`ios/App/App/PrivacyInfo.xcprivacy` que va adentro de la app, y las dos cosas
tienen que coincidir.

**3. Link a la política dentro de la app.** Apple también pide (pauta 5.1.1)
que la política se pueda abrir desde la app. **Ya está:** en el modal de Info,
el link **«Política de privacidad»** («Privacy Policy» en inglés) abre
`https://ios247.vercel.app/privacy.html` en Safari dentro de la app. Por eso conviene publicarla
justo en esa URL (con el proyecto de Vercel del punto 1).

Si la publicás en otra URL (por ejemplo en Framer o Webflow), cambiá la
constante `PRIVACY_URL`, al principio de `native/text.js`:

```js
const PRIVACY_URL = 'https://ios247.vercel.app/privacy.html';
```

Después: `npm test`, `npm run sync` y subí un build nuevo (Camino A o B). Sin
eso, el link de la app abre una página que no existe (un 404), y Apple lo toma
como que falta la política.

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

Tres formas de hacerlas:

1. **Automáticas, sin Mac ni iPhone:**
   ```bash
   npx playwright install chromium   # solo la primera vez
   npm run screenshots
   ```
   Arma la app y le saca fotos a la app real (la misma web con la capa nativa,
   con baños y una ruta de ejemplo en Buenos Aires): capturas de **6,9"**
   (**1320 × 2868 px**, sin transparencia) en `store/screenshots/es/` y
   `store/screenshots/en/`, más una hoja para verlas todas juntas
   (`store/screenshots/contact-sheet.png`). Se pueden subir tal cual o
   llevarlas a Figma para sumarles un título (ver la opción 3).
2. **Desde el simulador (Camino A):** elegí el simulador **iPhone 17 Pro Max**
   (su pantalla mide justo 1320 × 2868), simulá una ubicación con muchos baños
   (**Features → Location → Custom Location…**, por ejemplo el Obelisco) y en
   cada pantalla apretá **`Cmd + S`**: la captura queda en el Escritorio, ya en
   el tamaño correcto. Para cambiar de idioma: botón de ajustes (arriba a la
   derecha de la app) → Idioma. Opcional, para que la hora diga 9:41 y la
   batería esté llena, en la Terminal:
   ```bash
   xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100
   ```
3. **En Figma (o Framer):** frames de **1320 × 2868** (o 1290 × 2796), con las
   capturas adentro y un título arriba si querés. Exportá a 1x en **JPG**, que
   nunca lleva transparencia (lo más seguro). Las capturas pueden ser las de
   `npm run screenshots` o las que saques en tu iPhone, con la app instalada
   desde TestFlight.

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

1. En la página de la versión, primero revisá el campo **Version**: tiene que
   decir `1.0.0`, igual que el build (Apple la crea como `1.0`); si no,
   cambialo y tocá **Save**. Después, en **Build**, tocá **+** (Add Build) y
   elegí el build que subiste (tiene que haber terminado de procesarse).
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
   la app se siga armando. Como reemplaza `web/` entero, **no hace nada si
   `web/` tiene cambios sin guardar en git** (te los lista y te dice cómo
   guardarlos o descartarlos). Si igual querés pisarlos:
   `npm run web:update -- --force`.
2. **Probar:** `npm test` (ver [Pruebas](#pruebas)).
3. **Guardar el cambio en git:** `git add -A && git commit -m "Web al día" && git push`
   (o, en GitHub Desktop, **Commit to prod** y **Push origin**).
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
| **Bundle ID** | Registrá el nuevo en developer.apple.com (Paso 0) y después cambialo en dos lugares. **Con Mac:** Xcode → TARGETS → App → General → **Bundle Identifier**. **Sin Mac:** en GitHub, editá `ios/App/App.xcodeproj/project.pbxproj` (el lápiz de «Edit this file») y reemplazá las **2** líneas `PRODUCT_BUNDLE_IDENTIFIER = com.wc247.app;` por el nuevo (por ejemplo `PRODUCT_BUNDLE_IDENTIFIER = com.tunombre.wc247;`). **En los dos casos**, poné el mismo valor en `appId` de `capacitor.config.json`: `npm run sync` no lo copia al proyecto de Xcode, ni al revés. Ojo: una vez publicada, cambiar el Bundle ID es crear **otra app**. |
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

- **Es el proyecto de Vercel de la web**, no el de este repo: la app usa la
  búsqueda de la web, así que ese proyecto tiene que seguir publicado. Si la
  web se muda a un dominio propio, cambiá esa línea, corré `npm test` (la
  prueba T2 también busca ese dominio, en `tests/bridge.e2e.mjs`),
  `npm run sync` y publicá una versión nueva. La política y el soporte no
  dependen de la web (están en el proyecto de Vercel de este repo).
- **Si la API no responde, la app sigue funcionando:** consulta OpenStreetMap
  (Overpass) directo desde el teléfono, como hace la web, con el mismo punto
  redondeado (~250 m) que le manda a la API, nunca la posición exacta.
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
  - **iOS build** (en cada push que toque la app): ~3 min de Linux + 4 a
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

**Al archivar: «Your team has no devices from which to generate a provisioning profile»**
Con la firma automática, Xcode necesita al menos un iPhone registrado en tu
cuenta para archivar. Conectá tu iPhone y dale ▶ una vez
([Camino A, paso 4](#4-probar-en-tu-iphone)); después volvé a **Product →
Archive**. También se puede registrar a mano en developer.apple.com →
**Devices** → **+** (con el UDID del iPhone). Sin iPhone, subí por el
[Camino B](#camino-b-subir-sin-mac), que no lo necesita.

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
**Admin**. Si la firma en la nube no hay forma de que ande, usá la
[firma manual](#plan-b-firma-manual-con-tu-propio-certificado-opcional).

**`npm run web:update` dice que `web/` tiene cambios sin commitear**
Alguien editó `web/` a mano (no se edita: se pisa en cada actualización). El
mensaje explica cómo guardar esos cambios aparte (`git stash -u`) o
descartarlos. Si sabés que no sirven: `npm run web:update -- --force`.

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
(`tests/fixtures/capacitor-mock.js`), y revisa 17 escenarios (T1 a T17):
ubicación, permiso negado con el botón Abrir Ajustes, la guía con brújula y
pantalla encendida, vibración, links y mapas, tema claro y oscuro, pantalla de
arranque, acceso directo, el modal de Info, la API con su plan B, los detalles
de la ubicación, la pantalla previa al permiso («Continuar», sin «Ahora no»),
«Mi ubicación» (el ícono y el encuadre con los baños cercanos), el botón azul
a 12 px de la hoja con «Mi ubicación» en su fila (todos los textos, en
todos los anchos de iPhone), deslizar desde el borde para volver (con un dedo simulado
por el protocolo de Chrome) y la guía con el mapa (caminando por el recorrido,
desviándote y moviendo el mapa con el dedo). Si algo falla, sale con error. Deja capturas en
`tests/.output/`.

Para correr solo algunas: `node tests/bridge.e2e.mjs T2 T4`.

Estas pruebas no compilan el Swift; eso lo hacen Xcode (Camino A) y el
workflow **iOS build** (Camino B).

## La landing de promo

La página de promo de la app de iPhone está en **https://ios247.vercel.app**
(la raíz del mismo proyecto de Vercel que publica la privacidad y el soporte).
Es tu diseño de Claude Design, armado como sitio estático liviano.

**De dónde sale.** El export de Claude Design está en
[`landing/247WC_Landing.html`](landing/247WC_Landing.html): un solo HTML de
~6 MB que trae todo adentro (fuentes, capturas, React, el motor de componentes
y Babel, que traduce un componente en cada visita). `npm run landing`
([`scripts/build-landing.mjs`](scripts/build-landing.mjs)) lo desarma una vez
y deja en `site/`:

- `index.html` con título, descripción, vista previa para redes (`og.png`) e
  ícono;
- `assets/` con cada recurso en su archivo (con un hash en el nombre, así
  Vercel los deja en caché un año): las fuentes, las capturas achicadas a
  960 px y en WebP, React, el motor y el componente del iPhone ya traducido
  (sin Babel). Nada se pide a otros sitios (ni unpkg ni Google Fonts).

En vez de ~6 MB, la primera visita baja unos 600 KB.

**Cambios de contenido que hace el build** (parches anclados, como los de la
app: si exportás de nuevo y un ancla ya no aparece, el build falla y avisa):

- «Sin ubicación: mové el mapa a cualquier zona» pasa a «buscá en la zona
  que se ve en el mapa» (lo mismo que se corrigió en la ficha).
- El aviso de Android: como no hay un servicio que guarde los emails, en vez
  de decir «Listo» sin mandar nada, abre un mail ya escrito a
  lautarolacazeok@gmail.com para que la persona lo envíe.
- El idioma de la página y el título de la pestaña siguen al botón ES / EN.
- Las imágenes de la plantilla no se piden antes de tiempo (eran tres 404).

**Para actualizarla:** exportá de nuevo desde Claude Design, reemplazá
`landing/247WC_Landing.html`, corré `npm run landing`, mirá `site/index.html`
en el navegador (por ejemplo con `npx serve site`) y hacé commit y push:
Vercel la publica sola.

**Cuando Apple apruebe la app:** en App Store Connect → **App Information**,
copiá el **Apple ID** (un número) y ponelo en `APP_STORE_ID`, arriba de todo en
`scripts/build-landing.mjs`. Corré `npm run landing` y subilo: los botones
«Descargar» pasan a abrir la app en el App Store (hoy bajan a la sección
final) y Safari en el iPhone muestra el banner de la app arriba de la página.

## Estructura del repo

```
README.md                  esta guía
package.json               scripts: build, sync, ios, test, assets, web:update, screenshots, landing
capacitor.config.json      id de la app (com.wc247.app), nombre y ajustes de Capacitor

web/                       copia de la web 4zid/247wc. NO se edita a mano
  UPSTREAM.json            de qué commit vino
native/                    capa nativa del lado web (se inyecta en www/index.html)
  bridge.js                reemplaza ubicación, brújula, vibración, links, fetch… por lo nativo
  text.js                  textos de la web que cambian en la app (es/en)
  gestures.js              deslizar desde el borde izquierdo para volver
  guide.js                 la guía con el mapa: el recorrido se acorta y el mapa te sigue
  native.css               retoques mínimos de estilo (el botón azul, el panel de la guía)
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
  store-screenshots.mjs    capturas para el App Store (npm run screenshots)
  build-landing.mjs        arma la landing de promo en site/ (npm run landing)
  dev/configure-xcode.rb   deja el proyecto de Xcode configurado (para desarrolladores)
tests/
  bridge.e2e.mjs           pruebas de la capa nativa (npm test)
  fixtures/                datos falsos para las pruebas
.github/
  workflows/ios.yml        compila en cada push que toque la app
  workflows/testflight.yml sube a TestFlight sin Mac
  ci/                      ayudantes de esos workflows (incluida la firma manual)
docs/NATIVE-API.md         contrato entre la web y la capa nativa
site/                      lo que publica el proyecto de Vercel de este repo
  index.html               la landing de promo (la arma npm run landing)
  assets/, og.png          sus fuentes, capturas, scripts y la vista previa para redes
  privacy.html             política de privacidad (en español e inglés)
  support.html             página de soporte (en español e inglés)
landing/247WC_Landing.html el export de Claude Design de la landing
vercel.json                le dice a Vercel que publique solo site/
store/                     todo para el App Store
  listing-es.md            ficha en español (con los caracteres contados)
  listing-en.md            ficha en inglés
  app-privacy.md           respuestas del cuestionario App Privacy
  review-notes.md          notas para la revisión de Apple (inglés + traducción)
  CHECKLIST.md             lista para revisar antes de enviar
  screenshots/             capturas de 6,9" en es/ y en/ (npm run screenshots)
```
