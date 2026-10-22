# Feature Specification: Resumen por persona de las ponencias especializadas, cancelación y comunicado

**Created**: 2026-10-22 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: con la spec 030 solo pueden inscribirse a las ponencias quienes tienen su inscripción al congreso con el pago aprobado
(salvo el acceso libre), pero ya había personas inscritas antes. El usuario pidió **saber de cada inscrito si está inscrito al
congreso y si pagó**, con un **resumen total por persona (no por tema ni ponente) con filtros** que diga quién puede estar inscrito y
quién no, y la posibilidad de **cancelar su inscripción y darle un comunicado**.

> **Numeración**: es la spec **031** del backend. Panel = spec 022.

## Decisiones

- **Una fila por persona**, no por inscripción: documento, nombre, contacto, cuántas ponencias tiene vigentes, cuántas ya asistió y su
  **situación actual** frente al congreso. La situación **se calcula en cada consulta** con el documento (también sin ceros a la izquierda,
  que Excel pierde), igual que `validar-existentes`; no se guarda.
- **Situaciones**: `APROBADO` (inscrito con el pago aprobado), `PAGO_PENDIENTE` (pendiente o en revisión), `RECHAZADO` (rechazada o cancelada),
  `NO_INSCRITO`. **Puede asistir** = acceso libre o `APROBADO`. Con el acceso libre encendido todos pueden, pero la situación real se sigue mostrando.
- **Filtros**: situación, si puede, validación (todas sus inscripciones se validaron al registrarse), modo con el que asiste al congreso, si ya se le
  avisó y búsqueda por documento, nombre, correo o celular. Los totales (`meta.resumen`) son siempre los de todo el evento. Orden: primero quienes
  tienen problemas (no inscrito, rechazado, pago pendiente), luego por apellido.
- **Cancelar** (`SIN_CONGRESO`): solo a quien **hoy** no puede asistir (el servidor lo vuelve a comprobar: a quien sí puede no se le cancela aunque el
  panel lo mande). Cancela todas sus inscripciones vigentes **sin asistencia** («primero se anula la asistencia»); libera el aforo. Con el acceso
  libre encendido responde `409 FREE_ACCESS_ENABLED`. Máximo 100 personas por petición.
- **Comunicado por correo desde el sistema**: con `notificar` la cancelación envía un correo a cada persona con la credencial de correo del evento
  (`credencialParaEvento`), con el asunto y el mensaje que escribe el staff (se **escapa** el HTML; las líneas en blanco separan párrafos y `{nombre}`
  se reemplaza por el primer nombre). La cancelación se guarda primero: un correo que falla no la revierte (`avisos.fallidos`). A quien se le envía
  queda marcado con `aviso_enviado_en`. También se puede **solo avisar** (`notify`), por ejemplo para pedir que se inscriban al congreso antes de cancelar.
- **Descarga a Excel** con los mismos filtros: hoja «Resumen» (totales de todo el evento) y hoja «Personas».
- Permisos: ver y descargar = `especializadas.ver`; cancelar y avisar = `especializadas.inscribir`, ambos por evento. Los envíos y las descargas
  tienen límite por cuenta.
- Lo que se registra en el log son solo ids (quién canceló o avisó y cuántas personas), nunca correos ni mensajes.

## User Scenarios & Testing

1. **Given** hay inscritos a ponencias, **When** el staff abre el resumen, **Then** ve una fila por persona con su situación en el congreso, los totales
   (personas, cuántas pueden y cuántas no por motivo) y puede filtrar y descargar el Excel.
2. **Given** personas que no son congresistas con el pago aprobado, **When** el staff las selecciona y cancela, **Then** sus inscripciones quedan
   `CANCELADO` con motivo `SIN_CONGRESO`, y si pidió comunicado reciben el correo; quien sí puede asistir se omite.
3. **Given** una persona con asistencia marcada, **Then** su inscripción con asistencia no se cancela (se informa como `YA_ASISTIO`).
4. **Given** el acceso libre encendido, **Then** no hay a quién cancelar ni avisar (`409 FREE_ACCESS_ENABLED`).

## Requirements

- **FR-001**: migración aditiva `20261024150000_ponencias_resumen_aviso`: valor `SIN_CONGRESO` en `motivo_cancelacion` y columna `aviso_enviado_en`.
- **FR-002**: `GET /v1/events/:eventId/specialized-talk-attendees` (+ `/export`), `POST …/cancel` y `POST …/notify`.
- **FR-003**: la situación se calcula con `resolverElegibilidad`/`situacionDe` y `variantesDocumento` (compartido con `validar-existentes`).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` vacío; la matriz de rutas clasifica las 4 rutas y los 2 límites nuevos.
- **SC-002**: nunca se cancela ni se avisa a una persona que hoy puede asistir.
