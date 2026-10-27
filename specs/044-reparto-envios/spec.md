# Feature Specification: Los envíos masivos pasan solos de una credencial a la siguiente, con tope seguro

**Created**: 2026-10-26 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: el Owner preguntó qué pasa si ANGEL tiene 295 envíos y hay que mandar 320: «al llegar al límite debería elegir el otro automáticamente», y cómo saber que de verdad
salió. El trazado del código (specs 041/042) mostró que el cambio ya ocurre, pero con huecos: el control dependía de un error de Brevo que **el plan gratuito no siempre da**,
una dirección mala dejaba todas las credenciales en error y, si no quedaba ninguna con envíos, el envío masivo recorría a todos sin decir por qué.

> Amplía las specs 041 y 042. No cambia los correos ni las plantillas: solo **con qué credencial** salen y **cuándo se corta**.

## Hallazgo clave (Brevo)

Pasado el tope de 300 al día del plan gratuito, Brevo puede seguir **aceptando** correos (201 con `messageId`) y dejarlos en cola (hasta 1000; luego se descartan) en lugar de responder con un
error. Reaccionar a un error no basta: **el control es el conteo de créditos**, y hay que mantenerlo exacto justo donde importa (el tramo final).

## Decisiones

- **Zona de revisión** (`ZONA_DE_REVISION = 25`): con 1 a 25 envíos guardados, la revisión ya no vale y se pregunta a Brevo (`/account`, no gasta créditos) **antes de cada envío**. Con más, la revisión vale 5 min
  como en la spec 042; con 0 revisado hace menos de 5 min se salta sin llamar. Así el conteo local no se deja solo donde un descuadre cuesta correos en cola.
- **Revisión forzada antes de un envío masivo** (`prepararEnvioMasivo`): al empezar cada petición se pregunta a Brevo por todas las credenciales que podrían enviar (aunque su revisión sea reciente) y se
  responde `409 EMAIL_CREDITS_EXHAUSTED` **antes de reservar la marca de nadie** si ninguna tiene envíos. Sin credencial activa sigue siendo `409 EMAIL_CREDENTIAL_UNAVAILABLE`.
- **Un error de créditos se guarda**: si Brevo rechaza con 402, con el código `not_enough_credits` / «Insufficient credits» o con un 4xx cuyo mensaje habla de créditos, cuota o límite diario
  (`CorreoFallido.sinCreditos`), la credencial queda con `creditos = 0` (revisado ahora) además de la espera de 15 min en memoria: el siguiente correo ni la intenta, tampoco tras reiniciar el servidor.
  Un 429 (velocidad) o un 4xx por otra cosa (p. ej. el tamaño del adjunto) **no** la dejan en 0.
- **Política de `ERROR`**: si otra credencial pudo enviar el mismo correo, las que fallaron antes quedan con error (el problema era de ellas); si **todas** fallan, solo queda con error la primera y las que
  fallaron por su cuenta (clave, créditos). Una dirección mala ya no deja las tres en error ni apaga el acceso por código (`credencialUtilizable`).
- **Recuento por credencial** (`recuento-envios.ts`, `AsyncLocalStorage`): `enviarConCredencial` anota cada envío confirmado; `recorrer` lo devuelve en `ResultadoEnvio.porCredencial`
  (`[{ credencialId, nombre, enviados }]`) solo si salió alguno. `enviarConCredencial` **no cambia de firma** (`string | null`). Dos envíos que corren a la vez no mezclan su recuento.
- **Corte al agotarse**: si no queda ninguna credencial con envíos a mitad del lote, `recorrer` devuelve la marca de la persona en curso, **corta** y responde `agotado: true`; lo que faltó no se cuenta como
  fallido y sigue «sin enviar».
- **Sin migración ni rutas nuevas.** Gmail no informa créditos: siempre es elegible y su límite diario (~500) se detecta cuando Google lo rechaza (spec 041).

## Requisitos

- **FR-001**: con 295 envíos en ANGEL y 320 por enviar, los primeros 295 salen por ANGEL (con su remitente) y los 25 restantes por la siguiente credencial con envíos, sin pasar por las que tienen 0.
- **FR-002**: `POST …/credential-links/send` y `…/specialized-talk-invitations/send` responden `409 EMAIL_CREDITS_EXHAUSTED` sin reservar ninguna marca si ninguna credencial activa tiene envíos.
- **FR-003**: `ResultadoEnvio` trae `porCredencial` (si salió alguno) y `agotado: true` (si se cortó por falta de envíos); ambas claves solo aparecen cuando aplican.
- **FR-004**: un error de créditos de Brevo deja `creditos = 0` en la credencial; un 429 o un error del mensaje no.
- **FR-005**: una dirección mala que rechazan todas las credenciales deja con error solo a la primera.

## Fuera de alcance

- Estado de **entrega** de cada correo (entregado, rebotó, en cola de Brevo) y seguimiento por persona: «confirmado» sigue significando «el proveedor lo aceptó».
- `Reply-To` unificado: el remitente cambia con la credencial que envía (nombre y, si el evento no tiene `correoContacto`, la línea «escríbenos a…»).
- Documentación de Brevo **no confirmada**: la hora del reinicio diario del tope y si `credits` va atrasado respecto a los envíos; la zona de revisión existe por eso.

## Despliegue

Backend primero (sin migración); luego el panel. Con el panel anterior todo sigue igual: el `409` se muestra como error del envío y `porCredencial`/`agotado` se ignoran.
