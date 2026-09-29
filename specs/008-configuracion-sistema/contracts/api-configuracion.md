# Contrato — Configuración del sistema

## Administración (JWT de SuperAdmin)

`Configuracion`:

```json
{
  "undcApi": { "url": "https://api-jp.episundc.pe", "apiKeyEnmascarada": "••••9f3a", "timeoutMs": 8000,
               "configurada": true, "ultimoEstado": "OK", "ultimoError": null, "ultimaPruebaEn": "…" },
  "google": { "clientId": "1234567890-abc.apps.googleusercontent.com", "configurado": true },
  "urlPanel": "https://admin-ciisic.episundc.pe",
  "rutasLegacy": { "activas": true },
  "actualizadoPor": { "id": 1, "nombres": "…", "apellidos": "…" },
  "actualizadoEn": "…"
}
```

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/v1/settings` | | `Configuracion` (`Cache-Control: no-store`) |
| PUT | `/api/v1/settings` | Parcial: `undcApiUrl?: string\|null`, `undcApiKey?: string\|null` (solo escritura; omitir = conservar, `null` = quitar), `undcApiTimeoutMs?: 1000–30000`, `googleClientId?: string\|null`, `urlPanel?: string\|null` (se guarda el origen), `rutasLegacyActivas?: boolean` | `Configuracion` |
| POST | `/api/v1/settings/undc-api/test` | | `{ ok, mensaje, codigoHttp, latenciaMs, configuracion }` |

Errores: `422 VALIDATION_ERROR` (`fields`), `422 INVALID_URL`, `422 HOST_NOT_ALLOWED`,
`409 UNDC_API_NOT_CONFIGURED`, `401/403`.

## Configuración pública (nada secreto)

| Método | Ruta | Acceso | Respuesta |
|---|---|---|---|
| GET | `/api/v1/auth/config` | sin sesión (panel) | `{ google: { clientId }, urlPanel }` |
| GET | `/api/v1/site/config` | token de acceso del evento (landing) | igual |
