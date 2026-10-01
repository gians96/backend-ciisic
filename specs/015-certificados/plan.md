# Implementation Plan: Certificados (plantillas PDF, emisión, firma externa, portal y verificación)

**Spec**: [spec.md](spec.md) | **Contrato**: [api-certificados.md](contracts/api-certificados.md) | **Diseño**: [research.md](research.md)

- Núcleo:
  - `src/core/permisos.ts`: `certificados.ver` y `certificados.operar` en
    `PERMISOS_ELEGIBLES_COMISION` (con etiquetas; nunca en los permisos por defecto).
  - `src/core/resolutores-evento.ts`: `eventoDeCertificado` y `eventoDePlantilla` (`idParam`, fallan
    cerrados).
  - `src/core/configuracion-sistema.ts`: columnas `certificados_*` en la configuración vigente (misma
    caché de 30 s), `configuracionCertificados()` (`baseVerificacion` = `<url_panel>/verificar`),
    `urlVerificacionCertificado()` (`422 VERIFICATION_URL_NOT_CONFIGURED`) y
    `credencialesUndcCertificados()` (descifra el secreto).
  - `src/core/almacenamiento.ts`: `DIRECTORIO_CERTIFICADOS`, `DIRECTORIO_PLANTILLAS_CERTIFICADO`,
    límites (`MAX_BYTES_PLANTILLA` 5 MB, `MAX_BYTES_PDF_FIRMADO` 10 MB, `MAX_BYTES_CARGA_FIRMADOS`
    25 MB, `MAX_ARCHIVOS_CARGA_FIRMADOS` 10), nombres (`nuevoNombrePlantilla`, `nombreArchivoGenerado`,
    `nuevoNombreFirmado`), rutas que validan el nombre (`rutaPlantilla`, `rutaCertificadoGenerado`,
    `rutaCertificadoFirmado`), `escribirArchivoAtomico` y `borrarArchivo`.
  - `src/core/pdf.ts`: `hasPdfSignature` (sale de `papers/upload.ts`, que lo reexporta).
- `src/middlewares/rate-limit.ts`: clave `'global'` (sin cabeceras `RateLimit-*`),
  `limiteCargaFirmados` (30/min por cuenta), `limiteVerificacionCertificado` (30/min por IP) y
  `topeDeFallos`/`topeFallosVerificacion` (1200 códigos inexistentes por minuto, en el servicio de
  verificación). `limiteVistaPrevia` (30/min por cuenta) vive en `routes/certificate-template.ts`.
- Corrección tras la revisión adversarial: `pdf/lector.ts` (lectura acotada con registro de objetos,
  cabeceras y xref sobre ganchos de pdf-lib), `pdf/cms.ts` (DER y CMS `SignedData`), `pdf/firmas.ts`
  (firmas que verifican, cambios después del generado, contenido activo), `turnoCargaFirmados`,
  `archivarFirmado` y columnas `bytes_firmado` y `firmantes`.
- Esquema y migración `20261001150000_certificados` (DDL de `migrate diff` + CHECK
  `ck_certificados_clave_vigente` + tipos sembrados); enums `EstadoCertificado`,
  `CoincidenciaFirmado`, `EstadoRegistroExterno` y `ProveedorCertificados`;
  `prisma/preflight/revertir-015.sql` (P3009, repetible).
- `src/api/certificate/` (nuevo):
  - `pdf/`: `estampar.ts` (diseño + campos, `Subject`, título, guardado sin flujos de objetos,
    respaldo `FUENTE_SIN_SUBCONJUNTO`), `texto.ts` (ajuste en caja, capitalización, marcadores,
    fechas), `qr.ts` (QR vectorial), `fuentes.ts` (catálogo de 14 fuentes y caché),
    `firmas.ts` (`contarFirmas`, `verificarCoincidencia`, `analizarFirmado`, `identidadDeSubject`),
    `validar-diseno.ts`, `tipos.ts`; `pdf/fuentes/` (TTF + `OFL-*.txt` + `LICENSE-DejaVu.txt`).
  - `codigos/`: `codigo.ts` (formato, Crockford, `normalizarCodigo`, `extraerCodigo`,
    `nuevaGeneracion`, `claveVigente`, `crearConNumeroYCodigo` con reintento), `proveedor.ts`
    (`ProveedorCodigoCertificado`, `proveedorActivo`, `exigirProveedorConfirmado`), `local.ts` y
    `undc.ts` (501).
  - `services/`: `tipos.ts`, `configuracion.ts`, `plantillas.ts` (con vista previa limitada a 2 a la
    vez), `certificados.ts` (listado, detalle, edición, borrado), `destinatarios.ts` (individual,
    desde inscritos, por lista; reutiliza `crearParticipante` de la spec 014 y la caché DNI),
    `generacion.ts` (tandas con `limitarConcurrencia(2, 4)` y `setImmediate`), `descargas.ts` (archivo
    y ZIP con `yazl`, manifiesto con `celdaCsv`), `firmados.ts` (carga por tandas, reemplazo, quitar,
    anular), `verificacion.ts`, `archivos.ts`.
  - `routes/`: `certificate-template.ts` (tipos, fuentes, plantillas), `certificate-settings.ts`,
    `certificate.ts` (emisión, listado, generación, descargas), `certificate-signed.ts` (firmados y
    anulación) y `public-certificate.ts` (`/v1/public/certificates/:codigo`); con sus `controllers/`,
    `validation/` y las subidas `upload-plantilla.ts` y `upload-firmados.ts` (en memoria,
    `limiteContenido` → 411/413).
- `src/api/system-settings`: `certificadosUndc` en `GET /v1/settings`, credenciales en el PUT (URL
  https anti-SSRF, secreto cifrado de solo escritura) y `POST /v1/settings/certificados-undc/test`
  (501).
- `src/api/participant-portal`: `GET /v1/me/certificates` y `/v1/me/certificates/:id/file` (solo
  FIRMADO propios, `leerArchivoServido`).
- `src/api/event/services/event.ts` (409 con certificados; borra plantillas y diseños) y
  `src/api/inscription/services/inscription.ts` (`409 INSCRIPTION_HAS_CERTIFICATE`).
- Dependencias: `pdf-lib`, `@pdf-lib/fontkit`, `yazl` (+ `@types/yazl`). `Dockerfile`: `COPY` de
  `src/api/certificate/pdf/fuentes`.
- Constitución 1.4.0 (III y IV: familia `/api/v1/public/*`).
- Panel (spec 010 del panel): página Certificados (lista con KPIs, emitir, generar en tandas, ZIP
  para firmar, carga de firmados con `fflate`), editor visual de plantillas (pdf.js) con vista previa,
  tipos y configuración, «Mis certificados» en el portal y `/verificar/[codigo]` pública con BFF.

## Pruebas

- `tests/certificate/estampado.test.ts`: estampado con tildes y ñ, `Subject`, respaldo de glifos,
  caja (reducción, líneas, desborde), alineaciones, capitalización, marcadores y contornos de todos
  los glifos de cada fuente del catálogo.
- `tests/certificate/{qr,firmas,codigo}.test.ts`: QR comparado con la matriz (sin rasterizar);
  firmas simuladas (incremental, sello de tiempo, campo vacío, reescritura) y coincidencia por prefijo
  y por metadatos; formato del código, Crockford, normalización, `extraerCodigo`, reintentos y 501
  de UNDC.
- `tests/certificate/{tipos,configuracion,plantillas}.test.ts`: tipos (duplicado, código fijo),
  configuración (desconfirmar al cambiar, prefijo bloqueado, 501 UNDC, credenciales en Sistema solo
  Owner), plantillas (PDF cifrado, rotado, 3 páginas, no PDF, 413, campos con todos los errores,
  versión, `TEMPLATE_CHANGED`, `TEMPLATE_IN_USE`, diseño, vista previa con `X-Avisos`).
- `tests/certificate/{certificados,destinatarios,generacion,descargas}.test.ts`: acceso por rol,
  listado y filtros, documento enmascarado, edición y borrado, 409 al borrar eventos e
  inscripciones; emisión individual, desde inscritos (asistencia sin anuladas, idempotencia,
  carrera) y por lista (por fila, tope DNI, 300 filas); generación real (Subject y hash),
  idempotencia, 422/501, URL congelada, carrera optimista y cursor; descarga individual y ZIP leído
  entrada por entrada (manifiesto, inyección CSV, partes, archivo faltante, error a mitad).
- `tests/certificate/{firmados,verificacion,portal}.test.ts`: carga por tandas con todos los
  resultados, 411/413, forzar solo con `gestionar`, quitar y anular; verificación (formato inválido
  sin BD, 404 de los no firmados, sin documento, límites); portal solo FIRMADO propios.
- `tests/security/routes.test.ts`: 401 sin token en las rutas nuevas, `/v1/public` como pública
  intencional y token de participante en rutas del staff → 403. `tests/core/permisos.test.ts`:
  elegibles de la Comisión.
- Ajustes: mocks de `certificado.count` en `tests/event/event.test.ts`,
  `tests/inscription/admin.test.ts` y `tests/inscription/credencial.test.ts`.
- Pendiente (seguridad transversal): `tests/security/matriz-rutas.test.ts` con las 32 rutas nuevas
  (161 en total), `limiteVistaPrevia` y `limiteCargaFirmados` en los límites por cuenta, y las 4
  rutas con multer.
