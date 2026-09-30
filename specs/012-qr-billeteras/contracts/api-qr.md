# Contrato — Imagen del QR de las billeteras

## POST `/api/v1/payment-qr` (Admin)

`multipart/form-data` con un único campo `file` (PNG, JPG o WebP, hasta 2 MB).

- `201 { success: true, data: { archivo: "qr-<uuid>.png" } }`
- `422 INVALID_FILE_TYPE` (otro formato), `422 INVALID_FILE_CONTENT` (el contenido no es la imagen
  declarada), `422 FILE_REQUIRED`, `413 UPLOAD_LIMIT_EXCEEDED`, `401`/`403`.

La imagen no se publica hasta que se guarda en los datos de pago de un evento.

## Datos de pago (`PUT /api/v1/events/:id`, `POST /api/v1/events`)

- `datosPago.billeteras[]` acepta `qrArchivo` (el nombre que devolvió la subida); tiene prioridad
  sobre `qrUrl`.
- Archivo inexistente → `422 QR_NOT_FOUND`; nombre con otro formato → `422 VALIDATION_ERROR`.
- Al guardar se borran los QR que el evento dejó de usar, si ningún otro evento los usa.
- `GET /api/v1/site/event` devuelve `datosPago` tal cual, con `qrArchivo`.

## GET `/api/v1/payment-qr/:archivo` (Admin)

Vista previa en el panel. `Cache-Control: private, max-age=86400, immutable`.

## GET `/api/v1/site/payment-qr/:archivo` (token del evento)

Solo los QR que usa el evento del token; cualquier otro → `404 QR_NOT_FOUND`. `Content-Type`
`image/png`, `image/jpeg` o `image/webp`; `Cache-Control: public, max-age=86400, immutable`.
Límites de lectura por visitante y por token.
