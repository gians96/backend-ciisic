# Contrato — Credenciales de correo (API administrativa, solo SuperAdmin)

Respuestas `{ "success": true, "data": … }`; errores `{ "success": false, "code", "message", "fields"? }`.

`CredencialCorreo`:

```json
{
  "id": 1,
  "proveedor": "BREVO",
  "nombre": "Brevo (importado del entorno)",
  "apiKeyEnmascarada": "••••2kDa",
  "remitenteCorreo": "congreso@undc.edu.pe",
  "remitenteNombre": "Inscripción al congreso",
  "esPredeterminada": true,
  "activo": true,
  "ultimoEstado": "OK",
  "ultimoError": null,
  "ultimaPruebaEn": "2026-09-29T18:00:00.000Z",
  "ultimoEnvioEn": null,
  "eventos": [{ "id": 2, "codigo": "ciisic-viii-2026", "nombreCorto": "VIII CIISIC 2026" }],
  "creadoEn": "…",
  "actualizadoEn": "…"
}
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/v1/email-credentials` | | `CredencialCorreo[]` (predeterminada primero) |
| POST | `/api/v1/email-credentials` | `{ nombre, apiKey, remitenteCorreo, remitenteNombre?, esPredeterminada?, activo? }` | `201 CredencialCorreo` (la primera queda predeterminada) |
| PUT | `/api/v1/email-credentials/:id` | Parcial; `apiKey` la reemplaza; `esPredeterminada: true` mueve la marca | `CredencialCorreo` |
| DELETE | `/api/v1/email-credentials/:id` | | `null` (si era la predeterminada, se promueve otra) |
| POST | `/api/v1/email-credentials/:id/test` | | `{ ok, cuenta?: { correo, empresa, planes: [{ tipo, creditos, tipoCreditos }] }, error?, credencial }` |
| POST | `/api/v1/email-credentials/:id/send-test` | `{ correo }` | `{ ok, error?, credencial }` |

Errores: `404 EMAIL_CREDENTIAL_NOT_FOUND`, `422 DEFAULT_CREDENTIAL_REQUIRED` (quitar la marca a la
predeterminada), `422 VALIDATION_ERROR`, `401/403` sin sesión o sin rol SuperAdmin.

Eventos (`/api/v1/events`, `/api/v1/events/:id`): aceptan `credencialCorreoId: number | null` y
devuelven `credencialCorreoId` y `credencialCorreo: { id, nombre, remitenteCorreo } | null`;
`422 EMAIL_CREDENTIAL_NOT_FOUND` si el id no existe.
