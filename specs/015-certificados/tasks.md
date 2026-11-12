# Tasks · Spec 015 fase 1 (certificados firmados fuera del sistema)

## Backend
- [x] T001 Modelo `Certificado` + enum `EstadoCertificado` y migración `20261112120000_certificados` (`codigo` con `utf8mb4_bin`)
- [x] T002 Almacenamiento: `rutaCertificado`, `nuevoNombreCertificado`, `guardarAtomico` (`src/core/almacenamiento.ts`); `uploadCertificados` (`src/middlewares/upload.ts`)
- [x] T003 Código del nombre del PDF, DNI normalizado y conteo de firmas (`services/codigos.ts`)
- [x] T004 Lectura del Excel por encabezados (`services/lector-excel.ts`) e importación por DNI con simulación (`services/importacion.ts`)
- [x] T005 Listado con situación y resumen, pagados sin certificado, subida masiva y manual, anulación (`services/certificados.ts`)
- [x] T006 Envío por correo con reserva de marca y prueba (`services/envio.ts`, `templates/certificado.html` + `COPY` en el Dockerfile)
- [x] T007 Rutas públicas por DNI y por código, y portal `/v1/me/certificates` (`services/publico.ts`)
- [x] T008 Permisos: `certificados.ver` y `certificados.operar` elegibles para la Comisión; textos
- [x] T009 Pruebas: `tests/certificate/*` y matriz de rutas
- [ ] T010 Probar la migración contra un respaldo y `prisma migrate diff` vacío (requiere MySQL local)

## Panel (administrator-ciisic-frontend)
- [x] P001 Página `/certificados` (tarjetas, filtros, tabla, selección, envío por tandas, anular, prueba, subir uno)
- [x] P002 Diálogos `CertificadosImportar` y `CertificadosSubir`
- [x] P003 Páginas públicas `/consulta-certificados` y `/certificado/[codigo]` + proxys `server/api/publico/certificados/*`
- [x] P004 Menú, permisos y mensajes de error
- [ ] P005 Prueba en el navegador contra el backend local con el Excel y PDF reales
