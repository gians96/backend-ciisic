# Feature Specification: Enlace de acceso al congreso para los inscritos virtuales

**Created**: 2026-10-26 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: el usuario necesita enviar a los inscritos **virtuales** un enlace para que puedan ingresar al congreso, y tener en el panel la opción de enviárselo
a quienes están inscritos de manera virtual (hoy «el correo con el enlace de la transmisión lo manda la organización por fuera», spec 037).

> Amplía los envíos masivos de la spec 039 con un **tercer canal**: mismo módulo `broadcast`, misma reserva de la marca y mismo resultado. Panel = spec 033.

## Decisiones

- **Destinatarios**: inscripciones **APROBADAS** del evento con un **tipo virtual** (`tipos_inscripcion.modalidad = 'VIRTUAL'`; incluye los planes virtuales de las delegaciones). Sin tipo
  (cortesía) cuenta como presencial (`modalidadDe`), así que no entra. El servidor lo vuelve a comprobar en cada envío (`aprobadasVirtuales`): lo que mande el panel no decide, quien no cumple sale como `noElegibles`.
- **El enlace lo escribe quien envía** (`enlace`, en cada petición): es el de la transmisión (Zoom, Meet, YouTube…) y cambia de un evento o de un día a otro, así que no se guarda en la BD ni se agrega
  configuración. Debe ser `https://`, con servidor, sin usuario ni contraseña y sin espacios, hasta 500 caracteres (`esEnlaceDeAcceso`): solo va al botón del correo (el servidor no lo abre), por eso lo que
  importa es que no sea otro esquema (`javascript:`, `data:`) ni lleve credenciales. Se escapa en el HTML.
- **Un mismo mensaje y un mismo enlace para todas las personas** (asunto y HTML idénticos, no hay `{nombre}`), un correo por persona (nadie ve las direcciones de otras), con el botón
  «Ingresar al congreso» y el enlace en texto de respaldo (`htmlComunicado` con su parámetro `accion`). Mismo remitente y credencial de correo del evento (`credencialParaEvento`). No necesita la URL de la landing.
- **Marca por persona**: `inscripciones.enlace_virtual_enviado_en` (migración aditiva `20261030120000_acceso_virtual`). Sin `reenviar`, a quien ya la tiene se le omite (`yaEnviados`); con `reenviar` se vuelve
  a enviar (p. ej. si el enlace cambió de un día al siguiente). Reserva atómica y reversión si el correo falla: igual que la spec 039.
- **Por tandas**: hasta 100 inscripciones por petición (el panel envía de 25 en 25), `limiteEnviosMasivos` por cuenta; `…/ids` devuelve todos los ids de un filtro (hasta 5000).
- **Permisos existentes** (sin catálogo nuevo): ver = `inscripciones.ver`; enviar y probar = `credenciales.reenviar` (es entregar el acceso a la inscripción, como reenviar la credencial). Cuentas por evento solo en sus eventos.
- **Prueba**: `POST …/test` lo manda a una dirección, marcado `[Prueba]`, sin marcar a nadie.
- Sin credencial de correo activa (`409 EMAIL_CREDENTIAL_UNAVAILABLE`) no se envía ni se marca nada. En el log solo ids de cuenta y totales: **nunca** correos, mensajes ni el enlace (da acceso a la transmisión).

## Requisitos

- **FR-001**: `GET /v1/events/:eventId/virtual-access` (`?q&enviado=si|no&page&pageSize`) y `…/ids`: misma forma que los otros canales; `meta.resumen = { total, enviados, pendientes }` cuenta los virtuales aprobados del evento.
- **FR-002**: `POST …/virtual-access/send` `{ ids, asunto, mensaje, enlace, reenviar? }` → `{ enviados, yaEnviados, noElegibles, fallidos }`.
- **FR-003**: `POST …/virtual-access/test` `{ correo, asunto, mensaje, enlace }` → `{ enviado: true }` o `502 EMAIL_SEND_FAILED`.
- **FR-004**: migración aditiva con la marca; `prisma migrate diff` vacío.

## Fuera de alcance

- Guardar el enlace en el evento o mostrarlo en el portal del inscrito (por ahora se envía por correo).
- Personalizar el mensaje con el nombre, programar envíos o llevar un historial de campañas (solo la última marca por persona).
- Que el enlace dependa de la persona (uno por inscrito) o quede asociado a la asistencia de los virtuales (los virtuales siguen sin marcar asistencia, spec 037).
