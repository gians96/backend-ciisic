# Feature Specification: Enlace público por ciclo

**Created**: 2026-10-22 · **Status**: Implementado en el backend (panel en su repo, spec 018) · **Contrato**: [`contracts/api-enlaces-ciclo.md`](contracts/api-enlaces-ciclo.md)

**Input**: con la [spec 026](../026-enlaces-docentes/spec.md) cada docente ve a **sus** estudiantes, pero la organización también
necesita compartir el avance de **un ciclo completo** (todas sus secciones y docentes) con quien lo coordina, sin darle una cuenta
ni un Excel. Se pidió «otro enlace que sea solo por ciclo».

Cada ciclo del padrón puede tener un **enlace**: quien lo abre ve, en tiempo real, a todos los estudiantes de ese ciclo. Como en la
026, no es una cuenta del panel: el enlace **es** la credencial.

## Decisiones

- **Misma credencial que la 026**: token aleatorio de 256 bits (43 caracteres base64url), en claro, que viaja en `X-Link-Token` y en el
  navegador va tras el `#` (`<panel>/seguimiento/ciclo#<token>`). Mismas reglas: un solo error (`404 LINK_NOT_FOUND`) para
  token faltante, mal formado, desconocido o desactivado; `no-store` y `noindex`; límites por IP; renovar invalida el anterior.
- **Tabla propia `enlaces_ciclo`** (`evento_id`, `ciclo`, `token`, `creado_en`, `ultimo_acceso`; único por evento y ciclo): el ciclo no es
  una entidad (solo un texto del padrón) y el padrón se reemplaza en cada carga, así que el enlace **no** puede vivir en él. Recargar el
  padrón no toca esta tabla: los enlaces entregados siguen valiendo. Si el ciclo desaparece del padrón, el enlace sigue (con 0
  estudiantes) y aparece en la lista para poder desactivarlo.
- **Un token de docente no abre un ciclo ni al revés**: cada vista consulta solo su tabla.
- **Mínimo necesario, con una diferencia respecto al docente**: por estudiante, nombre, código, ciclo, sección, turno y situación;
  **sin celular** (el docente es el asesor de sus estudiantes y necesita llamarlos; quien recibe un enlace de ciclo no es el asesor de
  todos, y la lista llega a más gente). **Con** el nombre de los asesores de cada sección: es información institucional (la
  designación oficial), no de los estudiantes, y sirve para saber con quién hablar. **Nunca** DNI, correo, montos, fechas ni ids.
  Las notas de gestión interna («alumnos sin asesor») tampoco salen.
- **Reportes del enlace**: Excel y PDF con el título «Seguimiento ciclo VI», sin DNI, correo ni celular y con la columna de asesores.
- **Quién administra**: `reportes.gestionar` (global), como la 026: ni el Tesorero ni la Comisión ven ni crean enlaces.
- **Ciclos disponibles**: los del padrón cargado, en orden académico. Crear con `ciclos` acepta mayúsculas o minúsculas y guarda el
  ciclo como viene en el padrón; uno que no está es `404 CYCLE_NOT_FOUND`.

## User Scenarios & Testing

### User Story 1 - Entrego el enlace de un ciclo (Priority: P1)

1. **Given** el padrón está cargado, **When** creo los enlaces por ciclo, **Then** cada ciclo tiene uno y puedo copiarlo.
2. **When** renuevo un enlace, **Then** el anterior deja de funcionar. **When** lo desactivo, **Then** quien lo abra ve «El enlace no es válido».

### User Story 2 - Veo cómo va un ciclo (Priority: P1)

1. **Given** abro el enlace del ciclo VI, **Then** veo cuántos pagaron, están en revisión, fueron rechazados o no se inscribieron, por
   sección con su docente, y la lista de todos los estudiantes del ciclo, sin iniciar sesión.
2. **When** descargo el reporte, **Then** recibo Excel o PDF sin DNI, correo ni celular.

## Requirements

- **FR-001**: `GET|POST /v1/events/:eventId/advisory/cycle-links` y `DELETE …/cycle-links/:ciclo` (`reportes.gestionar`).
- **FR-002**: `GET /v1/public/cycle` y `GET /v1/public/cycle/export?formato=xlsx|pdf`, sin sesión, con `X-Link-Token`.
- **FR-003**: la vista pública no contiene DNI, correo, celular, montos, `recaudado`, fechas de pago ni estudiantes de otro ciclo (prueba automática).
- **FR-004**: tokens inválidos, desactivados o renovados responden igual (`404 LINK_NOT_FOUND`); un token de docente no abre un ciclo.
- **FR-005**: recargar el padrón no cambia ni borra los enlaces de los ciclos.
- **FR-006**: migración aditiva `20261023140000_enlaces_ciclo` (tabla nueva `enlaces_ciclo`).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` sin cambios; matriz de rutas con 172 rutas.
- **SC-002**: con el padrón de octubre se crean los 10 enlaces de ciclo (o los que tenga el padrón) y cada uno abre solo a su ciclo.
