# Contrato: enlaces públicos por ciclo (spec 027)

Amplía [`api-enlaces-docentes.md`](../../026-enlaces-docentes/contracts/api-enlaces-docentes.md) (misma credencial, mismos errores y
mismas cabeceras).

## Administración (Bearer de staff, permiso `reportes.gestionar`, global)

| Ruta | Efecto | Límite |
|---|---|---|
| `GET /api/v1/events/:eventId/advisory/cycle-links` | Lista los ciclos del padrón con su enlace | 120/min por cuenta |
| `POST /api/v1/events/:eventId/advisory/cycle-links` | Crea los enlaces que faltan | 60 cada 15 min por cuenta |
| `DELETE /api/v1/events/:eventId/advisory/cycle-links/:ciclo` | Desactiva el enlace de un ciclo | 60 cada 15 min por cuenta |

Las respuestas llevan `Cache-Control: no-store`. Las cuentas con alcance por evento (Tesorero, Comisión) reciben `403` en las tres.

### `GET …/advisory/cycle-links`

```json
{
  "success": true,
  "data": [
    { "ciclo": "I", "alumnos": 39, "token": "vuJSYpaVPu-9xe9-ivvBZtFKcFYlY-Y2OOWnnB-V5uY", "creadoEn": "2026-10-22T10:00:00.000Z", "ultimoAcceso": null },
    { "ciclo": "II", "alumnos": 41, "token": null, "creadoEn": null, "ultimoAcceso": null }
  ]
}
```

En orden académico (I, II… X). `alumnos` es la cantidad de estudiantes del ciclo en el padrón; un enlace cuyo ciclo ya no está en el
padrón aparece con `alumnos: 0`. `token` es `null` si el ciclo no tiene enlace. El enlace lo arma el panel:
`<origen del panel>/seguimiento/ciclo#<token>`.

### `POST …/advisory/cycle-links`

Cuerpo opcional: `{ "ciclos": ["II", "III"], "regenerar": false }`. Sin `ciclos` actúa sobre todos los del padrón. Sin `regenerar` solo
crea los que no tienen enlace; con `regenerar: true` renueva también los existentes (**el token anterior deja de valer**). Los ciclos se
comparan sin distinguir mayúsculas y se guardan como vienen en el padrón. Responde `201` con la lista completa.

Errores: `404 CYCLE_NOT_FOUND` (algún ciclo no está en el padrón) y `422 VALIDATION_ERROR` (`ciclos` vacío, no es lista, un ciclo vacío o de más de 10 caracteres, o más de 30).

### `DELETE …/advisory/cycle-links/:ciclo`

Borra el enlace del ciclo y responde `200` con la lista completa. Desactivar un ciclo que ya no tiene enlace es válido (idempotente).
`404 CYCLE_NOT_FOUND` si el ciclo no está en el padrón ni tiene enlace; `422 VALIDATION_ERROR` si el ciclo está vacío o tiene más de 10 caracteres.

## Públicas (sin sesión)

El token va en `X-Link-Token` (nunca en la URL ni en el cuerpo). Todas las respuestas llevan `Cache-Control: no-store` y
`X-Robots-Tag: noindex, nofollow`. Límite por IP: 40/min la vista y 10/min las descargas (los mismos que los del docente). Un token
faltante, mal formado, desconocido, desactivado o **de un docente** responde `404 LINK_NOT_FOUND`.

### `GET /api/v1/public/cycle`

```json
{
  "success": true,
  "data": {
    "ciclo": "I",
    "evento": { "nombre": "VIII Congreso Internacional …", "nombreCorto": "VIII CIISIC 2026" },
    "semestre": "2026-2",
    "generadoEn": "2026-10-22T15:44:00.000Z",
    "totales": { "alumnos": 78, "pagaron": 41, "enRevision": 2, "rechazados": 0, "sinInscripcion": 35, "noPagaron": 37, "avance": 0.5256 },
    "secciones": [
      { "ciclo": "I", "seccion": "A", "turnos": ["M"], "asesores": ["DRA. ANGOMA ASTUCURI MIRIAM"], "alumnos": 39, "pagaron": 23, "enRevision": 1, "rechazados": 0, "sinInscripcion": 15, "noPagaron": 16, "avance": 0.5897 }
    ],
    "alumnos": [
      { "nombre": "ALBITES REYNALDO GERALDINE ALEXANDRA", "codigo": "2621010003", "ciclo": "I", "seccion": "A", "turno": "M", "situacion": "PAGADO" }
    ]
  }
}
```

Todos los estudiantes del ciclo, ordenados por sección y nombre. `situacion`: `PAGADO`, `EN_REVISION`, `RECHAZADO` o `SIN_INSCRIPCION`.
**No salen** DNI, correo, **celular**, montos, `recaudado`, fechas de pago, `inscripcionId`, `coincidencia` ni estudiantes de otros ciclos.
Cada sección lleva el nombre de sus asesores (puede ser una lista vacía si la sección no tiene asesor).

### `GET /api/v1/public/cycle/export?formato=xlsx|pdf`

El mismo reporte de la spec 025 para ese ciclo, **sin** DNI, correo, celular ni columnas de dinero y **con** la columna de asesores. El archivo se
llama «Seguimiento ciclo I». `422 VALIDATION_ERROR` si `formato` no es `xlsx` ni `pdf`.

## Recarga del padrón

`POST …/advisory/import` no toca `enlaces_ciclo`: los enlaces de los ciclos siguen valiendo tras recargar el padrón.
