# Contrato — Disponibilidad de los tipos de inscripción

Valores de `disponiblePara`:

| Valor | Se ofrece a |
|---|---|
| `TODOS` | Todos (por defecto; comportamiento anterior) |
| `INSTITUCIONAL` | Solo a quien recibe el precio institucional |
| `EXTERNOS` | Solo a quien **no** recibe el precio institucional |

«Recibe el precio institucional»: categoría estudiantil → `verificacionToken` de estudiante válido
para ese documento y correo; otras categorías (y la ruta legacy) → correo del `dominioInstitucional` del
evento. Es la misma condición que decide el monto.

## API del sitio (token del evento)

### GET `/api/v1/site/registration-types`

Cada tipo agrega `disponiblePara`:

```json
{ "id": 4, "codigo": "general_sin_kit", "precio": 80, "precioInstitucional": 80, "disponiblePara": "EXTERNOS" }
```

La landing oculta el tipo a quien no corresponde; si falta el campo, `TODOS`.

### POST `/api/v1/site/inscriptions` (y legacy `POST /api/v1/inscription`)

Nuevo error `422 REGISTRATION_TYPE_NOT_AVAILABLE` cuando el tipo no corresponde a la persona, decidido
con el correo con que queda la inscripción (el registrado si se conserva). Mensajes:

- `EXTERNOS`: «Este tipo de inscripción no está disponible para correos @undc.edu.pe. Si ya te
  inscribiste antes, se usa el correo con el que estás registrado. Elige otro tipo de inscripción.»
  (en la categoría estudiantil: «…para estudiantes verificados con su correo @undc.edu.pe…»).
- `INSTITUCIONAL`: «Este tipo de inscripción es solo para correos @undc.edu.pe. Elige otro tipo de
  inscripción.»

No se crea el participante ni la inscripción; el voucher subido se borra.

## API administrativa (`eventos.configurar`)

- `POST /api/v1/registration-categories/:id/types`: `disponiblePara?` (sin él, `TODOS`).
- `PUT /api/v1/registration-types/:id`: `disponiblePara?` (sin él, se conserva).
- Otro valor (o `null`) → `422 VALIDATION_ERROR` con `fields.disponiblePara`.
- `GET /api/v1/events/:eventId/registration-categories`: cada tipo trae `disponiblePara`, también para
  cuentas sin `pagos.ver` (no es un precio).
- Las cortesías no aplican la regla.
