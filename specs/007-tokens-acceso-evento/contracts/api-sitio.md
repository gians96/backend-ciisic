# Contrato — API del sitio (landing de cada evento)

Base: `/api/v1/site`. Se recomienda llamarla desde el servidor de la landing (BFF), con

| Cabecera | Obligatoria | Uso |
|---|---|---|
| `X-Api-Key` | sí | Token de acceso del evento (`ciisic_…`, generado en el panel). Define el evento. |
| `X-Client-Ip` | recomendada (BFF) | IP del visitante; con un token válido se usa para los límites por visitante. |

CORS está abierto a cualquier origen (spec 009): otra plataforma puede usarla también desde el
navegador, pero entonces el token es público; si hay abuso se revoca en el panel.
Respuestas de éxito `{ "success": true, "data": … }`; errores `{ "success": false, "code", "message", "fields"? }`.

Errores comunes a todas las rutas: `401 EVENT_TOKEN_REQUIRED` (falta la cabecera),
`401 INVALID_EVENT_TOKEN` (inexistente, revocado o expirado), `404 EVENT_NOT_FOUND` (evento archivado),
`429 RATE_LIMITED`.

Rate limits por visitante: lectura 120/min; `inscriptions` 10/15 min; `student-verification` 20/min;
`document-lookup` 10/min; `papers` 10/15 min; `contact` 5/15 min; `google-verification` 20/min.
Por token: lectura 3000/min; `document-lookup` 60/min y 1500/día; `student-verification` 50/min;
`google-verification` 300/min; `inscriptions` 150/15 min; `papers` y `contact` 60/15 min.

## GET `/config`

`{ "google": { "clientId": "…" | null }, "urlPanel": "https://admin…" | null }` (spec 008).

## POST `/google-verification`

Ver spec 010 (`contracts/api-google.md`).

## GET `/event`

Evento del token (`BORRADOR`, `PUBLICADO` o `FINALIZADO`; los archivados responden 404).

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

## GET `/registration-types?categoria=ESTUDIANTES`

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

## GET `/catalogs`

Catálogos del formulario de inscripción.

```json
{
  "success": true,
  "data": {
    "clasificaciones": [{ "id": 1, "nombre": "ESTUDIANTE - I CICLO" }],
    "tiposDocumento": [{ "id": "dni", "nombre": "Documento Nacional de Identidad", "abreviatura": "DNI" }]
  }
}
```

## POST `/inscriptions` (multipart/form-data)

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

Errores: `409 REGISTRATION_CLOSED`, `422 VALIDATION_ERROR`,
`422 REGISTRATION_TYPE_INVALID`, `422 VOUCHER_REQUIRED`, `422 INVALID_FILE_CONTENT`,
`409 ALREADY_REGISTERED`, `409 EMAIL_IN_USE`, `409 OPERATION_ALREADY_REGISTERED`,
`413 UPLOAD_LIMIT_EXCEEDED`.

## POST `/student-verification`

Ver spec 004. Body `{ "correo", "tipoDocumento", "numeroDocumento" }` →
`{ "esEstudianteUndc", "codigoEstudiante", "motivo", "verificacionToken" }`.

## POST `/papers` (multipart/form-data)

`data` = JSON `{ "title", "mainAuthor": { "firstName", "lastName", "university" }, "coauthors": [...] }`
(máx. 3), `file` = PDF ≤ 5 MB. Respuesta `201 { "success": true, "data": { "id": "<uuid>", "creadoEn" } }`.

## POST `/contact`

`{ "nombres", "apellidos", "correo", "asunto", "mensaje" }` → `201 { "success": true, "data": { "id" } }`.

## GET `/document-lookup/dni/:numero`

Ver spec 003. `200 { "success": true, "data": { "numero", "nombres", "apellidoPaterno", "apellidoMaterno", "apellidos" } }`;
`404 DOCUMENT_NOT_FOUND`, `503 LOOKUP_UNAVAILABLE`.

---

## Administración de tokens (JWT de SuperAdmin)

| Método | Ruta | Cuerpo | Respuesta |
|---|---|---|---|
| GET | `/api/v1/events/:eventId/access-tokens` | | `[{ id, eventoId, nombre, prefijo, estado: "ACTIVO" \| "REVOCADO" \| "EXPIRADO", ultimoUsoEn, expiraEn, revocadoEn, creadoPor: { id, nombres, apellidos } \| null, creadoEn }]` |
| POST | `/api/v1/events/:eventId/access-tokens` | `{ nombre, expiraEn?: ISO \| null }` | `201 { …token, "token": "ciisic_…" }`: el valor solo se devuelve aquí (`Cache-Control: no-store`) |
| DELETE | `/api/v1/access-tokens/:id` | | Token con `estado: "REVOCADO"` (idempotente) |

Errores: `404 EVENT_NOT_FOUND`, `404 ACCESS_TOKEN_NOT_FOUND`, `422 VALIDATION_ERROR` (expiración pasada).
