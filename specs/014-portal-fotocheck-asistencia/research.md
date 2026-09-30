> **Borrador de diseño (2026-09-30).** Generado por arquitectos y revisado adversarialmente antes de la spec.
> Donde contradiga a `spec.md`/`plan.md` de esta carpeta o a la reconciliación de abajo, **mandan la spec y el plan**.
>
> Reconciliación transversal (acordada con el usuario):
> - Permisos con punto de `src/core/permisos.ts` (p. ej. `asistencia.marcar`, `certificados.operar`); los nombres `ASISTENCIA_REGISTRAR`, `GESTION`, etc. quedan reemplazados.
> - Columnas de `asistencias` (`metodo` ENUM QR/QR_LEGADO/DOCUMENTO/MANUAL, `registrado_por_id`, `es_fuera_de_horario`, `anulado_en`, `anulado_por_id`) van en la migración de la spec 013; la anulación es lógica y volver a marcar reactiva la fila.
> - Cambio staff → portal: `POST /v1/auth/participant/switch` (spec 014). El código por correo se envía también a cuentas vinculadas a Google.
> - Reinscripción sin verificación: se **conserva** el correo registrado (sin 409) y se avisa (`correoConservado`).
> - Código de inscripción: columna `codigo_credencial`. Foto para el escáner: `GET /v1/inscriptions/:id/photo`.
> - Configuración de certificados en columnas `certificados_*` de `configuracion_sistema` (no tabla aparte); credenciales UNDC solo Owner (Sistema); el resto con `certificados.gestionar`. Descarga para firmar solo con proveedor confirmado.
> - Certificados: editor visual (pdfjs-dist) en la primera fase; el portal muestra solo los FIRMADOS.
> - Sesión del staff renovable con `POST /v1/auth/refresh`; participante 12 h.

# Bloque B definitivo: portal del participante, fotocheck y asistencia por QR (backend spec 014, panel spec 009)

## 1) Resumen
1. **Portal del inscrito.** Se entra con Google o con un código de 6 dígitos que llega al correo. Muestra el fotocheck virtual (QR con un código aleatorio de 10 caracteres, foto opcional y copia guardada en el propio celular), la asistencia, el perfil y los certificados (el contrato de certificados lo define el bloque C). La sesión dura 12 h.
2. **Asistencia.** Se registra por código, por el QR anterior (con aviso) o por documento. Queda auditada con quién la registró, cómo y si fue fuera de horario. Cada operación usa los permisos y el alcance por evento del bloque A. Hay escáner con la cámara del celular, lector USB y DNI.
3. **Correcciones de la crítica que incorporo.** Paso a la URL interna de Docker y subo los límites por IP. La migración es compatible con la imagen anterior (`codigo` admite NULL). La reinscripción ya no puede cambiar el correo sin verificarlo. El código por correo no sirve para cuentas vinculadas a Google, acepta los 2 últimos códigos y tiene un disyuntor global. El PDF se genera con un semáforo y una huella completa. La exportación queda solo con `ASISTENCIA_VER`.
4. **Orden.** Primero el bloque A (spec 013) y después B, porque se trabaja con un agente por repositorio a la vez (`B/AGENTS.md:110`, `P/AGENTS.md:95`). La migración de B lleva un timestamp posterior a la de A. Todo es aditivo y el panel anterior sigue funcionando con el backend nuevo.
5. **Antes del 26-oct es imprescindible:** la URL interna y los límites, la migración, el código en las inscripciones y su PDF, la asistencia, el escáner, `/badge` con `mi-fotocheck`, el código por correo y la regla del correo al reinscribirse. Lo demás va en la fase 2 (hasta el 21-oct) o después del evento.

Verifiqué en el código:
- `panel-admin.env:4` apunta a la URL pública del backend.
- `inscription.ts:99-108` cambia el correo y borra `googleSub`.
- `email-credential.ts:153-159` no revisa `ultimoEstado`.
- `server.ts` no tiene manejador de promesas rechazadas.
- La constitución (`:21-22`) pide booleanos `es_*`.
- `seed` está en `src/database/seed.ts:27` (incluye `ruc`).
- Las líneas de las citas (`sesiones.ts:54-56`, `google-auth.ts:56`, controlador de activity `:26-28` y `:41-47`) y los conteos (308 inscripciones y 585 asistencias, `docs/despliegue-ecosistema.md:57-58` del backend) coinciden con la crítica.

## 2) Modelo de datos

### Prisma (`prisma/schema.prisma`)

```prisma
/// Código de acceso al portal por correo (spec 014). Solo HMAC-SHA256(correo:código).
/// participanteId NULL = correo sin registro o vinculado a Google (no se envía código).
model CodigoAcceso {
  id             Int           @id @default(autoincrement())
  correo         String        @db.VarChar(191)
  codigoHash     String        @map("codigo_hash") @db.Char(64)
  participanteId Int?          @map("participante_id")
  ip             String?       @db.VarChar(45)
  intentos       Int           @default(0)
  expiraEn       DateTime      @map("expira_en")
  usadoEn        DateTime?     @map("usado_en")
  invalidadoEn   DateTime?     @map("invalidado_en")
  creadoEn       DateTime      @default(now()) @map("creado_en")
  participante   Participante? @relation(fields: [participanteId], references: [id], onDelete: Cascade, map: "fk_codigos_acceso_participante")
  @@index([correo, creadoEn], map: "idx_codigos_acceso_correo_creado")
  @@index([ip, creadoEn], map: "idx_codigos_acceso_ip_creado")
  @@index([participanteId], map: "idx_codigos_acceso_participante")
  @@index([creadoEn], map: "idx_codigos_acceso_creado")
  @@map("codigos_acceso")
}

enum MetodoAsistencia { QR QR_LEGADO DOCUMENTO MANUAL }

// Participante (+)
  fotoArchivo       String?        @map("foto_archivo") @db.VarChar(80)
  fotoActualizadaEn DateTime?      @map("foto_actualizada_en")
  codigosAcceso     CodigoAcceso[]
// Inscripcion (+). NOT NULL en una migración posterior al 31-oct
  codigo            String?        @unique(map: "uq_inscripciones_codigo") @db.Char(10)
  esQrLegado        Boolean        @default(false) @map("es_qr_legado")
// Asistencia (+). metodo NULL = histórico (585 filas)
  registradoPorId   Int?              @map("registrado_por_id")
  metodo            MetodoAsistencia?
  esFueraDeHorario  Boolean           @default(false) @map("es_fuera_de_horario")
  registradoPor     Administrador?    @relation("AsistenciaRegistrador", fields: [registradoPorId], references: [id], onDelete: SetNull, map: "fk_asistencias_registrado_por")
  @@index([registradoPorId], map: "idx_asistencias_registrado_por")
// Administrador (+)
  asistenciasRegistradas Asistencia[] @relation("AsistenciaRegistrador")
```

### Migración
Archivo: `prisma/migrations/20261009120000_portal_fotocheck_asistencia/migration.sql`. El timestamp debe ser mayor que el de la migración de A; hay que ajustarlo al hacer el merge.

```sql
-- ============================================================================
-- Spec 014 · Portal del participante, fotocheck y asistencia por QR
-- 1) Códigos de acceso por correo (solo hash; 10 min; 5 intentos por código).
-- 2) Foto opcional del participante (uploads/fotos).
-- 3) Código aleatorio de la inscripción para el QR (NULL permitido: la imagen anterior inserta sin él);
--    es_qr_legado marca a quien pudo recibir la credencial con el QR anterior (id del participante).
-- 4) Auditoría de asistencia: quién, cómo y si fue fuera de horario.
-- Compatible hacia atrás: toda columna nueva admite NULL o tiene DEFAULT. La sentencia riesgosa
-- (índice único) va al final para facilitar la reparación.
-- ============================================================================
CREATE TABLE `codigos_acceso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `correo` VARCHAR(191) NOT NULL,
    `codigo_hash` CHAR(64) NOT NULL,
    `participante_id` INTEGER NULL,
    `ip` VARCHAR(45) NULL,
    `intentos` INTEGER NOT NULL DEFAULT 0,
    `expira_en` DATETIME(3) NOT NULL,
    `usado_en` DATETIME(3) NULL,
    `invalidado_en` DATETIME(3) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `idx_codigos_acceso_correo_creado`(`correo`, `creado_en`),
    INDEX `idx_codigos_acceso_ip_creado`(`ip`, `creado_en`),
    INDEX `idx_codigos_acceso_participante`(`participante_id`),
    INDEX `idx_codigos_acceso_creado`(`creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `codigos_acceso` ADD CONSTRAINT `fk_codigos_acceso_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `participantes`
    ADD COLUMN `foto_archivo` VARCHAR(80) NULL,
    ADD COLUMN `foto_actualizada_en` DATETIME(3) NULL;

ALTER TABLE `asistencias`
    ADD COLUMN `registrado_por_id` INTEGER NULL,
    ADD COLUMN `metodo` ENUM('QR', 'QR_LEGADO', 'DOCUMENTO', 'MANUAL') NULL,
    ADD COLUMN `es_fuera_de_horario` BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX `idx_asistencias_registrado_por` ON `asistencias`(`registrado_por_id`);
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_registrado_por` FOREIGN KEY (`registrado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `inscripciones`
    ADD COLUMN `codigo` CHAR(10) NULL,
    ADD COLUMN `es_qr_legado` BOOLEAN NOT NULL DEFAULT false;
-- 64 bits aleatorios → base 36 (mayúsculas) → últimos 10 caracteres (~51 bits)
UPDATE `inscripciones` SET `codigo` = RIGHT(LPAD(CONV(HEX(RANDOM_BYTES(8)), 16, 36), 13, '0'), 10) WHERE `codigo` IS NULL;
UPDATE `inscripciones` i JOIN `estados_inscripcion` e ON e.`id` = i.`estado_id`
   SET i.`es_qr_legado` = true WHERE e.`codigo` = 'APROBADO' OR i.`credencial_enviada_en` IS NOT NULL;
CREATE UNIQUE INDEX `uq_inscripciones_codigo` ON `inscripciones`(`codigo`);
```

**Ensayo con el respaldo.** Agregar estas consultas a `prisma/preflight/conteos-despues.sql`:
- `SELECT COUNT(*), COUNT(codigo), COUNT(DISTINCT codigo) FROM inscripciones`: los tres valores deben ser iguales.
- `SELECT COUNT(*) FROM inscripciones WHERE es_qr_legado`.
- `prisma migrate diff` debe salir vacío.

**Si falla la última sentencia** (probabilidad de colisión de unos 1e-11), el runbook es:
1. Regenerar `codigo` solo en las filas duplicadas.
2. Ejecutar a mano `CREATE UNIQUE INDEX`.
3. Ejecutar `prisma migrate resolve --applied 20261009120000_portal_fotocheck_asistencia`.

Antes de todo, sacar un `mysqldump`.

## 3) Contratos de API
Los permisos vienen de A: `requirePermiso` y `asegurarEvento` (que responde 403 `EVENT_NOT_ALLOWED`) revalidan contra la BD. Si A no está fusionado, estas rutas usan `verifyAdminRole`. Los nombres de permisos se acuerdan con A: `ASISTENCIA_VER`, `ASISTENCIA_REGISTRAR`, `ASISTENCIA_EXCEPCION`, `ASISTENCIA_QUITAR`, `PARTICIPANTES_VER`, `PARTICIPANTES_CREAR`, `PARTICIPANTES_EDITAR` e `INSCRIPCIONES_CORTESIA`.

| Método | Ruta | Permiso / guardas | Respuesta | Errores |
|---|---|---|---|---|
| POST | `/v1/auth/participant/code` `{correo}` | Pública, `limiteSolicitudCodigo` (60 por IP cada 15 min) | **202** `{expiraEnSegundos:600,reintentarEnSegundos:60}`, igual exista o no el correo | 422; 429 `CODE_COOLDOWN` (con `Retry-After`); 429 `RATE_LIMITED`; 503 `CODE_LOGIN_UNAVAILABLE` |
| POST | `/v1/auth/participant/code/verify` `{correo,codigo:/^\d{6}$/}` | Pública, `limiteVerificacionCodigo` (120 por IP cada 15 min) | `{jwt,tipo:'PARTICIPANTE',participante,expiraEn}` (12 h, `metodo:'CODIGO'`) | 401 `INVALID_CODE` `{restantes}`; 401 `CODE_EXPIRED`; 429 `CODE_LOCKED`; 503 `CODE_LOGIN_PAUSED` |
| POST | `/v1/auth/participant/switch` | Sesión de administrador (cualquier rol, revalidada), `limiteLoginGoogle` | Igual que `verify` (`metodo:'GOOGLE'`) | 403 `ACCOUNT_DISABLED`; 409 `CODE_REQUIRED`; 404 `PARTICIPANT_NOT_FOUND`; 403 `GOOGLE_ACCOUNT_MISMATCH` |
| POST | `/v1/auth/google` | `limiteLoginGoogle` (120 por IP cada 15 min) | La rama ADMIN agrega `tambienParticipante:boolean` | Sin cambios |
| GET | `/v1/auth/session` | Cualquier sesión | ADMIN: `+portal:{mismoCorreo,directo}`. PARTICIPANTE: `+panel:{disponible}` | Sin cambios |
| GET | `/v1/auth/config` | Pública | `+accesoCodigo:{disponible}`. **`/v1/site/config` no cambia** | Sin cambios |
| GET | `/v1/me` | Participante | `+celular, foto:{tiene,actualizadaEn}, google:{vinculado}` | Sin cambios |
| GET | `/v1/me/inscriptions` | Participante | `+fotocheck:{disponible}` | Sin cambios |
| GET | `/v1/me/inscriptions/:id/badge` | Participante | `{inscripcionId,codigo,qr:dataURL,evento:{nombre,nombreCorto,fechaInicio,fechaFin,sede,logo},participante:{nombres,apellidos,tipoDocumento,documentoEnmascarado},tipoInscripcion,rol:'PARTICIPANTE',foto}` | 404 `INSCRIPTION_NOT_FOUND` (también si es ajena); 409 `NOT_APPROVED` |
| GET | `/v1/me/inscriptions/:id/credential` | Participante (existente) | PDF con el QR nuevo | Además 503 `PDF_BUSY` (cola llena, con `Retry-After`) |
| GET | `/v1/me/attendances` | Participante | `[{evento,totalActividades,asistidas,actividades:[{id,nombre,fecha,horaInicio,horaFin,asistio,registradoEn}]}]`, solo eventos con inscripción APROBADO | Sin cambios |
| PATCH | `/v1/me/profile` `{celular}` | Participante | Perfil | 422 |
| PUT | `/v1/me/photo` multipart `file` + `consentimiento=true` | Participante, `limiteFotoPortal` (10 por hora), después multer | `{foto:{tiene:true,actualizadaEn}}` | 422 `FILE_REQUIRED`, `INVALID_FILE_TYPE`, `INVALID_FILE_CONTENT`, `CONSENT_REQUIRED`; 413 `UPLOAD_LIMIT_EXCEEDED` |
| GET / DELETE | `/v1/me/photo` | Participante | Imagen con `private, no-store`, o `{foto:{tiene:false}}` | 404 `PHOTO_NOT_FOUND` |
| GET | `/v1/me/certificates[/:id/file]` | Participante (**solo contrato; lo implementa C**) | `[{id,evento,rol,titulo,emitidoEn,codigoVerificacion,urlVerificacion}]` | 404 si es ajeno |
| GET | `/v1/events/:eventId/activities` | `ASISTENCIA_VER` o `ASISTENCIA_REGISTRAR`, más alcance | Sin cambios | 403 `EVENT_NOT_ALLOWED` |
| POST | `/v1/activities/:id/attendances` `{codigo}` \| `{participanteId,manual?}` \| `{numeroDocumento,tipoDocumento?}` más `fueraDeHorario?` | `ASISTENCIA_REGISTRAR`, más alcance del evento de la actividad | **201** `{id,registradoEn,metodo,esFueraDeHorario,alerta:'QR_LEGADO'\|null,participante:{id,nombres,apellidos,tipoDocumento,numeroDocumento,foto},inscripcion:{id,tipoInscripcion}}` | 404 `CODE_NOT_FOUND`; 409 `CODE_OTHER_EVENT`; 403 `NOT_APPROVED`; 422 `LEGACY_QR_NOT_ALLOWED`; 409 `AMBIGUOUS_DOCUMENT`; 403 `OVERTIME_NOT_ALLOWED` (también `manual` sin `ASISTENCIA_EXCEPCION`); 409 `OUTSIDE_WINDOW`; 409 `ATTENDANCE_ALREADY_REGISTERED` (con la hora del registro previo) |
| GET | `/v1/activities/:id/attendances` | `ASISTENCIA_VER` o `ASISTENCIA_REGISTRAR`, más alcance | `+metodo,esFueraDeHorario,registradoPor{id,nombres,apellidos}`. Sin `VER`, el documento sale enmascarado | 403 |
| DELETE | `/v1/attendances/:id` | `ASISTENCIA_QUITAR`, más alcance (`asistencia.actividad.eventoId`) | `null` | 404; 403 |
| GET | `/v1/events/:eventId/attendances/export` | **`ASISTENCIA_VER`**, más alcance | Sin cambios | 403 |
| POST / GET | Rutas legacy `/v1/attendances*` (routes `:22-25`) | `rutaLegacy` + **`ASISTENCIA_EXCEPCION`** (solo OWNER y ADMINISTRADOR); método `QR_LEGADO` con la regla del QR anterior | Sin cambios | 410 si están desactivadas |
| GET | `/v1/participants/:id/photo` | `ASISTENCIA_REGISTRAR` o `PARTICIPANTES_VER`, más alcance (el participante tiene inscripción en un evento del usuario) | Imagen, `no-store` | 404; 403 |
| DELETE | `/v1/participants/:id/photo` | `PARTICIPANTES_EDITAR` (moderación) | `null` | 404 |
| POST | `/v1/participants` `{tipoDocumento,numeroDocumento,nombres?,apellidos?,correo,celular?}` | `PARTICIPANTES_CREAR` | 201 `aParticipante` | 409 `PARTICIPANT_EXISTS` `{fields:{id}}`; 409 `EMAIL_IN_USE`; 422 `NAMES_REQUIRED` |
| POST | `/v1/events/:eventId/courtesy-inscriptions` `{participanteId,tipoInscripcionId?,enviarCredencial?}` | `INSCRIPCIONES_CORTESIA`, más alcance | 201: inscripción APROBADO, monto 0, `modalidadPago 'cortesia'`, `numeroOperacion 'CORTESIA-<codigo>'` | 409 `ALREADY_REGISTERED`; 422 `REGISTRATION_TYPE_INVALID` |
| POST | `/v1/inscriptions/:id/regenerate-code` | Fase 3 (OWNER y ADMINISTRADOR) | Código nuevo y `esQrLegado=false` | Sin cambios |

**Cambio de contrato con la landing** (ruta `POST /v1/site/.../inscriptions`, `crearInscripcion`): nuevo 409 `EMAIL_CHANGE_REQUIRES_VERIFICATION`. Ver la decisión 1.

## 4) Cambios en el backend, por archivo
- **`config/env.ts`** (junto a `VERIFICACION_SECRET`, `:42`): agregar `CODIGOS_SECRET = sha256('codigos:'+JWT_SECRET)`. No se crea ninguna variable de entorno nueva.
- **`src/core/sesiones.ts`**
  - `:14`: `MetodoSesion` pasa a `'PASSWORD'|'GOOGLE'|'CODIGO'`.
  - `:12`: nueva constante `SESION_PARTICIPANTE_SEGUNDOS = 12*3600`.
  - `firmar` (`:39-48`) recibe los segundos de vida.
  - `:54-56`: `firmarSesionParticipante(p, metodo='GOOGLE')`, con valor por defecto para no romper `tests/helpers/tokens.ts:13`.
- **Nuevo `src/core/codigos.ts`**
  - Constantes:
    - Vida del código: 10 min.
    - 5 intentos por código; se aceptan los 2 últimos códigos vigentes.
    - Espera de 60 s entre solicitudes.
    - Por correo: 5 por hora y 10 por día.
    - Por IP en la BD: 200 por hora.
    - Bloqueo por correo: 10 fallos por hora (`CODE_LOCKED`).
    - Disyuntor global: 60 fallos por hora → `CODE_LOGIN_PAUSED` durante 1 h y `console.warn`.
    - Tolerancia de 30 min antes de `horaInicio`.
  - Funciones: `nuevoCodigoAcceso`, `hashCodigoAcceso` (HMAC), `hashIgual` (`timingSafeEqual`), `nuevoCodigoInscripcion` (`randomInt(36)` ×10), `conReintentoDeCodigo(fn)` (repite hasta 3 veces ante P2002 sobre `uq_inscripciones_codigo`) y `asegurarCodigo(inscripcionId)` (si es NULL, lo genera con `updateMany where codigo:null`).
- **Nuevo `src/core/concurrencia.ts`**: `limitarConcurrencia(max=2, cola=30)`; si la cola se desborda, responde 503 `PDF_BUSY`.
- **Nuevo `src/core/imagenes.ts`**
  - Se mueven aquí `tipoDeImagen` y los mapas de MIME (`payment-qr/services/payment-qr.ts:10-22`); payment-qr pasa a importarlos.
  - Nueva `limpiarMetadatos(buffer,tipo)`: en JPEG quita los segmentos APP1-APP15 (EXIF y GPS); en PNG quita los chunks `tEXt`, `iTXt`, `zTXt` y `eXIf`. Para fotos solo se aceptan JPEG y PNG.
- **`src/core/almacenamiento.ts`**: `DIRECTORIO_FOTOS='uploads/fotos'`, `MAX_BYTES_FOTO=2MB` y `REGEX_ARCHIVO_FOTO=/^foto-<uuid>\.(png|jpg)$/`.
- **`src/core/configuracion-sistema.ts:86`**
  - `configuracionPublica` no cambia, porque la landing la usa en `/v1/site/config`.
  - Nueva `configuracionPanel()` = pública + `accesoCodigo:{disponible}`. La usa solo `/v1/auth/config` (`system-settings/routes:16`, en su controlador).
- **`src/api/email-credential/services/email-credential.ts:153`**: nueva `credencialUtilizable()`. Devuelve una credencial activa, salvo que tenga `ultimoEstado==='ERROR'` y `ultimoEnvioEn` de hace menos de 15 min. Funciona como disyuntor que se recupera solo.
- **`src/middlewares/auth.ts`**: `req.metodoSesion = carga.metodo` en `requireRoles`, `requireParticipante` y `requireSesion`.
- **`src/middlewares/rate-limit.ts`**
  - `limiteLogin` (`:58`) se queda solo para contraseña, con 10 cada 15 min.
  - Nuevos: `limiteLoginGoogle` (120 cada 15 min), `limiteSolicitudCodigo` (60 cada 15 min), `limiteVerificacionCodigo` (120 cada 15 min) y `limiteFotoPortal` (10 por hora por participante).
- **`src/api/google-auth/routes`**: `limiteLogin` pasa a `limiteLoginGoogle`.
- **`src/api/google-auth/services/google-auth.ts`**
  - `:44-49`: agregar `tambienParticipante`.
  - `:56`: `firmarSesionParticipante(datos,'GOOGLE')`.
  - Exportar `vincular` (`:17`), que usará el switch.
- **Nuevo `src/api/participant-auth/`** (routes, controllers, services, `validation.ts`, `templates/codigo-acceso.html`, `templates/usa-google.html`)
  - **`solicitarCodigo(correo, ip, ahora)`**
    1. Normaliza el correo.
    2. Si no hay `credencialUtilizable`, responde 503.
    3. Aplica los topes por correo e IP en la BD.
    4. Busca siempre al participante por correo.
    5. En una transacción:
       - invalida los códigos activos, salvo el más reciente;
       - crea la fila nueva, con `participanteId` NULL si el correo no existe **o si el participante tiene `googleSub`**.
    6. Programa el envío con `setImmediate(() => void enviarDiferido(...).catch(e => console.error(...)))`. Dentro de esa tarea se busca la inscripción más reciente, se obtiene su credencial y se envía:
       - `codigo-acceso.html` si el participante existe y no tiene `googleSub`;
       - `usa-google.html` si tiene `googleSub`;
       - nada si el correo no existe.
    7. Borra las filas con `creadoEn` de más de 7 días.
  - **`verificarCodigo`**
    1. Revisa el disyuntor global y el bloqueo por correo (suma de `intentos` de filas no usadas en la última hora).
    2. Toma hasta 2 filas vigentes.
    3. Por cada fila, reserva el intento con `updateMany({id, usadoEn:null, invalidadoEn:null, intentos:{lt:5}}, increment)` y compara.
    4. Si coincide, marca `usadoEn` (`updateMany where usadoEn:null`) e invalida las demás filas. Luego comprueba que el participante exista, que tenga el mismo correo y que `googleSub` siga NULL; si no, responde `CODE_EXPIRED`. Firma la sesión con `'CODIGO'`.
    5. Si no coincide, responde `INVALID_CODE` con los intentos restantes.
  - **`cambiarAPortal(actor)`**
    - Revalida al administrador en la BD.
    - Exige `metodoSesion==='GOOGLE'`; si no, 409 `CODE_REQUIRED`.
    - Busca el participante por el correo del administrador.
    - `googleSub`: si ambos existen y difieren, responde 403 `GOOGLE_ACCOUNT_MISMATCH`; si el participante no lo tiene, se vincula el del administrador.
    - El código por correo nunca da sesión de administrador, y no existe el camino inverso.
- **`src/api/admin/controllers/admin.ts:33-39`**: `session` pasa a ser asíncrono y agrega los indicadores `portal` (`directo` = mismo correo y `metodo GOOGLE`) y `panel`.
- **`src/api/inscription/services/inscription.ts`**
  - `:27` `errorDeUnicidad`: se integra con `conReintentoDeCodigo`.
  - `:88-144`: la transacción queda envuelta en `conReintentoDeCodigo` y `create` recibe `codigo: nuevoCodigoInscripcion()`.
  - **`:99-108`**: si `cambiaCorreo`, solo se permite con `verificacionCorreo` (el nuevo correo verificado con Google, spec 010). Si no hay verificación, o si es la ruta legacy, responde 409 `EMAIL_CHANGE_REQUIRES_VERIFICATION`, con un mensaje que remite al correo de contacto del evento. Ver la decisión 1.
  - `:238-249` `archivoCredencial`: usa `asegurarCodigo` y la ruta con huella.
  - `:253-260`: `borrarCredenciales`.
  - Nueva `crearInscripcionCortesia` (fase 2): valida que el tipo pertenezca al evento (como `:46-49`) y usa `conReintentoDeCodigo`.
- **`src/api/inscription/utils/generatePdf.ts`**
  - `:14` `rutaCredencial`: pasa a `<id>-<huella12>.pdf`. La huella es sha256 de: `codigo`, nombres, apellidos, tipo y número de documento, correo, celular, `fotoArchivo`, id, nombre y etiqueta del tipo, `evento.actualizadoEn`, `revisadoEn` y `VERSION_PLANTILLA`.
  - `:18` `logoEnBase64`: se exporta y se guarda en memoria por ruta y `mtime`.
  - `:41`: `QRCode.toDataURL(codigo)`.
  - Marcadores `CODIGO`, `FOTO` y `CLASE_FOTO` (en crudo: `FOTO` y `CLASE_FOTO`).
  - `:58-78`: puppeteer dentro de `limitarConcurrencia`.
  - Nueva `borrarCredenciales(inscripcion)`, que elimina `<id>.pdf` y `<id>-*.pdf`.
- **`templates/inscription.html`**: agregar `{{CODIGO}}`, `{{FOTO}}` y `{{CLASE_FOTO}}`.
- **`src/api/inscription/services/mappers.ts:18`**: `aDetalle` agrega `codigo`. **No** va en `aFilaLista` (`:82`) ni en el CSV.
- **`src/api/activity/validation.ts:25-29`**
  - `codigo` (`/^[0-9A-Za-z]{10}$/`, se transforma a mayúsculas), `participanteId`, `manual`, `numeroDocumento` y `tipoDocumento` (`oneOf(['dni','ce'])`).
  - Exactamente un identificador.
- **`src/api/activity/services/activity.ts`**
  - `:78-96`: el listado agrega la auditoría y enmascara el documento si no hay `ASISTENCIA_VER`.
  - **`:102-133` `registrarAsistencia(actividadId,input,actor,ahora)`**:
    - `codigo`: `findUnique({codigo})`.
    - `participanteId` sin `manual`: se acepta solo si la inscripción del evento tiene `esQrLegado` **y** `fechaLima(ahora) <= fechaSoloDia(evento.fechaFin)`. Si no, 422. Método `QR_LEGADO` y `alerta:'QR_LEGADO'`.
    - `manual`: exige `ASISTENCIA_EXCEPCION`; método `MANUAL`.
    - Documento: `findUnique` por tipo y número, o `findMany` con 409 `AMBIGUOUS_DOCUMENT` si hay más de uno. Esto reemplaza el `findFirst` de `:106`.
    - `fueraDeHorario` exige `ASISTENCIA_EXCEPCION`.
    - La ventana va de `horaInicio - 30 min` a `horaFin`.
    - Se aplica `asegurarEvento`.
    - Se guardan `registradoPorId`, `metodo` y `esFueraDeHorario`.
  - `:135-139`: el borrado verifica el alcance.
- **`src/api/activity/controllers/activity.ts`**: pasar `req.user` en `:26-28` y `:30-33`, y en las legacy `:41-47`, con método `QR_LEGADO` y la misma regla.
- **`src/api/activity/routes/activity.ts:10-25`**: permisos según la tabla. Crear, editar y borrar actividades sigue siendo configuración.
- **`src/api/participant-portal/`**
  - Rutas nuevas, en el orden `requireParticipante` → limitador → multer.
  - Nuevo `upload.ts` `fotoUpload`: en memoria, `files:1`, `fields:1` (`consentimiento`), `parts:2`.
  - Servicios: `miPerfil` ampliado, `actualizarPerfil`, `guardarFoto` (`tipoDeImagen` → `limpiarMetadatos` → escritura con `flag:'wx'` → borra la foto anterior), `miFotocheck` (con `asegurarCodigo`) y `misAsistencias`.
- **`src/api/participant/`**
  - `POST /v1/participants`: `consultarDni(n,'PANEL')` (`document-lookup/services/lookup.ts:143`); si la consulta responde 503 o 404, exige los nombres.
  - `GET` y `DELETE /photo`.
- **Documentación**
  - `docs/api.md`: nuevos límites.
  - `docs/arquitectura-ecosistema.md`: contrato 5 y el nuevo 409 de la landing.
  - `docs/despliegue-ecosistema.md` §4.1: la URL interna pasa a ser **obligatoria**, más el runbook de la migración.
  - `specs/014-portal-fotocheck-asistencia/`: spec, plan, tasks y `contracts/api-acceso-codigo.md`, `api-portal.md` v2 y `api-asistencia.md`.
- **Despliegue (sin cambio de código)**: `despliegue-produccion/panel-admin.env:4` pasa a `NUXT_BACKEND_BASE_URL=http://<servicio-backend>:3000`, la URL interna de la red de Dokploy.
  - Para verificarlo, hay que revisar la IP que registra morgan en el log `combined` para `/api/v1/auth/google`, antes y después del cambio. Hoy debería salir la misma IP en todos los registros.

## 5) Cambios en el panel, por archivo
- **BFF**
  - Nuevos `server/api/auth/codigo/index.post.ts` y `server/api/auth/codigo/verificar.post.ts`. Ambos usan `assertSameOrigin` y reenvían `x-forwarded-for`, como `login.post.ts:18`. `verificar` hace `guardarSesion(jwt, vidaSesionSegundos(expiraEn))`, de modo que las 12 h se respetan solas (el tope es de 30 días, `vida-sesion.ts:4`).
  - Nuevo `server/api/auth/portal.post.ts` (switch): reemplaza la cookie.
  - `server/api/auth/google.post.ts:33-35`: reenviar `tambienParticipante`.
  - `server/api/auth/session.get.ts`: reenviar `portal` y `panel`.
  - `server/api/portal/[...path].ts` no cambia: ya transmite multipart (`proxy.ts:28-31`).
- **Estado y tipos**
  - `app/stores/auth.ts`: `solicitarCodigo`, `verificarCodigo` e `irAlPortal`.
  - `app/utils/sesion.ts`: `leerSesion` lee `portal` y `panel`.
  - `app/types/api.ts`: `Sesion`, `PerfilPortal`, `Fotocheck`, `AsistenciaPortal`, `CertificadoPortal` y `ResultadoAsistencia` (con `alerta`).
- **Login**
  - `app/pages/login.vue`: nuevo `components/auth/AccesoConCodigo.vue`, en dos pasos, con cuenta regresiva, `inputmode=numeric`, `autocomplete=one-time-code` y Google siempre visible como alternativa. Solo se muestra si `accesoCodigo.disponible`.
  - Nuevo `components/auth/ElegirPerfil.vue`, si Google devuelve ADMIN con `tambienParticipante`.
  - Se reescribe el texto de `:80-83`.
- **Layouts**
  - `app/layouts/participante.vue`: tabs en escritorio y barra inferior en móvil desde `NAVEGACION_PORTAL`, con "Volver al panel" (cierra sesión y lleva a `/login`).
  - `app/layouts/default.vue`: menú de usuario con "Mi portal de participante", directo o con modal de código.
  - Nuevo `app/layouts/escaner.vue`: pantalla completa, **con el selector de evento de la barra superior (`useEventoStore`)**. Así cumple el principio III sin enmienda.
- **Páginas del portal** (`perfil:'participante'`)
  - `mi-fotocheck.vue` con `components/portal/Fotocheck.vue`:
    - QR grande, código en texto, indicador "en vivo", `navigator.wakeLock` y enlace al PDF.
    - **Guarda en `localStorage` el último fotocheck para verlo sin conexión**, y lo borra al cerrar sesión.
  - `mi-asistencia.vue`.
  - `mi-perfil.vue` con `SubirFoto.vue`: recorte cuadrado a 600 px en JPEG 0,85 con canvas y **casilla de consentimiento obligatoria** (Ley 29733).
  - `mis-certificados.vue`: estado vacío si la ruta responde 404.
  - `mis-inscripciones.vue`: botón "Ver fotocheck".
- **Operación**
  - `app/pages/asistencia.vue`:
    - `:57`: `interpretarLectura` devuelve `{codigo}` o `{participanteId}` legado (`^\d{1,6}$`).
    - `:138`: `inputmode="text"`.
    - Selector de tipo de documento.
    - Columnas `metodo` y `registradoPor`.
    - Checkbox de fuera de horario solo con permiso.
    - Resultado en ámbar si hay `alerta`.
  - Nuevo `app/pages/escanear.vue` (permiso `ASISTENCIA_REGISTRAR`):
    - `components/asistencia/LectorCamara.vue`: `ClientOnly` con `QrcodeStream` de `vue-qrcode-reader`, cámara `environment`, formato `qr_code` y wasm local con `setZXingModuleOverrides`.
    - Modos USB y DNI.
    - Resultado a pantalla completa: verde, rojo o **ámbar "QR antiguo: verifica el DNI"**, con foto, vibración, pitido y las últimas 10 lecturas.
  - `app/pages/participantes.vue`: modal "Nuevo participante" y cortesía (fase 2).
  - `app/components/layout/AppSidebar.vue`: ítem "Escanear asistencia".
- **Utilidades**
  - `app/utils/errores.ts`: todos los códigos nuevos de la tabla, más `CODE_LOCKED`, `CODE_LOGIN_PAUSED`, `GOOGLE_ACCOUNT_MISMATCH`, `PDF_BUSY` y `CONSENT_REQUIRED`.
  - Nuevas utilidades puras:
    - `codigoAcceso.ts`: `normalizarCodigo`, `esCodigoValido`, `segundosParaReintentar`.
    - `lecturaQr.ts`: `interpretarLectura`, `debeProcesar`, `actividadEnCurso`, `mensajeErrorCamara`.
    - `portal.ts`: `NAVEGACION_PORTAL`, `inscripcionParaFotocheck`, `resumenAsistencia`, `fotocheckGuardado`.
    - `foto.ts`: `errorFoto`, `recorteCuadrado`.
- **`package.json`**: agregar `vue-qrcode-reader`.
- **`.specify/memory/constitution.md:37-44`, enmienda del principio VI**: el inscrito entra con Google o con un código por correo; se amplían las páginas con `perfil:'participante'`; el paso del administrador al portal solo es posible con Google o con el código, nunca a la inversa.
- **`specs/009-portal-escaner/`**.

## 6) Pruebas
**Backend** (jest + supertest, Prisma simulado por archivo, `jest.mock('…/brevo-client')`):
- **`tests/participant-auth/codigo.test.ts`**
  - 202 idéntico para un correo existente, uno inexistente y uno vinculado a Google.
  - Solo se guarda el hash.
  - Envío: código solo si el participante existe sin `googleSub`; `usa-google` si está vinculado.
  - Espera de 60 s → 429; tope por hora.
  - 503 sin credencial utilizable (`ERROR` reciente), y vuelve a estar disponible tras 15 min.
  - Un fallo de Brevo o de la BD en el envío diferido no tumba el proceso (promesa rechazada capturada).
  - Verificación correcta → `aud` de participante, `metodo CODIGO` y 12 h.
  - Se acepta el penúltimo código.
  - El 5.º fallo agota el código.
  - 10 fallos por hora → `CODE_LOCKED`; disyuntor global → 503.
  - Un código usado no se reutiliza.
  - Un correo que solo es de administrador no da sesión.
- **`tests/participant-auth/cambio-perfil.test.ts`**
  - Sesión GOOGLE → sesión de participante.
  - PASSWORD → 409; administrador inactivo → 403; `googleSub` distinto → 403 `GOOGLE_ACCOUNT_MISMATCH`; token de participante → 403.
  - `/v1/auth/session` devuelve los indicadores.
- **`tests/participant-portal/perfil-foto.test.ts`**
  - PATCH solo cambia `celular`.
  - PNG o JPEG válidos se guardan sin EXIF (`limpiarMetadatos`).
  - Texto con extensión `.png` → 422; más de 2 MB → 413; sin consentimiento → 422.
  - `no-store`; token de administrador → 403.
- **`tests/participant-portal/fotocheck-asistencia.test.ts`**
  - Inscripción ajena → 404; no aprobada → 409.
  - `codigo` y QR presentes; documento enmascarado; sin `revisadoPor`.
  - `asegurarCodigo` llena un `codigo` NULL.
  - Asistencias agrupadas por evento.
- **`tests/activity/asistencia.test.ts`** (nuevo; hoy no hay pruebas de activity):
  - `codigo` válido, `CODE_OTHER_EVENT`, `NOT_APPROVED`.
  - QR anterior: aceptado con `esQrLegado` y dentro de `fechaFin`, con `alerta`; rechazado fuera de plazo o sin la marca.
  - Documento con tipo; `AMBIGUOUS_DOCUMENT`.
  - Fuera de horario o `manual` sin permiso → 403; tolerancia de 30 min.
  - Se guarda la auditoría; duplicado → 409.
  - Exportación con solo `REGISTRAR` → 403; rutas legacy con COMISION → 403.
  - Documento enmascarado en el listado sin `VER`; COMISION en un evento ajeno → 403.
- **`tests/inscription/credencial.test.ts`**
  - `toDataURL` recibe `codigo`.
  - La huella cambia con el código, la foto, el nombre, `evento.actualizadoEn` y la etiqueta del tipo.
  - `borrarCredenciales` borra los `<id>*.pdf`.
  - El semáforo no pasa de 2 generaciones simultáneas; con la cola desbordada responde `PDF_BUSY`.
  - Se reintenta ante una colisión de `codigo`.
- **`tests/inscription/correo-reinscripcion.test.ts`**
  - Cambio de correo sin verificación → 409 y el participante queda intacto.
  - Con `verificacionCorreo` → se permite y `googleSub` se borra.
  - La ruta legacy nunca cambia el correo.
- **`tests/participant/crear.test.ts`**: consulta DNI simulada; nombres de respaldo ante 503; `PARTICIPANT_EXISTS` y `EMAIL_IN_USE`; cortesía APROBADO con monto 0 y tipo validado del evento.
- **Actualizar**
  - `tests/participant-portal/portal.test.ts:9` (`/me` con `toEqual`) y `:23` (`29.pdf` → huella).
  - `tests/security/routes.test.ts:7-9`: agregar al mock `participante.findUnique` y `administrador.findUnique` para `session`; sumar las rutas nuevas a la lista de 401; token de participante en `POST /v1/participants` → 403; token de administrador en `/v1/me/photo` → 403.

**Panel** (vitest, funciones puras):
- `codigoAcceso.test.ts`.
- `lecturaQr.test.ts`: minúsculas, `\r\n` final, `123` → legado, `12345678` → null en modo QR, código de 10 → `codigo`.
- `portal.test.ts`, incluido el fotocheck guardado.
- `foto.test.ts`.
- `sesion.test.ts` (indicadores) y `vidaSesion.test.ts` (43 200 s).

## 7) Fases (★ = imprescindible antes del 26-oct)
- **Fase 0 (1-3 oct, sin código):**
  - ★ Cambiar `NUXT_BACKEND_BASE_URL` a la URL interna y verificar `req.ip` en el log. Hoy los inicios de sesión con Google de todo el congreso comparten el tope de 10 cada 15 min.
  - Revisar la cuota de Brevo.
  - Si la landing nueva ya está publicada, desactivar las rutas legacy en Sistema, lo que cierra `POST /v1/inscription` sin voucher.
  - Redactar las specs 014 y 009 y acordar con A los permisos y el orden de las migraciones.
- **Bloque A (spec 013), requisito previo:** despliegue previsto como máximo el 9-oct. Si se retrasa, B sigue con `verifyAdminRole` y la migración de A lleva un timestamp posterior.
- **Fase 1** (desarrollo 9-15 oct; ensayo de la migración el 15-oct; backend a más tardar el 16-oct y panel el 17-oct):
  - ★ B1: migración y schema completos, incluidas las columnas de foto.
  - ★ B2: `codigo` en las inscripciones, PDF con huella y semáforo, y `limiteLoginGoogle`.
  - ★ B3: asistencia completa (permisos, alcance, exportación con `VER`, rutas legacy restringidas).
  - ★ B4: `/badge` y `fotocheck.disponible`.
  - ★ B5: código por correo con sus protecciones, más la sesión de participante de 12 h.
  - ★ B6: regla del correo al reinscribirse. Va junto con B5, porque el código por correo agrava la toma de cuenta.
  - ★ P1: login con código, navegación del portal, `mi-fotocheck` con copia sin conexión, `escanear.vue`, `asistencia.vue` y errores.
  - ★ Enmienda VI y documentación.
  - Si falta tiempo, B5 y P-código son lo primero que se corre a la fase 2: sin ellos, el participante sigue teniendo su PDF por correo y el QR anterior vale hasta el 30-oct.
- **Fase 2, deseable** (desarrollo 16-20 oct; despliegue a más tardar el 21-oct):
  - Foto con consentimiento, limpieza de metadatos y moderación (`DELETE /v1/participants/:id/photo`, junto con la subida).
  - `PATCH` de perfil y `mi-perfil`.
  - Cambio al portal para el personal, con selector y menú.
  - Alta de participantes y cortesía.
  - `mi-asistencia`.
  - **Simulacro 22-23 oct**: carga de inicios de sesión desde la red de la UNDC y celulares iOS y Android.
  - **Congelamiento desde el 24-oct.**
- **Fase 3 (después del 31-oct):**
  - Certificados (C).
  - `regenerate-code`.
  - Migración `codigo NOT NULL`.
  - Retirar la aceptación de `participanteId`.
  - Cola sin conexión del escáner.
  - Texto de la landing.
  - Pregeneración pausada de PDF, si hace falta.

## 8) Riesgos y mitigación
| Riesgo | Mitigación |
|---|---|
| IP compartida: con el BFF por la URL pública y el NAT de la UNDC, los límites por IP bloquean la puerta | URL interna (fase 0); topes principales por correo en la BD; topes por IP altos (Google 120, códigos 60 y 120 cada 15 min); prueba de carga en el simulacro. Falta verificar en el servidor si Traefik sobrescribe `X-Forwarded-For` (por defecto no confía en él) |
| DDL de MySQL no transaccional | Columnas aditivas y admitiendo NULL, índice único al final, ensayo con el respaldo, `mysqldump` y runbook con `migrate resolve` |
| Reversión o convivencia con la imagen anterior | `codigo` admite NULL y `asegurarCodigo` lo llena al leer; `NOT NULL` después del 31-oct |
| Toma de cuenta por reinscripción (`inscription.ts:99-108`) | 409 sin verificación con Google; corrección por un administrador (`PUT /v1/participants/:id`); desactivar las rutas legacy |
| Correo de Workspace reasignado | Si hay `googleSub`, no se envía código, solo el aviso de usar Google. Un administrador puede desvincular (`participant.ts:67`) |
| Fuerza bruta del código | 5 intentos por código, 2 códigos vigentes, 10 fallos por hora por correo y disyuntor global de 60 por hora. En el peor caso, unas 1 440 conjeturas al día contra todo el padrón, es decir menos de 0,3 % al día de que caiga alguna cuenta, y la víctima recibe códigos que no pidió. Google sigue como alternativa |
| Bloqueo de un correo a propósito | Solo por 1 h; Google sigue disponible |
| Credencial de correo activa pero rota | `credencialUtilizable` con disyuntor de 15 min; el panel muestra `ultimoError` en Correo |
| Proceso caído por una promesa rechazada | `.catch` en el envío diferido |
| Falta de memoria por puppeteer | Semáforo de 2 y cola de 30 (503 `PDF_BUSY`); la huella regenera bajo demanda |
| QR anterior falsificable hasta el 30-oct | Solo inscripciones con `esQrLegado`; alerta ámbar con nombre, DNI y foto; método auditado; caduca solo |
| Capturas del fotocheck compartidas | Indicador "en vivo", foto y el 409 de duplicado |
| Cámara (HTTPS, navegadores integrados) y wasm | HTTPS en producción; aviso "abre en Chrome o Safari"; wasm servido desde el panel |
| Sesión del personal de 1 h | Lo resuelve A (refresh con revalidación) |
| Cuota de Brevo | Revisar el plan; Google como vía principal |
| La exportación expone DNI a la comisión | Solo con `ASISTENCIA_VER`; documento enmascarado sin ese permiso |
| `/v1/events` entrega `datosPago` y `credencialCorreo` a la comisión | Lo resuelve A; el escáner reutiliza ese store |

**Estado de cada punto de la crítica:**
- **Aceptados:** 1, 2, 3, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18 (se resuelve sin tocar el contrato: `accesoCodigo` va solo en `/v1/auth/config`), 19, 20, 21 (queda para A) y 22.
- **Aceptados con variante:**
  - 4: se bloquea todo `googleSub`, no solo los correos de Workspace, porque no se guarda el `hd`.
  - 5: se aceptan 2 códigos en vez de 3, para no ampliar la superficie de adivinación.
  - 8: se agrega la alerta ámbar, pero no un paso obligatorio de confirmación (ver la decisión 5).
- **Descartados:**
  - 7 (pregeneración): el semáforo basta; queda como opcional.
  - 23: ya estaba asumido.
  - 24: no hubo hallazgos.
  - La decisión anterior sobre el idioma de las rutas: la convención es inglés (`AGENTS.md:53`).

## 9) Decisiones abiertas para el usuario
1. **Cambio de correo al reinscribirse** (medida de seguridad). **Recomiendo** rechazarlo con 409 si el nuevo correo no está verificado con Google, y que la organización lo corrija desde el panel. La alternativa es permitirlo y marcarlo para revisión, que es más cómoda pero deja abierta la toma de cuenta.
2. **Reenviar la credencial con el QR nuevo a los aprobados del VIII.** **Recomiendo** no hacer un reenvío masivo: basta el QR anterior hasta el 30-oct más el portal. Si el plan de Brevo lo permite, se puede mandar un aviso corto: "tu fotocheck virtual ya está disponible".
3. **Documento en el fotocheck.** **Recomiendo** mostrarlo enmascarado (`****5678`); el escáner muestra el documento completo al operador.
4. **Tolerancia antes de `horaInicio`.** **Recomiendo** 30 min, como constante. Aparte, conviene que A decida si `ASISTENCIA_EXCEPCION` puede darse a la comisión; recomiendo que no por defecto.
5. **QR anterior en la puerta.** **Recomiendo** registrarlo automáticamente con alerta ámbar y mostrar DNI y foto, para no frenar la cola. La alternativa es exigir un toque de confirmación, más seguro pero más lento, porque casi todo el VIII trae el QR anterior.

### Archivos críticos para la implementación
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/prisma/schema.prisma
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/activity/services/activity.ts
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/inscription/services/inscription.ts (junto con `src/api/inscription/utils/generatePdf.ts`)
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/participant-portal/services/participant-portal.ts (junto con el nuevo `src/api/participant-auth/` y `src/middlewares/rate-limit.ts`)
- C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend/app/pages/asistencia.vue (junto con los nuevos `app/pages/escanear.vue`, `app/pages/login.vue` y `app/layouts/participante.vue`) y C:/Users/HP/Desktop/dev/UNDC/congreso/despliegue-produccion/panel-admin.env

---

## Anexo: crítica adversarial

# Revisión adversarial del diseño B (spec 014: portal, fotocheck y asistencia por QR)

Encontré 24 problemas: 1 crítico, 4 altos, 7 medios y 12 bajos, más 6 citas de línea equivocadas. El más grave: en producción el panel llama al backend por la URL pública. Así, todos los visitantes del panel comparten una sola IP en los límites de acceso, y el día del evento la puerta se bloquearía.

Revisé solo lectura contra `backend-ciisic` (B), `administrator-ciisic-frontend` (P) y `despliegue-produccion/`, ordenado de más a menos grave.

## CRÍTICO

**1. Todos los límites por IP del panel son en la práctica globales, y el diseño agrega topes por IP que bloquearían la puerta del evento.**
- **Evidencia:**
  - `despliegue-produccion/panel-admin.env:4` define `NUXT_BACKEND_BASE_URL=https://api-ciisic-vii.episundc.pe`, que es la URL pública (Traefik).
  - `B/src/app.ts:13` usa `trust proxy 1`, y `rate-limit.ts:25` usa `req.ip`. Con Traefik en medio, `req.ip` es la IP del BFF para todos. Deduzco esto del comportamiento de Traefik; no está probado en el servidor.
  - Hoy `limiteLogin` (10 cada 15 min, `rate-limit.ts:58`) ya protege `/v1/auth/google` (`google-auth/routes:11`). Es decir, ya hay un tope global de 10 inicios de sesión Google cada 15 min, que está latente.
  - El diseño suma `limiteSolicitudCodigo` (10 por IP cada 15 min), 30 por IP y hora en la BD, y el switch con `limiteLogin`. Con esa IP compartida, entrarían 30 códigos por hora para todo el congreso.
  - Aun con la URL interna, el Wi-Fi de la UNDC (una sola IP pública por NAT) y el CGNAT de las operadoras móviles concentran a cientos de personas en pocas IP.
  - Además, la sesión dura 1 h (`sesiones.ts:12`), así que en la puerta habrá que volver a entrar.
- **Corrección:**
  - Pasar a la URL interna de Docker, como ya recomiendan `docs/despliegue-ecosistema.md:72-73` y `P/docs/configuracion-y-despliegue.md:7`, y verificar qué `req.ip` real llega.
  - Hacer que los topes principales sean por correo (en la BD). Por IP, dejar solo un tope alto, de cientos por hora. Subir también `limiteLogin` para Google, ya que Google firma el token.
  - Pasar la sesión del participante a 12 h en la fase 1, no como decisión abierta.
  - Probar la carga en el simulacro del 22 y 23 de octubre.

## ALTO

**2. La migración no es "compatible con el código anterior", como afirma el diseño.**
- **Evidencia:**
  - `inscripciones.codigo CHAR(10) NOT NULL` queda sin DEFAULT.
  - El código actual crea inscripciones sin `codigo` (`inscription.ts:116-141`) y MySQL en modo estricto rechaza ese INSERT.
  - Si se revierte en Dokploy a la imagen anterior, o si durante el despliegue queda vivo el contenedor viejo, se caen las inscripciones de la landing y las de la ruta legacy (`inscription/routes:22`).
- **Corrección (en dos pasos):**
  - Primero, `codigo CHAR(10) NULL` con índice único; en MySQL se permiten varios NULL.
  - El código nuevo lo llena al crear y, si una inscripción antigua no lo tiene, lo genera al leer.
  - `NOT NULL` va en una migración posterior, después del 31 de octubre.

**3. Toma de cuenta: la reinscripción cambia el correo del participante, y el código por correo amplía el alcance.**
- **Evidencia:**
  - `inscription.ts:93-109`: si alguien se inscribe con un documento que ya existe y un correo nuevo, el sistema cambia `participante.correo`, borra `googleSub` e invalida la sesión de la víctima.
  - Basta conocer el DNI de la víctima; RENIEC completa los nombres.
  - Vías posibles: la ruta legacy pública `POST /v1/inscription` (routes:22, sin token y sin voucher) o la landing de cualquier otro evento abierto.
  - Después, el atacante pide un código a su propio correo y entra al portal. Ve el fotocheck con el QR de la víctima, sus certificados (bloque C) y sus datos de pago, y puede subir **su** foto.
  - El problema ya existe hoy con Gmail, pero el portal ampliado lo vuelve mucho más valioso.
- **Corrección:** no sobrescribir el correo de un participante que ya existe desde las rutas públicas. Un cambio de correo debería requerir una prueba de control del correo anterior, o la acción de un administrador. Si no se cambia, al menos debe dejar una marca para revisión.

**4. El código por correo anula la protección de `googleSub`.**
- **Evidencia:** `google-auth.ts:13-16`. El vínculo con Google existe para frenar correos de Workspace reasignados. Con el código, quien reciba el correo reasignado (por ejemplo, una cuenta `@undc.edu.pe` reciclada) entra al portal del titular anterior.
- **Corrección:** si el participante tiene `googleSub` y el correo es de un dominio Workspace (con `hd`), exigir Google o avisar con un mensaje explícito.

**5. El diseño del código por correo permite bloquear a una persona y es frágil ante correos que llegan tarde.**
- **Evidencia:**
  - Cada solicitud invalida el código activo del mismo correo.
  - Un atacante puede:
    - pedir un código cada 60 s para invalidar siempre el de la víctima;
    - agotar su cuota de 5 por hora y 10 por día;
    - gastar sus 5 intentos con códigos equivocados.
  - Un usuario impaciente que pide dos veces y escribe el primer código recibe `INVALID_CODE`.
  - El 0,005 % calculado es por correo y por día. Contra cualquiera de los alrededor de 300 inscritos sube a cerca de 1,5 % al día si el atacante tiene muchas IP.
- **Corrección:**
  - Aceptar cualquiera de los últimos 3 códigos vigentes.
  - Contar los fallos por correo con un bloqueo corto, en lugar de invalidar el código.
  - Agregar un tope global de verificaciones fallidas por hora que actúe como disyuntor.
  - Mostrar siempre Google como alternativa.

## MEDIO

**6. Un error en el envío del código puede tumbar el proceso.**
- **Evidencia:** el envío se programa con `setImmediate(async …)`, pero `credencialParaEvento` puede lanzar un error de BD. No hay manejador de `unhandledRejection` (`server.ts:1-18`; grep sin resultados) y Node 22 termina el proceso ante una promesa rechazada sin manejar.
- **Corrección:** envolver el envío con `.catch(log)`. Hacer también dentro de esa tarea diferida la búsqueda de la "inscripción más reciente", para no introducir una diferencia de tiempo que revele si el correo existe.

**7. Riesgo de quedarse sin memoria por una avalancha de PDF después de la migración.**
- **Evidencia:**
  - La nueva huella deja sin uso todos los `<id>.pdf` guardados.
  - Cada generación lanza un Chromium (`generatePdf.ts:58-78`).
  - El único límite es por participante (`rate-limit.ts:73`); no hay tope global.
  - El propio diseño recomienda "descargar antes la credencial".
- **Corrección:** un semáforo global de 1 o 2 generaciones, o un navegador compartido, más una pregeneración pausada después del despliegue.
- **Huella incompleta:** el PDF usa datos del evento (nombre, contacto, logo), el nombre y la etiqueta del tipo, y `revisadoEn` (`generatePdf.ts:40-55`), que la huella no incluye. Agregar `evento.actualizadoEn` y el nombre y la etiqueta del tipo.

**8. El QR anterior sigue valiendo para casi todo el VIII.**
- **Evidencia:** toda inscripción aprobada antes del despliegue del 14 de octubre queda con `qr_legado=1`, y el QR es `participanteId` secuencial (`generatePdf.ts:41`). Hasta el 30 de octubre, cualquier participante puede fabricar el QR de un amigo, y la foto es opcional.
- **Corrección:** si la lectura es `QR_LEGADO`, que el escáner muestre en rojo o ámbar "QR antiguo: verifica el DNI" y exija confirmarlo. Documentar que el QR nuevo solo protege al evento siguiente.

**9. La credencial de correo puede estar "activa" pero rota, y el código no llega nunca.**
- **Evidencia:** `email-credential.ts:153-159` no revisa `ultimoEstado`. `docs/despliegue-ecosistema.md:15-16` ya documenta una API key de Brevo inhabilitada. El usuario recibe 202 y nunca le llega el correo.
- **Corrección:** calcular `disponible = activa && ultimoEstado !== 'ERROR'`, registrar el fallo del envío y mostrar una alerta en el panel.

**10. El escáner depende de la red y de la sesión en la puerta.**
- **Evidencia:** el fotocheck necesita pedir `/badge` en ese momento, y la sesión dura 1 h.
- **Corrección:** guardar el último fotocheck en `localStorage` del propio dispositivo para mostrarlo sin conexión, junto con la sesión de 12 h del punto 1.

**11. La exportación de asistencia expone los DNI a la comisión.**
- **Evidencia:** `GET /events/:id/attendances/export` (activity routes:19; `activity.ts:148-177`) devuelve los DNI y nombres de todos los aprobados, y el diseño la habilita con `ASISTENCIA_REGISTRAR`.
- **Corrección:** exportar solo con `ASISTENCIA_VER`. Las rutas legacy de asistencia (routes:22-25; `matrizLegacy`, `activity.ts:180-184`, cuyo evento elige quien llama) deben quedar solo para OWNER y ADMINISTRADOR, o retirarse.

**12. A y B no se pueden desarrollar en paralelo sobre el backend.**
- **Evidencia:** `B/AGENTS.md:110` y `P/AGENTS.md:95` dicen "Un agente por repositorio a la vez". A y B tocan los mismos archivos: `auth.ts`, `schema.prisma`, las rutas de activity y las migraciones.
- **Corrección:** hacerlos en secuencia. Así, la fase 1 del 2 al 11 de octubre no es realista con A incluido. Reducir la fase 1 a: código de la inscripción, asistencia, `/badge`, acceso con código, escáner y, además, lo del punto 1. Si B se despliega antes que A, la migración de A debe llevar un timestamp posterior.

## BAJO

13. **La cortesía crea inscripciones fuera de `crearInscripcion`.** Contradice "único punto de creación": el código y su reintento deben vivir en una función compartida. Además, falta validar que `tipoInscripcionId` pertenezca al evento, como hace `inscription.ts:46-49`.
14. **El switch se salta `vincular`.** Si `participante.googleSub` es distinto del de la cuenta Google del administrador, debería responder 403 `GOOGLE_ACCOUNT_MISMATCH` (`google-auth.ts:17-23`).
15. **Pruebas que se rompen y el diseño no menciona:**
    - `tests/security/routes.test.ts:7-9 y 43-48`: `session` pasa a consultar `participante`/`administrador`, pero el mock de Prisma solo tiene `tokenAcceso`, así que responde 500.
    - `tests/helpers/tokens.ts:13`: cambia la firma de `firmarSesionParticipante`; conviene darle un valor por defecto.
16. **Convenciones de nombres.**
    - Backend (convenciones de columnas de la constitución): los booleanos llevan `es_*`, `tiene_*` o `activo`. `qr_legado` y `fuera_de_horario` deberían ser `es_qr_legado` y `es_fuera_de_horario`.
    - Panel, principio III: toda pantalla trabaja sobre el evento de la barra superior. El `escaner.vue`, con su propio selector y sin barra, necesita una enmienda o reutilizar `useEventoStore`.
17. **La foto no se vuelve a codificar en el servidor.** Si alguien evita el cliente, conserva el EXIF y el GPS. Falta un texto de consentimiento (Ley 29733). La moderación dice "fase 2" en la sección 3 y "fase 3" en la sección (e); no hay forma de quitar una foto inapropiada antes del evento.
18. **Cambio de contrato con la landing.** `configuracionPublica` también sirve `/v1/site/config` (system-settings routes:16-17). Agregar `accesoCodigo` cambia el contrato de la landing (es aditivo, pero hay que documentarlo en `arquitectura-ecosistema.md`).
19. **La respuesta de `/badge` lleva el logo en base64 en cada llamada.** `logoEnBase64` lee el archivo en cada petición; cachearlo.
20. **Enumeración de correos.** El 202 idéntico aporta poco, porque la landing ya revela `EMAIL_IN_USE` (`inscription.ts:94`). No es grave, pero no conviene presentarlo como una garantía.
21. **El layout del escáner carga `/v1/events`.** Esa respuesta trae `datosPago` y `credencialCorreo`. Si A no la restringe, la comisión recibe esos datos.
22. **`codigo` en `aDetalle` expone el secreto del QR.** Lo ve cualquier persona con lectura de inscripciones. Es aceptable, pero debe quedar fuera de `aFilaLista` y del CSV.
23. **`/badge` sin foto en el VIII.** Con el QR anterior y sin foto, el "indicador en vivo" no impide capturas escaneables. Queda asumido en la lista de riesgos; solo lo dejo anotado.
24. **Portal: sin hallazgos de IDOR ni de fuga pública.** Las rutas `/me/*` filtran por `participanteId`, y B no expone ninguna verificación pública (eso es de C). El QR lleva un código opaco, no una URL con datos: conviene mantenerlo así.

## Citas equivocadas del diseño (corregir antes del plan)
- `firmarSesionParticipante` está en `sesiones.ts:54-56`, no en `:59-61` (esas líneas son `verificarSesion`).
- `nombresOficiales` está en `inscription.ts:60-62`, no en `:67-69`.
- La llamada en Google es `google-auth.ts:56`, no `:57`.
- `activity/controllers/activity.ts` tiene 56 líneas: `createAttendance` está en `:26-28` y las legacy en `:41-47` (no en `:97` ni `:112-117`).
- La tabla `tipos_documento` también tiene `ruc` (`seed.ts:27`), aunque la inscripción solo acepta `dni` y `ce`.
- Hay 308 inscripciones y 585 asistencias según `docs/despliegue-ecosistema.md:57-58`.
