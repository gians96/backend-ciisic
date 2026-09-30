# Tasks: Imagen del QR de las billeteras

- [x] T001 Constantes de almacenamiento (`uploads/qr`, 2 MB, formato del nombre)
- [x] T002 `POST /v1/payment-qr` con validación de tipo, firma y tamaño
- [x] T003 `GET /v1/payment-qr/:archivo` (admin) y `GET /v1/site/payment-qr/:archivo` (solo QR del evento)
- [x] T004 `qrArchivo` en `datosPago`: verificación al guardar y limpieza al reemplazar o eliminar
- [x] T005 Pruebas
- [x] T006 Panel: campo con arrastrar y soltar y vista previa (spec 003 del panel)
- [x] T007 Landing: ruta del BFF y uso de `qrArchivo` (spec 001 de la landing)
- [x] T008 Prueba integrada local (panel → backend → landing), 2026-09-30
