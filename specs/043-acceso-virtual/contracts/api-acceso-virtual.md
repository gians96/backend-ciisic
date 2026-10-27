# Contrato: acceso al congreso para los inscritos virtuales (API del panel)

Rutas de `/api/v1/events/:eventId/virtual-access…` con sesión de staff (`Authorization: Bearer`). Los destinatarios son las inscripciones **APROBADAS** del evento con un
**tipo virtual** (una cortesía sin tipo no entra). Es el tercer canal de los envíos masivos de la spec 039: misma forma de lista, de ids y de resultado.

| Acción | Ruta | Permiso |
|---|---|---|
| Listar | `GET …/virtual-access` | `inscripciones.ver` |
| Ids de todos los destinatarios de un filtro | `GET …/virtual-access/ids` | `inscripciones.ver` |
| Enviar | `POST …/virtual-access/send` | `credenciales.reenviar` |
| Enviarse una prueba | `POST …/virtual-access/test` | `credenciales.reenviar` |

## Listar

`GET …/virtual-access?q=<palabras>&enviado=si|no&page=1&pageSize=20` (máx. 100). Respuesta `no-store`, igual que `credential-links`:

```json
{
  "success": true,
  "data": [
    { "id": 7, "nombres": "Luis", "apellidos": "Rojas", "tipoDocumento": "dni", "numeroDocumento": "87654321", "correo": "luis@example.com",
      "tipo": { "nombre": "Virtual estudiante", "etiqueta": "VIRTUAL" }, "clasificacion": null, "enviadoEn": null }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "resumen": { "total": 30, "enviados": 12, "pendientes": 18 } }
}
```

`resumen` cuenta todos los virtuales aprobados del evento (no los filtros). `enviadoEn` es la marca de este canal (`null` = aún no). Filtro inválido → `400 INVALID_FILTER`.
`GET …/ids` (mismos filtros) → `{ "success": true, "data": [3, 8], "meta": { "total": 2 } }` (hasta 5000 ids).

## Enviar

`POST …/virtual-access/send`

```json
{ "ids": [1, 2], "asunto": "Tu acceso al VIII CIISIC", "mensaje": "Hola,\n\nEntra con el botón de abajo…", "enlace": "https://meet.example.com/sala", "reenviar": false }
```

- `ids`: 1 a 100, sin repetir. `asunto` 3–150, `mensaje` 10–3000 (texto plano: se escapa; las líneas en blanco separan párrafos).
- `enlace`: obligatorio; `https://` con servidor, sin usuario ni contraseña ni espacios, hasta 500 caracteres. Otro esquema o un enlace con credenciales → `422 VALIDATION_ERROR`.
- Sin `reenviar`, a quien ya tiene la marca se le omite. Cada persona recibe su correo por separado, con el botón «Ingresar al congreso» y el enlace en texto.
- Respuesta `200`: `{ "success": true, "data": { "enviados": 1, "yaEnviados": 1, "noElegibles": 0, "fallidos": 0 } }`.
  - `noElegibles`: no existe, es de otro evento, no está aprobada o no es virtual.
  - `fallidos`: el correo no salió; su marca queda como estaba.
- Errores: `409 EMAIL_CREDENTIAL_UNAVAILABLE`, `422 VALIDATION_ERROR`, `403`/`401`, `429 RATE_LIMITED`. **No** responde `LANDING_URL_MISSING`: el enlace no sale de la landing.

## Probar

`POST …/virtual-access/test` — `{ "correo": "yo@example.com", "asunto": "…", "mensaje": "…", "enlace": "https://…" }` → `{ "success": true, "data": { "enviado": true } }`.
Asunto `[Prueba] …`; no marca a nadie. `502 EMAIL_SEND_FAILED` si el proveedor falla.
