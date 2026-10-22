# Contrato: enlaces públicos por docente (spec 026)

Amplía [`api-seguimiento-asesores.md`](../../025-reportes-asesores/contracts/api-seguimiento-asesores.md).

## Administración (Bearer de staff, permiso `reportes.gestionar`, global)

| Ruta | Efecto | Límite |
|---|---|---|
| `GET /api/v1/events/:eventId/advisory/links` | Lista los asesores con su enlace | 120/min por cuenta |
| `POST /api/v1/events/:eventId/advisory/links` | Crea los enlaces que faltan | 60 cada 15 min por cuenta |
| `DELETE /api/v1/events/:eventId/advisory/links/:asesorId` | Desactiva el enlace de un asesor | 60 cada 15 min por cuenta |

Las respuestas llevan `Cache-Control: no-store` (el token es una credencial). Las cuentas con alcance por evento
(Tesorero, Comisión) reciben `403` en las tres.

### `GET …/advisory/links`

```json
{
  "success": true,
  "data": [
    { "asesorId": 7, "nombre": "DRA. ANGOMA ASTUCURI MIRIAM", "token": "vuJSYpaVPu-9xe9-ivvBZtFKcFYlY-Y2OOWnnB-V5uY", "creadoEn": "2026-10-22T10:00:00.000Z", "ultimoAcceso": null },
    { "asesorId": 8, "nombre": "MG. CÁRDENAS LINO CÉSAR ANDY", "token": null, "creadoEn": null, "ultimoAcceso": null }
  ]
}
```

`token` es `null` si el asesor no tiene enlace; `ultimoAcceso` es la última vez que el docente abrió el suyo (se anota como
máximo cada 5 minutos). El enlace que se entrega al docente lo arma el panel: `<origen del panel>/seguimiento#<token>`.

### `POST …/advisory/links`

Cuerpo opcional: `{ "asesorIds": [7, 8], "regenerar": false }`. Sin `asesorIds` actúa sobre todos los asesores del evento. Sin
`regenerar` solo crea los que no tienen enlace; con `regenerar: true` renueva también los existentes (**el token anterior deja de
valer**). Responde `201` con la lista completa (misma forma que el `GET`).

Errores: `404 ADVISOR_NOT_FOUND` (algún id no pertenece al evento) y `422 VALIDATION_ERROR` (`asesorIds` vacío, no entero o más de 200).

### `DELETE …/advisory/links/:asesorId`

Pone `token`, `creadoEn` y `ultimoAcceso` en `null`. Responde `200` con la lista completa. `404 ADVISOR_NOT_FOUND` si el asesor no es del evento.

## Públicas (sin sesión)

El token va en el encabezado `X-Link-Token` (nunca en la URL ni en el cuerpo). Todas las respuestas llevan
`Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`. Límite por IP: 40/min la vista y 10/min las descargas.

Un token faltante, mal formado (no son 43 caracteres `[A-Za-z0-9_-]`), desconocido o desactivado responde siempre:

```json
{ "success": false, "code": "LINK_NOT_FOUND", "message": "El enlace no es válido o fue desactivado." }
```

con estado `404`.

### `GET /api/v1/public/advisor`

```json
{
  "success": true,
  "data": {
    "asesor": { "nombre": "DRA. ANGOMA ASTUCURI MIRIAM" },
    "evento": { "nombre": "VIII Congreso Internacional …", "nombreCorto": "VIII CIISIC 2026" },
    "semestre": "2026-2",
    "generadoEn": "2026-10-22T15:44:00.000Z",
    "totales": { "alumnos": 39, "pagaron": 23, "enRevision": 1, "rechazados": 0, "sinInscripcion": 15, "noPagaron": 16, "avance": 0.5897 },
    "secciones": [{ "ciclo": "I", "seccion": "A", "turnos": ["M"], "alumnos": 39, "pagaron": 23, "enRevision": 1, "rechazados": 0, "sinInscripcion": 15, "noPagaron": 16, "avance": 0.5897 }],
    "alumnos": [
      { "nombre": "ALBITES REYNALDO GERALDINE ALEXANDRA", "codigo": "2621010003", "ciclo": "I", "seccion": "A", "turno": "M", "celular": "920301747", "situacion": "PAGADO" }
    ]
  }
}
```

Solo los estudiantes de ese asesor (todas sus secciones). `situacion`: `PAGADO`, `EN_REVISION`, `RECHAZADO` o `SIN_INSCRIPCION` (igual que en la
spec 025). **No salen** DNI, correo, montos, `recaudado`, fechas de pago, `inscripcionId`, `coincidencia` ni otros asesores.

### `GET /api/v1/public/advisor/export?formato=xlsx|pdf`

El mismo reporte de la spec 025 para ese asesor, **sin** DNI, correo, asesores ni columnas de dinero. El archivo se llama como el
docente. `422 VALIDATION_ERROR` si `formato` no es `xlsx` ni `pdf`.

## Recarga del padrón

`POST …/advisory/import` reemplaza el padrón y los asesores del evento, pero los asesores que ya tenían enlace lo conservan
(`enlace_token`, `enlace_creado_en`, `enlace_ultimo_acceso`), emparejados por nombre sin distinguir acentos ni mayúsculas.
