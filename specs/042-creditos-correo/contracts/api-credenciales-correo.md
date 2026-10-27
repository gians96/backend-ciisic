# Contrato — Créditos de las credenciales de correo y confirmación del envío (spec 042)

Amplía [`041-correo-respaldo-gmail/contracts`](../../041-correo-respaldo-gmail/contracts/api-credenciales-correo.md); todo lo que no se menciona sigue igual. Solo Owner y Administrador del sistema (`correo.configurar`).

## `CredencialCorreo` (campos nuevos)

| Campo | Tipo | Notas |
|---|---|---|
| `creditosDisponibles` | `number` o `null` | Envíos que le quedan en Brevo en la última revisión (suma de sus planes de correo). `null` = no se sabe: nunca se revisó o es Gmail (no lo informa). `0` = sin envíos: no se usa para enviar |
| `creditosVerificadosEn` | `string` (ISO) o `null` | Cuándo se revisó. Una revisión de `0` vale 5 min; pasado ese tiempo se vuelve a preguntar antes de enviar |

## Rutas

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| POST | `/api/v1/email-credentials/check` | | `CredencialCorreo[]` (orden de prioridad) tras preguntar a Brevo cuántos envíos le quedan a cada credencial **activa de Brevo**, en paralelo. No gasta créditos; una que falla (clave inválida) queda con su error y no impide revisar las demás |
| POST | `/api/v1/email-credentials/:id/test` | | Ya existía: ahora también guarda `creditosDisponibles` y `creditosVerificadosEn` (Brevo) |
| POST | `/api/v1/email-credentials/:id/send-test` | `{ correo }` | `{ ok, messageId?, error?, credencial }`. `messageId` es el identificador con el que el proveedor confirmó que aceptó el correo; sin confirmación, `ok: false` |

## Comportamiento del envío (no es una ruta)

- Antes de enviar se revisan los créditos de las candidatas (solo si la revisión tiene más de 5 min): **las de Brevo con 0 envíos se saltan** y se usa la siguiente por prioridad. Si ninguna activa tiene envíos, el envío falla sin
  intentar con nadie («Ninguna credencial activa tiene envíos disponibles»). Gmail siempre es elegible.
- Un envío exitoso descuenta 1 de `creditosDisponibles` (si se conocía).
- **Un envío solo se da por hecho si el proveedor lo confirma**: Brevo con `messageId`/`messageIds` en la respuesta; Gmail con el destinatario en `accepted` y `rejected` vacío. Sin confirmación es un error y se prueba la siguiente credencial.
- Esto **no** dice que el mensaje llegó al buzón: los rebotes y el spam se saben después, en los eventos de Brevo.
