# Ficha del App Store · Español (México)

Textos para **App Store Connect → Apps → 247WC**, con el idioma **Spanish
(Mexico)** elegido arriba a la derecha. Es el idioma principal: Apple lo usa en
México, Argentina y el resto de Latinoamérica.

Cada campo dice cuántos caracteres tiene y cuál es el límite de Apple. Están
contados con un script (cada letra, espacio, signo y salto de línea cuenta 1;
una «ñ» o una «á» también cuentan 1). Si cambiás un texto, volvé a contar;
App Store Connect también avisa si un campo se pasa del límite.

El tono es el de la app: rioplatense, con «vos». Si algún día querés sumar la
ficha de **Spanish (Spain)**, conviene pasarla a «tú».

| Campo | Caracteres | Dónde va |
|---|---|---|
| Nombre | 27/30 | App Information |
| Subtítulo | 26/30 | App Information |
| Texto promocional | 140/170 | Página de la versión |
| Descripción | 2054/4000 | Página de la versión |
| Palabras clave | 95/100 (97 bytes) | Página de la versión |
| Novedades de la versión 1.0 | 175/4000 | Página de la versión (ver nota) |

## Nombre · 27/30

```text
247WC: Baños públicos cerca
```

Tiene que ser único en todo el App Store. Si está tomado, probá `247WC` solo
y pasá «Baños públicos cerca» al subtítulo. Debajo del ícono, en el iPhone, la
app se sigue llamando **247WC** (eso sale de `Info.plist`, no de acá).

## Subtítulo · 26/30

```text
El más cercano, a un toque
```

## Texto promocional · 140/170

```text
Tocá escanear y en segundos ves el baño público más cercano, si es gratis o abre 24 h, y una brújula que te lleva caminando hasta la puerta.
```

De todos los textos de la página de la versión, es el único que se puede
cambiar **sin mandar una versión nueva** a revisión. Sirve para novedades o temporadas («¿Viajás en verano?…»).

## Descripción · 2054/4000

```text
¿Necesitás un baño ya? 247WC te muestra el baño público más cercano y te lleva caminando hasta la puerta. Gratis, sin cuenta y sin publicidad.

ESCANEÁ, ELEGÍ, LLEGÁ
• Escaneá: un toque y aparecen los baños públicos a menos de 3 km, ordenados por cercanía.
• Elegí: el más cercano aparece primero, con un minimapa de la ruta, el horario y si es gratis o accesible.
• Llegá: una flecha gira con la brújula del iPhone y cuenta los metros que faltan. La pantalla queda encendida y el teléfono vibra cuando llegás.

LO QUE NECESITÁS SABER ANTES DE CAMINAR
• Filtros que importan: Gratis, 24 h, Accesible y Cambiador.
• Bares y negocios: si no hay baños públicos cerca, sumás locales con baño.
• Detalles de cada baño: horario, costo, acceso, accesibilidad, cambiador y piso, cuando la comunidad los cargó.
• ¿Preferís otra app? Abrís la ruta a pie en Mapas de Apple o en Google Maps con un toque.

PENSADA PARA LA URGENCIA
• Acceso rápido: mantené apretado el ícono y elegí «Baño más cercano». Busca solo y, si ya le diste permiso, arranca la guía.
• Si te quedás sin señal, te muestra los últimos baños que encontró.
• Sin ubicación también funciona: mové el mapa a cualquier zona y buscá ahí.
• Modo oscuro automático, o el que elijas.
• En español y en inglés, según el idioma de tu iPhone.

TU UBICACIÓN ES TUYA
247WC usa tu ubicación solo mientras usás la app, para buscar y para guiarte. No hay cuentas, ni analytics, ni publicidad, ni rastreo. Para buscar, a nuestro servidor llega solo una zona aproximada (redondeada a unos 250 m), y no guardamos tu ubicación en nuestros servidores. Para la ruta a pie, tu posición va a un servicio público de rutas.

DATOS ABIERTOS DE LA COMUNIDAD
Los baños salen de OpenStreetMap y de Refuge Restrooms, cargados por personas como vos. Por eso la cobertura cambia según la ciudad y puede que algún baño esté cerrado o haya cambiado. ¿Conocés uno que falta? Tocá «¿Falta un baño?» al final de la lista y sumalo en OpenStreetMap: queda disponible para todo el mundo.

Datos del mapa © colaboradores de OpenStreetMap.
```

## Palabras clave · 95/100 (97 bytes)

```text
wc,sanitarios,servicios,aseos,urgencia,brújula,mapa,accesible,cambiador,gratis,24h,guía,inodoro
```

- Separadas por comas, **sin espacios** después de las comas.
- No repiten palabras del nombre ni del subtítulo (`247WC`, `baños`,
  `públicos`, `cerca`, `cercano`, `toque`): Apple ya las busca ahí.
- Hay palabras de cada país: `sanitarios` (México), `servicios` y `aseos`
  (España), `wc` (en todos lados). `wc` no repite el nombre: Apple busca
  palabras enteras y «247WC» no coincide con «wc».
- Nunca pongas nombres de otras apps o marcas: es motivo de rechazo.
- Están por debajo de 100 contadas en caracteres **y** en bytes, por si App
  Store Connect cuenta las tildes doble.

## Novedades de la versión 1.0 · 175/4000

```text
Primera versión para iPhone. Escaneá los baños públicos a 3 km, elegí el más cercano y seguí la flecha. Incluye el acceso rápido «Baño más cercano»: mantené apretado el ícono.
```

En la **primera** versión App Store Connect no muestra el campo «Novedades de
esta versión» (What's New): aparece recién desde la 1.0.1. Guardá este texto
para TestFlight («Qué probar») o adaptalo para la primera actualización.

## URL de soporte

```text
https://247-wc.vercel.app/support.html
```

Es [`store/support.html`](support.html) publicada al lado de la política (ver
README → «Privacidad y soporte»): ayuda en español y en inglés y un email de
contacto (lautarolacazeok@gmail.com), que es lo que Apple pide. Si la publicás en otra URL
(Framer, Webflow), poné esa acá.

## URL de marketing

Dejala **vacía**: es opcional.

No uses la landing (`https://247-wc.vercel.app/landing`): promociona la
versión web y explica cómo instalarla en Android, y App Review puede
rechazar una ficha que manda a la gente a usar la app por fuera del App Store
o a otra plataforma (pautas 2.3.10 y 4.2). Si algún día hacés una página solo
de la app de iPhone (por ejemplo en Framer, con el botón del App Store), esa
sí puede ir acá.

## Categorías

- **Principal:** Navegación (Navigation)
- **Secundaria:** Viajes (Travel)

Van en **App Information** y valen para todos los idiomas.

## Derechos de autor

```text
2026 [TU NOMBRE O EL DE TU EMPRESA]
```

El formato de Apple es «año + titular», sin el símbolo ©. Poné el mismo nombre
que figura como vendedor en tu cuenta del Developer Program. Va en la página de
la versión y vale para todos los idiomas.

## Otros datos de la ficha

- **Precio:** gratis, en todos los países.
- **Clasificación por edad:** 4+ (respuestas en el README, «Clasificación por edad»).
- **URL de la política de privacidad:** `https://247-wc.vercel.app/privacy.html`
  una vez publicada (ver `store/privacy.html`). Va en **App Privacy**.
- **Capturas:** iPhone 6,9", 1320 × 2868 o 1290 × 2796 px (ver el README).
