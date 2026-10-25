# Feature Specification: Enlace público del aforo de las ponencias especializadas

**Created**: 2026-10-25 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: el usuario quiere ver por tema el **aforo**, los **inscritos** y la **asistencia** de las ponencias especializadas en una página aparte de
la landing (`/aforo-ponencias`), con un **enlace público que solo él genera y comparte**. La página pública de ponencias (`/ponencias-especializadas`)
no cambia.

> **Numeración**: es la spec **036** del backend. Panel = spec 027 (generar el enlace); landing = spec 012 (la página).

## Decisiones

- **Un enlace por evento**, en su propia tabla `enlaces_aforo_ponencias` (como `enlaces_ciclo`, spec 027): un token aleatorio de 256 bits
  (43 caracteres base64url) guardado en claro para que el panel pueda mostrarlo y copiarlo cuando se quiera. Renovarlo invalida el anterior al
  instante; desactivarlo borra la fila.
- **Solo el Owner**: permiso nuevo `especializadas.enlace_aforo`, global y en `PERMISOS_SOLO_OWNER` (como `inscripciones.cambiar_tipo`). El
  Administrador del sistema, el Tesorero y la Comisión reciben `403 FORBIDDEN`, y el panel no les muestra la tarjeta. Si algún día debe poder también
  el Administrador, basta quitarlo de esa lista.
- **La vista vive en la API del sitio** (`GET /v1/site/specialized-talk-occupancy`): la landing la pide desde su servidor con el token del evento
  (`X-Api-Key`) **y** el del enlace (`X-Link-Token`). El enlace debe ser del **mismo evento** que el token del sitio. El token del enlace nunca va en una
  URL: en el navegador va tras el `#` (no se envía a ningún servidor) y el BFF lo reenvía en el encabezado.
- **Un solo error**: token faltante, mal formado, desconocido, desactivado o de otro evento = el mismo `404 LINK_NOT_FOUND`.
- **Qué muestra** (por ponencia **publicada**): tema, fecha, horario, duración, ambiente, modalidad, ponente y coponentes (nombre, foto y si es externo),
  `cupo` (aforo presencial; `null` = sin límite), `inscritos` (**solo presenciales vigentes**: los que ocupan aforo), `cuposDisponibles`, `llena` y
  `asistentes` (inscripciones vigentes con asistencia en puerta). Los virtuales no se cuentan aparte (decisión del usuario). Ni biografías, precios
  ni si está publicada.
- **Lista de inscritos** (pedida por el usuario el mismo día, 2026-10-25): cada ponencia trae `personas`, los inscritos **vigentes** (presenciales y
  virtuales) ordenados por apellido y nombre, con **solo** `nombre`, `modo` (`PRESENCIAL` | `VIRTUAL`) y `asistioEn` (o `null`). **Nunca** documento,
  correo, celular ni procedencia: el enlace llega a quien lo reciba (como el enlace por ciclo, que tampoco trae celular). Los cancelados no salen.
- El último acceso se anota como máximo cada 5 minutos (dato de cortesía para el panel: «Se abrió hace …»). Respuestas `no-store` y `noindex`.

## Requisitos

- **FR-001**: `GET|POST|DELETE /v1/events/:eventId/specialized-talks/occupancy-link` con `especializadas.enlace_aforo`, límite por cuenta
  (`limiteEnlacesAsesores`) y `Cache-Control: no-store`. `POST` crea si falta (si ya existe lo devuelve igual) y con `{ regenerar: true }` lo renueva.
- **FR-002**: `GET /v1/site/specialized-talk-occupancy` con `requireTokenEvento`, `limiteLecturaPublica` y `limiteTokenLectura`; token del enlace en `X-Link-Token`.
- **FR-003**: de las personas la respuesta del sitio solo lleva nombre, modo y hora de asistencia; nunca documento, correo, celular ni procedencia
  (lo comprueba `tests/specialized-talk/enlace-aforo.test.ts`).
- **FR-004**: migración aditiva `20261027120000_enlace_aforo_ponencias` (solo crea la tabla).

## Fuera de alcance

- Varios enlaces por evento o con vencimiento automático.
- Datos de contacto o documentos de las personas, y descargas desde el enlace.
