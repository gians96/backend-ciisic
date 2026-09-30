# Contrato — Acceso con Google

## POST `/api/v1/auth/google` (panel)

Cuerpo `{ idToken, nonce }` (el `nonce` lo emite el servidor del panel y viaja en el ID token).

```json
{ "success": true, "data": { "jwt": "…", "tipo": "ADMIN", "usuario": { "id": 4, "nombres": "…", "apellidos": "…", "correo": "…", "rolId": 1, "rolCodigo": "SUPERADMIN", "rolNombre": "SuperAdmin" }, "expiraEn": "2026-09-30T18:00:00.000Z" } }
{ "success": true, "data": { "jwt": "…", "tipo": "PARTICIPANTE", "participante": { "id": 50, "nombres": "…", "apellidos": "…", "correo": "…" }, "expiraEn": "…" } }
```

Errores: `503 GOOGLE_NOT_CONFIGURED`, `503 GOOGLE_UNAVAILABLE`, `401 INVALID_GOOGLE_TOKEN`,
`403 GOOGLE_EMAIL_NOT_VERIFIED`, `403 GOOGLE_NOT_AUTHORITATIVE`, `403 GOOGLE_ACCOUNT_MISMATCH`,
`409 GOOGLE_ACCOUNT_IN_USE`, `403 ACCOUNT_DISABLED`, `403 GOOGLE_ACCOUNT_NOT_REGISTERED`,
`422 VALIDATION_ERROR`, `429 RATE_LIMITED`.

## POST `/api/v1/site/google-verification` (landing, token del evento)

Cuerpo `{ idToken }` →
`{ correo, nombres, apellidos, tipoCuenta: "ESTUDIANTE"|"PERSONAL"|"EXTERNO", esInstitucional, verificacionCorreoToken }`.
La inscripción (`POST /api/v1/site/inscriptions`) acepta `verificacionCorreoToken` (24 h, mismo
evento y correo) y responde `esCorreoVerificado`.

## Sesión

- `POST /api/v1/auth/login` (contraseña) responde además `tipo: "ADMIN"`.
- `GET /api/v1/auth/session` → `{ tipo: "ADMIN", user }` o `{ tipo: "PARTICIPANTE", participante }`.
- JWT HS256 con `iss: backend-ciisic` y `aud` `ciisic-admin` o `ciisic-participante`. Un token de
  un perfil en rutas del otro → `403 FORBIDDEN`.

## Administración

- `PUT /api/v1/admin/:id` y `PUT /api/v1/participants/:id` aceptan `desvincularGoogle: true`;
  las respuestas incluyen `googleVinculado` y `googleVinculadoEn`.
- Administradores solo con Google:
  - `POST /api/v1/admin`: `contrasena` es opcional (mínimo 12 caracteres si se envía); sin ella
    la cuenta entra solo con Google.
  - `PUT /api/v1/admin/:id` acepta `quitarContrasena: true` (junto con `contrasena` → `422`).
    Quitarse la propia sin Google vinculado → `409 SELF_UPDATE_FORBIDDEN`.
  - Las respuestas incluyen `tieneContrasena`.
  - `POST /api/v1/auth/login` con una cuenta sin contraseña → `401 INVALID_CREDENTIALS`, igual
    que unas credenciales incorrectas (no revela si el correo existe).
- Inscripciones: `verificacion.correo = { verificado, detalle: { metodo, tipoCuenta, hd, verificadoEn } | null }`,
  filas con `esCorreoVerificado`, columna "Correo verificado" en el CSV.
