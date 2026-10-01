# Feature Specification: Certificados (plantillas PDF, emisión, firma externa, portal y verificación)

**Feature Branch**: `feat/certificados`
**Created**: 2026-10-01
**Status**: En implementación (backend listo; faltan la matriz de rutas, el panel 010, la prueba de firma real y el despliegue después del 30-oct)
**Input**: "Se pueden generar manualmente, elegir un diseño, quizás poner todo el PDF del diseño donde poner el nombre y el tipo del rol PARTICIPANTE/ORGANIZADOR/PONENTE y entre otros; se descargará masivamente o individual, porque estos serán firmados digitalmente; también debes permitir tener un apartado para poder editar el pdf en el sistema como un template y generar masivamente para descargarse y subirse manualmente masivamente, y tener los certificados preparados y otros firmados completamente; y cuando se generen los certificados vamos a usar una API para obtener el código del certificado (certificados.undc.edu.pe) ... lo podemos dejar como pendiente."

Decisiones: cada evento tiene una o varias **plantillas**: un PDF de diseño (1–2 páginas, ≤5 MB) con
campos ubicados en el sistema (nombre, tipo, código, QR, fecha, horas, evento, documento, detalle y
textos con marcadores) y una vista previa real. Se emite un certificado por persona, **tipo**
(PARTICIPANTE, ORGANIZADOR, PONENTE y los que se agreguen) y ponencia, con un **código fijo y
aleatorio** (`CIISIC-2026-000123-7KQ2XM`) asignado antes de firmar. Los PDF se generan con `pdf-lib`
en tandas síncronas de 10, se descargan (uno o en ZIP) para firmarlos fuera del sistema (FirmaPerú o
ReFirma) y los firmados se suben en tandas; solo se acepta el PDF generado vigente. El participante
ve y descarga en su portal **solo los firmados**, y cualquiera verifica un certificado con el QR en
una familia pública nueva (`/api/v1/public/*`, enmienda de los principios III y IV de la
constitución). El código de la UNDC (certificados.undc.edu.pe) queda **pendiente**: el proveedor
LOCAL funciona ya y el adaptador UNDC responde 501. La configuración va en columnas `certificados_*`
de `configuracion_sistema` (las credenciales UNDC solo para el Owner). Sin variables de entorno ni
procesos en segundo plano. Se despliega después del VIII CIISIC (26–30 oct 2026). Diseño y revisión
adversarial: [research.md](research.md) (su cabecera de reconciliación manda sobre el cuerpo).

## User Scenarios & Testing

### User Story 1 - Preparar la plantilla de un evento (Priority: P1)

**Acceptance Scenarios**:

1. **Given** el diseño del certificado en PDF (A4, ≤5 MB), **When** lo subo como plantilla del VIII,
   **Then** queda con sus páginas y medidas, y puedo ubicar los campos (nombre centrado, tipo, texto
   con `{evento}` y `{horas}`, código y QR) con fuente, tamaño, color, alineación y capitalización.
2. **When** pido la vista previa, **Then** recibo el PDF estampado con datos de ejemplo (con tildes y
   ñ) y los avisos (texto que desborda, carácter sin glifo en la fuente, página inexistente).
3. Un PDF cifrado, rotado, de más de 2 páginas o que no es PDF → `422`; más de 5 MB → `413`. Un campo
   mal formado → `422 INVALID_TEMPLATE_FIELDS` con todos los errores de una vez (`campos[i].prop`).
4. Si otra persona guardó la plantilla desde que la abrí → `409 TEMPLATE_CHANGED`. Una plantilla con
   certificados no se borra (`409 TEMPLATE_IN_USE`): se desactiva.

### User Story 2 - Emitir certificados (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una plantilla activa del evento y el tipo PARTICIPANTE, **When** simulo la emisión desde
   los inscritos aprobados con 60 % de asistencia mínima, **Then** veo cuántos se crearían, cuántos ya
   tienen certificado y cuántos quedan fuera (las asistencias anuladas no cuentan); al confirmar se
   crean en PENDIENTE con su código.
2. **When** emito a un organizador o ponente que no está registrado, **Then** se registra con su DNI
   (nombres de RENIEC) y su **correo obligatorio**; si ya existía con otro correo, se conserva el
   registrado y se avisa.
3. **When** cargo una lista (DNI, correo, detalle, horas), **Then** la simulo y emito fila por fila:
   cada fila sale CREADO, YA_EMITIDO o ERROR con su motivo, sin que una fila mala bloquee las demás.
4. Repetir una emisión no duplica (`409 CERTIFICATE_EXISTS` en la individual; YA_EMITIDO en bloque).
   Dos certificados PONENTE de la misma persona se distinguen por la ponencia.
5. Sin plantilla, con una de otro evento o inactiva, o con un tipo inactivo → `422`.

### User Story 3 - Generar los PDF (Priority: P1)

**Acceptance Scenarios**:

1. **When** genero los pendientes, **Then** el panel pide tandas de 10 hasta terminar y cada
   certificado pasa a PREPARADO con su PDF (nombre, tipo, código impreso y QR con
   `<url_panel>/verificar/<código>`).
2. Repetir la generación no cambia los ya generados; un firmado nunca se regenera.
3. Sin URL del panel en Sistema → `422 VERIFICATION_URL_NOT_CONFIGURED`. La URL y el código impreso
   se congelan al generar: cambiar luego la URL del panel no altera lo impreso.

### User Story 4 - Descargar para firmar (Priority: P1)

**Acceptance Scenarios**:

1. **Given** el proveedor del código confirmado, **When** descargo para firmar, **Then** recibo un ZIP
   (por partes de hasta 500) con `<código>.pdf` y `manifiesto.csv`, o el PDF de uno solo.
2. Sin confirmar el proveedor → `409 PROVIDER_NOT_CONFIRMED` (no se firma un código que luego haya
   que cambiar por el de la UNDC).
3. Editar un certificado ya descargado para firmar pide confirmación (`409 CERTIFICATE_SENT_TO_SIGN`).

### User Story 5 - Subir los firmados (Priority: P1)

**Acceptance Scenarios**:

1. **When** subo los PDF firmados (o un ZIP que el panel abre en el navegador) en tandas de ≤10 MB,
   **Then** cada archivo se empareja por el código de su nombre (aunque la herramienta agregue `[R]` o
   `_firmado`) y el reporte dice FIRMADO, PARCIAL, NO_COINCIDE, NO_ENCONTRADO, etc.
2. Solo se acepta el PDF generado vigente de ese certificado (prefijo de bytes o `Subject`
   `ciisic:<código>:<generación>`); el de otra persona o de una versión anterior se rechaza
   (`SIGNED_MISMATCH`). Solo quien gestiona puede forzar uno, con motivo registrado.
3. Con las firmas requeridas por la plantilla queda FIRMADO; con menos, EN_FIRMA. Volver a subir el
   mismo archivo no cambia nada.

### User Story 6 - El participante descarga su certificado (Priority: P1)

**Acceptance Scenarios**:

1. **Given** un certificado FIRMADO, **When** entro a mi portal (Google o código por correo), **Then**
   lo veo y descargo; los que están en preparación o anulados no aparecen.
2. Un certificado de otra persona o no firmado → `404`.
3. El staff que también es participante llega a sus certificados con el cambio al portal de la spec
   014 (`POST /v1/auth/participant/switch`) o con el código por correo.

### User Story 7 - Cualquiera verifica un certificado (Priority: P1)

**Acceptance Scenarios**:

1. **When** escaneo el QR (o escribo el código), **Then** veo si es VALIDO o ANULADO, el titular, el
   tipo, el evento, la fecha y las horas; nunca el documento, el correo ni el PDF.
2. Un código mal escrito (O por 0, minúsculas) se corrige; uno con otro formato → `404` sin consultar
   la BD. Un certificado que aún no está firmado responde igual que uno inexistente.
3. Más de 30 consultas por minuto desde una IP (o 1200 en total) → `429`.

### User Story 8 - Corregir, quitar un firmado y anular (Priority: P2)

**Acceptance Scenarios**:

1. Puedo corregir el nombre impreso, el detalle, las horas, la plantilla o la fecha de un certificado
   PENDIENTE o PREPARADO: vuelve a PENDIENTE y conserva su código.
2. Puedo quitar un firmado equivocado (vuelve a PREPARADO) y anular un certificado con motivo: sale
   del portal, la verificación lo muestra ANULADO y se puede volver a emitir con otro código.
3. Un PENDIENTE que nunca se generó se puede borrar; los demás se anulan.

### User Story 9 - Tipos, proveedor y permisos (Priority: P2)

**Acceptance Scenarios**:

1. Agrego tipos (p. ej. `MODERADOR`, «Moderador») con su texto impreso; no se borran, se desactivan.
2. Confirmo el proveedor LOCAL y elijo el prefijo; el prefijo se bloquea en cuanto hay un PDF
   generado (`409 CERTIFICATE_SETTINGS_LOCKED`). El Owner guarda en Sistema las credenciales de la API
   UNDC (secreto cifrado); probarla, o confirmar el proveedor UNDC, responde `501` hasta tener la API.
3. A una cuenta de la Comisión le puedo dar «Ver certificados» u «Operar» (generar, descargar para
   firmar, subir firmados), nunca marcados por defecto; el Tesorero solo ve. Emitir, anular,
   plantillas y proveedor son de Owner y Administrador.

## Requirements

- **FR-001**: Tablas `tipos_certificado`, `plantillas_certificado` y `certificados` y columnas
  `certificados_*` en `configuracion_sistema` (migración aditiva `20261001150000_certificados`, con
  los tipos PARTICIPANTE, ORGANIZADOR y PONENTE y el CHECK `ck_certificados_clave_vigente`: solo un
  ANULADO tiene la clave vigente en NULL).
- **FR-002**: Permisos `certificados.gestionar` (G), `certificados.operar` y `certificados.ver` (E),
  con `operar → ver`; `ver` y `operar` elegibles para la Comisión y nunca preseleccionados; Tesorero
  con `ver`. Resolutores `eventoDeCertificado` y `eventoDePlantilla` (fallan cerrados).
- **FR-003**: Código `<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>` (prefijo configurable `^[A-Z0-9]{2,20}$`, año
  del evento, correlativo por evento con `max+1` y hasta 5 reintentos ante colisión, 30 bits
  aleatorios en Crockford), asignado al emitir y fijo. Adaptador `ProveedorCodigoCertificado`
  (`resolverImpresion`, `registrar`, `probarConexion`): LOCAL imprime el mismo código; UNDC responde
  `501 CERTIFICATE_PROVIDER_PENDING`.
- **FR-004**: Configuración (`certificados.gestionar`): proveedor, prefijo (bloqueado con PDF
  generados) y «proveedor confirmado» (cambiar proveedor o prefijo lo desconfirma). La URL de
  verificación no se guarda: es `<url_panel>/verificar/<código>` y se congela en cada certificado al
  generarlo. Credenciales UNDC solo en `/v1/settings` (Owner), con el secreto cifrado y URL https
  anti-SSRF.
- **FR-005**: Plantillas por evento: diseño PDF validado (firma de bytes, 1–2 páginas, ≤5 MB, sin
  cifrar ni rotar) guardado como `plantilla-<uuid>.pdf`; hasta 30 campos validados y normalizados;
  versión que sube al cambiar campos o diseño; control de edición simultánea; vista previa con avisos
  en `X-Avisos` (`encodeURIComponent(JSON)`), 30/min por cuenta y 2 a la vez.
- **FR-006**: Motor PDF (`pdf-lib` + `@pdf-lib/fontkit`): 14 fuentes TTF incluidas (OFL y DejaVu, con
  sus licencias), subconjunto con respaldo a la fuente completa, respaldo por glifo en DejaVu Sans con
  aviso, texto en caja (alineación, reducción, varias líneas), QR vectorial, `Subject`
  `ciisic:<código>:<generación>` y guardado sin flujos de objetos.
- **FR-007**: Emisión (`certificados.gestionar`) con plantilla obligatoria (del evento y activa) y
  tipo activo: individual (participante existente o persona nueva con correo obligatorio vía
  `crearParticipante` de la spec 014), desde inscritos APROBADOS (filtro por tipo de inscripción y
  asistencia mínima sin anuladas, con simulación) y por lista (≤300 filas, ≤50 consultas DNI, resultado
  por fila y simulación). Idempotente por `clave_vigente` (evento, participante, tipo, ponencia).
- **FR-008**: Generación (`certificados.operar`): síncrona, ≤10 por solicitud, reanudable con cursor,
  idempotente, con `setImmediate` entre certificados, actualización optimista (el archivo perdedor se
  borra), 2 tandas a la vez por proceso (`503 GENERATION_BUSY`); un firmado nunca se regenera.
- **FR-009**: Descargas: firmado individual (`ver`); para firmar, individual o ZIP (`operar`), solo con
  el proveedor confirmado (`409 PROVIDER_NOT_CONFIRMED`) y marcando `descargado_para_firmar_en`; ZIP en
  flujo (`yazl`) por partes ≤500 con `manifiesto.csv` (documento solo con `gestionar`).
- **FR-010**: Carga de firmados (`operar`): tandas de ≤10 PDF de ≤10 MB y ≤25 MB por solicitud
  (`Content-Length` obligatorio; 2 cargas a la vez por proceso), emparejamiento por código del
  nombre, `codigoExterno` o `Subject`; solo cuentan las firmas que **verifican** (CMS) en campos
  `/Sig` del AcroForm, sin sellos de tiempo; se acepta solo el generado vigente con firmas agregadas
  (prefijo SHA-256) sin cambios en lo generado ni contenido activo; un PDF reescrito (METADATOS), uno
  que no coincide o uno con cambios solo entra forzado (`gestionar`, con motivo auditado);
  EN_FIRMA/FIRMADO según `firmas_requeridas` (bajarlas promueve los EN_FIRMA que ya alcanzan);
  reemplazar un FIRMADO es de `gestionar`; un EN_FIRMA solo se reemplaza por uno que lo continúe o
  tenga más firmas; el firmado anterior se archiva; idempotente.
- **FR-011**: Edición (vuelve a PENDIENTE; `CERTIFICATE_LOCKED` en EN_FIRMA, FIRMADO o ANULADO;
  confirmación si ya se descargó para firmar), borrado solo de un PENDIENTE nunca generado, quitar el
  firmado y anulación con motivo (libera la clave vigente y conserva los archivos).
- **FR-012**: Portal: `GET /v1/me/certificates` (solo FIRMADO propios) y `GET /v1/me/certificates/:id/file`
  (solo el firmado propio; `404` en otro caso).
- **FR-013**: Verificación pública `GET /v1/public/certificates/:codigo`: familia nueva `/v1/public`,
  límite por IP (30/min) y tope global de códigos inexistentes (1200/min; los reales siempre
  responden), formato inválido → `404` sin BD, solo FIRMADO (`VALIDO`)
  o ANULADO; titular, tipo, evento, fechas y horas, nunca documento, correo, motivo ni PDF;
  `Cache-Control: no-store`.
- **FR-014**: Archivos en `uploads/certificados/plantillas/` y `uploads/certificados/<eventoId>/{generados,firmados}/`
  (carpeta por id del evento, que no cambia), nombres generados por el servidor, rutas solo desde
  `almacenamiento.ts`, escritura atómica (`.tmp` + `fsync` + `rename`).
- **FR-015**: Borrar un evento con certificados → `409 EVENT_HAS_INSCRIPTIONS` (sus plantillas se
  borran con él); borrar una inscripción con un certificado vigente → `409 INSCRIPTION_HAS_CERTIFICATE`.
- **FR-016**: Constitución 1.4.0: principios III y IV admiten la familia `/api/v1/public/*` para
  verificaciones con código no adivinable, sin documento y con límites.

## Success Criteria

- **SC-001**: Sin variables de entorno nuevas ni procesos en segundo plano; el secreto UNDC se cifra
  con la clave derivada de `JWT_SECRET`.
- **SC-002**: Un PDF firmado de otra persona o de una versión anterior nunca queda FIRMADO (salvo
  forzado individual auditado por `certificados.gestionar`).
- **SC-003**: La verificación pública no expone documento, correo ni archivo, y no distingue un
  certificado sin firmar de uno inexistente.
- **SC-004**: Toda ruta nueva tiene su prueba de acceso denegado (401 sin token, 403 con el perfil o
  permiso equivocado) y está clasificada en `tests/security/matriz-rutas.test.ts`.
- **SC-005**: Ensayo de la migración sobre una copia del respaldo: conteos sin cambios, CHECK activo,
  `revertir-015.sql` repetible y `prisma migrate diff` vacío.
- **SC-006**: Cada fuente del catálogo conserva el contorno de todos sus glifos al embeberse (prueba
  automática); el QR del PDF de muestra se lee con la URL esperada.

## Limitaciones

- **API UNDC pendiente**: sin acceso a certificados.undc.edu.pe, el proveedor UNDC responde `501`, no
  hay `register-external` ni prueba de conexión real, y la verificación pública busca solo por el
  código local (no por `codigoExterno`). Con el proveedor UNDC, el `501` solo salta para certificados
  sin código impreso: uno ya generado y editado se regenera con su código congelado.
- **Prefijo**: el código se asigna al emitir. El prefijo se bloquea en cuanto un código queda en un
  PDF; los PENDIENTE emitidos antes de un cambio de prefijo conservan el anterior (se informan en
  `certificadosConOtroPrefijo`). Decisión abierta: bloquear con cualquier certificado o reasignar el
  código de los nunca generados.
- La generación y la carga ocupan la CPU del proceso (pdf-lib es síncrono): tandas de 10, `setImmediate`
  entre certificados y 2 tandas a la vez. Si se mide lento con diseños pesados, `worker_threads`.
- Los firmados no se pueden reponer: el volumen `uploads/certificados` se respalda tras cada carga.
- Las firmas se verifican criptográficamente, pero **no** se encadenan a una raíz de confianza
  (RENIEC, FirmaPerú): alguien con `operar` y un certificado propio podría firmar un generado vigente
  con un recuadro visible que tape el contenido. Mitigación: los `firmantes` (nombre, emisor,
  vigencia) se guardan y se muestran para revisarlos. Pendiente: lista de emisores de confianza.
- Un PDF que la herramienta de firma reescribe (no incremental) no se puede comprobar: solo entra
  forzado, uno por uno. Lo confirma la prueba F0 con FirmaPerú o ReFirma (T020).
- El documento se enmascara en las respuestas JSON, no en los PDF: si la plantilla tiene un campo
  `DOCUMENTO`, el generado, el ZIP para firmar y el firmado lo llevan completo (es parte del
  certificado). `ver` y `operar` se dan solo a quien puede ver el documento.
- Un ANULADO que nunca se firmó también responde `ANULADO` en la verificación (sin `firmadoEn`).
- `X-Avisos*` y `X-Zip-*` no están en `exposedHeaders` de CORS: el panel las lee desde su BFF.
- Los límites por IP y el tope global de la verificación, la cola de generación y el turno de las
  cargas de firmados viven en la memoria del proceso (una réplica). El límite por IP depende de que
  el BFF del panel reenvíe la IP real.
- Sin correo de aviso al quedar FIRMADO, sin fuentes subidas por el administrador y sin purga de los
  generados (fase opcional, ver research §7).
