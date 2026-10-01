# Contrato — Portal del inscrito v2 (amplía la spec 011)

Base `/api/v1`. `Authorization: Bearer <jwt de participante>` (audiencia `ciisic-participante`,
12 h, con Google o con código: ver [api-acceso-codigo.md](api-acceso-codigo.md)). Toda respuesta
lleva `Cache-Control: private, no-store`; las de datos son `{ "success": true, "data": … }`. Sin
token → `401 MISSING_TOKEN`; token de staff → `403 FORBIDDEN`; correo cambiado por el staff →
`401 SESSION_INVALIDATED`; `:id` no numérico → `400 INVALID_ID`.

| Método | Ruta | Guardas | Respuesta (`data`) |
|---|---|---|---|
| GET | `/me` | `requireParticipante`, `limitePortal` (60/min) | Perfil (abajo) |
| PATCH | `/me/profile` | ídem + `validateBody` | Perfil |
| GET | `/me/inscriptions` | ídem | Lista v1 + `fotocheck: { disponible }` |
| GET | `/me/inscriptions/:id/badge` | ídem | Fotocheck (abajo) |
| GET | `/me/inscriptions/:id/credential` | `requireParticipante`, `limiteCredencialPortal` (10/min) | PDF (`attachment; filename="credencial-<evento>-<id>.pdf"`) |
| GET | `/me/attendances` | `requireParticipante`, `limitePortal` | Asistencia por evento (abajo) |
| PUT | `/me/photo` | `requireParticipante`, `limiteFotoPortal` (10/h), `fotoUpload.single('file')` | `{ foto: { tiene: true, actualizadaEn } }` |
| GET | `/me/photo` | `requireParticipante`, `limitePortal` | Imagen `image/png` o `image/jpeg`, `inline` |
| DELETE | `/me/photo` | ídem | `{ foto: { tiene: false } }` (repetirlo no falla) |

## GET `/me`

```json
{ "id": 29, "nombres": "ANA", "apellidos": "PÉREZ GARCÍA", "correo": "ana@gmail.com", "tipoDocumento": "dni", "numeroDocumento": "70001234",
  "celular": "987654321", "foto": { "tiene": true, "actualizadaEn": "2026-10-20T15:00:00.000Z" }, "google": { "vinculado": false } }
```

`foto.actualizadaEn` es `null` sin foto. `404 PARTICIPANT_NOT_FOUND` si el registro ya no existe.

## PATCH `/me/profile`

```json
{ "celular": "+51987654321" }
```

Solo el celular (`/^\+?\d{9,15}$/`, recortado); los demás campos se ignoran (nombres, documento y
correo son la identidad y la llave de la sesión). Responde el perfil. `422 VALIDATION_ERROR`.

## GET `/me/inscriptions`

Igual que en la spec 011, con `fotocheck: { disponible }` en cada elemento (`true` solo si está
`APROBADO`).

## GET `/me/inscriptions/:id/badge`

```json
{ "inscripcionId": 500, "codigo": "K7Q2M9X4TB", "qr": "data:image/png;base64,…",
  "evento": { "nombre": "VIII Congreso Internacional …", "nombreCorto": "VIII CIISIC 2026", "fechaInicio": "2026-10-26", "fechaFin": "2026-10-30", "sede": "…" },
  "participante": { "nombres": "ANA", "apellidos": "PÉREZ GARCÍA", "tipoDocumento": "dni", "documentoEnmascarado": "****1234" },
  "tipoInscripcion": { "nombre": "ESTUDIANTES", "etiqueta": "CON KIT" },
  "foto": { "tiene": true } }
```

- El QR (PNG de 480 px, corrección M) codifica **solo** el código de 10 caracteres: sin URL ni
  datos personales. Si la inscripción no tenía código (creada por la imagen anterior), se le asigna
  y, si ya estaba aprobada o se le envió la credencial, se marca como QR anterior.
- `tipoInscripcion` puede ser `null`. La foto se pide con `GET /me/photo`.
- El panel puede guardar el último fotocheck en el dispositivo para mostrarlo sin conexión (y
  borrarlo al cerrar sesión).

| Estado | Código | Cuándo |
|---|---|---|
| 404 | `INSCRIPTION_NOT_FOUND` | No existe o es de otra persona |
| 409 | `NOT_APPROVED` | La inscripción no está aprobada |

## GET `/me/inscriptions/:id/credential`

Misma ruta y errores que en la spec 011 (`404 INSCRIPTION_NOT_FOUND`, `409 NOT_APPROVED`). El PDF
lleva ahora el QR del código, el código impreso y la foto. Además: `503 PDF_BUSY` si hay demasiadas
credenciales generándose (reintentar en unos segundos).

## GET `/me/attendances`

Solo eventos con la inscripción `APROBADO`, del más reciente al más antiguo; todas las actividades
del evento (por fecha y hora) y si asistió. Las marcas anuladas no cuentan.

```json
[ { "evento": { "id": 2, "nombre": "…", "nombreCorto": "VIII CIISIC 2026" }, "totalActividades": 3, "asistidas": 1,
    "actividades": [
      { "id": 10, "nombre": "Inauguración", "fecha": "2026-10-26", "horaInicio": "09:00", "horaFin": "10:30", "asistio": true, "registradoEn": "2026-10-26T14:05:00.000Z" },
      { "id": 11, "nombre": "Taller", "fecha": "2026-10-27", "horaInicio": "15:00", "horaFin": "17:00", "asistio": false, "registradoEn": null } ] } ]
```

Horas en hora de Lima (`HH:mm`).

## Foto: PUT, GET y DELETE `/me/photo`

`PUT` en `multipart/form-data` con **solo** dos partes: `file` (JPG o PNG, hasta 2 MB) y
`consentimiento=true` (Ley 29733: acepta el uso de la foto en su fotocheck).

- Se revisa el tipo real por la firma de bytes (debe coincidir con el declarado) y la estructura, y
  se deja solo lo necesario para decodificar la imagen: JPEG con un único SOFn, tablas (DQT, DHT,
  DAC, DRI) y escaneos (hasta 64), sin ningún APPn (tampoco APP0/JFIF, que puede traer una
  miniatura), comentarios ni marcadores desconocidos; PNG con IHDR primero, el CRC correcto en cada
  chunk y solo `IHDR`, `PLTE`, `IDAT`, `IEND`, `tRNS`, `gAMA`, `cHRM`, `sRGB`, `sBIT`, `bKGD` y `pHYs`
  (fuera texto, EXIF, fecha, perfiles ICC, animación APNG y chunks privados); en ambos, nada después
  del fin de la imagen. Las dimensiones declaradas no pueden pasar de **4096 px por lado** (una
  imagen de pocos KB puede declarar 25 000 × 25 000 y ocupar gigabytes al decodificarla en el PDF o
  en el celular del escáner). Se guarda con un nombre nuevo del servidor
  (`uploads/fotos/foto-<uuid>.png|jpg`, nunca sobrescribe).
- Cambiar o quitar la foto borra la anterior del disco y los PDF de credencial guardados del
  participante (se regeneran al pedirlos). Si falla la BD, el archivo nuevo se borra.
- **Panel**: recodificar y reducir la imagen con canvas antes de subirla (por ejemplo, a 1200 px
  por el lado mayor; quitar los metadatos también quita la orientación EXIF) y mostrar la casilla
  de consentimiento.

| Estado | Código | Cuándo |
|---|---|---|
| 422 | `FILE_REQUIRED` | Sin `file` |
| 422 | `CONSENT_REQUIRED` | `consentimiento` distinto de `"true"` |
| 422 | `INVALID_FILE_TYPE` | Tipo declarado distinto de `image/png` o `image/jpeg` |
| 422 | `INVALID_FILE_CONTENT` | Los bytes no son PNG/JPEG, no coinciden con el tipo declarado o la imagen está dañada (estructura, CRC, sin datos, dimensiones en 0) |
| 422 | `IMAGE_TOO_LARGE` | La imagen declara más de 4096 px por lado |
| 413 | `UPLOAD_LIMIT_EXCEEDED` | Más de 2 MB |
| 400 | `UPLOAD_INVALID` | Partes adicionales a `file` y `consentimiento` |
| 409 | `PHOTO_CONFLICT` | La foto cambió desde otra ventana tres veces seguidas |
| 429 | `RATE_LIMITED` | Más de 10 cambios por hora |
| 404 | `PHOTO_NOT_FOUND` | `GET` sin foto (o el archivo ya no está) |

```json
{ "success": false, "code": "CONSENT_REQUIRED", "message": "Debes aceptar el uso de tu foto en el fotocheck.", "fields": { "consentimiento": "Acepta el uso de tu foto" } }
```

## Certificados

`GET /me/certificates` y `/me/certificates/:id/file` son de la spec 015 (solo los firmados).
