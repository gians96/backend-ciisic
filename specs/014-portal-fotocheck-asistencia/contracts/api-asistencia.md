# Contrato — Asistencia por QR, credencial e inscripciones (staff y landing)

Base `/api/v1`. Staff: `Authorization: Bearer <jwt>` con la guarda de la spec 013
(`requirePermiso`; `401 SESSION_INVALIDATED`, `403 FORBIDDEN`, `403 EVENT_NOT_ASSIGNED` y
`404 NOT_FOUND` para las cuentas por evento). Errores `{ "success": false, "code", "message", "fields"? }`.

## Código de la credencial

- `inscripciones.codigo_credencial`: 10 caracteres `[0-9A-Z]` (base 36, ~51 bits, generador
  criptográfico), único. Se asigna al crear la inscripción (sitio, legacy y cortesía; ante una
  colisión se reintenta hasta 3 veces y después `409 DUPLICATE_RECORD`) y, si falta, al leerla
  (fotocheck, PDF, reenvío, aprobación).
- `es_qr_legado`: la inscripción pudo recibir la credencial con el QR anterior (id del
  participante). Lo marca la migración en las aprobadas o con credencial enviada, y
  `asegurarCodigoCredencial` al rellenar un código de una inscripción así. Aprobar asigna el código
  **antes**, para que una aprobación nueva no quede marcada.
- El QR del fotocheck y del PDF codifica solo el código. El código va en `GET /inscriptions/:id`
  (y en las respuestas que usan ese detalle) como `codigoCredencial` y `esQrLegado`; **no** va en
  los listados ni en el CSV.

```json
{ "id": 500, "…": "…", "codigoCredencial": "K7Q2M9X4TB", "esQrLegado": false }
```

## POST `/activities/:id/attendances`

Guardas: `requirePermiso('asistencia.marcar', { evento: eventoDeActividad })` →
`limiteMarcarAsistencia` (120/min, solo cuentas por evento) → `validateBody`.

Cuerpo con **exactamente uno** de los identificadores, más `fueraDeHorario?: boolean` y
`metodo?: "QR" | "DOCUMENTO" | "MANUAL" | null`:

| Identificador | Formato | Método guardado |
|---|---|---|
| `{ "codigo": "k7q2m9x4tb\r\n" }` | Se recorta y pasa a mayúsculas; `/^[0-9A-Z]{10}$/` | `QR` |
| `{ "numeroDocumento": "70001234", "tipoDocumento": "dni" }` | `tipoDocumento` (`dni`\|`ce`) solo con `numeroDocumento` | `DOCUMENTO` |
| `{ "participanteId": 100 }` | QR anterior | `QR_LEGADO` |

- **Método**: se deduce del identificador. `QR` y `DOCUMENTO` enviados no cambian nada (el panel
  de la spec 013 envía `{ participanteId, metodo: "QR" }` y se registra como `QR_LEGADO`). Solo
  `MANUAL` cuenta: exige `asistencia.fuera_horario`, guarda `MANUAL` y salta la regla del QR
  anterior.
- **Regla del QR anterior** (`participanteId` sin `MANUAL`): la inscripción del evento tiene
  `esQrLegado` o no tiene código, **y** hoy (hora de Lima) es como mucho `evento.fechaFin`.
- **Ventana**: el día de la actividad, de 30 min antes de `horaInicio`
  (`TOLERANCIA_ANTES_MINUTOS`) hasta `horaFin`. Fuera de ella, solo con `fueraDeHorario: true` y
  `asistencia.fuera_horario`; `esFueraDeHorario` sale de la hora real.
- La persona se busca solo entre las inscripciones del evento de la actividad; volver a marcar una
  anulada la reactiva (spec 013).

`201`:

```json
{ "success": true, "data": {
  "id": 3, "registradoEn": "2026-10-26T14:05:00.000Z", "metodo": "QR", "esFueraDeHorario": false,
  "alerta": null,
  "participante": { "id": 100, "nombres": "ANA", "apellidos": "PÉREZ GARCÍA", "tipoDocumento": "dni", "numeroDocumento": "70001234", "foto": { "tiene": true } },
  "inscripcion": { "id": 500, "tipoInscripcion": { "nombre": "ESTUDIANTES", "etiqueta": "CON KIT" } } } }
```

- `alerta: "QR_LEGADO"` con el QR anterior: el escáner muestra el resultado en ámbar y pide
  verificar el DNI y la foto.
- `numeroDocumento` sale `****1234` si la cuenta no tiene `inscripciones.ver`.
- `foto.tiene` indica que hay un nombre de foto válido (no comprueba el archivo); la imagen se pide
  con `GET /inscriptions/:id/photo` usando `inscripcion.id`. `tipoInscripcion` puede ser `null`.

| Estado | Código | Cuándo |
|---|---|---|
| 422 | `VALIDATION_ERROR` | No hay exactamente un identificador, código mal formado o `tipoDocumento` sin documento |
| 403 | `MANUAL_NOT_ALLOWED` | `metodo: "MANUAL"` sin `asistencia.fuera_horario` (antes de buscar a la persona) |
| 403 | `OUT_OF_HOURS_NOT_ALLOWED` | `fueraDeHorario` sin `asistencia.fuera_horario` |
| 404 | `CODE_NOT_FOUND` | El código no es de ninguna credencial |
| 409 | `CODE_OTHER_EVENT` | La credencial es de otro evento (sin datos de la persona) |
| 404 | `PARTICIPANT_NOT_FOUND` | Documento o id sin inscripción en el evento |
| 409 | `AMBIGUOUS_DOCUMENT` | Dos inscritos comparten el número; enviar `tipoDocumento` |
| 422 | `LEGACY_QR_NOT_ALLOWED` | QR anterior sin la marca y con código propio, o pasado `fechaFin` (el mensaje trae la fecha) |
| 403 | `NOT_APPROVED` | La inscripción no está aprobada |
| 409 | `OUTSIDE_WINDOW` | Fuera del día o de la ventana («desde HH:MM hasta HH:MM») |
| 409 | `ATTENDANCE_ALREADY_REGISTERED` | Ya marcada (con la hora) |
| 429 | `RATE_LIMITED` | Más de 120 marcas por minuto de una cuenta por evento |

```json
{ "success": false, "code": "LEGACY_QR_NOT_ALLOWED", "message": "El QR anterior solo valía hasta el fin del evento (2026-10-30). Pide el fotocheck del portal o registra con el documento." }
```

**Rutas legacy** `POST /attendances` y `/attendances/overtime` (`rutaLegacy` + `legacy.usar`): el
`id_usuario` es el QR anterior, se guarda como `QR_LEGADO` con la misma regla y la respuesta (sin
`{ success, data }`) trae también `alerta`, `participante.foto` e `inscripcion`.

## GET `/inscriptions/:id/photo`

Foto del participante de la inscripción, para el escáner y el panel. Guarda:
`requirePermiso(['asistencia.marcar', 'inscripciones.ver'], { evento: eventoDeInscripcion })`.
`200` con la imagen (`image/png` o `image/jpeg`), `Cache-Control: private, no-store` y
`Content-Disposition: inline`.

| Estado | Código | Cuándo |
|---|---|---|
| 404 | `PHOTO_NOT_FOUND` | Sin foto, nombre con otro formato o archivo inexistente |
| 404 | `INSCRIPTION_NOT_FOUND` / `NOT_FOUND` | La inscripción no existe (cuenta global / cuenta por evento) |
| 403 | `EVENT_NOT_ASSIGNED` | Inscripción de un evento ajeno |

## Credencial PDF

- QR del código, código impreso en texto y foto si existe. Archivo
  `uploads/credenciales/<evento>/<id>-<huella>.pdf`: la huella (12 hex) resume código, nombres,
  apellidos, documento, correo, celular, foto, tipo de inscripción, `evento.actualizadoEn`, fechas
  impresas y `VERSION_PLANTILLA` (2). Si cambian, se genera otro y se borran las versiones viejas
  (las escritas por generaciones que empezaron antes; una que termina tarde con datos anteriores no
  borra la más nueva); borrar la inscripción borra todas. Cambiar o quitar la foto borra los PDF
  guardados del participante.
- Las descargas y el adjunto del correo se leen a memoria en cuanto el PDF está listo (un cambio de
  foto simultáneo no los deja sin archivo).
- Como mucho 2 generaciones a la vez y 30 en cola (Puppeteer, cada paso con un tope de 30 s). Con
  la cola llena:
  - descargas (`GET /inscriptions/:id/credential`, portal) → `503 PDF_BUSY` con `Retry-After: 10`;
  - aprobar (`PATCH /inscriptions/:id/status`), reenviar y la cortesía con `enviarCredencial`
    responden con `credencialEnviada: false` y la aprobación se mantiene.
- Tras desplegar la 014: `npm run credenciales:pregenerar -- --evento <código>` (en la imagen,
  `node dist/src/database/pregenerarCredenciales.js --evento <código>`) las genera de una en una.

```json
{ "success": false, "code": "PDF_BUSY", "message": "Hay muchas credenciales generándose en este momento. Intenta nuevamente en unos segundos." }
```

## POST `/participants`

Alta sin inscripción (organizadores, ponentes, inscripción en persona). Guardas:
`requirePermiso('participantes.gestionar')` → `validateBody`.

```json
{ "tipoDocumento": "dni", "numeroDocumento": "70001234", "correo": "Ana@Gmail.com", "nombres": "Ana", "apellidos": "Pérez García", "celular": "987654321" }
```

- `correo` obligatorio (sin correo no hay portal), se guarda en minúsculas. Sin `celular` se guarda
  `""`.
- Con DNI se consulta el documento (`PANEL`: caché y proveedores); si responde, sus nombres
  reemplazan a los enviados; si no (404 o 503), se usan los enviados.
- La unicidad se revisa antes de consultar (no gasta una consulta).

`201`: la misma forma que `GET /participants/:id`:

```json
{ "success": true, "data": { "id": 7, "tipoDocumento": "dni", "numeroDocumento": "70001234", "nombres": "ANA", "apellidos": "PÉREZ GARCÍA", "correo": "ana@gmail.com",
  "celular": "987654321", "googleVinculado": false, "googleVinculadoEn": null, "creadoEn": "…", "actualizadoEn": "…", "inscripciones": [] } }
```

| Estado | Código | `fields` |
|---|---|---|
| 422 | `VALIDATION_ERROR` | por campo |
| 422 | `NAMES_REQUIRED` | `{ "nombres"?, "apellidos"? }` |
| 409 | `PARTICIPANT_EXISTS` | `{ "id": "7" }` (para abrir el registro existente) |
| 409 | `EMAIL_IN_USE` | — |

## PUT `/participants/:id`

Contrato sin cambios (`participantes.gestionar`). Si cambia el correo: se borra el vínculo con
Google, se cierran las sesiones del portal, se avisa **en diferido al correo anterior** (con el
nuevo enmascarado y el evento de su inscripción más reciente) y se registra
`[participantes] La cuenta <actorId> cambió el correo del participante <id>` (solo ids). Dos
ediciones simultáneas al mismo correo → `409 EMAIL_IN_USE`.

## POST `/events/:eventId/courtesy-inscriptions`

Guardas: `requirePermiso('inscripciones.cortesia')` (solo Owner y Administrador) →
`validateBody`.

```json
{ "participanteId": 7, "tipoInscripcionId": 12, "enviarCredencial": true }
```

`tipoInscripcionId` opcional (`null`), del mismo evento (se admiten tipos inactivos, como
«Ponente»); `enviarCredencial` por defecto `false`. Crea la inscripción `APROBADO` con monto y
descuento 0, `modalidadPago: "cortesia"`, `numeroOperacion: "CORTESIA-<12 hexadecimales aleatorios>"`
(p. ej. `CORTESIA-3F9A0C21B7E4`; **independiente** del código de la credencial, porque el número
de operación sale en listados, búsquedas y el CSV), fecha de pago de hoy y revisada por quien la
crea ahora.

`201`: el detalle de `GET /inscriptions/:id` más `credencialEnviada` (`null` si no se pidió).

| Estado | Código |
|---|---|
| 404 | `EVENT_NOT_FOUND`, `PARTICIPANT_NOT_FOUND` |
| 422 | `REGISTRATION_TYPE_INVALID`, `VALIDATION_ERROR` |
| 409 | `ALREADY_REGISTERED`, `DUPLICATE_RECORD` (3 colisiones del código o del número de operación) |

Los formularios del sitio y legacy rechazan un número de operación con el prefijo `cortesia-` (sin
importar mayúsculas): `422 VALIDATION_ERROR`.

## Inscripción con otro correo (landing y legacy)

`POST /site/inscriptions` y legacy `POST /inscription`. Si el documento ya está registrado con otro
correo (sin importar mayúsculas), **nunca** se cambia el correo ni hay 409, **venga o no un
`verificacionCorreoToken` válido**: verificar con Google prueba que quien envía el formulario
controla el correo nuevo, no que sea el dueño del documento (con solo conocer un DNI se tomaría la
cuenta: portal, fotocheck y credenciales futuras). La inscripción usa el participante tal cual
(correo, celular y vínculo con Google; los nombres oficiales de RENIEC sí se actualizan), se avisa
en diferido al correo registrado (con el ingresado enmascarado) y:

- `esCorreoVerificado` es `false` y `verificacionCorreo` `null` (la verificación era de otro correo);
- el precio por dominio institucional (categoría general y ruta legacy) y `esCorreoInstitucional`
  salen del correo **registrado** (la categoría estudiantil sigue dependiendo del token de
  verificación de estudiante).

Cambiar el correo lo hace el staff (`PUT /participants/:id`, con aviso al anterior). Con el mismo
correo (sin importar mayúsculas) se actualiza el celular como siempre. Una persona **nueva** con el
correo de otra sigue recibiendo `409 EMAIL_IN_USE`.

La respuesta `201` agrega dos campos (compatible hacia atrás):

```json
{ "success": true, "data": { "…": "…",
  "participante": { "…": "…", "correo": "a***@g***.com", "celular": "*********" },
  "esCorreoVerificado": false,
  "correoConservado": true, "correoEnmascarado": "a***@g***.com" } }
```

- `correoConservado: false` → `correoEnmascarado: null` y el contacto sale completo, como antes.
- Con `correoConservado: true` el correo sale enmascarado y el celular oculto por completo (quien
  envía el formulario pudo ser cualquiera que conozca el documento): en el sitio en
  `data.participante.correo|celular`; en la legacy en `data.usuario.correoElectronico|celular`.
- Mensaje sugerido para la landing: «Ya estabas registrado con {correoEnmascarado}; tu inscripción
  y tu credencial llegarán a ese correo. Si ya no lo usas, escribe a la organización para
  cambiarlo».

## Compatibilidad y despliegue

- Todo lo nuevo son claves o rutas agregadas: el panel de la spec 013 y la landing actual siguen
  funcionando.
- El escáner del panel anterior solo entiende el QR anterior (id). Las credenciales que el backend
  014 aprueba, reenvía o deja descargar llevan el código nuevo: **desplegar primero (o a la vez) el
  panel 009**, nunca el backend 014 solo.
- Panel 009: con el texto leído sin espacios ni saltos de línea, enviar `{ codigo }` si cumple
  `/^[0-9A-Za-z]{10}$/` y `{ participanteId }` si es el anterior (`/^\d+$/`, que nunca llega a 10
  dígitos); mostrar en ámbar `alerta === "QR_LEGADO"`; pedir la foto con
  `GET /inscriptions/:id/photo`.
- Tras una vuelta atrás a la imagen anterior (o un despliegue con solapamiento), correr
  `prisma/preflight/marcar-qr-legado-014.sql`: la imagen anterior imprime el QR anterior también
  en inscripciones que ya tienen código.
