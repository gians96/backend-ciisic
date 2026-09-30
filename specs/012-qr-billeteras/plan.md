# Implementation Plan: Imagen del QR de las billeteras

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-qr.md](contracts/api-qr.md)

- `src/core/almacenamiento.ts`: `DIRECTORIO_QR` (`uploads/qr`), `MAX_BYTES_QR` (2 MB) y
  `REGEX_ARCHIVO_QR`.
- `src/api/payment-qr/`: `upload.ts` (multer en memoria, solo PNG/JPG/WebP),
  `services/payment-qr.ts` (tipo real por la firma, guardado como `qr-<uuid>`, rutas, `qrsDe`,
  `verificarQrs`, `limpiarQrs`), controlador y rutas (administración y sitio).
- `src/api/event`: `qrArchivo` en la validación de billeteras; `crearEvento` y `actualizarEvento`
  verifican los QR; `actualizarEvento` y `eliminarEvento` borran los que dejaron de usarse.
- Panel (spec 003 del panel): `CampoQr.vue` con arrastrar y soltar y vista previa por su BFF.
- Landing (spec 001 de la landing): ruta `GET /api/publico/qr/:archivo` del BFF y `urlQrBilletera`.

## Pruebas

`tests/payment-qr/payment-qr.test.ts`: tipos permitidos, contenido falso, tamaño, sesión, nombres
ajenos, QR de otro evento, QR inexistente al guardar, borrado del QR reemplazado y conservación
si otro evento lo usa.
