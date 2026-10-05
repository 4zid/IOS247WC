# App Privacy: respuestas para App Store Connect

Es el cuestionario que arma la «etiqueta de privacidad» de la ficha. Está en
**App Store Connect → Apps → 247WC → App Privacy** (en el menú de la izquierda).
Si tu App Store Connect está en español, las opciones son la traducción de las
que figuran acá en inglés.

Las respuestas coinciden con lo que declara el manifiesto que va adentro de la
app, `ios/App/App/PrivacyInfo.xcprivacy`. **Las dos cosas tienen que decir lo
mismo**: si algún día cambia una, cambiá la otra (y la política,
`site/privacy.html`).

## Resultado en la ficha

Así se va a ver en el App Store:

> **Data Not Linked to You** (Datos no vinculados con tu identidad)
> The following data may be collected but it is not linked to your identity:
> **Location**

Nada en «Data Used to Track You» ni en «Data Linked to You».

## Paso a paso

### 1. Política de privacidad

**Privacy Policy → Edit** (Política de privacidad → Editar):

- **Privacy Policy URL:** `https://ios247wc.vercel.app/privacy.html` (o la URL
  donde la publicaste; ver «Privacidad y soporte» en el README). Tiene que
  abrir sin login, y tiene que ser la misma a la que apunta el link
  «Política de privacidad» de la app (`PRIVACY_URL` en `native/text.js`).
- **User Privacy Choices URL:** dejalo vacío (es opcional y la app no tiene
  opciones de privacidad que configurar en una web).

→ **Save**.

### 2. ¿Se recopilan datos?

**Data Collection → Get Started**.

> Do you or your third-party partners collect data from this app?

**Yes, we collect data from this app.** → **Next**.

¿Por qué «sí», si no guardamos tu ubicación en nuestros servidores? Para
Apple, «recopilar» es mandar datos fuera del teléfono de forma que vos o un
tercero puedan tenerlos más tiempo que el necesario para responder el pedido.
Pasa con la ubicación: la posición exacta va a los servicios de ruta a pie
(terceros que pueden guardar registros) y un punto redondeado va a nuestra
búsqueda, que guarda la respuesta en caché unos días (ver abajo). Así que lo
correcto, y lo que ya declara `PrivacyInfo.xcprivacy`, es «sí». Declarar
de menos es motivo de rechazo; «no vinculados con tu identidad» es la etiqueta
más liviana que existe.

### 3. Tipos de datos

Marcá **solamente** estos dos, dentro de **Location** (Ubicación):

- [x] **Precise Location** (Ubicación precisa)
- [x] **Coarse Location** (Ubicación aproximada)

Todo lo demás queda **sin marcar**: Contact Info, Health & Fitness, Financial
Info, Sensitive Info, Contacts, User Content, Browsing History, Search History,
Identifiers, Purchases, Usage Data, Diagnostics, Surroundings, Body y Other Data.

→ **Save**.

### 4. Precise Location → Set Up

1. **Indicate how precise location is used by you or your third-party partners:**
   - [x] **App Functionality** (Funcionalidad de la app)
   - Todo lo demás sin marcar (Third-Party Advertising, Developer's Advertising
     or Marketing, Analytics, Product Personalization, Other Purposes).

   → **Next**.
2. **Is precise location collected from this app linked to the user's identity?**
   → **No, precise location is not linked to the user's identity.** → **Next**.
3. **Do you or your third-party partners use precise location for tracking purposes?**
   → **No, we do not use precise location for tracking purposes.** → **Save**.

### 5. Coarse Location → Set Up

Exactamente igual que la precisa:

1. Uso: solo **App Functionality**.
2. Vinculada a la identidad: **No**.
3. Para rastreo: **No**.

→ **Save**.

### 6. Publicar

Botón **Publish** (Publicar), arriba a la derecha. Sin publicar, la ficha no
se puede enviar a revisión.

## Por qué cada respuesta

| Dato | Adónde va | Por qué se declara así |
|---|---|---|
| **Precise Location** | **Solo** a los servicios públicos de ruta a pie: Valhalla (`valhalla1.openstreetmap.de`, de FOSSGIS e.V., Alemania) y, si no responde, el servidor de demostración de OSRM (`router.project-osrm.org`). Tu posición exacta es el punto de partida de la ruta, y la reciben junto con tu IP. | Son terceros que pueden guardar registros de los pedidos. Es la razón por la que se declara la precisa: sin ella, la ruta empezaría en otra cuadra. |
| **Coarse Location** | Un punto redondeado a una grilla de ~250 m (`snap()` en `web/app.js`): <br>• a la búsqueda propia de 247WC (función en Vercel), que con ese mismo punto consulta espejos de Overpass (entre ellos `maps.mail.ru`, de VK, Rusia) y Refuge Restrooms; esos ven la IP de Vercel, no la tuya; <br>• solo si nuestra búsqueda falla o contesta «parcial», directo desde el teléfono (con tu IP) a `overpass-api.de` (FOSSGIS e.V., Alemania), `overpass.kumi.systems` (Kumi Systems, Austria) y `overpass.private.coffee` (private.coffee, Austria). El build de la app saca de ese respaldo el espejo de Mail.ru y le pone el punto redondeado en vez de la posición exacta (parches de `app.js` en `scripts/build-web.mjs`). | La respuesta de nuestra búsqueda queda en caché del edge de Vercel, asociada a ese punto: un día fresca y hasta 7 días más mientras se renueva (unos 8 en total). Los espejos de Overpass pueden guardar registros. Un punto de ~250 m es menos preciso que tres decimales de latitud/longitud, que es como Apple define «aproximada». |
| Uso: **App Functionality** | — | Se usa solo para buscar baños (sola al abrir la app, una vez que diste el permiso, o al tocar «Escanear») y para guiarte. Nada de publicidad, analytics ni personalización. |
| Vinculada a la identidad: **No** | — | No hay cuentas, ni identificadores, ni nada que una el pedido con una persona. |
| Rastreo: **No** | — | No se combina con datos de otras empresas ni se comparte con data brokers. La app no usa el identificador de publicidad (por eso tampoco muestra el cartel de «App Tracking Transparency»). |

**Lo que no se declara, y por qué:**

- **Brújula y orientación:** se leen en el teléfono y no salen de él.
- **Lo que queda en el teléfono:** idioma, tema, filtros, si viste la
  introducción, los últimos resultados con **el punto exacto donde buscaste
  por última vez** (`247wc:last`) y una copia de los resultados de cada zona
  de ~1 km donde buscaste, con la fecha (`247wc:cache2:<lat>:<lng>:3000`).
  Queda en el almacenamiento interno de la app (y en las copias de seguridad
  del iPhone) hasta que se borra la app; nunca se manda a ningún lado. Para
  Apple, lo que no sale del teléfono no es «recopilar», pero la política
  (`site/privacy.html`, sección 5) lo cuenta igual.
- **Identifiers, Usage Data, Diagnostics:** la app no tiene SDK de analytics,
  de publicidad ni de reportes de errores, y no crea ningún identificador.
- **Search History:** no hay búsqueda por texto; la app solo pide los baños
  cerca de un punto, y eso ya está declarado como ubicación.
- **User Content / Contact Info:** no hay cuentas, formularios ni contenido
  que la gente cargue en la app.

## Coherencia con `PrivacyInfo.xcprivacy`

| En el manifiesto | En el cuestionario |
|---|---|
| `NSPrivacyTracking = false` | Rastreo: No |
| `NSPrivacyTrackingDomains` vacío | (no hay dominios de rastreo) |
| `NSPrivacyCollectedDataTypePreciseLocation`, `Linked = false`, `Tracking = false`, `Purposes = AppFunctionality` | Precise Location · App Functionality · No vinculada · Sin rastreo |
| `NSPrivacyCollectedDataTypeCoarseLocation`, `Linked = false`, `Tracking = false`, `Purposes = AppFunctionality` | Coarse Location · App Functionality · No vinculada · Sin rastreo |
| `NSPrivacyAccessedAPITypes` vacío | (no aplica al cuestionario) |

Si después de subir un build llega un mail de Apple con **«ITMS-91053: Missing
API declaration»**, el código nativo usa una API que necesita una razón
declarada en `NSPrivacyAccessedAPITypes`. El mail dice cuál: hay que sumarla al
manifiesto (es un cambio chico para alguien que programe) y subir otro build.
