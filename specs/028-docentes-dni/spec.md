# Feature Specification: DNI y secciones editables del docente, y consulta con el DNI

**Created**: 2026-10-22 · **Status**: Implementado en el backend (panel en su repo, spec 019) · **Contrato**: [`contracts/api-docentes-dni.md`](contracts/api-docentes-dni.md)

**Input**: los docentes (asesores) solo existían porque venían del Excel de la facultad: sin DNI y sin poder corregir su ciclo o sección
sin recargar el Excel (que reemplazaba todo). Se pidió: (1) registrar el **DNI** de cada docente; (2) **quitar o agregar** las
secciones de un docente (y agregar, eliminar o renombrar docentes); (3) **una página única** donde cada docente escribe su DNI y ve a *sus*
estudiantes (ciclos, secciones, quién pagó y quién no); (4) al recargar el Excel, **conservar lo editado**.

## Decisiones

- **DNI del docente**: `asesores.documento` (8 dígitos; con 7 se completa el cero que pierde Excel; `NULL` = sin DNI), **único por evento**
  (índice `(evento_id, documento)`; MySQL permite varios NULL). Quitarlo cierra la página común a ese docente; su enlace personal (spec 026) es independiente.
- **Gestión** (`reportes.gestionar`, global): listar, agregar, editar y eliminar docentes. Editar **reemplaza** nombre, DNI y la lista de secciones y **no toca**
  el token del enlace ni el último acceso. La sección debe existir en el padrón (o ya ser del docente: un padrón nuevo puede haberla dejado sin alumnos
  y no se le quita sola). Nombre y DNI repetidos → `409`. El DNI sale solo en esta lista: el resumen de `reportes.ver` no lo trae.
- **Consulta con el DNI** (sin sesión): `POST /v1/public/advisor/lookup` (+ `/export`) con `{ documento }`; devuelve **la misma vista** que el enlace personal
  (nombre, código, ciclo, sección, turno, celular y situación de **sus** estudiantes; nunca DNI de estudiantes, correo, montos ni otros asesores) y **no devuelve el DNI**.
  Si el DNI está en varios eventos se usa el más reciente. DNI mal escrito o desconocido → el mismo `404 ADVISOR_DOCUMENT_NOT_FOUND`.
- **Seguridad** — el DNI es de conocimiento semipúblico y adivinable, mucho más débil que un token de 256 bits: (1) viaja en el **cuerpo** del `POST`, nunca en la URL ni en
  `morgan`; (2) los **intentos fallidos** topan por IP (10 cada 15 min, `limiteIntentosDni`, con `soloFallos`: quien acierta no se penaliza y su página puede refrescarse sola),
  más el tope normal de vista/descarga; (3) una respuesta idéntica para cualquier DNI inválido; (4) `no-store` y `noindex`. **Riesgo asumido**: quien conozca el DNI de un docente
  ve a sus estudiantes (con celular). Si hiciera falta, el siguiente paso sería un segundo dato (código del docente) o un token por docente (ya existe, spec 026).
- **Recargar el padrón conserva a los docentes**: el campo `asesores` = `conservar` (por defecto si ya hay docentes) solo reemplaza a los **estudiantes**; docentes, DNI, secciones editadas y enlaces
  quedan. `reemplazar` vuelve a leer docentes y secciones del Excel (conservando enlace **y DNI** por nombre). Sin docentes previos se cargan los del Excel. La simulación informa
  `asesoresConservados` y avisa de toda sección que un docente conserva y el padrón nuevo ya no trae.

## User Scenarios & Testing

### User Story 1 - Mantengo a los docentes desde el panel (Priority: P1)

1. **Given** el padrón está cargado, **When** abro un docente, **Then** puedo ponerle el DNI, quitarle o agregarle ciclos y secciones y corregir su nombre.
2. **When** agrego un docente que no está en el Excel (con sus secciones), **Then** aparece con sus estudiantes en Reportes; **When** lo elimino, **Then** sus estudiantes quedan sin asesor en esas secciones.
3. **When** recargo el Excel sin pedir reemplazar, **Then** los docentes, sus DNI y secciones quedan como estaban.

### User Story 2 - El docente entra con su DNI (Priority: P1)

1. **Given** el docente tiene DNI registrado, **When** lo escribe en la página común, **Then** ve el avance de sus estudiantes, filtra por ciclo y sección y descarga Excel o PDF.
2. **When** escribe un DNI que no es de ningún docente, **Then** ve «No encontramos un docente con ese DNI» (el mismo aviso para cualquier DNI inválido).
3. **When** falla diez veces seguidas, **Then** queda frenado unos minutos.

## Requirements

- **FR-001**: `GET|POST /v1/events/:eventId/advisory/advisors` y `PUT|DELETE …/advisors/:asesorId` (`reportes.gestionar`); el Tesorero y la Comisión reciben `403`.
- **FR-002**: `POST /v1/public/advisor/lookup` y `…/lookup/export` con `{ documento }` en el cuerpo; sin sesión.
- **FR-003**: la vista por DNI no contiene el DNI del docente, ni DNI, correo, montos o fechas de pago de estudiantes, ni otros asesores (prueba automática).
- **FR-004**: DNI inválido o desconocido responde igual (`404 ADVISOR_DOCUMENT_NOT_FOUND`); solo un DNI bien formado consulta la base.
- **FR-005**: `POST …/advisory/import` acepta `asesores=conservar|reemplazar`; por defecto conserva los docentes existentes.
- **FR-006**: migración aditiva `20261023150000_asesores_documento` (columna `documento` e índice único).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` sin cambios; matriz de rutas con 178 rutas.
- **SC-002**: con el padrón de octubre se puede asignar un DNI, quitar y agregar secciones y consultar con ese DNI sin recargar el Excel.
