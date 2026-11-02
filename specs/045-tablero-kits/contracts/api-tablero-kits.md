# Contrato — Tablero de kits (spec 045)

Respuestas `{ success, data, meta? }`; errores `{ success: false, code, message, fields?, data? }`. Todo es **aditivo**: un cliente que no lee lo nuevo sigue funcionando. Un backend anterior a esta spec **ignora `?kit=` sin avisar**
(el listado saldría sin filtrar): el consumidor lo detecta porque las filas no traen `kit`.

Qué corresponde a cada persona (`kit.incluye`, `KitEstado` de la spec 037): una inscripción **`APROBADO`** con un tipo que **incluye kit y es presencial**. Es la misma regla de `GET …/kits/summary`.

## Filtro `?kit=` — `GET /v1/events/:eventId/inscriptions` y `GET /v1/events/:eventId/inscriptions/export`

Permisos de siempre (`inscripciones.ver` / `inscripciones.exportar`, por evento). Valor en mayúsculas o minúsculas; vacío = sin filtro. Se combina con `estado`, `categoria`, `modalidad`, `tipoInscripcionId`, `esEstudianteUndc` y `q`.

| `kit` | Devuelve |
|---|---|
| `CON_KIT` | el tipo entrega kit (presencial con `incluyeKit`), en cualquier estado |
| `SIN_KIT` | el tipo no lo entrega: sin kit, virtual o cortesía sin tipo |
| `PENDIENTE` | aprobada, con kit y **sin entregar** (lo que falta entregar) |
| `ENTREGADO` | el kit ya se entregó, sea cual sea el estado o el tipo de hoy |
| `POR_APROBAR` | con kit, sin entregar y con el pago aún `PENDIENTE` o `EN_REVISION` |
| `REVISAR` | ya se entregó pero hoy no corresponde: la inscripción no está aprobada o su tipo ya no entrega kit |

Con `ENTREGADO` o `REVISAR` el listado va de la **entrega más reciente a la más antigua**; con los demás, por fecha de registro (como siempre). Un valor desconocido (o repetido) responde
`422 VALIDATION_ERROR` con `fields.kit` y **no** consulta (también en el CSV).

## Filas del listado

Cada fila de `GET …/inscriptions` agrega `kit` y conserva `tipoInscripcion.incluyeKit` y `kitEntregado`:

```json
{ "id": 641, "kitEntregado": true,
  "kit": { "incluye": true, "entregado": true, "entregadoEn": "2026-10-27T15:32:00.000Z", "entregadoPor": { "id": 41, "nombres": "Rosa", "apellidos": "Quispe" } } }
```

`entregadoPor` es `null` también si se borró la cuenta. Sale también sin «pagos.ver» (no es un dato de pago).

## CSV

Tres columnas **al final** (después de `Código QR` y `Credencial 3D`), también sin «pagos.ver»:

| Columna | Valores |
|---|---|
| `Kit` | `Entregado` · `Pendiente de entrega` · `Pago por aprobar` · `No incluye` · `No corresponde` (con kit pero rechazada o cancelada) |
| `Kit entregado el` | `2026-10-27 10:32` (hora de Lima) o vacío |
| `Kit entregado por` | `Rosa Quispe` o vacío |

`GET …/inscriptions/export?kit=PENDIENTE` baja la lista de quién falta.

## Tablero — `GET /v1/events/:eventId/kits/dashboard`

Permiso `asistencia.ver` (por evento: una cuenta de otro evento recibe `403 EVENT_NOT_ASSIGNED`). Sin límite propio (como `summary`). Solo cifras y nombres de quienes entregan: **ningún dato de los inscritos**.

```json
{ "success": true, "data": {
  "totales": { "conKit": 120, "entregados": 85, "pendientes": 35, "porAprobar": 6, "aRevisar": 1 },
  "porTipo": [
    { "tipoInscripcionId": 5, "nombre": "ESTUDIANTES", "etiqueta": "CON KIT", "categoria": { "codigo": "ESTUDIANTES", "nombre": "ESTUDIANTES" }, "delegacionId": null,
      "conKit": 80, "entregados": 55, "pendientes": 25, "porAprobar": 6, "aRevisar": 1 }
  ],
  "entregas": [ { "fecha": "2026-10-27", "hora": 9, "total": 12 } ],
  "porPersona": [ { "id": 41, "nombres": "Rosa", "apellidos": "Quispe", "total": 52, "ultimaEn": "2026-10-29T15:32:00.000Z" } ]
} }
```

- `conKit`, `entregados` y `pendientes` son **los mismos** de `GET …/kits/summary` (`pendientes = max(0, conKit − entregados)`).
- `porAprobar`: con kit, sin entregar y con el pago aún `PENDIENTE` o `EN_REVISION` (lo que viene).
- `aRevisar`: kits ya entregados que hoy no corresponden (la inscripción se canceló o rechazó, o su tipo ya no entrega kit; una cortesía sin tipo cae aquí).
- `porTipo`: solo los tipos con alguna cifra (`conKit`, `porAprobar` o `aRevisar` mayor que 0), en el orden de la categoría y del tipo; la cortesía sin tipo va al final como `tipoInscripcionId: null`, `nombre: "Sin tipo (cortesía)"`.
  Los planes de una delegación llevan su `delegacionId` (la categoría de la delegación): así se agrupan por delegación.
- `entregas`: una fila por día (`YYYY-MM-DD`) y hora (0–23) **de Lima** con alguna entrega, de la más antigua a la más reciente.
- `porPersona`: quien más entregó primero; `id`, `nombres` y `apellidos` en `null` si la cuenta ya no existe.

Errores: `401`, `403 FORBIDDEN` / `403 EVENT_NOT_ASSIGNED`, `400 INVALID_ID`, `404 EVENT_NOT_FOUND`.
