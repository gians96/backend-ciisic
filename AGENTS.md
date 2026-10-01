# AGENTS.md — backend-ciisic

Guía para agentes de IA y desarrolladores que trabajen en este repositorio.

## Qué es

API del congreso CIISIC (UNDC), **multi-evento**: eventos, inscripciones, credenciales PDF y
correo, asistencia (escáner con el QR de la credencial), ponencias, consultas DNI, verificación de
estudiantes, integraciones, acceso con Google o con código por correo, portal del inscrito
(fotocheck virtual, asistencia, perfil con foto y certificados firmados) y certificados (plantillas
PDF, emisión, generación, firma digital externa y verificación pública). Es el **centro del
ecosistema del congreso**: la consumen el panel y la landing, y ella consume API_UNDC, deportes-fi,
Decolecta/apiperu, Brevo y Google (la API de certificados de la UNDC está pendiente).
Documentación: [`docs/`](docs/README.md).

## Entorno y comandos

- Node 22 + npm. En Windows se puede usar Git Bash o PowerShell (en PowerShell 5.1 encadena con `;`).
- `.env` local (ver [`.env.example`](.env.example)): solo `DATABASE_URL` y `JWT_SECRET`
  (+ `SHADOW_DATABASE_URL` y `PUPPETEER_EXECUTABLE_PATH` en desarrollo).
- Comandos:

  | Tarea | Comando |
  |---|---|
  | Instalar | `npm ci` |
  | Desarrollo (puerto de `.env`, local 3010) | `npm run dev` |
  | Lint · tipos · pruebas | `npm run lint` · `npx tsc --noEmit` · `npm test` |
  | Build · producción | `npm run build` · `npm start` |
  | Migraciones (dev / deploy) | `npx prisma migrate dev` · `npx prisma migrate deploy` |
  | Verificar que no hay drift | `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <shadow> --exit-code` |
  | Catálogos (idempotente) | `npm run seed` (`-- --demo` agrega tipos de ejemplo) |
  | Primer Owner | `npm run bootstrap:admin:dev -- --correo tu@undc.edu.pe` |
  | Pregenerar las credenciales PDF de un evento (tras desplegar la 014) | `npm run credenciales:pregenerar:dev -- --evento <código>` |

- BD local: MySQL 8.4 en Docker (`ciisic-mysql`, puerto 3310). **Nunca** apuntes a producción
  desde desarrollo.

## Arquitectura

- `config/env.ts`: variables validadas (solo 2 obligatorias; la clave de los secretos se deriva
  de `JWT_SECRET`).
- `src/core/`: errores (`HttpError`), fechas de Lima, cifrado (`crypto.ts`), sesiones JWT con
  audiencia (`sesiones.ts`), configuración del sistema con caché (`configuracion-sistema.ts`),
  URLs salientes anti-SSRF (`url-saliente.ts`), reglas del correo institucional; roles y permisos
  del staff (`catalogos.ts`, `permisos.ts`), la cuenta leída de la BD (`actor.ts`) y los
  resolutores del evento de cada recurso (`resolutores-evento.ts`); códigos de acceso y de
  credencial (`codigos.ts`), semáforo de PDF (`concurrencia.ts`), tipo real y limpieza de
  imágenes (`imagenes.ts`), firma de bytes de un PDF (`pdf.ts`) y rutas, nombres y escritura atómica
  de archivos (`almacenamiento.ts`).
- `src/api/certificate/` (spec 015): `pdf/` (motor con `pdf-lib` + `@pdf-lib/fontkit`: estampado,
  texto, QR vectorial, lectura acotada de PDF de afuera (`lector.ts`), verificación CMS de las firmas
  (`cms.ts`), firmas, coincidencia y cambios después del generado (`firmas.ts`), validación del
  diseño; `pdf/fuentes/` con las
  TTF y sus licencias), `codigos/` (código local y adaptador `ProveedorCodigoCertificado`: LOCAL y
  UNDC pendiente) y `services/` (tipos, configuración, plantillas, emisión, generación, descargas con
  `yazl`, firmados, verificación).
- `src/middlewares/`: `auth.ts` (`requirePermiso`, `requireActor`, `requireParticipante`,
  `requireSesion`), `sitio.ts` (`requireTokenEvento`), `rate-limit.ts` (por IP, token,
  participante o cuenta de staff), `legacy.ts`, `upload.ts`, `validate.ts`.
- `src/api/<módulo>/{controllers,routes,services}` + `validation.ts`; las rutas se autocargan
  (`src/loaders/routesLoader.ts`) con `buildRouter(AppRoute[])`.
- Prisma 6 (`prisma/schema.prisma`, modelos en español con `@@map`); migraciones en
  `prisma/migrations/` (las de datos, escritas a mano).
- Imagen Docker: `docker-entrypoint.sh` valida el entorno, aplica `prisma migrate deploy` e inicia.

## Convenciones de código

- TypeScript estricto, CommonJS, comillas simples, sin punto y coma, sin `any`.
- Nombres de dominio en español (`inscripcion`, `evento`); módulos y rutas HTTP en inglés
  (`/v1/events`), como el resto del proyecto.
- Validación con `validateBody(schema yup)` en la ruta (422 `VALIDATION_ERROR`); errores de
  negocio con `HttpError(status, code, mensaje)`; mensajes para usuarios en español.
- Respuestas nuevas `{ success, data, meta? }`.
- Pruebas con Jest + supertest; Prisma se simula por archivo (`jest.mock('../../src/database/prisma')`);
  proveedores externos con `fetch` o bibliotecas simuladas, nunca credenciales reales.

## Reglas de negocio clave (no romper)

- Todo dato pertenece a un **evento**; la API del sitio toma el evento **solo del token**.
- El servidor calcula precios, estados y montos; ignora `estadoId`, `pago`, `descuento` y rutas
  de archivo enviadas por el cliente. Precio UNDC en la categoría estudiantil solo con un token
  de verificación de estudiante válido y coincidente.
- Aprobar genera la credencial y envía el correo; si el correo falla, la aprobación se mantiene.
- Google en la landing es **opcional** y no cambia precios; en el panel entra una cuenta de staff
  activa (cualquier dominio) o un participante inscrito (portal), este con Google **o con un código
  de 6 dígitos por correo** (spec 014).
- Código por correo: siempre abre una sesión de **participante** (12 h), nunca de staff; se envía
  también a cuentas vinculadas a Google; la respuesta de la solicitud es idéntica exista o no el
  correo. El staff pasa a su portal solo con `POST /v1/auth/participant/switch` (sesión de Google;
  con contraseña, el código); no hay camino del portal al panel.
- Una reinscripción con otro correo **nunca** cambia el correo registrado desde un formulario
  público, ni aunque el nuevo venga verificado con Google (eso prueba el correo, no que sea el dueño
  del documento: sería una toma de cuenta): se conserva, se avisa a ese correo, la respuesta lleva
  `correoConservado` y el precio por dominio sale del correo registrado. Solo el staff lo cambia
  (`PUT /v1/participants/:id`): se avisa al correo anterior y se registra con ids.
- Cada inscripción tiene `codigo_credencial` (10 caracteres `[0-9A-Z]`, único): es lo único que va
  en el QR del fotocheck y del PDF. Se crea con `conReintentoDeCodigo(nuevoCodigoCredencial)` y, si
  falta, `asegurarCodigoCredencial`. Va en el detalle, **nunca** en listados, búsquedas, el CSV ni en
  un dato que salga en ellos (el `numeroOperacion` de una cortesía es aleatorio e independiente). El
  QR anterior (id del participante) solo vale con `es_qr_legado` y hasta el `fechaFin` del evento.
- Staff (spec 013): Owner (`SUPERADMIN`) y Administrador del sistema (`ADMIN`) son globales;
  Tesorero y Comisión solo operan en sus eventos. Solo el Owner configura Sistema y gestiona Owners
  y Administradores. Sin `pagos.ver` no salen montos ni datos de pago (van en `null`).
- Reglas del dominio institucional fijas en `src/core/correo-institucional.ts` (`undc.edu.pe`,
  parte local numérica = estudiante).
- Certificados (spec 015):
  - Permisos `certificados.gestionar` (global: tipos, plantillas, emitir, editar, anular, forzar,
    reemplazar o quitar un firmado, proveedor y prefijo), `certificados.operar` (por evento: generar,
    descargar para firmar, subir firmados) y `certificados.ver` (por evento). `ver` y `operar` son
    elegibles para la Comisión y nunca vienen marcados; el Tesorero tiene `ver`. Las credenciales de
    la API UNDC son de Sistema (`sistema.configurar`, solo Owner).
  - Emitir exige plantilla (del evento y activa) y tipo; una persona nueva se registra con
    `crearParticipante` (spec 014) y **correo obligatorio**. Un certificado vigente es único por
    evento, participante, tipo y ponencia (`clave_vigente`, NULL solo si ANULADO).
  - El código `<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>` se asigna al emitir y no cambia; el código impreso y
    la URL de verificación (`<url_panel>/verificar/<código>`, nunca guardada en la configuración) se
    congelan al generar. Sin URL del panel: `422 VERIFICATION_URL_NOT_CONFIGURED`.
  - Generar y subir firmados: tandas **síncronas** de ≤10, idempotentes y reanudables (sin trabajos en
    segundo plano), con `setImmediate` entre certificados y actualización optimista. Un firmado
    **nunca** se regenera; editar devuelve a PENDIENTE.
  - Descargar para firmar solo con `certificados_proveedor_confirmado` (`409 PROVIDER_NOT_CONFIRMED`).
  - Un firmado entra sin forzar (`pdf/firmas.ts`) solo si sus firmas **verifican** (CMS: `ByteRange`,
    `messageDigest` y firma con el certificado que trae; sin cadena de confianza: se guardan los
    `firmantes`), no trae contenido activo y es el generado vigente con firmas agregadas (prefijo
    SHA-256) sin cambiar nada de lo generado (`SIGNED_MODIFIED`). Un PDF reescrito con el `Subject`
    vigente (METADATOS, `SIGNED_REWRITTEN`), uno que no coincide (`SIGNED_MISMATCH`) o uno con cambios
    solo entra forzado: individual, de `certificados.gestionar` y con motivo. Nunca uno con una firma
    que no verifica o con contenido activo.
  - Reemplazar un FIRMADO es de `certificados.gestionar`; un EN_FIRMA solo se reemplaza por uno que lo
    continúe o tenga más firmas; el firmado anterior nunca se borra (`firmados/reemplazados/`).
  - El portal muestra **solo los FIRMADO** propios; la verificación pública solo responde FIRMADO o
    ANULADO, nunca con documento, correo ni PDF.
  - Proveedor UNDC (certificados.undc.edu.pe): pendiente, `501 CERTIFICATE_PROVIDER_PENDING`.
- Las rutas legacy existen para la landing anterior y se apagan desde el panel (Sistema).

## Seguridad

- El entorno solo lleva `DATABASE_URL` y `JWT_SECRET`. Toda otra configuración va a la BD
  (panel) o es constante: **no agregues variables de entorno nuevas**.
- Secretos en BD cifrados con `cifrar`/`descifrar` (AES-256-GCM, clave derivada de `JWT_SECRET`:
  rotarlo obliga a volver a guardarlos); la API devuelve solo el sufijo. Tokens entrantes (acceso
  del sitio) solo como hash SHA-256, que no depende de `JWT_SECRET`.
- Guardas obligatorias en toda ruta no pública; un token de un perfil nunca abre rutas de otro.
  Staff: `requirePermiso(permiso, { evento })` con un permiso de `src/core/permisos.ts` (los
  permisos por evento necesitan un resolutor de `resolutores-evento.ts`) o `requireActor`; la guarda
  va primera (tras `rutaLegacy`), antes de `upload` y `validateBody`. Los roles se nombran con
  `ROL.OWNER`/`ROL.ADMINISTRADOR`, nunca con los literales `'SUPERADMIN'`/`'ADMIN'` (el
  `tipo: 'ADMIN'` de las respuestas de sesión es otra cosa y se mantiene).
- Sesiones del staff: el JWT lleva la huella de las credenciales (`huellaCredenciales`: correo,
  contraseña y cuenta Google) y el inicio de la sesión. Cambiar esas credenciales cierra las sesiones
  abiertas; `POST /v1/auth/refresh` conserva el inicio y se corta a las 12 h.
- CORS abierto (`*`, sin cookies): la seguridad es el token. Toda ruta del sitio lleva límite por
  visitante **y** por token.
- URLs salientes configurables: `validarUrlSaliente` + `asegurarDestinoPublico`.
- Escapar texto de usuario en HTML (PDF, correos). No registrar secretos ni tokens, ni correos ni
  códigos de acceso (en la BD solo su HMAC, `codigos_acceso`).
- Fotos del participante: solo PNG o JPEG por la firma de bytes (`tipoDeImagen`), `limpiarMetadatos`
  (deja solo lo necesario para decodificar, valida la estructura y rechaza más de 4096 px por lado:
  `422 IMAGE_TOO_LARGE`), nombre generado (`nuevoNombreFoto`, escritura con `flag: 'wx'`) y lectura
  solo por `rutaFoto` (nunca un nombre que llegue del cliente); consentimiento obligatorio. El staff
  las lee con `GET /v1/inscriptions/:id/photo` (alcance por evento). Los archivos que otra petición
  puede borrar (fotos, PDF de credencial) se sirven con `leerArchivoServido`, no con `res.sendFile`.
- Los envíos de correo que no deben retrasar la respuesta van en diferido y con su `.catch`
  (`enDiferido` de `src/api/inscription/utils/sendEmail.ts`, que registra la causa y los ids, nunca
  el mensaje): no hay manejador global de promesas rechazadas y una sin manejar tumba el proceso.
  Puppeteer solo dentro de `limitarConcurrencia` (`503 PDF_BUSY` con `Retry-After`).
- Errores temporales: `HttpError(…, fields, reintentarEnSegundos)` y el `errorHandler` pone
  `Retry-After`; un 503 de negocio se registra con `console.warn` (código), no como error interno.
- Los envíos que provoca un anónimo (código de acceso) usan `enviarConCredencial(…, { registrar: false })`:
  su fallo no cambia el estado de la credencial (sería un oráculo de qué correos existen).
- Toda carpeta `templates` de `src` necesita su `COPY` en el `Dockerfile` (lo comprueba
  `tests/core/plantillas-docker.test.ts`); también `src/api/certificate/pdf/fuentes` (TTF y
  licencias: `tsc` no copia binarios). Una fuente nueva entra con su licencia y pasa la prueba de
  contornos de `tests/certificate/estampado.test.ts` (Great Vibes y Allura perdían glifos al
  embeberse).
- Consultas públicas sin token ni sesión (aparte de `/api/v1/auth/*` y las rutas legacy): solo en la
  familia `/api/v1/public/*` (constitución 1.4.0), con límite por IP **y** un tope global (de fallos:
  que no corte a quien acierta, `topeDeFallos`), un código no adivinable, `404` idéntico para lo que
  no corresponde y sin documento; toda ruta nueva allí va en la lista de públicas intencionales de las
  pruebas de seguridad.
- Archivos de certificados en `uploads/certificados/plantillas/` y
  `uploads/certificados/<eventoId>/{generados,firmados}/` (carpeta por id: el código del evento es
  editable): nombres generados por el servidor, rutas solo con `rutaPlantilla`,
  `rutaCertificadoGenerado` y `rutaCertificadoFirmado`, escritura con `escribirArchivoAtomico` y
  lectura con `leerArchivoServido`. Los firmados no se pueden reponer: nunca se borran (al
  reemplazarlos o quitarlos, `archivarFirmado` los pasa a `firmados/reemplazados/`) y se respaldan
  tras cada carga.
- Todo PDF que llega de afuera (diseños, firmados) se lee con `leerPdf` (`pdf/lector.ts`): topes de
  descompresión (pdf-lib decodifica `/ObjStm` y `/XRef` enteros al cargar) y registro de lo leído
  para comparar con lo que vería un visor. Nunca `PDFDocument.load` directo sobre bytes de afuera.
  La carga de firmados toma turno (`turnoCargaFirmados`, 2 a la vez) **antes** de multer.
- Subidas grandes en memoria y acotadas: `limiteContenido` exige `Content-Length` antes de multer
  (`411`/`413`); los PDF se validan por su firma de bytes (`hasPdfSignature`).

## Ecosistema y comunicación entre sistemas

La fuente de verdad de los contratos es [`docs/arquitectura-ecosistema.md`](docs/arquitectura-ecosistema.md)
(contratos 1–7). Este repositorio **expone** la API de administración (panel), la API del sitio
`/api/v1/site/*` (landings y otras plataformas, con token de acceso del evento), el portal
`/api/v1/me/*`, `/api/v1/auth/*` (incluido el código por correo, `/api/v1/auth/participant/*`) y la
verificación pública de certificados `/api/v1/public/*` (contrato 6); **consume** API_UNDC
(`POST /externo/estudiantes/verificar`), deportes-fi (`/api/v1/integrations/event/*`),
Decolecta/apiperu, Brevo y Google, y consumirá la API de certificados de la UNDC
(certificados.undc.edu.pe, contrato 7, **pendiente**).

| Sistema | Repositorio | Relación con este repo |
|---|---|---|
| Panel del congreso | `gians96/administrator-ciisic-frontend` | Consumidor (BFF con Bearer desde cookie httpOnly) |
| Landing del evento | `gians96/ciisic-undc-web` | Consumidor de `/api/v1/site/*` (token del evento, desde su servidor) |
| API UNDC | `API_UNDC` (+ UI `app-web-sigenet` para crear la API key) | Proveedor (verificación de estudiantes) |
| Deportes FI | `deportes-fi/backend` (+ `frontend` para crear el token por evento) | Proveedor (resumen Semana Sistémica) |
| Certificados UNDC | `certificados.undc.edu.pe` (externo, de la UNDC) | Proveedor del código de certificados (**pendiente**: hoy `501`) |

Puertos locales: landing 3000 · panel 3001 · backend-ciisic 3010 · API_UNDC 3020 · deportes-fi 3030.

**Protocolo de cambio de contrato**: 1) spec en el repo proveedor con `contracts/`; 2) actualizar
`docs/arquitectura-ecosistema.md`; 3) cambio compatible hacia atrás o alias temporal (como las
rutas legacy); 4) el consumidor se actualiza en su propio repo y rama; 5) prueba integrada local
con ambos sistemas levantados.

**Trabajo con agentes (varias sesiones en paralelo)**:
- Un agente por repositorio a la vez. Al empezar: `git status` y `git log --oneline -10`; si hay
  cambios sin comitear que no son tuyos, detente y coordina.
- No modifiques otros repositorios: documenta el contrato y pide el cambio a quien trabaje allí.
- Git: ramas `feat/*`; `git add <rutas explícitas>` (nunca `-A` ni `.`); commits convencionales en
  español; sin push, merge ni despliegues sin confirmación humana.
- Producción solo con permiso explícito y empezando por un respaldo de solo lectura (`mysqldump`).
- Al terminar, reporta commits, pruebas y pendientes.

## SDD con Spec Kit

Constitución: [`.specify/memory/constitution.md`](.specify/memory/constitution.md). Cada cambio
empieza en `specs/NNN-nombre/` (spec → plan → tasks → contracts) y se marcan las tasks al
implementar. Specs actuales: 001–015 (ver [README](README.md)); la 015 es la de certificados
(diseño y revisión adversarial en su `research.md`).

## Antes de dar por terminado

1. `npm run lint`, `npx tsc --noEmit` y `npm test` en verde.
2. Si cambiaste el esquema: migración nueva (a mano si toca datos) y `prisma migrate diff` vacío.
3. Contrato actualizado en `specs/*/contracts/` y, si afecta a otro sistema, en `docs/arquitectura-ecosistema.md`.
4. Si agregaste configuración: en la BD (panel) o como constante, no como variable de entorno.
5. Documentación de `docs/` al día (configuración, operación).
