# API

Base `/api`. Respuestas de éxito `{ "success": true, "data": … , "meta"? }`; errores
`{ "success": false, "code", "message", "fields"? }` con códigos estables (p. ej.
`VALIDATION_ERROR`, `EVENT_TOKEN_REQUIRED`, `RATE_LIMITED`). CORS abierto a cualquier origen
(sin cookies): la API la protege el token.

## Autenticación por audiencia

| Audiencia | Cómo | Rutas |
|---|---|---|
| Administración (staff) | `Authorization: Bearer <JWT>` (aud `ciisic-admin`, 1 h renovable); permiso por ruta según el rol: Owner, Administrador del sistema, Tesorero o Comisión (spec 013) | `/api/v1/events…`, `/inscriptions…`, `/certificates…`, `/certificate-templates…`, `/settings`, `/email-credentials`, `/lookup-tokens`, `/admin`, `POST /api/v1/auth/refresh`, `POST /api/v1/auth/participant/switch`, … |
| Sitio del evento (landing u otra plataforma) | `X-Api-Key: <token de acceso del evento>` (+ `X-Client-Ip` desde un BFF) | `/api/v1/site/*` |
| Portal del inscrito | `Authorization: Bearer <JWT>` (aud `ciisic-participante`, 12 h; con Google o con un código por correo) | `/api/v1/me/*` |
| Sesión y configuración pública | sin token (con límites) | `POST /api/v1/auth/login`, `POST /api/v1/auth/google`, `POST /api/v1/auth/participant/code`, `POST /api/v1/auth/participant/code/verify`, `GET /api/v1/auth/config` |
| Verificación pública (spec 015) | sin token, con límite por IP **y** global; solo lectura con un código no adivinable y sin documento | `GET /api/v1/public/certificates/:codigo` |

Un token de un perfil en rutas de otro responde `403 FORBIDDEN`.

Staff (spec 013): la guarda `requirePermiso` lee la cuenta de la BD en cada petición.
`401 SESSION_INVALIDATED` si la cuenta se borró, se desactivó o tiene un rol desconocido, o si
cambiaron su correo, su contraseña o su cuenta Google desde que se firmó el JWT;
`403 FORBIDDEN` sin el permiso de la ruta; las cuentas con eventos asignados (Tesorero, Comisión)
reciben `403 EVENT_NOT_ASSIGNED` fuera de sus eventos y `404 NOT_FOUND` si el recurso no existe.
El login, Google, `GET /api/v1/auth/session` y `POST /api/v1/auth/refresh` devuelven el usuario con
`acceso` (alcance, permisos y eventos). La renovación conserva el inicio de la sesión y se corta a
las 12 h (`401 SESSION_EXPIRED`). Sin `pagos.ver` los montos y datos de pago salen en `null`.

Portal y fotocheck (spec 014): el inscrito entra con Google o con un código de 6 dígitos enviado a
su correo (también si está vinculado a Google); ambos abren una sesión de participante de 12 h, sin
renovación. El staff que entró con Google pasa a su portal con `POST /api/v1/auth/participant/switch`
(con contraseña: `409 CODE_REQUIRED`). `GET /api/v1/auth/config` agrega
`accesoCodigo: { disponible }`. Cada inscripción tiene un código de credencial de 10 caracteres
(`codigoCredencial`, solo en el detalle) que va en el QR del fotocheck y del PDF; el escáner marca
asistencia con `{ codigo }` y acepta el QR anterior (`{ participanteId }`) con `alerta: 'QR_LEGADO'`
hasta el fin del evento. Una reinscripción con otro correo conserva el correo registrado, aunque el
nuevo venga verificado con Google (`correoConservado: true`); solo el staff lo cambia.

Certificados (spec 015): plantillas PDF por evento con campos ubicados y vista previa; emisión
(individual, desde inscritos aprobados con asistencia mínima o por lista) con plantilla obligatoria
y un código fijo `<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>`; generación en tandas síncronas de 10;
descarga para firmar (archivo o ZIP) solo con el proveedor del código confirmado
(`409 PROVIDER_NOT_CONFIRMED`); carga de firmados en tandas que solo acepta el PDF generado vigente
(`SIGNED_MISMATCH`). Permisos `certificados.gestionar` (global), `certificados.operar` y
`certificados.ver` (por evento; elegibles para la Comisión). El portal (`GET /api/v1/me/certificates`)
lista solo los firmados propios y la verificación pública (`GET /api/v1/public/certificates/:codigo`)
responde solo FIRMADO (`VALIDO`) o ANULADO, sin documento. El código de la API de la UNDC está
pendiente (`501 CERTIFICATE_PROVIDER_PENDING`).

## Contratos (fuente de verdad)

| Área | Contrato |
|---|---|
| Administración (eventos, tipos, inscripciones, actividades) | [`specs/002-multi-evento/contracts/api-admin.md`](../specs/002-multi-evento/contracts/api-admin.md) |
| Consultas DNI y pool de tokens | [`specs/003-consultas-dni/contracts/api-consultas.md`](../specs/003-consultas-dni/contracts/api-consultas.md) |
| Verificación de estudiantes | [`specs/004-verificacion-estudiante/contracts/api-verificacion.md`](../specs/004-verificacion-estudiante/contracts/api-verificacion.md) |
| Integraciones (deportes-fi) | [`specs/005-integracion-deportes/contracts/api-integraciones.md`](../specs/005-integracion-deportes/contracts/api-integraciones.md) |
| Credenciales de correo | [`specs/006-credenciales-correo/contracts/api-credenciales-correo.md`](../specs/006-credenciales-correo/contracts/api-credenciales-correo.md) |
| API del sitio y tokens de acceso | [`specs/007-tokens-acceso-evento/contracts/api-sitio.md`](../specs/007-tokens-acceso-evento/contracts/api-sitio.md) |
| Configuración del sistema | [`specs/008-configuracion-sistema/contracts/api-configuracion.md`](../specs/008-configuracion-sistema/contracts/api-configuracion.md) |
| Acceso con Google | [`specs/010-google-sign-in/contracts/api-google.md`](../specs/010-google-sign-in/contracts/api-google.md) |
| Portal del inscrito (v1) | [`specs/011-portal-participante/contracts/api-portal.md`](../specs/011-portal-participante/contracts/api-portal.md) |
| Portal v2: perfil, foto, fotocheck y asistencia | [`specs/014-portal-fotocheck-asistencia/contracts/api-portal.md`](../specs/014-portal-fotocheck-asistencia/contracts/api-portal.md) |
| Acceso al portal con código por correo y cambio del staff al portal | [`specs/014-portal-fotocheck-asistencia/contracts/api-acceso-codigo.md`](../specs/014-portal-fotocheck-asistencia/contracts/api-acceso-codigo.md) |
| Asistencia por QR, código y PDF de la credencial, alta de participantes, cortesías y correo conservado | [`specs/014-portal-fotocheck-asistencia/contracts/api-asistencia.md`](../specs/014-portal-fotocheck-asistencia/contracts/api-asistencia.md) |
| Roles, permisos y alcance por evento (permiso de cada ruta, sesión con `acceso`, equipo) | [`specs/013-roles-permisos/contracts/api-roles-permisos.md`](../specs/013-roles-permisos/contracts/api-roles-permisos.md) |
| Certificados: tipos, plantillas, emisión, generación, firmados, descargas, portal y verificación pública | [`specs/015-certificados/contracts/api-certificados.md`](../specs/015-certificados/contracts/api-certificados.md) |
| Rutas legacy (landing anterior) | [`specs/002-multi-evento/contracts/api-publica.md`](../specs/002-multi-evento/contracts/api-publica.md) |

## Límites

- Por visitante (IP; en la API del sitio, `X-Client-Ip` con token válido): lecturas 120/min,
  inscripción 10/15 min, verificación 20/min, DNI 10/min, ponencias 10/15 min, contacto
  5/15 min, login con contraseña 10/15 min, login con Google 120/15 min, solicitud de código
  60/15 min y verificación de código 120/15 min.
- Código por correo (spec 014): por correo, 60 s entre solicitudes, 5 por hora y 10 por día
  (`429 CODE_COOLDOWN`) y 10 fallos por hora (`429 CODE_LOCKED`); 200 solicitudes por hora por IP
  (`429 RATE_LIMITED`); como mucho 400 códigos **enviados** por hora y 2000 por día en total
  (`503 CODE_LOGIN_UNAVAILABLE`, igual exista o no el correo), todo contado en la BD. En memoria del
  proceso: 50 códigos incorrectos por hora por IP (`429 RATE_LIMITED`) y 150 verificaciones fallidas
  por hora contra participantes existentes pausan el acceso por código 1 h
  (`503 CODE_LOGIN_PAUSED`; los fallos con correos inventados no cuentan). Los 429 y 503 con espera
  llevan `Retry-After`.
- Por token del sitio: lecturas 3000/min, DNI 60/min y 1500/día, verificación 50/min, Google
  300/min, inscripciones 150/15 min, ponencias y contacto 60/15 min.
- Por participante (portal): 60/min; descarga de credencial o de certificado 10/min; cambio de
  foto 10/h.
- Por cuenta de staff: marcar asistencia 120/min (solo Tesorero y Comisión), reenvío de
  credencial 20/15 min, renovación de sesión 30/15 min, cambio al portal 20/15 min, vista previa
  de plantillas de certificado 30/min y cargas de firmados 30/min.
- Verificación pública de certificados (spec 015): 30/min por IP y un tope global de 1200 códigos
  **inexistentes** por minuto (pasado el tope, esos responden `429`; un código real siempre
  responde); un código con otro formato responde `404` sin consultar la BD ni contar.
- Carga de firmados (en memoria, por proceso): 2 cargas a la vez y 4 en espera, antes de leer el
  cuerpo (`503 SIGNED_UPLOAD_BUSY`, `Retry-After: 5`). Los PDF de afuera (diseños y firmados) se leen
  con topes de descompresión (32 MiB por flujo, 64 MiB por archivo).
- Certificados (en memoria, por proceso): generación 2 tandas a la vez y 4 en espera
  (`503 GENERATION_BUSY`, `Retry-After: 5`); vista previa 2 a la vez y 10 en espera
  (`503 PDF_BUSY`). Tamaños: diseño 5 MB y 2 páginas; firmado 10 MB; carga de 10 archivos y 25 MB
  con `Content-Length` obligatorio (`411 LENGTH_REQUIRED`); 10 certificados por tanda de
  generación; 300 filas y 50 consultas DNI por importación; ZIP de hasta 500 por parte.
- Generación de PDF de credenciales (global, en memoria): 2 a la vez y 30 en cola, cada paso de
  puppeteer con un tope de 30 s; con la cola llena, `503 PDF_BUSY` (`Retry-After: 10`) en las
  descargas y `credencialEnviada: false` al aprobar o reenviar.
- Fotos del fotocheck: JPG o PNG de hasta 2 MB y 4096 px por lado (`422 IMAGE_TOO_LARGE`).

## Salud

`GET /health` → `{ status: 'ok' }` (consulta la BD). Lo usa el `HEALTHCHECK` de la imagen.
