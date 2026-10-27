# Contrato — Envíos masivos con reparto entre credenciales (spec 044)

Amplía [`039-envios-masivos-presenciales/contracts`](../../039-envios-masivos-presenciales/contracts/api-envios-masivos.md); todo lo que no se menciona sigue igual.

## `POST /api/v1/events/:eventId/credential-links/send` y `…/specialized-talk-invitations/send`

Respuesta `data` (`ResultadoEnvio`), con dos claves **opcionales** que solo aparecen cuando aplican:

| Campo | Tipo | Notas |
|---|---|---|
| `enviados`, `yaEnviados`, `noElegibles`, `fallidos` | `number` | Como antes |
| `porCredencial` | `{ credencialId: number, nombre: string, enviados: number }[]` | Cuántos salieron por cada credencial de correo en esta petición. Ausente si no salió ninguno |
| `agotado` | `true` | No quedó ninguna credencial activa con envíos y se **cortó**: lo que faltó no cuenta como fallido y sigue «sin enviar». Ausente si no pasó |

`porCredencial` solo lleva el **nombre** de la credencial (el de la pantalla Correo): nunca su remitente, clave ni créditos.

## Errores nuevos

| Código | Cuándo |
|---|---|
| `409 EMAIL_CREDITS_EXHAUSTED` | Al empezar la petición, ninguna credencial activa tiene envíos disponibles (se revisan al día con Brevo). No se reservó ninguna marca |

`409 EMAIL_CREDENTIAL_UNAVAILABLE` (sin credencial activa) y `409 LANDING_URL_MISSING` no cambian.

## Comportamiento (no es una ruta)

- Los correos salen por la credencial del evento (o la primera activa por prioridad) y **pasan solos a la siguiente con envíos** cuando a esa se le acaban. En cada intento el remitente es el de la credencial que envía.
- Con 1 a 25 envíos guardados en una credencial de Brevo se pregunta a Brevo antes de cada envío; un error de créditos la deja en 0.
- Una dirección mala que rechazan todas las credenciales no las deja a todas con error: solo a la primera.
