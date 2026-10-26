# Feature Specification: Envíos masivos a los inscritos presenciales

**Created**: 2026-10-25 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: el usuario quiere, desde el panel, (1) enviar a los **inscritos presenciales** el enlace de su **credencial virtual 3D** (spec 038) y (2) enviarles
**un mismo mensaje** con el enlace para inscribirse a las **ponencias especializadas** (`/inscripcion-ponencias` de la landing), editando el texto, y **marcar
a quién ya se le envió** para elegir después solo a quien falta.

> **Numeración**: es la spec **039** del backend. Panel = spec 029 (las dos pantallas).

## Decisiones

- **Destinatarios**: inscripciones **APROBADAS** del evento con tipo presencial **o sin tipo** (cortesías), igual que `resolverElegibilidad` de las ponencias.
  El servidor lo vuelve a comprobar en cada envío: lo que mande el panel no decide (los que no cumplen salen como `noElegibles`).
- **Un correo por persona**, nadie ve las direcciones de otras. En el canal de ponencias el asunto y el HTML son **idénticos** para todas (no se personaliza);
  en el de la credencial cada una recibe el correo con **su** enlace. Mismo remitente y credencial de correo del evento (`credencialParaEvento`).
- **Marca por persona y canal** en la inscripción: `enlace_credencial_enviado_en` y `enlace_ponencias_enviado_en`. Quien envía puede filtrar «sin enviar» y elegir a todos
  los pendientes. Sin `reenviar`, a quien ya tiene la marca se le omite (`yaEnviados`).
- **Reserva atómica**: antes de enviar se pasa la marca de lo leído a «ahora» con un `UPDATE … WHERE marca = <lo leído>`; si dos cuentas envían a la vez, solo una gana. Si el
  correo falla, la marca vuelve a como estaba (`fallidos`). Una excepción al enviar no corta el lote.
- **Por tandas**: hasta 100 inscripciones por petición (el panel envía de 25 en 25 con avance), `limiteEnviosMasivos` por cuenta (120 cada 15 min). `…/ids` devuelve todos
  los ids de un filtro (hasta 5000) para elegirlos y partirlos.
- **Permisos existentes** (sin catálogo nuevo): ver y enviar la credencial = `inscripciones.ver` / `credenciales.reenviar`; ver y enviar el enlace de ponencias =
  `especializadas.ver` / `especializadas.inscribir`. Cuentas por evento solo en sus eventos.
- **Mensaje de ponencias**: texto del staff **escapado** (líneas en blanco = párrafos), con el botón «Inscribirme a las ponencias» y el enlace en texto de respaldo
  (`htmlComunicado` con su parámetro `accion`). `POST …/test` lo manda a una dirección, marcado `[Prueba]`, sin marcar a nadie.
- Sin la URL de la landing (`409 LANDING_URL_MISSING`) o sin credencial de correo activa (`409 EMAIL_CREDENTIAL_UNAVAILABLE`) no se envía ni se marca nada.
- **Plantilla del correo de la credencial** (`credencial-enlace.html`, dentro de `inscription/utils/templates`, que el `Dockerfile` ya copia): tarjeta clara y minimalista, titular, un
  botón y el código; sin adjuntos. En el log solo ids de cuenta y totales, nunca correos ni mensajes.

## Requisitos

- **FR-001**: `GET /v1/events/:eventId/credential-links` y `…/specialized-talk-invitations` (`?q&enviado=si|no&page&pageSize`): `data` con id, nombres, apellidos, documento,
  correo, tipo, clasificación y `enviadoEn`; `meta.resumen = { total, enviados, pendientes }` del evento (no de los filtros). `…/ids`: `data` = ids, `meta.total`.
- **FR-002**: `POST …/credential-links/send` `{ ids, reenviar? }` y `POST …/specialized-talk-invitations/send` `{ ids, asunto, mensaje, reenviar? }`: responden
  `{ enviados, yaEnviados, noElegibles, fallidos }`.
- **FR-003**: `POST …/specialized-talk-invitations/test` `{ correo, asunto, mensaje }` → `{ enviado: true }` o `502 EMAIL_SEND_FAILED`.
- **FR-004**: migración aditiva (las dos marcas; ver spec 038).

## Fuera de alcance

- Programar envíos, plantillas guardadas o un historial de campañas (solo la última marca por persona).
- Envío a quien no está aprobado o es virtual (el filtro es del servidor).
