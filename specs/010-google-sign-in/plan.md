# Implementation Plan: Acceso con Google

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-google.md](contracts/api-google.md)

| Archivo | Rol |
|---|---|
| `prisma/migrations/20260930120100_acceso_google` | `google_sub` y `google_vinculado_en` en administradores y participantes; `es_correo_verificado` y `verificacion_correo` en inscripciones |
| `src/core/sesiones.ts` | Firma de sesiones con `iss`/`aud`/`sub` |
| `src/core/correo-institucional.ts` | `tipoCuentaUndc` (reglas fijas) |
| `src/middlewares/auth.ts` | `requireRoles` (audiencia admin), `requireParticipante`, `requireSesion` |
| `src/api/google-auth/services/google-verifier.ts` | `OAuth2Client` único, `verificarIdTokenGoogle`, `googleEsAutoritativo` |
| `src/api/google-auth/services/google-auth.ts` | Login (admin → participante) con vínculo por `sub`; verificación de correo para la landing |
| `src/api/google-auth/services/verificacion-correo.ts` | Token firmado (24 h) atado a evento y correo |
| `src/api/inscription/*` | `verificacionCorreoToken`, evidencia en detalle, lista y CSV |
| `src/api/admin/*`, `src/api/participant/*` | `googleVinculado` y `desvincularGoogle` |

Dependencia nueva: `google-auth-library`.

## Configuración en Google Cloud (una vez)

1. Pantalla de consentimiento OAuth: *External*, estado *In production*, scopes `openid email profile`.
2. Credencial "ID de cliente de OAuth" tipo **Aplicación web** con **orígenes JavaScript
   autorizados**: el panel, cada landing y (desarrollo) `http://localhost`, `http://localhost:3000`
   y `http://localhost:3001`. No hace falta URI de redirección ni secreto.
3. Pegar el client ID en el panel → Sistema.

## Pruebas

`tests/google-auth/google.test.ts` (`google-auth-library` simulado): sin configurar, token
inválido vs Google caído, nonce, correo no verificado, cuenta no autoritativa, admin con
Gmail, `sub` distinto, admin desactivado que también es inscrito, no registrado, validación y
verificación de la landing atada a evento y correo. `tests/inscription/create.test.ts`
(evidencia solo con token coincidente, vínculo limpiado al cambiar el correo).
