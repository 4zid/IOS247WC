# Ficha del App Store · English (U.S.)

Textos para **App Store Connect → Apps → 247WC**, con **English (U.S.)** elegido
en el selector de idioma (arriba a la derecha). Si todavía no está, agregalo
desde ese mismo selector.

En cada país, Apple muestra la ficha en uno de los idiomas de ese país; si la
app no tiene ninguno, muestra la del idioma principal (español). En el Reino
Unido, Australia, Canadá y buena parte de Europa el inglés que Apple usa es
English (U.K.), English (Australia) o English (Canada). Opcional: para que ahí
también se vea en inglés, agregá esas localizaciones con estos mismos textos.

Los textos están en inglés; las explicaciones, en castellano. Los caracteres
están contados con un script (cada letra, espacio, signo y salto de línea
cuenta 1).

| Campo | Caracteres | Dónde va |
|---|---|---|
| Name | 28/30 | App Information |
| Subtitle | 25/30 | App Information |
| Promotional Text | 144/170 | Página de la versión |
| Description | 1889/4000 | Página de la versión |
| Keywords | 97/100 (97 bytes) | Página de la versión |
| What's New in This Version (1.0) | 174/4000 | Página de la versión (ver nota) |

## Name · 28/30

```text
247WC: Public Toilets Nearby
```

Si está tomado, probá `247WC` solo y pasá «Public Toilets Nearby» al subtítulo.

## Subtitle · 25/30

```text
Find the closest restroom
```

«Restroom» es la palabra que más se busca en Estados Unidos; «toilet», en el
resto del mundo. Con el nombre y el subtítulo quedan las dos.

## Promotional Text · 144/170

```text
Tap scan and in seconds you see the closest public toilet, whether it's free or open 24 h, and a compass arrow that walks you right to the door.
```

## Description · 1889/4000

```text
Need a toilet right now? 247WC shows you the closest public toilet and walks you to the door. Free, no account, no ads.

SCAN, PICK, ARRIVE
• Scan: one tap and you see the public toilets within 3 km, sorted by distance.
• Pick: the closest one comes first, with a mini-map of the route, opening hours and whether it's free or accessible.
• Arrive: an arrow turns with your iPhone's compass and counts down the meters. The screen stays on and your phone vibrates when you get there.

WHAT YOU NEED TO KNOW BEFORE YOU WALK
• Filters that matter: Free, 24 h, Accessible and Changing table.
• Bars and shops: if there are no public toilets nearby, add places that have one.
• Details for each toilet: hours, cost, access, accessibility, changing table and floor, when the community has added them.
• Prefer another app? Open the walking route in Apple Maps or Google Maps with one tap.

MADE FOR URGENT MOMENTS
• Quick action: touch and hold the icon and choose “Nearest toilet”. It scans right away and, if you've already allowed location, starts guiding you.
• No signal? It shows the last toilets it found.
• Works without location too: move the map to any area and search there.
• Automatic dark mode, or the one you choose.
• In English and Spanish, following your iPhone's language.

YOUR LOCATION IS YOURS
247WC uses your location only while you use the app, to search and to guide you. No accounts, no analytics, no ads, no tracking. To search, our server only receives an approximate area (rounded to about 250 m), and we don't store your location.

OPEN COMMUNITY DATA
Toilets come from OpenStreetMap and Refuge Restrooms, added by people like you. Coverage varies by city, and a toilet may be closed or may have changed. Know one that's missing? Tap “Missing a toilet?” at the bottom of the list and add it on OpenStreetMap: everyone gets it.

Map data © OpenStreetMap contributors.
```

## Keywords · 97/100 (97 bytes)

```text
bathroom,wc,loo,washroom,lavatory,urgent,compass,map,wheelchair,accessible,baby,changing,free,24h
```

- Sin espacios después de las comas y sin repetir palabras del nombre ni del
  subtítulo (`247WC`, `public`, `toilets`, `nearby`, `find`,
  `closest`, `restroom`).
- Hay palabras de cada país: `bathroom` y `restroom` (EE. UU.), `loo`
  (Reino Unido), `washroom` (Canadá), `wc` (Europa).
- `wc` no repite el nombre: Apple busca palabras enteras y «247WC» no
  coincide con «wc».
- `baby` y `changing` van separadas: Apple combina las palabras sueltas, así
  que igual aparece en «baby changing».

## What's New in This Version (1.0) · 174/4000

```text
First iPhone release. Scan the public toilets within 3 km, pick the closest one and follow the arrow. Includes the “Nearest toilet” quick action: touch and hold the app icon.
```

Igual que en español: en la primera versión App Store Connect no muestra este
campo. Queda para la 1.0.1 o para TestFlight.

## Support URL

```text
https://247-wc.vercel.app/landing
```

## Marketing URL

```text
https://247-wc.vercel.app/landing
```

La landing está solo en español. No es un problema para la revisión, pero si
algún día tiene versión en inglés, poné esa URL acá.

## Categorías, derechos de autor y precio

Son los mismos para todos los idiomas y se cargan una sola vez (ver
`store/listing-es.md`): Navigation / Travel, `2026 [TU NOMBRE O EL DE TU EMPRESA]`,
gratis.
