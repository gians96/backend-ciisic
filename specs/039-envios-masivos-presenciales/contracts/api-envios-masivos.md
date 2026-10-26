# Contrato: envíos masivos a los inscritos presenciales (API del panel)

Rutas de `/api/v1/events/:eventId/…` con sesión de staff (`Authorization: Bearer`). Los destinatarios son las inscripciones **APROBADAS** del evento con tipo
presencial o sin tipo. Cada canal lleva su marca de envío por inscripción.

| Canal | Ver (lista e ids) | Enviar |
|---|---|---|
| Credencial 3D — `credential-links` | `inscripciones.ver` | `credenciales.reenviar` |
| Ponencias — `specialized-talk-invitations` | `especializadas.ver` | `especializadas.inscribir` (también `…/test`) |

## Listar

`GET …/credential-links` · `GET …/specialized-talk-invitations` — `?q=<palabras>&enviado=si|no&page=1&pageSize=20` (máx. 100). Respuesta `no-store`:

```json
{
  "success": true,
  "data": [
    { "id": 5, "nombres": "Ana", "apellidos": "Pérez", "tipoDocumento": "dni", "numeroDocumento": "12345678", "correo": "ana@example.com",
      "tipo": { "nombre": "CON KIT", "etiqueta": "CON KIT" }, "clasificacion": null, "enviadoEn": "2026-10-26T15:00:00.000Z" }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "resumen": { "total": 40, "enviados": 15, "pendientes": 25 } }
}
```

`resumen` cuenta todo el evento (no los filtros). `enviadoEn` es la marca del canal (`null` = aún no). Filtro inválido → `400 INVALID_FILTER`.

`GET …/ids` (mismos filtros) → `{ "success": true, "data": [3, 8], "meta": { "total": 2 } }` (hasta 5000 ids, en el mismo orden de la lista).

## Enviar

`POST …/credential-links/send` — `{ "ids": [1, 2], "reenviar": false }`

`POST …/specialized-talk-invitations/send` — `{ "ids": [1, 2], "asunto": "…", "mensaje": "…", "reenviar": false }` (`asunto` 3–150, `mensaje` 10–3000)

- `ids`: 1 a 100, sin repetir. Sin `reenviar`, a quien ya tiene la marca se le omite.
- Respuesta `200`: `{ "success": true, "data": { "enviados": 1, "yaEnviados": 1, "noElegibles": 0, "fallidos": 0 } }`.
  - `noElegibles`: no existe, es de otro evento, no está aprobada o no es presencial.
  - `fallidos`: el correo no salió; su marca queda como estaba.
- Errores: `409 LANDING_URL_MISSING`, `409 EMAIL_CREDENTIAL_UNAVAILABLE`, `422 VALIDATION_ERROR`, `403`/`401`, `429 RATE_LIMITED`.

## Probar el mensaje de ponencias

`POST …/specialized-talk-invitations/test` — `{ "correo": "yo@example.com", "asunto": "…", "mensaje": "…" }` → `{ "success": true, "data": { "enviado": true } }`.
Asunto `[Prueba] …`; no marca a nadie. `502 EMAIL_SEND_FAILED` si el proveedor falla.
