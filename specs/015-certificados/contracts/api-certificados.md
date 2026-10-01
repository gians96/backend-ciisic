# Contrato — Certificados: plantillas, emisión, firma externa, portal y verificación

Base `/api/v1`. Respuestas `{ "success": true, "data": …, "meta"? }`; errores
`{ "success": false, "code", "message", "fields"? }`.

- **Staff**: `Authorization: Bearer <jwt>` con la guarda de la spec 013 (`requirePermiso`; la cuenta
  se lee de la BD en cada petición). Comunes: `401 SESSION_INVALIDATED`, `403 FORBIDDEN` (sin el
  permiso), `403 EVENT_NOT_ASSIGNED` (cuenta por evento fuera de sus eventos), `404 NOT_FOUND` (cuenta
  por evento y recurso inexistente: el resolutor falla cerrado), `400 INVALID_ID`.
- **Portal**: `Authorization: Bearer <jwt de participante>` (spec 014). Token de staff → `403 FORBIDDEN`.
- **Público**: `/api/v1/public/*`, sin token, con límite por IP y un tope global de códigos
  inexistentes (constitución 1.4.0).

## Permisos

| Permiso | Alcance | Quién | Qué permite |
|---|---|---|---|
| `certificados.gestionar` | Global (G) | Owner y Administrador del sistema | Tipos, fuentes, plantillas y vista previa, emitir, editar, borrar, reemplazar o quitar un firmado, anular, forzar un firmado, proveedor y prefijo |
| `certificados.operar` | Por evento (E) | Owner, Administrador y la Comisión que lo tenga marcado | Generar, descargar para firmar (individual o ZIP) y subir firmados |
| `certificados.ver` | Por evento (E) | Owner, Administrador, Tesorero (fijo) y la Comisión que lo tenga marcado | Listado, detalle y descarga individual del firmado (el ZIP, también el de firmados, es de `operar`); leer los tipos |

- `certificados.ver` y `certificados.operar` son **elegibles** para la Comisión y nunca vienen
  marcados (los PDF y el manifiesto pueden llevar el documento). `certificados.operar` implica
  `certificados.ver`. La Comisión nunca recibe `certificados.gestionar` (es global): esto reemplaza
  la línea «reservados: `certificados.ver`, `certificados.operar`» del contrato de la spec 013.
- Sin `certificados.gestionar` el documento sale enmascarado (`****5678`) en listados y detalle y el
  manifiesto del ZIP no lleva las columnas del documento. El enmascarado es **solo de las respuestas
  JSON**: si la plantilla tiene un campo `DOCUMENTO`, los PDF (generado, ZIP para firmar y firmado)
  llevan el documento completo, porque es parte del certificado que se entrega al titular. Dar `ver`
  u `operar` solo a quien puede ver el documento.
- Las credenciales de la API de certificados de la UNDC son de **Sistema** (`sistema.configurar`,
  solo Owner).
- Resolutores (`src/core/resolutores-evento.ts`): `eventoDelParametro('eventId')` y
  `eventoDeCertificado` (`/v1/certificates/:id/...`). `eventoDePlantilla` existe para cuando una
  ruta de plantillas sea por evento (hoy todas son de `certificados.gestionar`, global).

## Rutas

| Método | Ruta | Guarda (en orden) |
|---|---|---|
| GET | `/certificate-types?activo=` | `certificados.ver` (filtra por actor) o `certificados.gestionar` |
| POST · PUT | `/certificate-types` · `/certificate-types/:id` | `gestionar` → `validateBody` |
| GET | `/certificate-fonts` | `gestionar` |
| GET · PUT | `/certificate-settings` | `gestionar` (→ `validateBody` en el PUT) |
| GET · POST | `/events/:eventId/certificate-templates` | `gestionar` (→ multer `file` → `validateBody` en el POST) |
| GET · PUT · DELETE | `/certificate-templates/:id` | `gestionar` (→ `validateBody` en el PUT) |
| GET · PUT | `/certificate-templates/:id/design` | `gestionar` (→ multer `file` en el PUT) |
| POST | `/certificate-templates/:id/preview` | `gestionar` → `limiteVistaPrevia` → `validateBody` |
| GET | `/events/:eventId/certificates` | `certificados.ver` (evento del parámetro) |
| POST | `/events/:eventId/certificates` | `gestionar` → `validateBody` |
| POST | `/events/:eventId/certificates/from-inscriptions` | `gestionar` → `validateBody` |
| POST | `/events/:eventId/certificates/import` | `gestionar` → tope de filas → `validateBody` |
| POST | `/events/:eventId/certificates/generate` | `certificados.operar` (evento del parámetro) → `validateBody` |
| GET | `/events/:eventId/certificates/zip` | `certificados.operar` (evento del parámetro) |
| POST | `/events/:eventId/certificates/signed` | `certificados.operar` (evento del parámetro) → `limiteCargaFirmados` → `Content-Length` ≤ 25 MB → turno de carga → multer `files[]` → `validateBody` |
| GET | `/certificates/:id` | `certificados.ver` (`eventoDeCertificado`) |
| PUT · DELETE | `/certificates/:id` | `gestionar` (→ `validateBody` en el PUT) |
| GET | `/certificates/:id/file?version=` | `certificados.ver` (`eventoDeCertificado`); `generado` exige además `operar` |
| PUT | `/certificates/:id/signed` | `certificados.operar` (`eventoDeCertificado`) → `limiteCargaFirmados` → `Content-Length` → turno de carga → multer `file` → `validateBody` |
| DELETE | `/certificates/:id/signed` | `gestionar` |
| POST | `/certificates/:id/annul` | `gestionar` → `validateBody` |
| POST | `/settings/certificados-undc/test` | `sistema.configurar` |
| GET | `/me/certificates` | `requireParticipante` → `limitePortal` |
| GET | `/me/certificates/:id/file` | `requireParticipante` → `limiteCredencialPortal` |
| GET | `/public/certificates/:codigo` | `limiteVerificacionCertificado` (IP); el tope global de códigos inexistentes va en el servicio |

`GET|PUT /settings` (Sistema) amplían su contrato con las credenciales UNDC (abajo).

## Ciclo de vida y código

| Desde | Acción | Hacia |
|---|---|---|
| — | emitir | `PENDIENTE` |
| `PENDIENTE` | generar | `PREPARADO` |
| `PENDIENTE` · `PREPARADO` | editar | `PENDIENTE` (hay que regenerar) |
| `PREPARADO` · `EN_FIRMA` | subir firmado con todas las firmas · con menos | `FIRMADO` · `EN_FIRMA` |
| `EN_FIRMA` · `FIRMADO` | quitar firmado | `PREPARADO` |
| cualquiera menos `ANULADO` | anular (con motivo) | `ANULADO` |
| `PENDIENTE` nunca generado | borrar | (se elimina) |

- **Código** `<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>` (p. ej. `CIISIC-2026-000123-7KQ2XM`): prefijo de la
  configuración (`^[A-Z0-9]{2,20}$`), año del evento (`fechaInicio`), correlativo del certificado en
  su evento (`numero`, nunca se reutiliza: cuenta también los anulados) y 6 caracteres aleatorios en
  base 32 de Crockford (30 bits, `crypto.randomInt`; sin I, L, O ni U). Se asigna **al emitir**, con
  el prefijo de ese momento, y no cambia: va en el nombre de los archivos, en el `Subject` del PDF y
  en la URL del QR.
- **Código impreso** (`codigoImpreso`) y **URL de verificación** (`<url_panel>/verificar/<código impreso>`):
  se fijan en la primera generación y se **congelan**; regenerar tras una edición los conserva y
  cambiar después la URL del panel no los toca. Con el proveedor LOCAL el código impreso es el código.
- **Vigencia**: un certificado no anulado es único por evento, participante, tipo y ponencia
  (`clave_vigente`); repetir la emisión lo omite y, tras anularlo, se puede volver a emitir.
- **Generación** (`generacion`): 8 caracteres Crockford nuevos en cada PDF generado; el `Subject` del
  PDF es `ciisic:<código>:<generación>` y el título `Certificado <código impreso>`.
- **Archivos** (la BD guarda solo el nombre, generado por el servidor; escritura atómica):
  `uploads/certificados/plantillas/plantilla-<uuid>.pdf`,
  `uploads/certificados/<eventoId>/generados/<código>-<generación>.pdf` y
  `uploads/certificados/<eventoId>/firmados/<código>-<16 hex>.pdf`. Ninguna respuesta lleva nombres
  de archivo, rutas, hashes ni la clave vigente.

## Tipos de certificado y fuentes

```json
{ "id": 1, "codigo": "PARTICIPANTE", "nombre": "Participante", "textoImpreso": "PARTICIPANTE", "activo": true, "orden": 1 }
```

- Sembrados por la migración: `PARTICIPANTE`, `ORGANIZADOR`, `PONENTE`. El texto impreso es lo que
  estampa el campo `TIPO`.
- `GET /certificate-types?activo=true|false` → lista por `orden`. Filtro inválido → `400 INVALID_FILTER`.
- `POST /certificate-types` `{ codigo, nombre, textoImpreso?, activo?, orden? }` → `201`. El código
  pasa a mayúsculas (`^[A-Z][A-Z0-9_]{1,39}$`); sin `textoImpreso` se usa el nombre en mayúsculas.
  Repetido → `409 DUPLICATE_RECORD`.
- `PUT /certificate-types/:id` `{ codigo? (igual al actual), nombre?, textoImpreso?, activo?, orden? }`.
  Otro código → `422 CERTIFICATE_TYPE_CODE_LOCKED`; inexistente → `404 CERTIFICATE_TYPE_NOT_FOUND`.
  No hay DELETE: se desactiva con `activo: false`.
- `GET /certificate-fonts` → `[{ "codigo": "MONTSERRAT", "nombre": "Montserrat" }, …]`: `MONTSERRAT`,
  `MONTSERRAT_SEMIBOLD`, `MONTSERRAT_BOLD`, `POPPINS`, `POPPINS_BOLD`, `BARLOW`, `BARLOW_BOLD`,
  `PLAYFAIR_DISPLAY`, `PLAYFAIR_DISPLAY_BOLD`, `PLAYFAIR_DISPLAY_ITALICA`, `PINYON_SCRIPT`,
  `PARISIENNE`, `DEJAVU_SANS`, `DEJAVU_SANS_BOLD` (TTF incluidas con sus licencias OFL y DejaVu; por
  defecto `MONTSERRAT`; un carácter sin glifo usa DejaVu Sans y avisa).

## Configuración de certificados (`certificados.gestionar`)

Columnas `certificados_*` de la fila única `configuracion_sistema` (caché de 30 s). `GET` y `PUT`
responden lo mismo, con `Cache-Control: no-store`:

```json
{ "proveedor": "LOCAL", "prefijo": "CIISIC", "proveedorConfirmado": false,
  "urlVerificacionBase": "https://admin-ciisic.episundc.pe/verificar",
  "ejemploCodigo": "CIISIC-2026-000123-7KQ2XM",
  "ejemploUrlVerificacion": "https://admin-ciisic.episundc.pe/verificar/CIISIC-2026-000123-7KQ2XM",
  "prefijoBloqueado": false, "certificadosGenerados": 0, "certificadosConOtroPrefijo": 0,
  "proveedores": [ { "codigo": "LOCAL", "nombre": "Código local del sistema", "disponible": true },
                   { "codigo": "UNDC", "nombre": "API de certificados de la UNDC (certificados.undc.edu.pe)", "disponible": false } ],
  "undc": { "credencialesConfiguradas": false, "disponible": false },
  "actualizadoEn": "2026-11-02T15:00:00.000Z" }
```

- `urlVerificacionBase` = `<url_panel>/verificar` (Sistema → URL del panel), o `null`: sin ella no se
  genera (`422 VERIFICATION_URL_NOT_CONFIGURED`). La URL **no** se guarda en esta configuración.
- `certificadosGenerados`: certificados cuyo código ya está en un PDF (generados alguna vez o con
  firmado). Con alguno, `prefijoBloqueado: true`. `certificadosConOtroPrefijo`: vigentes emitidos con
  otro prefijo (conservan su código).
- `PUT` `{ proveedor?: "LOCAL" | "UNDC", prefijo? (se pasa a mayúsculas, ^[A-Z0-9]{2,20}$), proveedorConfirmado?: boolean }`:
  - cambiar el proveedor o el prefijo deja el proveedor **sin confirmar**, salvo que la misma
    solicitud lo confirme;
  - confirmar prueba el proveedor: LOCAL siempre; UNDC → `501 CERTIFICATE_PROVIDER_PENDING`;
  - cambiar el prefijo con `certificadosGenerados > 0` → `409 CERTIFICATE_SETTINGS_LOCKED`.
- **Sin `proveedorConfirmado: true` no se descarga para firmar** (`409 PROVIDER_NOT_CONFIRMED` en el
  archivo `generado` y en el ZIP `para-firmar`): no se firma un código que luego haya que cambiar por
  el de la UNDC. Generar sí se puede.

### Credenciales de la API UNDC (Sistema, `sistema.configurar`)

`GET /settings` agrega:

```json
"certificadosUndc": { "url": null, "usuario": null, "secretoEnmascarado": null, "timeoutMs": 10000, "configurada": false,
                      "disponible": false, "ultimoEstado": null, "ultimoError": null, "ultimaPruebaEn": null }
```

`PUT /settings` acepta `certificadosUndcUrl` (https; `validarUrlSaliente`, `422 INVALID_URL` /
`HOST_NOT_ALLOWED`), `certificadosUndcUsuario` (≤191), `certificadosUndcSecreto` (4–500, de solo
escritura, cifrado con AES-256-GCM; solo se devuelve `••••<sufijo>`; omitirlo lo conserva, `null` lo
quita) y `certificadosUndcTimeoutMs` (1000–30000). Cambiar URL, usuario o secreto borra el resultado de
la última prueba. `POST /settings/certificados-undc/test` → `501 CERTIFICATE_PROVIDER_PENDING`.

## Plantillas (`certificados.gestionar`)

```json
{ "id": 3, "eventoId": 2, "nombre": "Participantes VIII", "archivoOriginal": "participante.pdf", "tamanoBytes": 412345,
  "paginas": 1, "anchoPt": 841.89, "altoPt": 595.28,
  "campos": [
    { "id": "nombre-1", "tipo": "NOMBRE", "pagina": 1, "x": 120, "y": 300, "ancho": 600, "fuente": "PLAYFAIR_DISPLAY_BOLD",
      "tamano": 32, "tamanoMinimo": 20, "color": "#1f2937", "alineacion": "CENTRO", "capitalizacion": "MAYUSCULAS", "lineasMax": 2 },
    { "id": "tipo-2", "tipo": "TIPO", "pagina": 1, "x": 420.95, "y": 250, "fuente": "MONTSERRAT_BOLD", "tamano": 18, "alineacion": "CENTRO" },
    { "id": "texto-3", "tipo": "TEXTO", "pagina": 1, "x": 120, "y": 215, "ancho": 600, "tamano": 12, "alineacion": "CENTRO", "lineasMax": 3,
      "texto": "Por su participación en el {evento}, con {horas} horas académicas." },
    { "id": "codigo-4", "tipo": "CODIGO", "pagina": 1, "x": 160, "y": 40, "tamano": 8 },
    { "id": "qr-5", "tipo": "QR", "pagina": 1, "x": 60, "y": 30, "lado": 90 } ],
  "horasPorDefecto": 40, "firmasRequeridas": 1, "version": 4, "activa": true, "totalCertificados": 0, "enUso": false,
  "creadoPor": { "id": 1, "nombres": "…", "apellidos": "…" }, "creadoEn": "…", "actualizadoEn": "…" }
```

**Campo** (máximo 30 por plantilla; coordenadas en puntos PDF con el origen abajo a la izquierda):

| Propiedad | Regla |
|---|---|
| `id` | `^[A-Za-z0-9_-]{1,40}$`, único en la plantilla; sin él, `<tipo>-<posición>` |
| `tipo` | `NOMBRE`, `TIPO`, `CODIGO`, `QR`, `FECHA_EMISION`, `HORAS`, `EVENTO`, `DOCUMENTO`, `DETALLE`, `TEXTO` |
| `pagina` | 1 o 2 y dentro del diseño (por defecto 1) |
| `x`, `y` | ±14 400 pt; `y` es la línea base de la primera línea (en el QR, la esquina inferior izquierda) |
| `ancho` | Opcional. Con él la caja es `[x, x + ancho]`: alinea dentro, reduce hasta `tamanoMinimo` y parte hasta `lineasMax` líneas. Sin él, `x` es el ancla (empieza, se centra o termina en `x`) |
| `lado` | Solo QR: 36–300 pt |
| `fuente` | Código de `/certificate-fonts` (por defecto `MONTSERRAT`) |
| `tamano` · `tamanoMinimo` | 4–200 pt (por defecto 12); el mínimo no supera al tamaño |
| `color` | `#rrggbb` (por defecto `#000000`) |
| `alineacion` | `IZQUIERDA` (por defecto), `CENTRO`, `DERECHA` |
| `capitalizacion` | `ORIGINAL` (por defecto), `MAYUSCULAS`, `TITULO` |
| `lineasMax` · `interlineado` | 1–10 (por defecto 1) · 0,8–3 (por defecto 1,2) |
| `texto` | ≤500; obligatorio en `TEXTO`; en los demás reemplaza al valor. Marcadores: `{nombre}` `{tipo}` `{evento}` `{eventoCorto}` `{horas}` `{fecha}` `{detalle}` `{codigo}` `{documento}`. Un campo `HORAS` o `DETALLE` sin valor no se escribe aunque tenga `texto` |
| `formatoFecha` | `LARGO` (por defecto, «3 de noviembre de 2026») o `CORTO` («03/11/2026») |

Los campos se guardan normalizados (sin nulos, medidas a centésimas de pt). MySQL devuelve las claves
de cada campo en su propio orden: la versión solo sube si cambia el **contenido** (se comparan sin
importar el orden de las claves), así que guardar lo que devolvió el `GET` no la sube.
Errores de campos: `422 INVALID_TEMPLATE_FIELDS` con **todos** los errores a la vez en `fields`
(`campos[3].tamano`, `campos[5].id` «Id repetido…», `campos[0].pagina`…).

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /events/:eventId/certificate-templates` | — | Lista de plantillas del evento |
| `POST /events/:eventId/certificate-templates` | multipart: `file` (PDF ≤5 MB), `nombre?` (por defecto el del archivo), `horasPorDefecto?`, `firmasRequeridas?` (1–5, por defecto 1), `campos?` (JSON en texto) | `201` plantilla |
| `GET /certificate-templates/:id` | — | Plantilla |
| `PUT /certificate-templates/:id` | `{ nombre?, campos?, horasPorDefecto?, firmasRequeridas?, activa?, version? }` | Plantilla; la versión sube en 1 solo si cambian los campos. Bajar `firmasRequeridas` deja `FIRMADO` (con `firmadoEn` de ese momento) a los certificados `EN_FIRMA` de la plantilla que ya tienen esas firmas; subirlas no cambia los ya firmados |
| `DELETE /certificate-templates/:id` | — | `data: null` (borra también el PDF) |
| `GET /certificate-templates/:id/design` | — | `application/pdf` `inline`, `Cache-Control: private, no-store` |
| `PUT /certificate-templates/:id/design` | multipart `file` | Plantilla con versión + 1; se borra el diseño anterior |
| `POST /certificate-templates/:id/preview` | `{ campos?, tipoCodigo?, datos?: { nombre?, documento?, detalle?, horas?, fechaEmision? "AAAA-MM-DD" } }` | `application/pdf` `inline` (abajo) |

- El diseño: PDF real (firma de bytes; se lee con topes de descompresión: 32 MiB por flujo y 64 MiB
  por lectura), 1–2 páginas, sin cifrar ni rotar, **sin campos de formulario ni firmas** (un diseño
  ya firmado haría que cada generado «trajera» firmas) y **sin contenido activo** (JavaScript,
  acciones al abrir o adicionales `/AA`, adjuntos, multimedia, XFA; abrir en una página `[pág /Fit]`
  sí se acepta). La plantilla nunca expone la ruta del archivo. Si la BD falla, el PDF recién escrito
  se borra.
- `version` en el PUT es la que tiene el editor: si la plantilla cambió desde entonces (o se guarda a
  la vez desde otra ventana) → `409 TEMPLATE_CHANGED`.
- Los certificados guardan la versión con la que se generaron (`plantillaDesactualizada` en el
  certificado). Cambiar la plantilla **no** regenera nada.
- **Vista previa**: estampa con datos de ejemplo (o los enviados) y los campos enviados sin guardar
  (si no, los guardados). Cabeceras `X-Avisos` = `encodeURIComponent(JSON.stringify([{ campo, codigo, mensaje }]))`
  (≤3500 caracteres; si no caben, el último es `{ codigo: "MAS_AVISOS" }`) y `X-Avisos-Total`. Avisos
  posibles: `GLIFO_RESPALDO`, `GLIFO_FALTANTE`, `DESBORDA`, `PAGINA_INEXISTENTE`, `FUENTE_DESCONOCIDA`,
  `FUENTE_SIN_SUBCONJUNTO` y `URL_VERIFICACION_NO_CONFIGURADA` (sin URL del panel usa un QR de
  ejemplo). 30 por minuto por cuenta; 2 a la vez y 10 en espera (si no, `503 PDF_BUSY` con
  `Retry-After: 5`).

| Estado | Código | Cuándo |
|---|---|---|
| 422 | `FILE_REQUIRED` · `INVALID_PDF` · `PDF_ENCRYPTED` · `PDF_ROTATED` · `PDF_TOO_MANY_PAGES` · `PDF_HAS_FORM_FIELDS` · `PDF_ACTIVE_CONTENT` | Diseño ausente o no válido (`INVALID_PDF` también si se infla más de lo permitido) |
| 413 | `UPLOAD_LIMIT_EXCEEDED` | Diseño de más de 5 MB |
| 422 | `INVALID_TEMPLATE_FIELDS` | Campos (también al reemplazar el diseño si quedan campos en una página que ya no existe) |
| 404 | `EVENT_NOT_FOUND` · `TEMPLATE_NOT_FOUND` · `TEMPLATE_DESIGN_NOT_FOUND` | — |
| 409 | `TEMPLATE_IN_USE` | Borrar una plantilla con certificados: se desactiva (`activa: false`) |
| 409 | `TEMPLATE_CHANGED` | Versión vieja o edición simultánea |
| 422 | `CERTIFICATE_TYPE_NOT_FOUND` | `tipoCodigo` desconocido en la vista previa |
| 503 | `PDF_BUSY` | Demasiadas vistas previas a la vez |

## Certificado (respuesta)

```json
{ "id": 41, "eventoId": 2, "numero": 123, "codigo": "CIISIC-2026-000123-7KQ2XM", "codigoImpreso": "CIISIC-2026-000123-7KQ2XM",
  "estado": "PREPARADO", "tipo": { "id": 1, "codigo": "PARTICIPANTE", "nombre": "Participante", "textoImpreso": "PARTICIPANTE" },
  "plantilla": { "id": 3, "nombre": "Participantes VIII", "version": 4, "firmasRequeridas": 1 }, "plantillaVersion": 4, "plantillaDesactualizada": false,
  "participanteId": 100, "inscripcionId": 500, "ponenciaId": null, "nombreImpreso": "ANA PÉREZ GARCÍA",
  "tipoDocumento": "dni", "numeroDocumento": "****1234", "detalle": null, "horas": 40, "fechaEmision": "2026-11-03",
  "tieneGenerado": true, "tieneFirmado": false, "generadoEn": "2026-11-03T15:00:00.000Z", "descargadoParaFirmarEn": null,
  "firmasDetectadas": 0, "firmadoEn": null, "anuladoEn": null, "creadoEn": "…", "actualizadoEn": "…" }
```

- `codigoImpreso` es `null` hasta la primera generación. `plantilla` es `null` si se borró.
- `numeroDocumento` completo solo con `certificados.gestionar`.

## Emisión (`certificados.gestionar`)

Toda emisión lleva **plantilla obligatoria** (del evento y activa) y **tipo** (activo); crea los
certificados en `PENDIENTE` con su código, una copia del nombre (`nombres apellidos`) y del documento,
`horas` (las enviadas o `horasPorDefecto` de la plantilla) y `fechaEmision` (la enviada o hoy en Lima).
Las personas nuevas se registran con el servicio del alta de participantes de la spec 014
(`crearParticipante`): **correo obligatorio**, nombres oficiales por la consulta DNI del panel
(`PANEL`). Si la persona ya existe con otro correo, se conserva el registrado (solo Participantes lo
cambia) y se avisa `CORREO_CONSERVADO`.

### POST `/events/:eventId/certificates` (individual: organizador, ponente…)

```json
{ "persona": { "tipoDocumento": "dni", "numeroDocumento": "70001234", "correo": "ana@gmail.com", "nombres": "Ana", "apellidos": "Pérez García", "celular": "987654321" },
  "tipoCodigo": "PONENTE", "plantillaId": 3, "ponenciaId": "6c1f…", "horas": 4, "detalle": "Ponencia: Visión por computadora", "fechaEmision": "2026-11-03" }
```

Exactamente uno de `participanteId` o `persona` (`tipoDocumento` `dni`|`ce`, `numeroDocumento`,
`correo`, `nombres?`, `apellidos?`, `celular?`). `ponenciaId` (UUID) distingue dos certificados del
mismo tipo para la misma persona. `horas` 0–10 000; `detalle` ≤500.

`201`:

```json
{ "certificado": { "…": "Certificado" }, "participante": { "id": 100, "nuevo": false },
  "avisos": [ { "codigo": "CORREO_CONSERVADO", "mensaje": "La persona ya estaba registrada con otro correo: se conserva el registrado." } ] }
```

| Estado | Código |
|---|---|
| 409 | `CERTIFICATE_EXISTS` (ya hay uno vigente con ese evento, persona, tipo y ponencia) · `EMAIL_IN_USE` (persona nueva con el correo de otra) |
| 404 | `TEMPLATE_NOT_FOUND` · `PARTICIPANT_NOT_FOUND` · `PAPER_NOT_FOUND` · `EVENT_NOT_FOUND` |
| 422 | `TEMPLATE_OTHER_EVENT` · `TEMPLATE_INACTIVE` · `CERTIFICATE_TYPE_NOT_FOUND` · `CERTIFICATE_TYPE_INACTIVE` · `PAPER_OTHER_EVENT` · `NAMES_REQUIRED` · `VALIDATION_ERROR` |

### POST `/events/:eventId/certificates/from-inscriptions` (inscritos aprobados)

```json
{ "tipoCodigo": "PARTICIPANTE", "plantillaId": 3, "horas": 40, "fechaEmision": "2026-11-03",
  "filtro": { "tipoInscripcionIds": [12, 13], "actividadIds": [10, 11, 12], "asistenciaMinima": 60 }, "simular": true }
```

- Candidatos: inscripciones `APROBADO` del evento (con `tipoInscripcionIds`, solo esos tipos).
- `asistenciaMinima` (0–100, % de actividades con asistencia **no anulada**, comparación exacta
  `marcadas × 100 ≥ mínima × total`) sobre `actividadIds` (del evento) o, sin ellas, todas las del
  evento. `actividadIds` sin `asistenciaMinima` → `422 VALIDATION_ERROR`.
- `simular: true` → `200`:
  `{ "simular": true, "candidatos": 300, "crear": 240, "yaEmitidos": 10, "excluidos": 50, "muestra": [ { "inscripcionId": 500, "participanteId": 100, "nombre": "ANA PÉREZ GARCÍA", "tipoDocumento": "dni", "numeroDocumento": "70001234", "asistencia": { "marcadas": 2, "total": 3, "porcentaje": 66.7 }, "resultado": "CREAR" } ] }`
  (`muestra` ≤100; `asistencia` `null` sin filtro; `resultado` `CREAR` | `YA_EMITIDO` | `EXCLUIDO`).
- Sin simular → `201` `{ "simular": false, "candidatos": 300, "creados": 240, "yaEmitidos": 10, "excluidos": 50 }`.
  Idempotente: lo ya emitido se cuenta en `yaEmitidos` (también si otra solicitud lo emitió a la vez).
- Errores: `422 ACTIVITY_OTHER_EVENT` · `NO_ACTIVITIES` y los de plantilla y tipo.

### POST `/events/:eventId/certificates/import` (por lista)

```json
{ "tipoCodigo": "ORGANIZADOR", "plantillaId": 3, "fechaEmision": "2026-11-03", "simular": true,
  "filas": [ { "tipoDocumento": "dni", "numeroDocumento": "70001234", "correo": "ana@gmail.com", "nombres": "", "apellidos": "", "detalle": "Comisión de logística", "horas": 40 } ] }
```

- 1–300 filas (más → `422 IMPORT_TOO_LARGE`, antes de validar); el panel envía listas largas en
  partes. Cada fila se valida con las reglas del alta de participantes; una fila mala no bloquea
  las demás. Como mucho 50 consultas DNI a proveedores (sin caché) por envío: las siguientes filas
  salen `LOOKUP_LIMIT` (volver a enviar la lista: lo ya emitido se omite).
- Respuesta (`200` al simular, `201` si no):

```json
{ "simular": false, "resumen": { "total": 3, "porCrear": 0, "creados": 1, "yaEmitidos": 1, "errores": 1 },
  "filas": [ { "fila": 1, "resultado": "CREADO", "participante": { "id": 100, "nuevo": false }, "codigo": "CORREO_CONSERVADO", "mensaje": "…" },
             { "fila": 2, "resultado": "YA_EMITIDO", "participante": { "id": 101, "nuevo": false }, "codigo": null, "mensaje": null },
             { "fila": 3, "resultado": "ERROR", "participante": null, "codigo": "EMAIL_IN_USE", "mensaje": "…" } ] }
```

`resultado`: `CREAR` (simulación), `CREADO`, `YA_EMITIDO`, `ERROR`. Códigos por fila: `INVALID_ROW`,
`DUPLICATE_ROW` (repetida en la lista), `EMAIL_IN_USE`, `NAMES_REQUIRED`, `LOOKUP_LIMIT` y el aviso
`CORREO_CONSERVADO`.

## Listado, detalle, edición y borrado

- `GET /events/:eventId/certificates?estado=PENDIENTE,PREPARADO&tipo=PARTICIPANTE&plantillaId=3&q=perez&page=1&pageSize=20`
  (`pageSize` ≤100) → `data: Certificado[]` y
  `meta: { page, pageSize, total, resumen: { PENDIENTE, PREPARADO, EN_FIRMA, FIRMADO, ANULADO } }`
  (el resumen aplica los demás filtros, no el de estado). `q` busca en nombre, código y código
  impreso; en el documento, solo con `gestionar`. `estado` o `plantillaId` inválidos →
  `422 VALIDATION_ERROR`.
- `GET /certificates/:id` → Certificado más
  `{ evento: { id, codigo, nombreCorto }, urlVerificacion, coincidencia, motivoForzado, firmantes, motivoAnulacion, codigoExterno, registroExterno, registroExternoError, registradoExternoEn, emitidoPor, editadoPor, firmadoCargadoPor, anuladoPor }`
  (cada `…Por` es `{ id, nombres, apellidos }` o `null`). `firmantes` es la lista de las firmas que
  verificaron del firmado vigente, en orden (`[]` sin firmado):
  `[{ "nombre": "PÉREZ GARCÍA JUAN (FIR…)", "emisor": "ECEP-RENIEC CA Class 1", "serie": "1a2b…", "validoDesde": "…", "validoHasta": "…", "fechaFirma": "2026-11-05T15:58:00.000Z" }]`
  (`nombre` y `emisor` son el CN del certificado; `fechaFirma` sale del CMS o de `/M`, puede ser
  `null`). El panel la muestra junto al estado: **no se comprueba la cadena de confianza** (RENIEC o
  FirmaPerú), así que quien opera revisa que los firmantes sean los esperados.
  `404 CERTIFICATE_NOT_FOUND`.
- `PUT /certificates/:id` (`gestionar`)
  `{ nombreImpreso? (2–200), detalle?, horas?, plantillaId?, fechaEmision?, sincronizarNombre?, confirmar? }`
  → detalle. Vuelve a `PENDIENTE` (hay que regenerarlo), registra `editadoPorId` y conserva el código
  impreso y la URL. `sincronizarNombre` toma el nombre actual del participante (no junto con
  `nombreImpreso`).
  - `409 CERTIFICATE_LOCKED`: está `EN_FIRMA`, `FIRMADO` o `ANULADO` (quitar el firmado o anular).
  - `409 CERTIFICATE_SENT_TO_SIGN`: ya se descargó para firmar y no llega `confirmar: true` (el PDF
    que se está firmando dejará de coincidir).
  - Plantilla: `404 TEMPLATE_NOT_FOUND`, `422 TEMPLATE_OTHER_EVENT` · `TEMPLATE_INACTIVE`.
- `DELETE /certificates/:id` (`gestionar`) → `data: null`, solo un `PENDIENTE` que nunca se generó;
  si no, `409 CERTIFICATE_LOCKED` (anularlo).

## Generación (`certificados.operar`)

`POST /events/:eventId/certificates/generate` con `{ "ids": [41, 42] }` (1–10, de este evento) **o**
`{ "pendientes": true, "despuesDeId": 0 }` (los siguientes 10 `PENDIENTE` por id). Síncrona: el
panel repite la solicitud con `despuesDeId = ultimoId` mientras `hayMas`.

```json
{ "procesados": [
    { "id": 41, "codigo": "CIISIC-2026-000123-7KQ2XM", "resultado": "GENERADO", "estado": "PREPARADO", "avisos": [], "codigoError": null, "mensaje": null },
    { "id": 42, "codigo": "CIISIC-2026-000124-M3Q9TB", "resultado": "OMITIDO", "estado": "FIRMADO", "avisos": [], "codigoError": null, "mensaje": "Ya está firmado: no se regenera." },
    { "id": 43, "codigo": "CIISIC-2026-000125-0V4K2D", "resultado": "ERROR", "estado": "PENDIENTE", "avisos": [], "codigoError": "TEMPLATE_FILE_MISSING", "mensaje": "…" } ],
  "restantes": 120, "ultimoId": 43, "hayMas": true }
```

- Idempotente: solo genera `PENDIENTE`; lo demás sale `OMITIDO` (un firmado **nunca** se regenera).
  `ultimoId` es `null` con `ids`. `avisos` son los del estampado (el PDF se genera igual).
- Cada PDF: diseño de la plantilla + campos, QR vectorial con la URL de verificación, `Subject`
  `ciisic:<código>:<generación>`, sin flujos de objetos (compatibilidad con las herramientas de firma).
  La fila pasa a `PREPARADO` solo si nadie la cambió entre tanto; si no, el archivo se borra
  (`OMITIDO` con `CERTIFICATE_CHANGED`). El generado anterior (tras una edición) se borra.
- Errores de toda la solicitud (antes de generar ninguno): `422 VERIFICATION_URL_NOT_CONFIGURED`
  (Sistema sin URL del panel), `422 VERIFICATION_URL_TOO_LONG` (>255), `501 CERTIFICATE_PROVIDER_PENDING`
  (proveedor UNDC y algún certificado sin código impreso), `503 GENERATION_BUSY` con `Retry-After: 5`
  (2 tandas a la vez y 4 en espera por proceso).
- Por certificado: `CERTIFICATE_NOT_FOUND` (no existe o es de otro evento), `TEMPLATE_REQUIRED`,
  `TEMPLATE_FILE_MISSING`, `CERTIFICATE_CHANGED`, `GENERATION_FAILED`.

## Descargas

- `GET /certificates/:id/file?version=firmado` (por defecto; `certificados.ver`): el PDF firmado de un
  `FIRMADO`. `GET …?version=generado` (además `certificados.operar`, si no `403 FORBIDDEN`; proveedor
  confirmado, si no `409 PROVIDER_NOT_CONFIRMED`): el generado de un `PREPARADO` o el firmado parcial
  de un `EN_FIRMA`, y marca la primera descarga (`descargadoParaFirmarEn`). `application/pdf`,
  `attachment; filename="<código>.pdf"`, `Cache-Control: private, no-store`. Sin archivo →
  `404 CERTIFICATE_FILE_NOT_FOUND`; `version` inválida → `422 VALIDATION_ERROR`.
- `GET /events/:eventId/certificates/zip?version=para-firmar|firmados&estado&tipo&ids&porParte&despuesDe`
  (`certificados.operar`):
  - `para-firmar`: `PREPARADO` (generado) y `EN_FIRMA` (firmado parcial), exige el proveedor
    confirmado y marca `descargadoParaFirmarEn`; `firmados`: `FIRMADO`. `estado` acota dentro de esos.
  - `tipo` (código), `ids` (≤500, separados por comas), `porParte` 1–500 (por defecto 200) y
    `despuesDe` (cursor: número del último certificado de la parte anterior; 0 o ausente = desde el
    primero). Cada parte trae los `porParte` siguientes con número mayor, en orden de `numero`: si
    entre una parte y otra se firman o regeneran certificados, no se salta ninguno.
  - `application/zip` en flujo (yazl, PDF sin comprimir) con `<código>.pdf` y `manifiesto.csv` (UTF-8
    con BOM, `;`, celdas protegidas contra fórmulas):
    `Archivo;Código;Código impreso;Estado;Tipo;Nombre;[Tipo doc.;N° documento];Detalle;Horas;Fecha de emisión;Plantilla;Firmas detectadas;Firmas requeridas;Observación`
    (el documento solo con `gestionar`). Un archivo que falta en disco no va en el ZIP y se avisa en
    `Observación`.
  - Nombre `certificados-<evento>-<version>.zip`, o `certificados-<evento>-<version>-<desde>-a-<hasta>.zip`
    si hay más de una parte. Cabeceras:

    | Cabecera | Valor |
    |---|---|
    | `X-Zip-Total` | Certificados del filtro en este momento (todas las partes) |
    | `X-Zip-Certificados` · `X-Zip-Archivos` | Certificados de esta parte · PDF incluidos (los que faltan en disco no van) |
    | `X-Zip-Desde` · `X-Zip-Hasta` | Primer y último `numero` de esta parte |
    | `X-Zip-Restantes` | Certificados del filtro después de esta parte |
    | `X-Zip-Siguiente` | `despuesDe` de la parte siguiente (vacío si no hay más) |
    | `X-Zip-Hay-Mas` | `true` · `false` |

    El panel pide `despuesDe=<X-Zip-Siguiente>` mientras `X-Zip-Hay-Mas` sea `true`.
  - `409 PROVIDER_NOT_CONFIRMED`, `422 NOTHING_TO_DOWNLOAD` (nada con ese filtro, nada después de
    `despuesDe` o ningún archivo en disco), `422 VALIDATION_ERROR` (`version`, `estado`, `ids`,
    `porParte`, `despuesDe`).

## Firmados

Un firmado se acepta solo si:

1. **Sus firmas verifican.** Cuentan los campos `/FT /Sig` del AcroForm cuyo `/V` es una firma
   (`adbe.pkcs7.detached`, `ETSI.CAdES.detached` o `adbe.pkcs7.sha1`) que cumple todo esto: `/ByteRange`
   desde 0 con el hueco exactamente en su `/Contents`; CMS `SignedData` con un firmante; atributo
   `messageDigest` igual al hash de los bytes cubiertos; firma (RSA PKCS#1 v1.5, RSA-PSS o ECDSA)
   válida con el certificado que trae el CMS. Los sellos de tiempo del documento (`/DocTimeStamp`,
   `ETSI.RFC3161`) no cuentan, y un diccionario `/Sig` fuera del AcroForm tampoco. Una firma que **no**
   verifica invalida el archivo (`SIGNATURE_INVALID`). **No** se encadena el certificado a una raíz de
   confianza (RENIEC, FirmaPerú): el firmante queda en `firmantes` para revisarlo.
2. **Es el generado vigente con firmas agregadas** (**PREFIJO**): los primeros `bytesGenerado` bytes
   tienen el SHA-256 del generado (firma incremental), solo se cuentan las firmas agregadas después y
   lo agregado no cambia nada del generado (si no, `SIGNED_MODIFIED`):
   - no redefine objetos del generado salvo el catálogo, las páginas, `/Info`, `/Metadata`, el
     AcroForm y el árbol de estructura de un PDF etiquetado (diccionarios, no flujos), ni define dos
     veces un objeto nuevo (salvo catálogo, AcroForm, DSS, `/Info` y XMP);
   - toda versión del catálogo cambia como mucho `/AcroForm`, `/DSS`, `/Perms`, `/Metadata`,
     `/Extensions` y `/Version`; toda versión de una página, como mucho `/Annots` (y `/Tabs`,
     `/StructParents`, `/Metadata`, `/PieceInfo`, `/LastModified`); el AcroForm solo suma campos de
     firma y no trae XFA; no se agregan ni quitan páginas;
   - toda anotación nueva es el widget de un campo de firma, y si es visible la cubre alguna firma
     válida (un recuadro agregado después de la última firma podría tapar el nombre);
   - lo que se lee es lo que leería un visor: cada cabecera `N G obj` agregada es un objeto que se
     leyó en ese lugar (nada escondido dentro de un flujo), ningún objeto ilegible, cada entrada xref
     agregada apunta a su objeto y ninguna borra objetos.
3. **No trae contenido activo** en ninguna versión de ningún objeto (`PDF_ACTIVE_CONTENT`): JavaScript,
   acciones `Launch`, `SubmitForm`, `ImportData`, `GoToR`/`GoToE`, multimedia, `/AA`, adjuntos, XFA.

Si la herramienta **reescribió** el archivo pero su `Subject` es `ciisic:<código>:<generación vigente>`
(**METADATOS**), no se puede comprobar el contenido: se rechaza (`SIGNED_REWRITTEN`) y solo quien
gestiona los certificados puede aceptarlo uno por uno con `forzar` y motivo. Si no coincide de ninguna
forma, `SIGNED_MISMATCH` (otra persona o una versión anterior).

Con las `firmasRequeridas` de la plantilla queda `FIRMADO` (`firmadoEn`); con menos, `EN_FIRMA`. Los
PDF se leen con topes de descompresión (32 MiB por flujo, 64 MiB por archivo; si no, `INVALID_PDF`).

Reglas de reemplazo:

- Un `FIRMADO` solo se reemplaza con `reemplazar`, por **quien gestiona los certificados** y por un
  archivo con todas las firmas.
- Un `EN_FIRMA` solo se reemplaza por un archivo que **continúa** el cargado (empieza con sus bytes:
  otro firmante firmó encima) o que tiene **más** firmas; si no (copia vieja, o dos firmantes que
  firmaron en paralelo), se conserva el cargado.
- El mismo archivo otra vez no cambia nada, salvo que ahora alcance las firmas requeridas (bajaron en
  la plantilla): entonces pasa a `FIRMADO`.
- El firmado anterior **no se borra**: pasa a `uploads/certificados/<eventoId>/firmados/reemplazados/`.

### POST `/events/:eventId/certificates/signed` (tandas)

`multipart/form-data`: `files` (hasta 10 PDF de hasta 10 MB; `Content-Length` obligatorio y ≤25 MB)
y `reemplazar` (`true`/`false`; `true` exige `certificados.gestionar`, si no `403 FORBIDDEN` para toda
la tanda). Un archivo que no es PDF no corta la tanda (sale `INVALIDO`). Emparejamiento: código en el
nombre (tolera `[R]`, `_firmado`, `-signed`, minúsculas, prefijos), luego `codigoExterno` y por último
el `Subject` del PDF (que se lee una sola vez).

```json
{ "resumen": { "firmados": 1, "parciales": 0, "sinFirma": 0, "noCoincide": 1, "noEncontrados": 0, "otroEvento": 0, "anulados": 0, "yaFirmados": 0, "duplicados": 0, "invalidos": 1 },
  "detalle": [
    { "archivo": "CIISIC-2026-000123-7KQ2XM[R].pdf", "resultado": "FIRMADO", "certificadoId": 41, "codigo": "CIISIC-2026-000123-7KQ2XM", "estado": "FIRMADO",
      "firmas": 1, "firmasRequeridas": 1, "coincidencia": "PREFIJO", "codigoError": null, "mensaje": "Firmado (1 de 1 firmas)." },
    { "archivo": "CIISIC-2026-000124-M3Q9TB.pdf", "resultado": "NO_COINCIDE", "certificadoId": 42, "codigo": "CIISIC-2026-000124-M3Q9TB", "estado": "PREPARADO",
      "firmas": 1, "firmasRequeridas": 1, "coincidencia": "METADATOS", "codigoError": "SIGNED_REWRITTEN", "mensaje": "…" },
    { "archivo": "notas.docx", "resultado": "INVALIDO", "certificadoId": null, "codigo": null, "estado": null,
      "firmas": null, "firmasRequeridas": null, "coincidencia": null, "codigoError": "INVALID_FILE_TYPE", "mensaje": "Solo se aceptan archivos PDF." } ] }
```

| `resultado` | Significado |
|---|---|
| `FIRMADO` · `PARCIAL` | Aceptado con todas las firmas · con menos (`EN_FIRMA`). `PARCIAL` también si se conservó el parcial ya cargado (el nuevo no lo continúa ni tiene más firmas) o si era el mismo archivo |
| `SIN_FIRMA` | Coincide pero no tiene firmas válidas (`SIGNATURE_NOT_FOUND`) |
| `NO_COINCIDE` | `SIGNED_MISMATCH`, `SIGNED_REWRITTEN` (reescrito: forzar uno por uno), `SIGNED_MODIFIED` (cambió algo del generado), `CERTIFICATE_NOT_GENERATED` o `CERTIFICATE_CHANGED` (cambió mientras se cargaba: volver a subir) |
| `NO_ENCONTRADO` · `OTRO_EVENTO` | Sin certificado con ese código · de otro evento (sin revelar su id ni su estado) |
| `ANULADO` · `YA_FIRMADO` | Certificado anulado · ya firmado (mismo archivo, sin `reemplazar`, o el nuevo tiene menos firmas) |
| `DUPLICADO` | Otro archivo de esta tanda ya es de ese certificado |
| `INVALIDO` | `INVALID_FILE_TYPE` (no es PDF), `INVALID_PDF` (ilegible, cifrado o se infla demasiado), `SIGNATURE_INVALID` (una firma no verifica), `PDF_ACTIVE_CONTENT` |

`coincidencia` en el detalle: `PREFIJO`, `METADATOS` o `null`. Errores de la solicitud:
`411 LENGTH_REQUIRED` (sin `Content-Length` o con `Transfer-Encoding`), `413 UPLOAD_LIMIT_EXCEEDED`,
`403 FORBIDDEN` (`reemplazar` sin `gestionar`), `422 FILE_REQUIRED`, `404 EVENT_NOT_FOUND`,
`429 RATE_LIMITED` (30 tandas por minuto por cuenta), `503 SIGNED_UPLOAD_BUSY` con `Retry-After: 5`
(2 cargas a la vez y 4 en espera por proceso; las que esperan no se leen hasta su turno).

### PUT `/certificates/:id/signed` (uno, sin emparejar por nombre)

Multipart `file` (≤10 MB), `reemplazar`, `forzar`, `motivo` (5–500, obligatorio con `forzar`). `forzar`
exige `certificados.gestionar` (`403 FORBIDDEN`) y acepta un archivo que no coincide
(`coincidencia: "FORZADO"`), reescrito (`"METADATOS"`) o con cambios después de generado
(`"FORZADO"`); **nunca** uno sin firmas válidas, con una firma que no verifica o con contenido activo.
Queda `motivoForzado`, quién lo cargó y un aviso en el log. Reemplazar un `FIRMADO` exige
`certificados.gestionar` (`403 FORBIDDEN`).

```json
{ "id": 41, "codigo": "CIISIC-2026-000123-7KQ2XM", "estado": "FIRMADO", "firmasDetectadas": 1, "firmasRequeridas": 1, "coincidencia": "PREFIJO",
  "firmantes": [{ "nombre": "…", "emisor": "…", "serie": "…", "validoDesde": "…", "validoHasta": "…", "fechaFirma": "…" }],
  "firmadoEn": "2026-11-05T16:00:00.000Z" }
```

| Estado | Código |
|---|---|
| 403 | `FORBIDDEN` (`forzar` o reemplazar un `FIRMADO` sin `gestionar`) |
| 404 | `CERTIFICATE_NOT_FOUND` |
| 409 | `CERTIFICATE_ANNULLED` · `CERTIFICATE_NOT_GENERATED` · `CERTIFICATE_ALREADY_SIGNED` (sin `reemplazar`) · `CERTIFICATE_CHANGED` · `SIGNATURES_NOT_EXTENDED` (un `EN_FIRMA` y el archivo no continúa el cargado ni tiene más firmas) |
| 422 | `FILE_REQUIRED` · `INVALID_FILE_TYPE` · `INVALID_PDF` · `SIGNATURE_INVALID` · `PDF_ACTIVE_CONTENT` · `SIGNATURE_NOT_FOUND` · `SIGNED_MISMATCH` · `SIGNED_REWRITTEN` · `SIGNED_MODIFIED` · `SIGNATURES_INCOMPLETE` (reemplazar un firmado por uno con menos firmas) |
| 411 · 413 · 503 | `LENGTH_REQUIRED` · `UPLOAD_LIMIT_EXCEEDED` · `SIGNED_UPLOAD_BUSY` |

### DELETE `/certificates/:id/signed` (`gestionar`)

Quita el firmado (el archivo pasa a `firmados/reemplazados/`, no se borra) y el certificado vuelve a
`PREPARADO`: `{ "id": 41, "codigo": "…", "estado": "PREPARADO" }`. `409 CERTIFICATE_NOT_SIGNED` ·
`CERTIFICATE_ANNULLED`.

## Anulación — POST `/certificates/:id/annul` (`gestionar`)

`{ "motivo": "Nombre mal escrito; se emite otro" }` (5–500; no se publica) →
`{ "id": 41, "codigo": "…", "estado": "ANULADO", "anuladoEn": "…", "motivoAnulacion": "…" }`. Libera la
clave vigente (se puede volver a emitir, con otro código), conserva los archivos, sale del portal y la
verificación pública lo muestra `ANULADO`. `409 CERTIFICATE_ALREADY_ANNULLED`.

## Portal del participante

- `GET /me/certificates` (`limitePortal`, 60/min) → solo los **FIRMADO** propios (ni anulados ni en
  preparación), por fecha de emisión descendente; `[]` si no hay:

```json
[ { "id": 41, "codigoImpreso": "CIISIC-2026-000123-7KQ2XM",
    "evento": { "codigo": "ciisic-viii-2026", "nombre": "VIII Congreso Internacional …", "nombreCorto": "VIII CIISIC 2026", "fechaInicio": "2026-10-26", "fechaFin": "2026-10-30" },
    "tipo": { "codigo": "PARTICIPANTE", "nombre": "Participante" }, "fechaEmision": "2026-11-03", "horas": 40, "detalle": null,
    "firmadoEn": "2026-11-05T16:00:00.000Z", "urlVerificacion": "https://admin-ciisic.episundc.pe/verificar/CIISIC-2026-000123-7KQ2XM" } ]
```

- `GET /me/certificates/:id/file` (`limiteCredencialPortal`, 10/min) → el PDF firmado propio,
  `attachment; filename="certificado-<código impreso>.pdf"`, `Cache-Control: private, no-store`.
  `404 CERTIFICATE_NOT_FOUND` si es ajeno, no está firmado o falta el archivo.

## Verificación pública — GET `/public/certificates/:codigo`

Sin token. `limiteVerificacionCertificado` (30/min por IP) → `429 RATE_LIMITED`. Además, un tope
global de **códigos inexistentes** (1200 por minuto en el proceso, contando también los `PENDIENTE`,
`PREPARADO` y `EN_FIRMA`): pasado el tope, esos responden `429 RATE_LIMITED` con `Retry-After`; un
código real (`FIRMADO` o `ANULADO`) **siempre** responde, así que recorrer códigos desde muchas IP no
deja sin servicio a quien verifica uno de verdad. Un formato inválido no cuenta. `Cache-Control: no-store`.

- El código se normaliza (sin espacios, mayúsculas; en la parte aleatoria O→0, I/L→1). Con otro
  formato → `404` **sin consultar la BD**.
- Solo responden `FIRMADO` (`VALIDO`) y `ANULADO`; `PENDIENTE`, `PREPARADO`, `EN_FIRMA` e inexistente
  dan el mismo `404 CERTIFICATE_NOT_FOUND` («No encontramos un certificado firmado con ese código.»).

```json
{ "success": true, "data": { "codigo": "CIISIC-2026-000123-7KQ2XM", "estado": "VALIDO", "titular": "ANA PÉREZ GARCÍA", "tipo": "Participante",
  "evento": { "nombre": "VIII Congreso Internacional …", "fechaInicio": "2026-10-26", "fechaFin": "2026-10-30" },
  "fechaEmision": "2026-11-03", "horas": 40, "firmadoEn": "2026-11-05T16:00:00.000Z" } }
```

Anulado: lo mismo con `"estado": "ANULADO"` y `"anuladoEn"`. **Nunca** devuelve el documento, el
correo, el motivo de la anulación ni el PDF.

## Límites

| Límite | Valor | Clave |
|---|---|---|
| `limiteVistaPrevia` | 30/min (+ 2 a la vez y 10 en espera: `503 PDF_BUSY`) | cuenta |
| Generación | 2 tandas a la vez y 4 en espera por proceso (`503 GENERATION_BUSY`, `Retry-After: 5`) | proceso |
| `limiteCargaFirmados` | 30/min (POST y PUT de firmados) | cuenta |
| Turno de carga de firmados | 2 a la vez y 4 en espera (`503 SIGNED_UPLOAD_BUSY`, `Retry-After: 5`); antes de leer el cuerpo | proceso |
| `limiteVerificacionCertificado` · `topeFallosVerificacion` | 30/min · 1200 códigos inexistentes por minuto (los reales siempre responden) | IP · proceso |
| Lectura de PDF de afuera | 32 MiB por flujo decodificado, 64 MiB por archivo, 200 000 objetos, 10 firmas | archivo |
| Portal | 60/min · descarga 10/min | participante |
| Tamaños | diseño 5 MB; firmado 10 MB; tanda 10 archivos y 25 MB; importación 300 filas y 50 consultas DNI; ZIP ≤500 por parte | — |

## Cambios en rutas existentes

- `DELETE /events/:id`: `409 EVENT_HAS_INSCRIPTIONS` también si el evento tiene certificados (el
  mensaje los menciona); sus plantillas se borran con el evento y después sus diseños.
- `DELETE /inscriptions/:id`: `409 INSCRIPTION_HAS_CERTIFICATE` si tiene un certificado no anulado.
- `GET /roles` (spec 013): el rol `COMISION` lista `certificados.ver` y `certificados.operar` en
  `permisosElegibles` (con su etiqueta; `operar` implica `ver`), nunca en `permisosPorDefecto`; el
  alta y la edición de cuentas de la Comisión los aceptan.
- `GET|PUT /settings`: `certificadosUndc` (arriba).

## Compatibilidad y despliegue

- Todo es aditivo: rutas nuevas y claves agregadas; el panel y la landing actuales siguen
  funcionando. Se despliega **después del evento** (31-oct-2026 o más tarde).
- Panel (spec 010 del panel): el BFF debe transmitir el multipart en flujo (`streamRequest`) y subir en
  tandas de ≤10 MB, reintentando ante `503 SIGNED_UPLOAD_BUSY`; el ZIP por partes se pide con
  `despuesDe=<X-Zip-Siguiente>`; las cabeceras `X-Avisos*` y `X-Zip-*` no están en `exposedHeaders` de CORS: el
  panel las lee en su BFF (mismo origen). La página pública `/verificar/<código>` del panel llama a
  `/api/v1/public/certificates/:codigo` desde su BFF reenviando la IP del visitante en
  `X-Forwarded-For`.
- API de certificados de la UNDC: **pendiente** (contrato 7 de `docs/arquitectura-ecosistema.md`).
