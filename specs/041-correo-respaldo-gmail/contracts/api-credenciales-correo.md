# Contrato — Credenciales de correo con proveedor y prioridad (spec 041)

Amplía [`006-credenciales-correo/contracts`](../../006-credenciales-correo/contracts/api-credenciales-correo.md); todo lo que no se menciona sigue igual. Solo Owner y Administrador del sistema (`correo.configurar`).

## `CredencialCorreo` (campos nuevos o con otro significado)

| Campo | Tipo | Notas |
|---|---|---|
| `proveedor` | `"BREVO"` o `"GMAIL_SMTP"` | Ya existía (solo `BREVO`). No cambia después de crear |
| `prioridad` | `number` | Orden de respaldo: menor = antes (`PUT …/order` la renumera 1, 2, 3…). La predeterminada (`esPredeterminada`) va siempre primero, sea cual sea su valor; la posición en la lista es lo que se muestra |
| `apiKeyEnmascarada` | `string` | `••••` + últimos 4 de la API key de Brevo **o de la contraseña de aplicación** de Gmail |
| `remitenteCorreo` | `string` | En Gmail es la **cuenta con la que se inicia sesión** en el SMTP |

## Rutas

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/v1/email-credentials` | | `CredencialCorreo[]` en orden de prioridad (predeterminada primero) |
| POST | `/api/v1/email-credentials` | `{ proveedor?, nombre, apiKey, remitenteCorreo, remitenteNombre?, esPredeterminada?, activo? }` | `201 CredencialCorreo`. `proveedor` por defecto `BREVO`. Una de respaldo va al final de la fila |
| PUT | `/api/v1/email-credentials/order` | `{ ids: number[] }` con **todas** las credenciales, de la primera a la última | `CredencialCorreo[]` en el nuevo orden; la primera queda predeterminada |
| POST | `/api/v1/email-credentials/:id/test` | | `{ ok, cuenta?, error?, credencial }`; Gmail: inicia sesión sin enviar y `cuenta = { correo, empresa: null, planes: [] }` |
| POST | `/api/v1/email-credentials/:id/send-test` | `{ correo }` | `{ ok, error?, credencial }`; **sin respaldo**: prueba solo esta credencial |

`apiKey` para `GMAIL_SMTP` es la **contraseña de aplicación** de Google: se acepta con o sin espacios, se guarda en minúsculas y sin espacios y debe tener 16 letras.
Al editar una credencial de Gmail, cambiar `remitenteCorreo` exige enviar también `apiKey`.

## Errores nuevos

| Código | Cuándo |
|---|---|
| `422 VALIDATION_ERROR` (`fields.proveedor`) | Proveedor desconocido |
| `422 VALIDATION_ERROR` (`fields.apiKey`) | Contraseña de aplicación que no son 16 letras, o cambio de cuenta de Gmail sin contraseña |
| `422 INVALID_ORDER` | `ids` repite, omite o inventa credenciales |
| `422 DEFAULT_CREDENTIAL_INACTIVE` | La primera del orden está inactiva |

## Comportamiento del envío (no es una ruta)

Todos los envíos de correo del backend pasan por `enviarConCredencial`: prueban la credencial elegida y, si falla, las demás **activas** en orden de prioridad (máximo 3 por correo), con el
remitente de la que envía. Una credencial cuya cuenta falla (sin créditos, límite diario, clave inválida) queda 15 min en espera. El resultado se registra en cada credencial
(`ultimoEstado`, `ultimoError`, `ultimoEnvioEn`). Los respaldos solo se anotan en el log con ids de credencial, nunca con direcciones.
