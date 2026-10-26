# Contrato: credencial 3D por código (API del sitio)

Rutas de `/api/v1/site/*`: llevan el token del evento en `X-Api-Key` (spec 007) y la landing las pide desde su servidor (BFF
`/api/publico/credencial/:codigo`). El evento sale del token.

## `GET /api/v1/site/credential/:codigo`

`codigo`: 10 caracteres `[0-9A-Z]` (el `codigo_credencial` impreso en el QR). Respuesta `200`, siempre `Cache-Control: no-store`:

```json
{
  "success": true,
  "data": {
    "nombres": "Ana María",
    "apellidos": "Pérez López",
    "codigo": "K7Q2M9X4TB",
    "clasificacion": null,
    "tipo": { "nombre": "General", "etiqueta": "CON KIT" },
    "tecnologias": ["vue", "vite"],
    "evento": { "nombre": "VIII Congreso …", "nombreCorto": "VIII CIISIC 2026" }
  }
}
```

- `clasificacion` y `tipo` pueden ser `null` (cortesías). La landing muestra la clasificación, o el tipo, o «Asistente».
- `tecnologias`: ids en el orden elegido (`[]` si no eligió).
- **Nunca** documento, correo, celular, montos ni número de operación.

| Estado | `code` | Cuándo |
|---|---|---|
| 401 | `EVENT_TOKEN_REQUIRED` / `INVALID_EVENT_TOKEN` | falta o no vale el token del evento |
| 404 | `CREDENTIAL_NOT_FOUND` | no existe, es de otro evento o no está `APROBADO` (mismo error para los tres) |
| 422 | `INVALID_CODE` | el código no tiene el formato (no se consulta la BD) |
| 429 | `RATE_LIMITED` | límites por visitante o por token |

## `POST /api/v1/site/credential/:codigo/technologies`

Cuerpo: `{ "tecnologias": ["nuxt", "vue", "node-js"] }`. Reemplaza la lista completa.

- Hasta **8** ids, sin repetir; cada uno `^[a-z0-9][a-z0-9-]{0,29}$`. `[]` las borra.
- Respuesta `200`: `{ "success": true, "data": { "tecnologias": ["nuxt", "vue", "node-js"] } }`, `Cache-Control: no-store`.
- Errores: `404 CREDENTIAL_NOT_FOUND`, `422 INVALID_CODE`, `422 VALIDATION_ERROR` (con `fields.tecnologias`), `401`, `429`.

## Correo de aprobación

`<landing>/credencial/<codigo>` aparece como botón «Ver mi credencial 3D» en el correo de aprobación, que conserva el PDF adjunto. La URL de la
landing es `configuracion_sistema.url_landing` (Sistema); sin ella el botón no sale.
