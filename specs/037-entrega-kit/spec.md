# Feature Specification: Entrega del kit en la puerta y asistencia solo presencial

**Created**: 2026-10-25 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: la organización escanea el QR del fotocheck (celular con cámara o lector USB) para registrar la asistencia y necesita **saber si la persona
tiene kit o no**, **marcar que se lo entregó** con la hora y **poder corregirlo** (se marcó por error, o no había kit y se entrega otro día). Además **solo
los presenciales marcan asistencia**: a los virtuales se les envía por correo el enlace de la transmisión (Zoom/Meet; lo manda la organización por fuera).

> **Numeración**: es la spec **037** del backend. Panel = spec 028. La landing no cambia.

## Decisiones

- **El kit es de la inscripción, no de la actividad**: una persona recibe un kit en todo el congreso. Dos columnas en `inscripciones`
  (`kit_entregado_en`, `kit_entregado_por_id`); deshacer las deja en `NULL`. No hay historial de entregas anteriores (como la asistencia anulada,
  la fila se reescribe), solo la entrega vigente.
- **Qué tipo lleva kit lo dice una bandera**, `tipos_inscripcion.incluye_kit` (`false` por defecto), no el texto de la etiqueta. La migración la rellena
  con `codigo LIKE '%\_con\_kit'` o etiqueta `CON KIT` y solo en tipos **presenciales**: cubre los tipos de la landing y el plan `delegacion_con_kit` de
  cada delegación (`PLANES[CON_KIT].incluyeKit`). El editor de tipos del panel la cambia. Un tipo virtual nunca lleva kit (al crear o editar se guarda
  `false`, también si se pasa un tipo con kit a virtual sin mencionarla). Se clona con el evento.
- **Entregar** exige inscripción `APROBADO` + tipo que incluye kit + presencial (`403 NOT_APPROVED`, `409 KIT_NOT_INCLUDED`) y no depende del horario de
  ninguna actividad. **Deshacer** solo exige que esté entregado (`409 KIT_NOT_DELIVERED`): se puede corregir aunque el tipo haya cambiado después. Ambas
  son atómicas (`updateMany` condicionado al estado leído): dos operadores a la vez no se pisan; el segundo recibe `409 KIT_ALREADY_DELIVERED` con la hora.
- **Permisos sin permiso nuevo**: entregar y deshacer = `asistencia.marcar` (por evento): las cuentas de la puerta funcionan tal como están; el resumen
  de kits = `asistencia.ver`.
- **Los virtuales no marcan asistencia**: `registrarAsistencia` responde `403 VIRTUAL_REGISTRATION` tras comprobar que la inscripción está aprobada.
  Nada lo salta (ni «fuera de horario» ni la marca manual ni quien tiene todos los permisos) y aplica también a las rutas legacy. Una cortesía sin tipo
  se lee presencial (como siempre). Las ponencias especializadas no cambian.
- **«Ya registrada» lleva datos**: antes `ATTENDANCE_ALREADY_REGISTERED` no decía nada de la persona y un kit pendiente no se podía entregar al volver
  a escanear en la misma actividad. Ahora el 409 trae `data: { participante, inscripcion }` con el mismo formato de una marca (`HttpError.datos`; el
  `errorHandler` y `normalizeErrorResponses` lo emiten como `data`). Es aditivo: quien no lo lee no nota nada.
- Una cortesía sin tipo no tiene kit; el Owner puede darle un tipo con kit con «Cambiar tipo» (spec 035).

## Requisitos

- **FR-001**: `PUT /v1/inscriptions/:id/kit` entrega y `DELETE /v1/inscriptions/:id/kit` deshace, con `asistencia.marcar` (evento de la inscripción) y
  `limiteMarcarAsistencia`. Responden `{ inscripcionId, kit }`.
- **FR-002**: `GET /v1/events/:eventId/kits/summary` da `{ conKit, entregados, pendientes }` de las inscripciones aprobadas con un tipo presencial que
  incluye kit (`asistencia.ver`).
- **FR-003**: la marca de asistencia (`POST /v1/activities/:id/attendances`), el listado (`GET /v1/activities/:id/attendances`), el detalle de la
  inscripción y el listado de tipos del panel traen `incluyeKit` y/o `kit` (`{ incluye, entregado, entregadoEn, entregadoPor }`); el listado de
  inscripciones, `incluyeKit` y `kitEntregado`. La landing y la forma legacy no cambian.
- **FR-004**: `POST|PUT …/registration-categories/…/types` y `registration-types/:id` aceptan `incluyeKit` (booleano; `false` si el tipo queda virtual).
- **FR-005**: migración aditiva `20261027180000_entrega_kit` (columnas, índice, clave foránea `SET NULL` y el relleno). `prisma/preflight/verificar-kit.sql`
  la revisa en solo lectura.

## Fuera de alcance

- El correo masivo con el enlace de Zoom/Meet a los virtuales.
- El kit en el CSV de asistencia o de inscritos y una vista de kits por delegación.
- Un permiso propio para el kit (si la organización lo pide, basta cambiar la guarda de las dos rutas).
