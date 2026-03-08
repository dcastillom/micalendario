# Mi Calendario

Aplicacion de escritorio para macOS y Windows orientada a una agenda diaria de pedidos, referencias, localidad, observaciones y estado de entrega.

## Stack

- `Astro` para la shell y la construccion web.
- `Vue` para la vista diaria editable.
- `Electron` para empaquetar la app en macOS y Windows sin depender de Rust.
- Persistencia local desacoplada en `electron/planner-store.cjs`.

## Base de datos recomendada

La mejor opcion para este caso es `SQLite`:

- Es un archivo local por usuario, sin servidor.
- Funciona bien en Windows y macOS.
- Facilita copias de seguridad y exportacion.
- El modelo relacional encaja con dias y filas de agenda.

He dejado un esquema inicial en [database/schema.sql](/Users/d.castillo.marfull/Projects/micalendario/database/schema.sql). Para acelerar la primera version, la persistencia actual usa un archivo JSON local; asi podemos validar la UX antes de fijar la capa SQLite.

## Scripts

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm build:mac`
- `pnpm build:win`

## Empaquetado

Build local:

- En macOS: `pnpm build:mac`
- En Windows: `pnpm build:win`

Los instalables se generan en `release/`.

Archivos esperados:

- macOS: `.dmg`
- Windows: `.exe`

La configuracion de empaquetado esta en [package.json](/Users/d.castillo.marfull/Projects/micalendario/package.json).

## Publicacion

El repo incluye un workflow de GitHub Actions en [.github/workflows/release.yml](/Users/d.castillo.marfull/Projects/micalendario/.github/workflows/release.yml).

Hace esto:

- compila en `macos-latest` y genera el `.dmg`
- compila en `windows-latest` y genera el `.exe`
- sube ambos archivos a una GitHub Release

Como usarlo:

1. Haz commit y push de la version que quieras publicar.
2. Crea una etiqueta, por ejemplo:
   `git tag v0.1.0`
3. Sube la etiqueta:
   `git push origin v0.1.0`
4. GitHub Actions generara la release con los instalables adjuntos.

Tambien puedes lanzarlo manualmente desde `Actions > Build Desktop Release`.

## Firma

La configuracion actual genera builds sin firma.

Eso sirve para pruebas privadas, pero:

- macOS mostrara avisos de Gatekeeper
- Windows mostrara avisos de SmartScreen

Para distribuirlo de forma mas limpia a usuarios finales, el siguiente paso es anadir:

- firma y notarizacion en macOS
- firma de codigo en Windows

## Estructura

- [src/components/DailyPlanner.vue](/Users/d.castillo.marfull/Projects/micalendario/src/components/DailyPlanner.vue): vista diaria basada en el boceto.
- [electron/main.cjs](/Users/d.castillo.marfull/Projects/micalendario/electron/main.cjs): ventana de escritorio e IPC.
- [electron/planner-store.cjs](/Users/d.castillo.marfull/Projects/micalendario/electron/planner-store.cjs): persistencia local actual.
- [database/schema.sql](/Users/d.castillo.marfull/Projects/micalendario/database/schema.sql): schema SQLite recomendado para la siguiente iteracion.
