# Contrato: registro de delegaciones (spec 018)

API del sitio (contrato 3) que consume la landing. El evento sale **siempre** del token de acceso
(`X-Api-Key`); el cliente nunca envía precios ni montos.

## `GET /api/v1/site/delegations/tarifa`

Tarifa por defecto de las delegaciones del evento (la landing la muestra antes de registrar).

**Respuesta `200`**

```json
{
  "success": true,
  "data": {
    "minIntegrantes": 10,
    "precioEstandar": 60,
    "precioPromocional": 50
  }
}
```

## `GET /api/v1/site/delegations/link/:codigoLink`

Datos de una delegación por su link, para abrir el formulario ya con la delegación cargada.

- **Autenticación**: `requireTokenEvento`. El link solo sirve dentro del evento del token: una
  delegación de otro evento responde `404 DELEGATION_NOT_FOUND`.
- No expone el correo ni el teléfono del representante (el link se comparte).

**Respuesta `200`**

```json
{
  "success": true,
  "data": {
    "id": 5,
    "nombre": "Ing. de Sistemas UNDC",
    "codigoLink": "9f3a2b1c4d5e6f70",
    "institucion": "UNDC",
    "representanteNombre": "Rosa Quispe",
    "evento": { "id": 2, "codigo": "ciisic-viii-2026", "nombre": "VIII CIISIC", "estado": "PUBLICADO", "inscripcionesAbiertas": true },
    "minIntegrantes": 10,
    "precioEstandar": 60,
    "precioPromocional": 50,
    "precioUnitario": 60,
    "totalIntegrantes": 0
  }
}
```

**Errores**: `404 DELEGATION_NOT_FOUND` (inexistente, inactiva o de otro evento),
`401 EVENT_TOKEN_REQUIRED`, `401 INVALID_EVENT_TOKEN`.

## `POST /api/v1/site/delegations`

Registra una delegación completa y su pago conjunto.

- **Autenticación y límites**: `requireTokenEvento` + `limiteInscripcion` (por IP) +
  `limiteTokenInscripcion` (por token).
- **Cuerpo**: `multipart/form-data` (como `POST /site/inscriptions`).

| Campo | Forma |
|---|---|
| `codigoLink` | Código de una delegación ya creada por el staff. Si viene, el registro **se suma a esa delegación** (con su tarifa y su mínimo); si no, se crea una delegación nueva con la tarifa del evento. Un link de otro evento o de una delegación inactiva → `404` |
| `delegacion` | JSON `{ nombre, institucion? }` |
| `representante` | JSON `{ nombres, apellidos, tipoDocumento, numeroDocumento, correo, celular, esIntegrante }` |
| `participantes` | JSON array de 1..200 `{ tipoDocumento, numeroDocumento, nombres, apellidos, correo, celular? }` |
| `modalidadPago` | `'banco'` o `'billetera'` |
| `banco`, `tipoOperacion` | Solo con `modalidadPago: 'banco'` |
| `billeteraDigital` | Solo con `modalidadPago: 'billetera'` |
| `numeroOperacion` | Código del voucher (3–100 caracteres) |
| `fechaPago` | `YYYY-MM-DD`, no futura (hora de Lima) |
| `voucher` | Archivo PDF/JPG/PNG/WebP ≤ 5 MB (`upload.single('voucher')`) |

**Reglas**

- El representante, si `esIntegrante` es `true`, se agrega **primero** en la lista de participantes
  (el backend no depende del orden del cliente).
- Con `codigoLink` no se crea una delegación nueva: se reutiliza la del link, con **sus** precios y
  su mínimo. El total se calcula sobre el grupo completo (los que ya estaban más los de este envío).
- Reenviar la misma lista **omite** a quien ya está en la delegación (`omitidos` en la respuesta),
  no lo duplica; quien ya está inscrito en el evento por fuera se rechaza.
- La delegación se crea con la tarifa del evento y su `codigoLink` (16 hexadecimales).
- El pago es **conjunto**: un solo número de operación, una fecha, un medio y un voucher, en la
  delegación. Cada inscripción lleva un número de operación interno (`DELEGACION-<uuid>`).
- La tarifa por persona y el total los calcula el servidor con el total final del grupo: la
  promocional desde `minIntegrantes` y la estándar antes. El cliente solo muestra un estimado.
- Las inscripciones nacen `PENDIENTE` (las revisa el staff) y con su código de credencial propio.
- Si el registro falla al escribir las inscripciones, la delegación a medias se borra.

**Respuesta `201`**

```json
{
  "success": true,
  "data": {
    "id": 5,
    "nombre": "Ing. de Sistemas UNDC",
    "codigoLink": "9f3a2b1c4d5e6f70",
    "institucion": "UNDC",
    "minIntegrantes": 10,
    "precioEstandar": 60,
    "precioPromocional": 50,
    "precioUnitario": 60,
    "totalIntegrantes": 2,
    "montoTotal": 120,
    "tarifaUnitaria": 60,
    "registrados": 2,
    "pago": {
      "modalidad": "billetera",
      "billeteraDigital": "yape",
      "numeroOperacion": "OP-12345",
      "fechaPago": "2026-10-15",
      "montoTotalPagado": 120,
      "tieneVoucher": true
    },
    "inscripciones": []
  }
}
```

**Errores**

| Estado | Código | Cuándo |
|---|---|---|
| 422 | `VALIDATION_ERROR` | Datos inválidos (con `fields`) |
| 422 | `VOUCHER_REQUIRED` | Falta el voucher |
| 422 | `INVALID_FILE_TYPE` / `INVALID_FILE_CONTENT` | El archivo no es un PDF/JPG/PNG/WebP válido |
| 409 | `REGISTRATION_CLOSED` | Las inscripciones del evento están cerradas |
| 409 | `OPERATION_ALREADY_REGISTERED` | Otra delegación del mismo evento ya usó ese número de operación |
| 409 | `DUPLICATE_PARTICIPANT` | Documento o correo repetido en la lista |
| 409 | `EMAIL_IN_USE` | Un correo ya pertenece a otra persona |
| 409 | `PARTICIPANT_ALREADY_REGISTERED` | Alguien de la lista ya tiene inscripción en el evento |
| 413 | `UPLOAD_LIMIT_EXCEEDED` | El archivo supera los 5 MB |
| 429 | `RATE_LIMITED` | Demasiados intentos |
| 401 | `EVENT_TOKEN_REQUIRED` / `INVALID_EVENT_TOKEN` | Token de acceso ausente o inválido |

## Administración (panel)

| Ruta | Autenticación | Uso |
|---|---|---|
| `GET /api/v1/events/:eventId/delegations` | `eventos.configurar` | Listar las delegaciones del evento |
| `POST /api/v1/events/:eventId/delegations` | `eventos.configurar` | Crear una delegación a mano (con sus precios) |
| `GET /api/v1/delegations/:id` | `eventos.configurar` | Detalle: integrantes y pago conjunto |
| `GET /api/v1/delegations/:id/voucher` | `eventos.configurar` | Voucher del grupo |
| `POST /api/v1/delegations/:id/inscriptions` | `eventos.configurar` | Alta manual o masiva (1–200, sin voucher) |

`eventos.configurar` es de alcance global: solo lo tienen el Owner y el Administrador del sistema.
