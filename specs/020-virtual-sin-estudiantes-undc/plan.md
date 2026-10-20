# Implementation Plan: Tipos de inscripción que no admiten estudiantes UNDC

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-excluye-estudiantes.md](contracts/api-excluye-estudiantes.md)

## Decisión de diseño

- Interruptor **por tipo** (`TipoInscripcion.excluyeEstudiantesUndc`), ortogonal a `disponiblePara`
  (a quién se ofrece por precio institucional) y a `modalidad` (cómo se asiste): se usa en los virtuales,
  pero la regla no depende de la modalidad.
- Columna booleana aparte, no un valor nuevo del enum `disponible_para`: la imagen anterior sigue
  funcionando (no lee la columna; un valor de enum desconocido haría fallar a Prisma al leer el tipo).
- «Estudiante UNDC» se decide con dos señales del servidor, sin llamadas nuevas a API_UNDC: el
  `verificacionToken` de SIVIRENO (categoría estudiantil) y el correo final `<8–12 dígitos>@<dominio del
  evento>` (`esCorreoDeEstudiante`, con el dominio del evento como el precio institucional). Un docente o
  administrativo del dominio no es estudiante.
- Se evalúa dentro de la transacción de `crearInscripcion`, tras `tipoDisponible` y con el correo final
  (el registrado si se conserva): un error revierte el participante recién creado.
- Error: el mismo `REGISTRATION_TYPE_NOT_AVAILABLE` (el consumidor ya lo maneja) con un mensaje propio.

## Archivos

- `prisma/schema.prisma` y migración `20261021120000_excluye_estudiantes_undc` (un `ADD COLUMN` con valor
  por defecto).
- `src/core/correo-institucional.ts`: `PATRON_CODIGO_ESTUDIANTE` (lo reutiliza `tipoCuentaUndc`) y
  `esCorreoDeEstudiante(correo, dominio)`.
- `src/api/inscription/services/pricing.ts`: `estudianteUndcExcluido` y `MENSAJE_TIPO_SIN_ESTUDIANTES_UNDC`;
  `services/inscription.ts`: la guarda en `crearInscripcion`.
- `src/api/registration-type`: `excluyeEstudiantesUndc` en la validación (`yup.boolean()`), `aTipo`,
  `tiposPublicos`, `crearTipo` (`?? false`) y `actualizarTipo` (solo si llega). No se toca `aTipoLegacy`.
- `src/api/event/services/event.ts`: copiar el interruptor al duplicar un evento. `src/database/seed.ts`:
  encendido en los virtuales de demostración.
- `prisma/preflight/excluir-estudiantes-undc-virtual.sql`: enciende (o apaga) el interruptor en
  `estudiantes_virtual` y `general_virtual` de un evento y cuenta a los estudiantes que ya estaban inscritos
  (idempotente; lo ejecuta el dueño del proyecto, nunca el código).
- Documentación: `AGENTS.md`, `README.md`, `docs/` (modelo de datos, API, operación, ecosistema) y nota en
  la spec 018.
- Consumidores (otros repositorios): panel (casilla en el editor de tipos) y landing (ocultar el plan).

## Orden de despliegue

1. Respaldo `mysqldump`. 2. Backend (la imagen aplica `prisma migrate deploy`). 3. Encender el interruptor
(panel o `excluir-estudiantes-undc-virtual.sql`). 4. Panel y landing cuando se publiquen: toleran un backend
sin el campo (la casilla avisa; la landing no oculta nada y el backend rechaza igual).

- **Backend primero.** Un backend anterior descarta en silencio el campo que envía el panel
  (`validateBody` quita lo que no conoce) y no aplica la regla.
- **Las inscripciones ya hechas no se tocan.** Los 2 estudiantes UNDC aprobados en `estudiantes_virtual`
  antes de la spec siguen inscritos; la organización decide desde el panel.

## Pruebas

- `tests/inscription/pricing.test.ts`: `esCorreoDeEstudiante` (dominio del evento, longitud del código,
  subdominios) y `estudianteUndcExcluido`.
- `tests/inscription/create.test.ts`: estudiante verificado, correo de estudiante sin verificar (estudiantil y
  general), docente y externo permitidos, correo registrado, interruptor apagado, tipo sin la columna,
  dominio del evento y ruta legacy.
- `tests/registration-type/sin-estudiantes-undc.test.ts`: crear/actualizar/listar (con y sin `pagos.ver`),
  validación, `GET /site/registration-types` y la forma LEGACY sin el campo.
- `tests/event/modalidad.test.ts`: copiar un evento conserva el interruptor.
