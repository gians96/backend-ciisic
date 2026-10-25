# Contrato — Enlace público del aforo de las ponencias especializadas (spec 036)

Respuestas `{ success, data }`; errores `{ success: false, code, message }`. Todas con `Cache-Control: no-store`.

## Panel (sesión de staff) — `especializadas.enlace_aforo` (global, solo Owner)

### `GET /v1/events/:eventId/specialized-talks/occupancy-link`

```json
{ "success": true, "data": { "token": "q3J…43 caracteres…", "creadoEn": "2026-10-25T15:00:00.000Z", "ultimoAcceso": null } }
```

Sin enlace: `{ "token": null, "creadoEn": null, "ultimoAcceso": null }`. `ultimoAcceso` se actualiza como máximo cada 5 minutos.

### `POST /v1/events/:eventId/specialized-talks/occupancy-link`

Cuerpo opcional `{ "regenerar": true }`. Sin `regenerar` crea el enlace si falta (si ya existe lo devuelve igual); con `regenerar` lo renueva y el
anterior deja de valer al instante. Respuesta `201` con la misma forma que el `GET`.

### `DELETE /v1/events/:eventId/specialized-talks/occupancy-link`

Desactiva el enlace (si no había, igual responde bien). Respuesta `200` con `token: null`.

Errores: `401` sin sesión, `403 FORBIDDEN` (cualquier cuenta que no sea Owner), `404 EVENT_NOT_FOUND`, `422 VALIDATION_ERROR` (`regenerar` no booleano),
`429` (límite por cuenta: 60 cada 15 minutos).

## Sitio (token del evento) — `GET /v1/site/specialized-talk-occupancy`

Encabezados: `X-Api-Key: <token del evento>` y `X-Link-Token: <token del enlace>`. El token del enlace **nunca** va en la URL.

```json
{
  "success": true,
  "data": {
    "evento": { "nombre": "VIII Congreso Internacional …", "nombreCorto": "VIII CIISIC" },
    "generadoEn": "2026-10-27T17:05:00.000Z",
    "ponencias": [
      {
        "id": 12, "tema": "Arquitectura Big Data a gran escala…", "fecha": "2026-10-27", "horaInicio": "12:00", "horaFin": "12:45", "duracionMin": 45,
        "ambiente": "Laboratorio 6", "modalidad": "PRESENCIAL",
        "ponente": { "nombre": "Mg. Claudio Huancahuire", "foto": "/images/ponentes/2026/especializados/claudio-huancahuire.webp", "externo": false },
        "coponentes": [],
        "cupo": 20, "inscritos": 14, "cuposDisponibles": 6, "llena": false, "asistentes": 9, "orden": 0
      }
    ]
  }
}
```

- Solo las ponencias **publicadas** del evento del token, en el orden del programa (fecha, hora, `orden`, id).
- `cupo`: aforo presencial (`null` = sin límite, y entonces `cuposDisponibles` es `null` y `llena` es `false`).
- `inscritos`: inscripciones **vigentes y presenciales** (las que ocupan aforo). Las virtuales no ocupan aforo y no se cuentan aquí.
- `asistentes`: inscripciones vigentes con la asistencia marcada en puerta.
- Nunca trae datos de personas, biografías, precios ni `publicada`. Además lleva `X-Robots-Tag: noindex, nofollow`.

Errores: `401 EVENT_TOKEN_REQUIRED` / `INVALID_EVENT_TOKEN` (token del sitio), `404 LINK_NOT_FOUND` (el **mismo** para un token del enlace faltante, mal
formado, desconocido, desactivado o de otro evento), `429` (límites del sitio por visitante y por token).

## Compatibilidad

Cambio aditivo: tabla nueva, permiso nuevo y cuatro rutas nuevas. Backend primero; luego la landing (página) y el panel (tarjeta).
