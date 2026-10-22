# Contrato: docentes, DNI y consulta con el DNI (spec 028)

Amplía [`api-seguimiento-asesores.md`](../../025-reportes-asesores/contracts/api-seguimiento-asesores.md) y
[`api-enlaces-docentes.md`](../../026-enlaces-docentes/contracts/api-enlaces-docentes.md).

## Administración (Bearer de staff, permiso `reportes.gestionar`, global)

| Ruta | Efecto | Límite |
|---|---|---|
| `GET /api/v1/events/:eventId/advisory/advisors` | Lista los docentes y las secciones del padrón | 120/min por cuenta |
| `POST /api/v1/events/:eventId/advisory/advisors` | Agrega un docente | 120 cada 15 min por cuenta |
| `PUT /api/v1/events/:eventId/advisory/advisors/:asesorId` | Cambia nombre, DNI y secciones | 120 cada 15 min por cuenta |
| `DELETE /api/v1/events/:eventId/advisory/advisors/:asesorId` | Elimina al docente | 120 cada 15 min por cuenta |

Las respuestas llevan `Cache-Control: no-store` (el DNI es un dato personal). Las cuentas con alcance por evento (Tesorero, Comisión) reciben `403` en las cuatro.

### `GET …/advisory/advisors`

```json
{
  "success": true,
  "data": {
    "asesores": [
      { "id": 7, "nombre": "DRA. ANGOMA ASTUCURI MIRIAM", "documento": "12345678", "secciones": [{ "ciclo": "I", "seccion": "A" }, { "ciclo": "II", "seccion": "A" }] },
      { "id": 8, "nombre": "MG. CÁRDENAS LINO CÉSAR ANDY", "documento": null, "secciones": [{ "ciclo": "II", "seccion": "B" }] }
    ],
    "secciones": [{ "ciclo": "I", "seccion": "A" }, { "ciclo": "II", "seccion": "A" }, { "ciclo": "II", "seccion": "B" }]
  }
}
```

Los docentes van por nombre; sus secciones y `secciones` (las del padrón cargado, lo que se puede asignar), en orden académico. `documento` es `null` si no se registró.

### `POST …/advisory/advisors` y `PUT …/advisors/:asesorId`

Cuerpo: `{ "nombre": "DR. JUAN PÉREZ", "documento": "02442123", "secciones": [{ "ciclo": "I", "seccion": "A" }] }`.

- `nombre`: 3 a 200 caracteres. `documento`: opcional (`null` o `""` = sin DNI); 8 dígitos, o 7 (se completa el cero inicial). `secciones`: lista (hasta 100; vacía = ninguna); ciclo y sección se comparan sin distinguir mayúsculas y se guardan como el padrón.
- `POST` responde `201` con el docente (`{ id, nombre, documento, secciones }`). `PUT` **reemplaza** nombre, DNI y la lista de secciones y responde `200` con el docente; no cambia su enlace personal.
- Errores: `422 VALIDATION_ERROR` (DNI que no tiene 7 u 8 dígitos, nombre corto, secciones mal formadas), `422 SECTION_NOT_FOUND` (la sección no está en el padrón y no es ya del docente),
  `404 ADVISOR_NOT_FOUND` (el docente no es del evento; solo `PUT`/`DELETE`), `409 ADVISOR_NAME_TAKEN` y `409 ADVISOR_DOCUMENT_TAKEN` (nombre o DNI ya usados en el evento).

### `DELETE …/advisory/advisors/:asesorId`

Elimina al docente, sus secciones y su enlace; sus estudiantes quedan sin asesor en esas secciones. Responde `200` con `data: null`. `404 ADVISOR_NOT_FOUND` si no es del evento.

## Públicas (sin sesión)

El DNI va en el **cuerpo** del `POST` (nunca en la URL). Todas las respuestas llevan `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`.
Límites por IP: **10 intentos fallidos cada 15 min** (los aciertos no cuentan) y, además, 40/min la vista y 10/min las descargas.

DNI ausente, que no es texto ni número, mal formado (no son 7 u 8 dígitos) o que no es de ningún docente responde siempre:

```json
{ "success": false, "code": "ADVISOR_DOCUMENT_NOT_FOUND", "message": "No encontramos un docente con ese DNI." }
```

con estado `404`.

### `POST /api/v1/public/advisor/lookup`

Cuerpo `{ "documento": "12345678" }`. Responde **lo mismo** que `GET /api/v1/public/advisor` (spec 026): `{ asesor: { nombre }, evento, semestre, generadoEn, totales, secciones, alumnos }`, solo con los estudiantes de ese docente y
solo nombre, código, ciclo, sección, turno, celular y situación. **No sale** el DNI del docente, ni DNI, correo, montos, `recaudado`, fechas de pago, `inscripcionId`, `coincidencia` ni otros asesores.
Si el DNI está en varios eventos se usa el más reciente.

### `POST /api/v1/public/advisor/lookup/export`

Cuerpo `{ "documento": "12345678", "formato": "xlsx" | "pdf" }` (`xlsx` por defecto). El mismo reporte público de la spec 026 (sin DNI, correo, asesores ni dinero), con el nombre del docente como nombre de archivo.
`422 VALIDATION_ERROR` si `formato` no es `xlsx` ni `pdf`.

## Recarga del padrón

`POST …/advisory/import` (multipart) acepta el campo opcional `asesores`:

- `conservar` (por defecto si el evento ya tiene docentes): reemplaza solo a los **estudiantes**; los docentes, sus DNI, sus secciones y sus enlaces quedan.
- `reemplazar`: vuelve a leer los docentes y sus secciones del Excel; el enlace y el DNI se conservan por nombre (sin distinguir acentos ni mayúsculas).

Con el evento sin docentes se cargan siempre los del Excel. La respuesta añade `asesoresConservados` (`true` si se conservaron); `asesores` y `secciones` cuentan los que quedan. Un valor distinto de los dos es `422 VALIDATION_ERROR`.
La simulación (`?simular=true`) avisa, entre las advertencias, de toda sección que un docente conserva y el padrón nuevo ya no trae.
