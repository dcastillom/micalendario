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

## Estructura

- [src/components/DailyPlanner.vue](/Users/d.castillo.marfull/Projects/micalendario/src/components/DailyPlanner.vue): vista diaria basada en el boceto.
- [electron/main.cjs](/Users/d.castillo.marfull/Projects/micalendario/electron/main.cjs): ventana de escritorio e IPC.
- [electron/planner-store.cjs](/Users/d.castillo.marfull/Projects/micalendario/electron/planner-store.cjs): persistencia local actual.
- [database/schema.sql](/Users/d.castillo.marfull/Projects/micalendario/database/schema.sql): schema SQLite recomendado para la siguiente iteracion.
