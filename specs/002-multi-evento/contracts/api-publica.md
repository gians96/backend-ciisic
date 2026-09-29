# Contrato — API pública (landing)

Base: `/api/v1/public`. Sin autenticación. Todas las respuestas de éxito tienen la forma
`{ "success": true, "data": … }` y los errores `{ "success": false, "code", "message", "fields"? }`.

Rate limits por IP: lectura 120/min; `inscriptions` 10/15 min; `student-verification` 20/min;
`document-lookup` 10/min; `papers` 10/15 min; `contact` 5/15 min.

## GET `/events/:codigo`

Evento visible (`PUBLICADO` o `FINALIZADO`).

```json
{
  "success": true,
  "data": {
    "codigo": "ciisic-viii-2026",
    "nombre": "VIII Congreso Internacional de Ingeniería de Sistemas e Investigación Científica",
    "nombreCorto": "VIII CIISIC 2026",
    "descripcion": "…",
    "sede": "Auditorio Casa de la Cultura, San Vicente de Cañete",
    "fechaInicio": "2026-10-26",
    "fechaFin": "2026-10-30",
    "estado": "PUBLICADO",
    "inscripciones": { "abiertas": true, "inicio": null, "fin": null },
    "dominioInstitucional": "undc.edu.pe",
    "contacto": { "correo": "congreso@undc.edu.pe", "telefono": "+51 949 026 908" },
    "datosPago": {
      "titular": "…",
      "bancos": [{ "codigo": "bcp", "nombre": "BCP", "numeroCuenta": "…", "cci": "…" }],
      "billeteras": [{ "codigo": "yape", "nombre": "Yape", "telefono": "…", "qrUrl": "/images/qr/yape-2026.png" }]
    }
  }
}
```

`inscripciones.abiertas` = `inscripcionesAbiertas` ∧ estado `PUBLICADO` ∧ dentro de la ventana
`[inicio, fin]` cuando están definidas. Errores: `404 EVENT_NOT_FOUND`.

## GET `/events/:codigo/registration-types?categoria=ESTUDIANTES`

Categorías (ordenadas por `orden`) con sus tipos **activos**. `categoria` es opcional.

```json
{
  "success": true,
  "data": [
    {
      "codigo": "ESTUDIANTES",
      "nombre": "ESTUDIANTES",
      "descripcion": null,
      "esEstudiantil": true,
      "precioDesde": null,
      "caracteristicas": null,
      "tipos": [
        {
          "id": 1,
          "codigo": "estudiantes_con_kit",
          "nombre": "ESTUDIANTES",
          "etiqueta": "CON KIT",
          "descripcion": "…",
          "caracteristicas": [{ "icon": "heroicons:gift", "text": "Kit de Merchandising Oficial" }],
          "precio": 120,
          "precioInstitucional": 100
        }
      ]
    }
  ]
}
```

## POST `/events/:codigo/inscriptions` (multipart/form-data)

| Campo | Tipo | Regla |
|---|---|---|
| `participante` | JSON string | `{ "tipoDocumento": "dni"\|"ce", "numeroDocumento": "8 dígitos (dni) / 9–12 (ce)", "nombres", "apellidos", "correo", "celular": "9 dígitos" }` |
| `tipoInscripcionId` | entero | tipo activo del evento |
| `clasificacionId` | entero opcional | ciclo del estudiante |
| `modalidadPago` | `banco` \| `billetera` | |
| `banco` | texto opcional | p. ej. `bcp` (si `banco`) |
| `tipoOperacion` | `directo` \| `interbancario` opcional | |
| `billeteraDigital` | texto opcional | p. ej. `yape` (si `billetera`) |
| `numeroOperacion` | texto 3–100 | único |
| `fechaPago` | `YYYY-MM-DD` | no futura (hora de Lima) |
| `verificacionToken` | texto opcional | devuelto por `student-verification` |
| `voucher` | archivo | **obligatorio**; PDF/JPG/PNG/WebP ≤ 5 MB, validado por contenido |

Campos ignorados si se envían: `estadoId`, `pago`, `monto`, `descuento`, `hasDiscount`, `file`.

Respuesta `201`:

```json
{
  "success": true,
  "data": {
    "id": 123,
    "evento": { "codigo": "ciisic-viii-2026", "nombreCorto": "VIII CIISIC 2026" },
    "participante": { "tipoDocumento": "dni", "numeroDocumento": "12345678", "nombres": "…", "apellidos": "…", "correo": "…", "celular": "…" },
    "tipoInscripcion": { "id": 1, "nombre": "ESTUDIANTES", "etiqueta": "CON KIT", "categoria": "ESTUDIANTES" },
    "clasificacion": { "id": 4, "nombre": "ESTUDIANTE - IV CICLO" },
    "monto": 100,
    "precioRegular": 120,
    "descuento": 20,
    "esEstudianteUndc": true,
    "modalidadPago": "banco",
    "banco": "bcp",
    "tipoOperacion": "directo",
    "billeteraDigital": null,
    "numeroOperacion": "123456",
    "fechaPago": "2026-09-29",
    "estado": { "codigo": "PENDIENTE", "nombre": "Pendiente" },
    "creadoEn": "2026-09-29T15:04:05.000Z"
  }
}
```

Errores: `404 EVENT_NOT_FOUND`, `409 REGISTRATION_CLOSED`, `422 VALIDATION_ERROR`,
`422 REGISTRATION_TYPE_INVALID`, `422 VOUCHER_REQUIRED`, `422 INVALID_FILE_CONTENT`,
`409 ALREADY_REGISTERED`, `409 EMAIL_IN_USE`, `409 OPERATION_ALREADY_REGISTERED`,
`413 UPLOAD_LIMIT_EXCEEDED`.

## POST `/events/:codigo/student-verification`

Ver spec 004. Body `{ "correo", "tipoDocumento", "numeroDocumento" }` →
`{ "esEstudianteUndc", "codigoEstudiante", "motivo", "verificacionToken" }`.

## POST `/events/:codigo/papers` (multipart/form-data)

`data` = JSON `{ "title", "mainAuthor": { "firstName", "lastName", "university" }, "coauthors": [...] }`
(máx. 3), `file` = PDF ≤ 5 MB. Respuesta `201 { "success": true, "data": { "id": "<uuid>", "creadoEn" } }`.

## POST `/events/:codigo/contact`

`{ "nombres", "apellidos", "correo", "asunto", "mensaje" }` → `201 { "success": true, "data": { "id" } }`.

## GET `/document-lookup/dni/:numero`

Ver spec 003. `200 { "success": true, "data": { "numero", "nombres", "apellidoPaterno", "apellidoMaterno", "apellidos" } }`;
`404 DOCUMENT_NOT_FOUND`, `503 LOOKUP_UNAVAILABLE`.

---

## Rutas legacy (evento principal)

Se mantienen para la landing actual y se retirarán cuando la nueva esté desplegada.

| Ruta | Comportamiento |
|---|---|
| `POST /api/v1/inscription` | Igual que antes (`usuario` JSON, `file` opcional); responde la forma anterior (`usuario`, `pago`, `estado`…). Ignora `estadoId`. |
| `GET /api/v1/registration-types[/:id]` | Tipos del evento principal con la forma anterior (`badge`, `value`, `institutionalPrice`, `tipoPlanId`). |
| `POST /api/v1/papers` | Igual que antes, asociado al evento principal. |
| `POST /api/v1/contact` | `{ firstName, lastName, email, subject, message }`, asociado al evento principal. |
| `GET /api/v1/reniec/dni?number=` | Usa el pool de consultas (spec 003); responde `{ numero, idTipoDocumento, nombres, apellidos }`. |
| `GET /api/v1/classification`, `/document-type`, `/inscription-state`, `/deposit-method`, `/payment-type` | Catálogos públicos (los dos últimos responden `[]`). |
