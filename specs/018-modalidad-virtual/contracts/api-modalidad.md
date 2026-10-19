# Contrato — Modalidad de asistencia (presencial / virtual)

Todo es **aditivo**: ningún campo existente cambia ni se quita. `modalidad` ausente, `null` o
desconocida significa `PRESENCIAL` (también el tipo `null` de una cortesía sin tipo). Los consumidores
deben ignorar los campos que no conozcan y tratar un valor distinto de `VIRTUAL` como `PRESENCIAL`.

| Valor | Significado |
|---|---|
| `PRESENCIAL` | Asistencia en la sede (todo lo existente; valor por defecto) |
| `VIRTUAL` | Asistencia a distancia, por la transmisión del congreso |

## Terminología: no confundir

La clave `modalidad` de esta spec va **siempre dentro del objeto del tipo** (`tipo.modalidad`,
`tipoInscripcion.modalidad`). Nunca aparece en la raíz de una inscripción, porque ya existen otras que
significan otra cosa y **no cambian**:

- `pago.modalidad` / `modalidadPago` (listado y creación): `banco` | `billetera` | `cortesia`.
- Columna «Modalidad» del CSV: la de **pago** (solo con `pagos.ver`).
- «Fotocheck virtual» (spec 014): la credencial digital del portal.
- «Modalidad 01/02/03» de `/planes` en la landing: categorías de precios.

## API del sitio (token del evento)

### GET `/api/v1/site/registration-types`

Cada tipo de `categorias[].tipos[]` agrega `modalidad`:

```json
{
  "id": 14, "codigo": "estudiantes_virtual", "nombre": "ESTUDIANTES", "etiqueta": "VIRTUAL",
  "precio": 30, "precioInstitucional": 30, "disponiblePara": "TODOS", "modalidad": "VIRTUAL"
}
```

Los tipos virtuales viven dentro de las categorías existentes `ESTUDIANTES` y `PUBLICO_GENERAL`. Con
`precio == precioInstitucional` y `disponiblePara = TODOS` el monto es el mismo con cualquier correo y el
descuento es 0.

### POST `/api/v1/site/inscriptions` (201)

`tipoInscripcion` agrega `modalidad`: `{ "id", "nombre", "etiqueta", "categoria", "modalidad" }`.
Sin cambios en el cálculo del precio ni en los errores. La ruta legacy (`POST /api/v1/inscription`) y su
forma congelada **no** llevan `modalidad`.

## API administrativa

### Tipos (`eventos.configurar`)

- `GET /api/v1/events/:eventId/registration-categories`: `tipos[].modalidad`, también para cuentas sin
  `pagos.ver` (no es un precio).
- `POST /api/v1/registration-categories/:id/types` y `PUT /api/v1/registration-types/:id` aceptan
  `modalidad` opcional: `PRESENCIAL` | `VIRTUAL`. Otro valor, o `null`, responde `422 VALIDATION_ERROR`
  con `fields.modalidad`. Al crear sin ella, nace `PRESENCIAL`; al actualizar sin ella, se conserva. Las
  respuestas de crear y actualizar la incluyen.
- `GET /api/v1/registration-types` (legacy) no cambia.

### Inscripciones

- `GET /api/v1/events/:eventId/inscriptions` (lista): `filas[].tipoInscripcion.modalidad`
  (`tipoInscripcion` es `null` para una cortesía sin tipo; en ese caso se lee como `PRESENCIAL`).
- `GET /api/v1/inscriptions/:id` (detalle): `tipoInscripcion.modalidad`.
- Filtro nuevo `?modalidad=PRESENCIAL|VIRTUAL` en la lista y en
  `GET /api/v1/events/:eventId/inscriptions/export`; se combina con `?categoria=` (se cumplen las dos
  condiciones) y con los demás filtros. Un valor desconocido responde `422 VALIDATION_ERROR` con
  `fields.modalidad` (vacío = sin filtro). Sin el parámetro, el comportamiento es el anterior.
  `?modalidad=PRESENCIAL` incluye también las inscripciones sin tipo (cortesías), igual que el resumen;
  combinado con `?categoria=` o `?tipoInscripcionId=` solo trae las de esos tipos.
- CSV: columna nueva **«Modalidad de asistencia»** (`PRESENCIAL` | `VIRTUAL`), tras «Etiqueta». Sale
  también sin `pagos.ver`. La columna «Modalidad» existente es la de **pago** y no se renombra.

### Resumen — `GET /api/v1/events/:id/summary`

```json
{
  "totales": {
    "porModalidad": [
      { "modalidad": "PRESENCIAL", "inscripciones": 120, "aprobadas": 80, "montoAprobado": 9600 },
      { "modalidad": "VIRTUAL", "inscripciones": 15, "aprobadas": 10, "montoAprobado": 400 }
    ]
  },
  "porTipo": [
    { "tipoInscripcionId": 14, "nombre": "ESTUDIANTES", "etiqueta": "VIRTUAL", "categoria": "ESTUDIANTES", "modalidad": "VIRTUAL", "total": 9, "aprobadas": 6, "montoAprobado": 180 }
  ]
}
```

- `totales.porModalidad` trae siempre las dos modalidades (`PRESENCIAL` primero); `inscripciones` cuenta
  todas las inscripciones de esa modalidad (las de tipo `null` cuentan como `PRESENCIAL`, así la suma es
  `totales.inscripciones`); `aprobadas` y `montoAprobado` son las `APROBADO`.
- Sin `pagos.ver`, `montoAprobado` va en `null`, igual que los demás montos.

## Portal del inscrito y escáner

- `GET /api/v1/me/inscriptions` → `[].tipoInscripcion.modalidad`.
- `GET /api/v1/me/inscriptions/:id/badge` (fotocheck) → `tipoInscripcion.modalidad`.
- `POST /api/v1/activities/:id/attendances` → `inscripcion.tipoInscripcion.modalidad`. El escáner solo
  muestra un aviso: **la marca se registra igual** para un virtual (no hay `403` ni `409` nuevos).

## Eventos

Crear un evento copiando otro (`copiarDeEventoId`) copia la `modalidad` de cada tipo.

## Credencial y correo

- La credencial PDF agrega el rótulo **«Modalidad: VIRTUAL»** solo si el tipo es virtual. Entra en la
  huella del archivo y sube `VERSION_PLANTILLA` a 3: los PDF guardados se regeneran al pedirlos de nuevo.
- El correo de aprobación agrega un párrafo solo para virtuales: «Tu inscripción es en modalidad
  VIRTUAL: la organización te compartirá las indicaciones para conectarte a la transmisión del
  congreso.» Sin enlaces ni promesas de horas o certificado.

## Datos que se crean en producción

Los crea el dueño del proyecto (script `prisma/preflight/configurar-virtual.sql` o el panel), no el
código. En el evento `ciisic-viii-2026`:

| Categoría | Código | Nombre | Etiqueta | Precio | Precio inst. | Disponible para | Modalidad |
|---|---|---|---|---|---|---|---|
| `ESTUDIANTES` | `estudiantes_virtual` | ESTUDIANTES | VIRTUAL | 30.00 | 30.00 | `TODOS` | `VIRTUAL` |
| `PUBLICO_GENERAL` | `general_virtual` | PROFESIONALES Y PUBLICO EN GENERAL | VIRTUAL | 50.00 | 50.00 | `TODOS` | `VIRTUAL` |

Características (`[{ icon, text }]`): `heroicons:computer-desktop` «Participación virtual en las
ponencias transmitidas» y `heroicons:x-mark` «No incluye kit ni ingreso presencial». La descripción no
promete certificado ni horas.

## Compatibilidad

- Backend nuevo + frontends viejos: el campo extra se ignora; los tipos virtuales aparecen como planes
  normales (con la etiqueta «VIRTUAL») y la inscripción funciona igual.
- Frontends nuevos + backend viejo: sin `modalidad` todo se lee `PRESENCIAL`; el filtro `?modalidad=` lo
  ignora el backend anterior (los frontends no deben depender de él hasta desplegar el backend).
- Preguntas de negocio abiertas (entrega del acceso, certificados y asistencia de los virtuales,
  constancia de estudiante): ver `spec.md`. Hasta que se respondan, los textos son neutros y nada se
  bloquea.
