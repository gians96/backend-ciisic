# Implementation Plan: Credenciales de correo en BD

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-credenciales-correo.md](contracts/api-credenciales-correo.md)

## Archivos

| Archivo | Rol |
|---|---|
| `prisma/migrations/20260929120500_credenciales_correo` | Tabla `credenciales_correo` y `eventos.credencial_correo_id` |
| `src/api/email-credential/services/brevo-client.ts` | `enviarConBrevo` (`POST /v3/smtp/email`) y `cuentaBrevo` (`GET /v3/account`) |
| `src/api/email-credential/services/email-credential.ts` | CRUD, predeterminada, prueba, envío de prueba, `credencialParaEvento`, `enviarConCredencial` |
| `src/api/email-credential/routes/email-credential.ts` | Rutas SuperAdmin |
| `src/api/inscription/utils/sendEmail.ts` | Correo de aprobación con la credencial resuelta |
| `src/api/event/*` | `credencialCorreoId` en crear/actualizar/detalle del evento |
| `src/database/importarSecretosLegados.ts` | Importación única desde el entorno (la llama `server.ts`) |

## Remitente y asunto

- Remitente: `evento.remitente_nombre` → `credencial.remitente_nombre` → `evento.nombre_corto`,
  con el correo `credencial.remitente_correo` (debe estar verificado en Brevo).
- Asunto: `evento.asunto_aprobacion` → "Tu inscripción ha sido aprobada".

## Variables de entorno

| Variable | Estado |
|---|---|
| `BREVO_API_KEY`, `BREVO_SENDER`, `BREVO_SENDER_NAME` | Solo para la importación inicial; luego se eliminan |
| `BREVO_SENDER_SUBJECT` | Se elimina (asunto por evento) |
| `BREVO_API_URL` | Opcional (default `https://api.brevo.com/v3`) |
| `EMAIL_TIMEOUT_MS` | Opcional (default 15000) |

## Pruebas

`tests/email/credenciales.test.ts` (cifrado y máscara, predeterminada, prueba de cuenta,
errores legibles, resolución por evento, correo de aprobación con adjunto) y
`tests/database/importar-secretos.test.ts` (importa solo con tablas vacías, avisos).
