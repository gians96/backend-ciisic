# Contrato — API administrativa

Base: `/api/v1`. Header `Authorization: Bearer <jwt>` (rol `ADMIN` o `SUPERADMIN`; **SA** =
solo `SUPERADMIN`). Éxito: `{ "success": true, "data", "meta"? }`. Paginación:
`?page=1&pageSize=20` (máx. 100) → `meta: { "page", "pageSize", "total" }`.

## Autenticación

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| POST | `/auth/login` | `{ "correo", "contrasena" }` (acepta también `correoElectronico`) → `{ "jwt", "usuario": { "id", "nombres", "apellidos", "correo", "rolCodigo", "rolNombre" } }`. 401 `INVALID_CREDENTIALS` (también si está inactivo). Rate limit 10/15 min. |
| GET | `/auth/session` | `{ "success": true, "user": { …mismo objeto… } }` |

El JWT dura 1 h y lleva `user.rolCodigo`.

## Eventos

| Método | Ruta | Notas |
|---|---|---|
| GET | `/events` | Todos los eventos con `totalInscripciones`. |
| POST | `/events` | Crea. Campos: `codigo` (slug `a-z0-9-`), `nombre`, `nombreCorto`, `descripcion?`, `sede?`, `fechaInicio`, `fechaFin` (`YYYY-MM-DD`), `inscripcionesInicio?`, `inscripcionesFin?` (ISO), `inscripcionesAbiertas?`, `estado?`, `esPrincipal?`, `dominioInstitucional?`, `correoContacto?`, `telefonoContacto?`, `remitenteNombre?`, `asuntoAprobacion?`, `datosPago?`, `copiarDeEventoId?` (copia categorías y tipos). 409 `EVENT_CODE_TAKEN`. |
| GET | `/events/:id` | Detalle completo. |
| PUT | `/events/:id` | Actualización parcial (mismos campos salvo `copiarDeEventoId`). Marcar `esPrincipal` desmarca los demás. |
| DELETE | `/events/:id` | Solo sin inscripciones; si tiene → 409 `EVENT_HAS_INSCRIPTIONS` (usar estado `ARCHIVADO`). |
| GET | `/events/:id/summary` | KPIs (ver abajo). |

`summary`:

```json
{
  "totales": { "inscripciones": 28, "pendientes": 4, "enRevision": 3, "aprobadas": 12, "rechazadas": 2, "canceladas": 2,
               "montoAprobado": 1460, "montoPendiente": 420, "estudiantesUndc": 9 },
  "porEstado": [{ "codigo": "APROBADO", "nombre": "Aprobado", "total": 12, "monto": 1460 }],
  "porTipo": [{ "tipoInscripcionId": 1, "nombre": "ESTUDIANTES", "etiqueta": "CON KIT", "categoria": "ESTUDIANTES",
                "total": 8, "aprobadas": 5, "montoAprobado": 500 }],
  "porDia": [{ "fecha": "2026-09-20", "total": 3 }]
}
```

## Categorías y tipos de inscripción

| Método | Ruta | Notas |
|---|---|---|
| GET | `/events/:eventId/registration-categories` | Categorías con todos sus tipos (activos e inactivos) y `totalInscripciones` por tipo. |
| POST | `/events/:eventId/registration-categories` | `{ codigo, nombre, descripcion?, caracteristicas?, precioDesde?, esEstudiantil?, orden? }` |
| PUT | `/registration-categories/:id` | Parcial. |
| DELETE | `/registration-categories/:id` | 409 `CATEGORY_IN_USE` si tiene tipos. |
| POST | `/registration-categories/:id/types` | `{ codigo, nombre, etiqueta?, descripcion?, caracteristicas?: [{icon,text}], precio, precioInstitucional, activo?, orden? }` |
| PUT | `/registration-types/:id` | Parcial (no borra `caracteristicas` si no se envían). |
| DELETE | `/registration-types/:id` | 409 `REGISTRATION_TYPE_IN_USE` si tiene inscripciones (desactivar en su lugar). |

## Inscripciones

| Método | Ruta | Notas |
|---|---|---|
| GET | `/events/:eventId/inscriptions` | Filtros: `estado` (código), `tipoInscripcionId`, `categoria` (código), `esEstudianteUndc` (`true`/`false`), `q` (documento, nombres, apellidos, correo, nº operación), `page`, `pageSize`. Orden: más recientes primero. |
| GET | `/events/:eventId/inscriptions/export` | CSV (`text/csv; charset=utf-8`, separador `;`, con BOM). |
| GET | `/inscriptions/:id` | Detalle con participante, tipo, categoría, clasificación, estado, pago, verificación y revisión. |
| PATCH | `/inscriptions/:id/status` | `{ "estado": "APROBADO"\|"RECHAZADO"\|"EN_REVISION"\|"PENDIENTE"\|"CANCELADO", "motivo"? }`; `RECHAZADO` exige `motivo`. Respuesta: detalle + `credencialEnviada` (boolean\|null). |
| POST | `/inscriptions/:id/resend-credential` | Solo `APROBADO`. 409 `NOT_APPROVED`. |
| GET | `/inscriptions/:id/voucher` | Archivo del voucher (inline). 404 si no tiene. |
| GET | `/inscriptions/:id/credential` | PDF de la credencial (la genera si no existe; solo `APROBADO`). |
| DELETE | `/inscriptions/:id` | SA. Borra la inscripción y su voucher. |

Detalle de inscripción:

```json
{
  "id": 1, "eventoId": 1, "creadoEn": "…", "actualizadoEn": "…",
  "participante": { "id": 1, "tipoDocumento": "dni", "numeroDocumento": "…", "nombres": "…", "apellidos": "…", "correo": "…", "celular": "…" },
  "tipoInscripcion": { "id": 1, "codigo": "…", "nombre": "…", "etiqueta": "…", "precio": 120, "precioInstitucional": 100,
                        "categoria": { "id": 1, "codigo": "ESTUDIANTES", "nombre": "…", "esEstudiantil": true } },
  "clasificacion": { "id": 4, "nombre": "…" },
  "estado": { "id": 1, "codigo": "PENDIENTE", "nombre": "Pendiente" },
  "pago": { "monto": 100, "descuento": 20, "tieneDescuento": true, "modalidad": "banco", "banco": "bcp", "tipoOperacion": "directo",
            "billeteraDigital": null, "numeroOperacion": "…", "fechaPago": "2026-09-20", "tieneVoucher": true },
  "verificacion": { "esEstudianteUndc": true, "esCorreoInstitucional": true, "codigoEstudiante": "…", "detalle": { … } },
  "revision": { "motivoRechazo": null, "revisadoPor": { "id": 1, "nombres": "…" }, "revisadoEn": "…", "credencialEnviadaEn": "…" }
}
```

## Actividades y asistencia

| Método | Ruta | Notas |
|---|---|---|
| GET | `/events/:eventId/activities` | Con `totalAsistencias`. |
| POST | `/events/:eventId/activities` | `{ nombre, fecha: "YYYY-MM-DD", horaInicio: "HH:mm", horaFin: "HH:mm" }` (hora de Lima). |
| PUT | `/activities/:id` | Parcial. |
| DELETE | `/activities/:id` | 409 `ACTIVITY_HAS_ATTENDANCE`. |
| GET | `/activities/:id/attendances` | Participantes con asistencia. |
| POST | `/activities/:id/attendances` | `{ participanteId? , numeroDocumento?, fueraDeHorario?: boolean }`; exige inscripción `APROBADO` en el evento; valida ventana horaria salvo `fueraDeHorario`. 409 `ATTENDANCE_ALREADY_REGISTERED`. |
| DELETE | `/attendances/:id` | |
| GET | `/events/:eventId/attendances/export` | Matriz participantes aprobados × actividades (1/0). |

Legacy: `POST /attendances` y `/attendances/overtime` con `{ id_usuario, id_evento }`.

## Ponencias, mensajes y participantes

| Método | Ruta | Notas |
|---|---|---|
| GET | `/events/:eventId/papers?page=` | 50 por página. |
| GET | `/papers/:id/file` | Descarga PDF. |
| GET | `/events/:eventId/contact-messages?page=&leido=` | |
| PATCH | `/contact-messages/:id` | `{ leido }` |
| DELETE | `/contact-messages/:id` | |
| GET | `/participants?q=&page=` | |
| GET | `/participants/:id` | Con inscripciones (evento, estado). |
| PUT | `/participants/:id` | `{ nombres?, apellidos?, correo?, celular? }` |

## Administradores y catálogos

| Método | Ruta | Notas |
|---|---|---|
| GET/POST | `/admin` | SA. `{ nombres, apellidos, correo, contrasena (≥12), rolCodigo? ("ADMIN" por defecto), activo? }` |
| GET/PUT/DELETE | `/admin/:id` | SA. PUT parcial sin valores por defecto; no se puede desactivar/eliminar a sí mismo. |
| GET | `/roles` | SA. |
| GET | `/classification`, `/document-type`, `/inscription-state` | Públicos (catálogos). Escritura: admin. |

## Consultas DNI (spec 003), verificación (spec 004), integraciones (spec 005)

Ver `specs/003-consultas-dni/contracts`, `specs/004-verificacion-estudiante/contracts`,
`specs/005-integracion-deportes/contracts`.
