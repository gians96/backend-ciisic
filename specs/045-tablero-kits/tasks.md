# Tasks: Tablero de kits — pendientes y entregados en el listado, el CSV y un tablero

- [x] T001 `src/core/kit.ts`: `TIPO_CON_KIT`, `aEntregar` (base común del resumen y del tablero), `FILTROS_KIT`/`esFiltroKit`/`condicionKit` (siempre en positivo) y `situacionKit`/`TEXTO_SITUACION_KIT`
- [x] T002 Listado y CSV de inscripciones: `?kit=` (`kitDeLaConsulta`: `422` con un valor desconocido), `construirFiltro` con la condición como un elemento más de `AND` y `ordenDelListado` (entregados por la entrega más reciente)
- [x] T003 `aFilaLista` agrega `kit`; el CSV agrega `Kit`, `Kit entregado el` y `Kit entregado por` al final
- [x] T004 `src/api/kit/services/tablero.ts` y `GET /v1/events/:eventId/kits/dashboard` (`asistencia.ver`); `resumenKits` usa `aEntregar`
- [x] T005 Pruebas: `tests/inscription/kit-filtro.test.ts`, `tests/kit/tablero.test.ts`, `tests/inscription/kit.test.ts` (las filas ya traen `kit`) y matriz de rutas (210)
- [x] T006 Contrato, AGENTS.md, README y `docs/api.md`
- [x] T007 Panel (spec 035): página «Entrega de kits», filtro y insignia de kit en Inscripciones (rama `feat/tablero-kits` del panel)
- [x] T008 Probado contra el motor MySQL real con los datos de producción, **solo lectura** (cliente de Prisma con guardia contra escrituras): los seis valores de `kit` coinciden con `SELECT COUNT` directos (`CON_KIT` + `SIN_KIT` = todas las inscripciones del evento), `kits/dashboard` con `kits/summary` y con las cifras agrupadas por tipo, el listado (`PENDIENTE` y `ENTREGADO`, este por la entrega más reciente) y el CSV (`?kit=PENDIENTE` y la columna `Kit`). No se creó una BD aislada: quedó sin cubrir solo un caso con datos (una cortesía sin tipo con kit entregado, que en producción no existe; lo cubren las pruebas con Prisma simulado)
- [ ] T009 Producción: desplegar el backend (no hay migración) y después el panel
