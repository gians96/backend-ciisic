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

# Diseño final del Bloque A: roles, permisos y alcance por evento (backend spec 013, panel spec 008)

B = `C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic`, P = `C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend`.

## 1) Resumen

1. Hay 4 roles de staff. **OWNER** y **ADMINISTRADOR** son globales. **TESORERO** y **COMISION** solo trabajan en los eventos que se les asignan (tabla `asignaciones_evento`). El participante sigue en el portal (otra audiencia del JWT).
2. La guarda nueva es `requirePermiso(permisos, {evento})`. Lee rol, estado, eventos y permisos desde la BD en cada request. Hay un catálogo de 25 permisos, y cada permiso aplica solo a cuentas globales (G) o por evento (E). Los resolutores de evento **fallan cerrado** y usan el mismo parseo que los controladores (`idParam`, `http-error.ts:26-29`).
3. **Los códigos de rol NO se renombran antes del evento.** `SUPERADMIN` y `ADMIN` se quedan en la BD y se muestran como "Owner" y "Administrador del sistema". En el código se usan solo mediante `ROL.OWNER` y `ROL.ADMINISTRADOR`. Esto elimina los problemas de rollback, JWT, seed y convivencia de paneles (crítica 4, 9, 24). El renombre pasa a la Fase 4.
4. La COMISION recibe permisos elegibles por cuenta. Los montos se ocultan sin `pagos.ver`. La asistencia queda auditada (`registrado_por_id`, `metodo`) y la anulación es lógica (`anulado_en`, `anulado_por_id`), todo en un único `ALTER` de `asistencias`.
5. Calendario: backend el 7-oct y panel el 8-oct (los dos imprescindibles). Pruebas con cuentas reales del 12 al 16-oct y congelamiento el 19-oct. Los bloques de portal/OTP y fotocheck empiezan cuando el Bloque A esté fusionado, porque comparten `auth.ts`, `google-auth.ts`, `activity.ts` y `asistencias`.

## 2) Modelo de datos

### Catálogo `B/src/core/permisos.ts` (nuevo)

Alcance G = solo cuentas globales. Alcance E = requiere resolver el evento o filtrar por actor.

| Permiso | Alc. | OWNER | ADMINISTRADOR | TESORERO (fijo) | COMISION elegible |
|---|---|---|---|---|---|
| `sistema.configurar` | G | ✓ | – | – | – |
| `administradores.gestionar` | G | ✓ | ✓ (con delegación) | – | – |
| `eventos.configurar`, `eventos.eliminar`, `catalogos.configurar`, `correo.configurar`, `consultas_dni.gestionar`, `participantes.gestionar`, `inscripciones.eliminar`, `inscripciones.cancelar`, `legacy.usar` | G | ✓ | ✓ | – | – |
| `resumen.ver`, `inscripciones.ver`, `inscripciones.exportar`, `credenciales.reenviar`, `asistencia.ver`, `asistencia.exportar`, `ponencias.ver`, `mensajes.ver` | E | ✓ | ✓ | ✓ | ✓ |
| `pagos.ver`, `inscripciones.validar` | E | ✓ | ✓ | ✓ | – |
| `asistencia.marcar`, `asistencia.anular`, `asistencia.fuera_horario` | E | ✓ | ✓ | – | ✓ (el panel preselecciona `marcar`) |
| `mensajes.eliminar` | E | ✓ | ✓ | – | – |

**Dependencias.** Se aplican al guardar y también al cargar el actor (crítica 14):
- `inscripciones.exportar` → `inscripciones.ver`
- `pagos.ver` → `inscripciones.ver`
- `inscripciones.validar` → `pagos.ver`
- `credenciales.reenviar` → `inscripciones.ver`
- `asistencia.exportar` → `asistencia.ver`
- `asistencia.marcar` → `asistencia.ver`
- `asistencia.anular` → `asistencia.ver`
- `asistencia.fuera_horario` → `asistencia.marcar`
- `mensajes.eliminar` → `mensajes.ver`

`asistencia.marcar` **no** implica `asistencia.exportar` (crítica 6).

**Otras exportaciones de `permisos.ts`:**
- `ALCANCE`, `PERMISOS_POR_ROL`, `PERMISOS_ELEGIBLES_COMISION`, `ETIQUETAS_PERMISO` (`{nombre, implica}`).
- `cierre(permisos)`.
- `permisosEfectivos(rol, propios)`. Para COMISION calcula `cierre(propios ∩ ELEGIBLES)`; para TESORERO ignora las filas propias.
- `rolesGestionables(rolCodigo)`. OWNER puede gestionar los 4 roles; ADMINISTRADOR solo `TESORERO` y `COMISION`; los demás, ninguno.

En `B/src/core/catalogos.ts:7-8`:
- `ROLES = ['SUPERADMIN','ADMIN','TESORERO','COMISION']`.
- `ROL = { OWNER:'SUPERADMIN', ADMINISTRADOR:'ADMIN', TESORERO:'TESORERO', COMISION:'COMISION' } as const`.
- `METODOS_ASISTENCIA = ['QR','DNI','MANUAL']`.

### Prisma (`B/prisma/schema.prisma`)

```prisma
/// Eventos de una cuenta con alcance por evento (TESORERO, COMISION). Spec 013.
model AsignacionEvento {
  administradorId Int           @map("administrador_id")
  eventoId        Int           @map("evento_id")
  creadoEn        DateTime      @default(now()) @map("creado_en")
  administrador   Administrador @relation(fields: [administradorId], references: [id], onDelete: Cascade, map: "fk_asignaciones_evento_administrador")
  evento          Evento        @relation(fields: [eventoId], references: [id], onDelete: Cascade, map: "fk_asignaciones_evento_evento")
  @@id([administradorId, eventoId])
  @@index([eventoId], map: "idx_asignaciones_evento_evento")
  @@map("asignaciones_evento")
}

/// Permisos elegidos para una cuenta COMISION (códigos de src/core/permisos.ts). Spec 013.
model PermisoAdministrador {
  administradorId Int           @map("administrador_id")
  permiso         String        @db.VarChar(60)
  creadoEn        DateTime      @default(now()) @map("creado_en")
  administrador   Administrador @relation(fields: [administradorId], references: [id], onDelete: Cascade, map: "fk_permisos_administrador_administrador")
  @@id([administradorId, permiso])
  @@map("permisos_administrador")
}
```

Cambios en los modelos existentes:

- **`Administrador`** (`schema.prisma:26-46`), agregar:
  ```prisma
  asignacionesEvento AsignacionEvento[]
  permisos PermisoAdministrador[]
  asistenciasRegistradas Asistencia[] @relation("AsistenciaRegistradaPor")
  asistenciasAnuladas Asistencia[] @relation("AsistenciaAnuladaPor")
  ```
- **`Evento`**, agregar: `asignaciones AsignacionEvento[]`.
- **`Asistencia`** (`schema.prisma:239-250`), agregar:
  ```prisma
  metodo          String?   @db.VarChar(20)          // QR|DNI|MANUAL; null = legacy o previo
  registradoPorId Int?      @map("registrado_por_id")
  anuladoEn       DateTime? @map("anulado_en")
  anuladoPorId    Int?      @map("anulado_por_id")
  registradoPor Administrador? @relation("AsistenciaRegistradaPor", fields: [registradoPorId], references: [id], onDelete: SetNull, map: "fk_asistencias_registrado_por")
  anuladoPor    Administrador? @relation("AsistenciaAnuladaPor",   fields: [anuladoPorId],   references: [id], onDelete: SetNull, map: "fk_asistencias_anulado_por")
  @@index([registradoPorId], map: "idx_asistencias_registrado_por")
  @@index([anuladoPorId],    map: "idx_asistencias_anulado_por")
  ```

**Invariantes del servicio:**
- Solo las cuentas COMISION tienen filas en `permisos_administrador`.
- Solo TESORERO y COMISION tienen filas en `asignaciones_evento`.
- Al pasar una cuenta a un rol global, ambas se borran en la misma transacción.
- Una asistencia anulada no cuenta en ningún lado: listado, matriz, portal ni certificados.

### Migración `B/prisma/migrations/20261001120000_roles_permisos_alcance/migration.sql`

```sql
-- ============================================================================
-- Spec 013 · Roles, permisos y alcance por evento
-- Roles TESORERO y COMISION (SUPERADMIN/ADMIN conservan su código; solo cambia el nombre visible),
-- eventos asignados y permisos por cuenta, y auditoría/anulación lógica de asistencias.
-- ============================================================================

CREATE TABLE `asignaciones_evento` (
    `administrador_id` INTEGER NOT NULL,
    `evento_id` INTEGER NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `idx_asignaciones_evento_evento`(`evento_id`),
    PRIMARY KEY (`administrador_id`, `evento_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `permisos_administrador` (
    `administrador_id` INTEGER NOT NULL,
    `permiso` VARCHAR(60) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (`administrador_id`, `permiso`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `asistencias`
    ADD COLUMN `metodo` VARCHAR(20) NULL,
    ADD COLUMN `registrado_por_id` INTEGER NULL,
    ADD COLUMN `anulado_en` DATETIME(3) NULL,
    ADD COLUMN `anulado_por_id` INTEGER NULL;
CREATE INDEX `idx_asistencias_registrado_por` ON `asistencias`(`registrado_por_id`);
CREATE INDEX `idx_asistencias_anulado_por` ON `asistencias`(`anulado_por_id`);

ALTER TABLE `asignaciones_evento` ADD CONSTRAINT `fk_asignaciones_evento_administrador` FOREIGN KEY (`administrador_id`) REFERENCES `administradores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `asignaciones_evento` ADD CONSTRAINT `fk_asignaciones_evento_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `permisos_administrador` ADD CONSTRAINT `fk_permisos_administrador_administrador` FOREIGN KEY (`administrador_id`) REFERENCES `administradores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_registrado_por` FOREIGN KEY (`registrado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_anulado_por` FOREIGN KEY (`anulado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- DML idempotente (el código antiguo solo mira `codigo`: cambiar `nombre` es inocuo)
UPDATE `roles` SET `nombre` = 'Owner' WHERE `codigo` = 'SUPERADMIN';
UPDATE `roles` SET `nombre` = 'Administrador del sistema' WHERE `codigo` = 'ADMIN';
INSERT INTO `roles` (`codigo`, `nombre`) VALUES ('TESORERO', 'Tesorero'), ('COMISION', 'Comisión tecnológica')
    ON DUPLICATE KEY UPDATE `codigo` = `codigo`;
```

**Archivos operativos nuevos en `B/prisma/preflight/`:**
- **`verificar-roles-013.sql`:** lista cada cuenta con `a.id`, `a.correo`, `r.codigo`, `a.activo`, `google_sub IS NOT NULL` y la última revisión de inscripción. Es la tabla de `administradores` unida con `roles` (crítica 3). Hay que confirmar los nombres de columna de `inscripciones` en el esquema.
- **`reasignar-013.sql`:** plantilla para cambiar `rol_id` a TESORERO o COMISION e insertar sus filas en `asignaciones_evento` y `permisos_administrador`. Se ejecuta justo después de migrar si el OWNER así lo decide.
- **`revertir-013.sql`:** hace `DROP` de las FK, índices y columnas de `asistencias` y de las 2 tablas, cada paso solo si existe, y borra los roles TESORERO y COMISION si no tienen cuentas.

**Si la migración falla:**
1. El contenedor queda bloqueado por P3009, porque el entrypoint usa `set -e` y ejecuta `migrate deploy` (`docker-entrypoint.sh:6,10`).
2. Correr `revertir-013.sql`.
3. Correr `npx prisma migrate resolve --rolled-back 20261001120000_roles_permisos_alcance` desde un contenedor puntual.
4. Volver a arrancar.

**Ensayo sobre el respaldo:**
- `migrate diff --from-migrations … --to-schema-datamodel` debe salir vacío.
- Probar el fallo a medias con el runbook.
- Comprobar que la imagen anterior arranca con la BD ya migrada. El esquema es aditivo; las cuentas TESORERO y COMISION reciben 403 en el código viejo, así que falla cerrado.

## 3) Contratos de API

**Errores comunes de la guarda (GRD):**
- 401 `MISSING_TOKEN`, `INVALID_TOKEN` o `SESSION_INVALIDATED` (cuenta inexistente, inactiva o con rol desconocido; se reutiliza este código, crítica 19).
- 403 `FORBIDDEN`.
- Solo en permisos E: 403 `EVENT_NOT_ASSIGNED`.
- Solo en permisos E con alcance EVENTO: 404 `NOT_FOUND` si el recurso no existe.

**Convenciones de la tabla:** P(x) = evento tomado del parámetro x. R:rec = resolutor por recurso. F = el controlador filtra por el actor.

| Método · Ruta | Permiso (evento) | Respuesta | Errores extra |
|---|---|---|---|
| POST `/v1/auth/login` | pública | `{jwt, usuario{…,acceso}, expiraEn, tipo:'ADMIN'}` | 401 `INVALID_CREDENTIALS` (también con rol desconocido) |
| POST `/v1/auth/google` | pública | `usuario` con `acceso`; la precedencia admin > participante no cambia | 403 `ACCOUNT_DISABLED` (también con rol desconocido) |
| GET `/v1/auth/session` | requireSesion + actor | `user{id,nombres,apellidos,correo,rolId,rolCodigo,rolNombre,acceso{alcance:'GLOBAL'\|'EVENTO', permisos[], eventoIds:number[]\|null, perfilParticipante:boolean}}`, con datos frescos de la BD | 401 `SESSION_INVALIDATED` |
| **POST `/v1/auth/participant-session`** (nueva) | requireActor + JWT con `metodo:'GOOGLE'` (`sesiones.ts:36,51`) | `{jwt, tipo:'PARTICIPANTE', participante, expiraEn}`, el participante con el mismo correo | 403 `GOOGLE_SESSION_REQUIRED`, 404 `PARTICIPANT_NOT_FOUND` |
| GET `/v1/roles` | `administradores.gestionar` | solo los roles gestionables: `[{id,codigo,nombre,alcance,permisos[],permisosElegibles[{codigo,nombre,implica[]}]}]` | GRD |
| GET `/v1/admin`, GET `/v1/admin/:id` | `administradores.gestionar` | OWNER ve todas las cuentas; ADMINISTRADOR ve TESORERO, COMISION y la suya. Cada cuenta lleva además `alcance`, `eventos[{id,nombreCorto}]` y `permisos[]` | 403 `ADMIN_NOT_MANAGEABLE`, 404 |
| POST `/v1/admin` | `administradores.gestionar` | 201 con la cuenta. Cuerpo: `{…, rolCodigo (obligatorio), eventoIds?, permisos?}` | 403 `ROLE_NOT_ASSIGNABLE`; 422 `EVENTS_REQUIRED`, `EVENT_NOT_FOUND`, `PERMISSIONS_REQUIRED`, `PERMISSION_NOT_ELIGIBLE`; 409 `EMAIL_IN_USE` |
| PUT `/v1/admin/:id` | `administradores.gestionar` | 200. `eventoIds` y `permisos` reemplazan el conjunto completo | lo anterior, más 403 `ADMIN_NOT_MANAGEABLE`, 409 `SELF_UPDATE_FORBIDDEN` y 409 `LAST_OWNER` |
| DELETE `/v1/admin/:id` | `administradores.gestionar` | `{desactivado}`: se desactiva si tiene revisiones o asistencias registradas o anuladas | 403 `ADMIN_NOT_MANAGEABLE`, 409 `SELF_DELETE_FORBIDDEN`, `LAST_OWNER` |
| GET `/v1/events` | requireActor (F) | Cuenta global con `eventos.configurar`: respuesta actual (`event.ts:34-36`). Si no: `aEventoOperativo{id,codigo,nombre,nombreCorto,sede,fechaInicio,fechaFin,estado,esPrincipal,inscripcionesAbiertas}` de sus eventos, más `datosPago` si tiene `pagos.ver`. Nunca incluye `credencialCorreo` | GRD |
| POST `/v1/events`; GET y PUT `/v1/events/:id`; access-tokens (3); integraciones (5: GET, POST, PUT, DELETE, test); escrituras de actividades (3); escrituras de categorías y tipos (6); payment-qr (2) | `eventos.configurar` | sin cambios | GRD |
| DELETE `/v1/events/:id` | `eventos.eliminar` | sin cambios | GRD |
| GET `/v1/events/:id/summary` | `resumen.ver`, P(id) | montos en `null` sin `pagos.ver` | GRD |
| GET `…/integrations/sports-summary` | `resumen.ver`, P(eventId) | sin cambios | GRD |
| GET `/v1/events/:eventId/activities` | `asistencia.ver` o `eventos.configurar`, P(eventId) | sin cambios | GRD |
| GET `…/registration-categories` | `eventos.configurar` o `inscripciones.ver`, P(eventId) | sin `precio` ni `precioInstitucional` si no tiene `pagos.ver` | GRD |
| GET `…/inscriptions` | `inscripciones.ver`, P | sin `pagos.ver`: sin `monto`, `modalidadPago`, `numeroOperacion`, `fechaPago` ni `tieneVoucher`, y `q` no busca por operación (`inscription.ts:171`) | GRD |
| GET `…/inscriptions/export` | `inscripciones.exportar`, P | CSV sin columnas de pago ni "Motivo de rechazo" si no tiene `pagos.ver` | GRD |
| GET `/v1/inscriptions/:id` | `inscripciones.ver`, R:inscripcion | `pago:null` y el tipo sin precios si no tiene `pagos.ver` | GRD |
| PATCH `/v1/inscriptions/:id/status` | `inscripciones.validar`, R | el destino `CANCELADO` exige además `inscripciones.cancelar` | 403 `STATUS_NOT_ALLOWED` |
| POST `…/:id/resend-credential` | `credenciales.reenviar`, R; límite por actor 20 cada 15 min | reutiliza el PDF en caché | 409 `NOT_APPROVED`, 429 `RATE_LIMITED` |
| GET `…/:id/voucher` | `pagos.ver`, R | sin cambios | GRD |
| GET `…/:id/credential` | `inscripciones.ver`, R | sin cambios | GRD |
| DELETE `/v1/inscriptions/:id` | `inscripciones.eliminar` | sin cambios | GRD |
| GET `/v1/activities/:id/attendances` | `asistencia.ver`, R:actividad | Excluye las anuladas. Agrega `metodo` y `registradoPor{id,nombres,apellidos}`. DNI enmascarado `****5678` sin `inscripciones.ver` | GRD |
| POST `/v1/activities/:id/attendances` | `asistencia.marcar`, R:actividad; límite por actor 120 por minuto | 201 `{id, registradoEn, metodo, participante{id,nombres,apellidos,numeroDocumento(enmascarado)}}`. Cuerpo: `{participanteId\|numeroDocumento, fueraDeHorario?, metodo?}`. Si la marca estaba anulada, se reactiva | 403 `OUT_OF_HOURS_NOT_ALLOWED`; 404 `PARTICIPANT_NOT_FOUND` (búsqueda limitada a las inscripciones del evento); 403 `NOT_APPROVED`; 409 `OUTSIDE_WINDOW`, `ATTENDANCE_ALREADY_REGISTERED`; 429 |
| DELETE `/v1/attendances/:id` | `asistencia.anular`, R:asistencia | anulación lógica | 404 `ATTENDANCE_NOT_FOUND` (también si ya estaba anulada) |
| GET `/v1/events/:eventId/attendances/export` | `asistencia.exportar`, P | matriz sin las anuladas | GRD |
| GET `…/papers` y GET `/v1/papers/:id/file` | `ponencias.ver`, P y R:ponencia (validación UUID compartida, con `/i`) | sin cambios | GRD |
| GET `…/contact-messages`, PATCH `/v1/contact-messages/:id` | `mensajes.ver`, P y R:mensaje (`eventoId` null da 403 a cuentas por evento) | sin cambios | GRD |
| DELETE `/v1/contact-messages/:id` | `mensajes.eliminar`, R | sin cambios | GRD |
| classification (3), lookup (9), email-credentials (6), participants (3), settings (3) | `catalogos.configurar`, `consultas_dni.gestionar`, `correo.configurar`, `participantes.gestionar` y `sistema.configurar` (este último solo OWNER) | sin cambios | GRD |
| 19 legacy | `rutaLegacy` va antes de `legacy.usar`. El DELETE `/v1/inscription/:id` también exige `inscripciones.eliminar`. La asistencia legacy guarda `registradoPorId` | sin cambios | 410 `LEGACY_ROUTE_DISABLED` |

Las 14 rutas públicas, las 11 del sitio y las 3 del participante no cambian.

## 4) Cambios backend por archivo

**Núcleo nuevo**
- **`src/core/permisos.ts`:** catálogo y funciones de la sección 2.
- **`src/core/actor-consulta.ts`:** solo la consulta. Es un `prisma.administrador.findUnique` con `include { rol, asignacionesEvento{eventoId}, permisos{permiso} }`. Existe como módulo aparte para poder simularlo en las pruebas.
- **`src/core/actor.ts`:**
  - `actorDesdeFila(fila)` es pura. Devuelve `null` si la cuenta está inactiva o tiene un rol desconocido.
  - `Actor = {id, nombres, apellidos, correo, rolId, rolCodigo, rolNombre, alcance, permisos:ReadonlySet, eventoIds}`.
  - `cargarActor(id)` y `accesoPublico(actor, perfilParticipante)`.
  - Sin caché en la v1.
- **`src/core/resolutores-evento.ts`:**
  - `eventoDelParametro(nombre)` usa `idParam` y no consulta la BD.
  - Resolutores por recurso con `select{eventoId}`: `eventoDeInscripcion`, `eventoDeActividad`, `eventoDeAsistencia` (vía `actividad.eventoId`), `eventoDeMensaje` y `eventoDePonencia`.
  - Todos parsean con `idParam` o con `UUID_RECEPCION`, así que un id inválido da el mismo 400 que en el controlador.
  - Cada resolutor lleva la propiedad `nombre`, que usa la matriz de pruebas.

**`src/middlewares/auth.ts`**
- Se borran `requireRoles`, `verifyAdminRole` y `verifySuperAdminRole` (`:43-58`).
- `requirePermiso(requeridos, {evento?, filtraPorActor?})` hace lo siguiente:
  1. Exige la audiencia admin; si no, 403.
  2. Carga el actor (`req.actor ??= await cargarActor(user.id)`); si es `null`, 401 `SESSION_INVALIDATED`.
  3. Calcula `permitidos = requeridos.filter(p => actor.permisos.has(p) && (ALCANCE[p]==='E' || actor.alcance==='GLOBAL'))` (crítica 2). Si queda vacío, 403 `FORBIDDEN`.
  4. Si la cuenta es de alcance EVENTO y la ruta tiene `evento`, resuelve el evento: `null` da 404 `NOT_FOUND`; un evento que no está en `eventoIds` da 403 `EVENT_NOT_ASSIGNED`.
  5. Deja `req.user`, `req.actor` y `req.metodoSesion`.
- Al construir la guarda, un permiso E sin `evento` ni `filtraPorActor` lanza `Error`. La guarda expone los metadatos `{permisos, opciones}`.
- `requireActor` solo exige un actor válido (`permisos:[]`, `filtraPorActor:true`).
- `requireParticipante` y `requireSesion` no cambian.

**`src/middlewares/rate-limit.ts:7,24-28`:** nueva clave `'actor'` (`actor:${req.actor?.id}`), `limiteMarcarAsistencia` (1 min, 120) y `limiteReenvioCredencial` (15 min, 20).

**Los 15 archivos de rutas**
- Archivos: access-token, activity, admin, catalog, contact, document-lookup, email-credential, event, inscription, integration, papers (extraer el arreglo), participant, payment-qr, registration-type y system-settings.
- Cambian a `export const routes` con nombre y se recablean según la tabla de la sección 3.
- La guarda va siempre primera, o segunda después de `rutaLegacy`, antes de `upload` y de `validateBody`.

**Admin**
- **`admin/validation.ts:16`:**
  - `rolCodigo` pasa a `yup.string().oneOf([...ROLES])`; en `createAdminSchema` es `.required()` (crítica 20).
  - Se agregan `eventoIds: array(int>0).max(50)` y `permisos: array(string).max(30)`.
- **`admin/services/admin.ts`:**
  - `getAdmins(actor)` y `getAdminById(id, actor)` filtran por visibilidad.
  - `createAdmin(input, actor)`: se quita el valor por defecto `'ADMIN'` (`:86`).
  - `updateAdmin(id, input, actor)` reemplaza la regla de `:103`:
    - Una cuenta ajena no gestionable da 403 `ADMIN_NOT_MANAGEABLE`.
    - Un cambio de rol hacia uno no gestionable da 403 `ROLE_NOT_ASSIGNABLE`.
    - En la propia cuenta, da 409 `SELF_UPDATE_FORBIDDEN` si se desactiva, cambia de rol, envía `eventoIds` o `permisos`, o, sin ser OWNER, cambia el correo (crítica 21). Enviar el mismo `rolCodigo` está permitido.
    - Valida eventos y permisos según el rol final. Para roles globales se borran.
  - `LAST_OWNER`: una `$transaction` interactiva con `SELECT a.id … WHERE r.codigo='SUPERADMIN' AND a.activo=1 FOR UPDATE` (crítica 18). Aplica a degradar, desactivar o borrar.
  - `deleteAdmin` también desactiva si la cuenta tiene asistencias registradas o anuladas.
  - `aAdminPublico` agrega `alcance`, `eventos` y `permisos`.
  - `loginAdmin` (`:53-61`) incluye las relaciones del actor. Rechaza con 401 `INVALID_CREDENTIALS` si `actorDesdeFila` da `null` y devuelve `usuario.acceso`.
- **`admin/controllers/admin.ts`:**
  - Pasa `req.actor` a los servicios en lugar de `req.user?.id` (`:18-24`).
  - `session` (`:33-39`) se vuelve `async`: carga el actor y la bandera `perfilParticipante` (sesión con Google y participante con el mismo correo).
  - Nueva `participantSession`.
- **`admin/routes/admin.ts`:** ruta nueva `POST /v1/auth/participant-session` con `[requireActor, limiteLogin]`.

**Google**
- **`google-auth/services/google-auth.ts:44-50`:** incluye las relaciones del actor. Un rol desconocido da 403 `ACCOUNT_DISABLED`, y la respuesta devuelve `usuario.acceso`. La precedencia admin > participante se mantiene; el OTP del portal siempre emitirá sesión de participante.

**Otros servicios y controladores**
- **Catálogo (`catalog/controllers/catalog.ts:50-52`):** `listRoles(actor)` filtra por `rolesGestionables` y agrega los metadatos de permisos.
- **Eventos:**
  - `event/services/event.ts:79-85`: `listarEventos(actor)` y el nuevo `aEventoOperativo`.
  - `event.ts:194`: `resumenEvento(id, {conMontos})`.
  - `event/controllers/event.ts:28`: calcula `conMontos = actor.permisos.has('pagos.ver')`.
- **Inscripciones:**
  - `inscription/utils/mappers.ts:18,82`: `aDetalle` y `aFilaLista` reciben `{conPago}`.
  - `inscription/services/inscription.ts:161,183,270`: `construirFiltro`, `listarInscripciones` y `exportarCsv` reciben `{conPago}`.
  - `emitirCredencial` (`:203-213`) recibe `{reutilizar}`. En el reenvío usa `rutaCredencial` si el archivo existe, igual que `archivoCredencial` (`:239-244`).
  - `inscription/controllers/inscription.ts:106-152`:
    - Calcula `conPago`.
    - `CANCELADO` sin `inscripciones.cancelar` da 403 `STATUS_NOT_ALLOWED`.
    - `revisadoPor` pasa a ser `req.actor.id`.
- **Asistencia:**
  - `activity/services/activity.ts:102-133`: `registrarAsistencia(actividadId, input, {registradoPorId, metodo, enmascarar}, ahora)`.
    - Busca `inscripcion.findFirst({eventoId, participante: {id} | {numeroDocumento}})`; si no la encuentra, 404 `PARTICIPANT_NOT_FOUND`; si no está aprobada, 403 `NOT_APPROVED` (crítica 6).
    - Ante P2002 con una marca anulada, la reactiva con `update`; si no estaba anulada, 409.
  - `activity.ts:78-96`: `listarAsistencias(id, {enmascarar})` con `where anuladoEn:null`.
  - `activity.ts:135-139`: `eliminarAsistencia(id, anuladoPorId)` pasa a `update` de `anuladoEn` y `anuladoPorId`.
  - `activity.ts:148-176` (`matrizAsistencia` y `matrizLegacy`): filtra `anuladoEn:null`.
  - `activity/controllers/activity.ts:26-47`:
    - Si llega `fueraDeHorario` sin el permiso: 403 `OUT_OF_HOURS_NOT_ALLOWED`.
    - Pasa `req.actor.id` también en `legacyCreate` y `legacyOvertime` (crítica 22).
  - `activity/validation.ts`: `metodo: oneOf(METODOS_ASISTENCIA).nullable()`.
- **Tipos de inscripción (`registration-type/controllers`):** quita los precios si no tiene `pagos.ver`.
- **Ponencias (`papers/controllers/papers.ts:59`):** se exporta `UUID_RECEPCION` para compartirlo con el resolutor.

**Base de datos y documentación**
- **`src/database/seed.ts:12-13`:** agrega TESORERO y COMISION y los nombres nuevos (`upsert` con `update:{nombre}`).
- **`bootstrapAdmin.ts:38`:** usa `ROL.OWNER`; no cambia de comportamiento.
- **Documentación:**
  - `docs/api.md:12` y `docs/arquitectura-ecosistema.md:260-266` (contrato 4).
  - `AGENTS.md`.
  - `.specify/memory/constitution.md` principio III, versión 1.3.0: guardas `requirePermiso` y actor leído de la BD.
  - `specs/013-roles-permisos/{spec,plan,tasks}.md` y `contracts/api-roles-permisos.md`.

## 5) Cambios panel por archivo

**Nuevos**
- **`app/utils/permisos.ts`:**
  - `PERMISOS`, `Permiso`, `AccesoPanel`.
  - `tienePermiso(acceso, p|p[])`.
  - `menuPara(acceso)` y `inicioPara(acceso)`: COMISION con `asistencia.marcar` va a `/asistencia`; si no, al primer permitido; sin nada, a `/sin-acceso`.
  - `conDependencias`.
  - `accesoDeSesion(usuario)`, respaldo para sesiones sin `acceso`: `SUPERADMIN` → todos; `ADMIN` → todos menos `sistema.configurar`; otros → vacío.
  - `etiquetaRol` y `tonoRol`.
  - Nombres elegidos para no chocar con `accesoDe` y `FormAdmin.acceso` (`utils/administradores.ts:4,17,26`, crítica 15).
  - Los códigos de permiso desconocidos se ignoran.
- **`app/pages/sin-acceso.vue`:** página sin `permiso`.
- **`server/api/auth/perfil-participante.post.ts`:** con `assertSameOrigin`, llama a `POST /v1/auth/participant-session` y ejecuta `guardarSesion`.
- **Pruebas y specs:** `tests/permisos.test.ts` y `specs/008-roles-permisos/{spec,plan,tasks}.md`.

**Modificados**
- **`types/router.d.ts`:** `soloSuperAdmin` pasa a `permiso?: Permiso | readonly Permiso[]`.
- **`utils/sesion.ts`:**
  - `:9-13` `MetaAcceso`.
  - `:45-51` `redireccionPara(tipo, meta, acceso)`: si falta el permiso, va a `inicioPara`.
  - `:57-60` `destinoTrasLogin(tipo, redirect, acceso)`.
  - `SESSION_INVALIDATED` ya existe (`:63`).
- **`middleware/auth.global.ts:18`:** pasa `auth.acceso`.
- **`stores/auth.ts:23`:**
  - Se retira `esSuperAdmin`.
  - Se agregan `acceso`, `puede(p)` y `refrescarAcceso()`: como máximo cada 15 s y conserva la sesión previa si el error no es 401.
  - Se agrega `cambiarAParticipante()`.
- **`stores/evento.ts`:**
  - Tipo `EventoResumen`.
  - Clave de localStorage por usuario: `panel_evento_seleccionado:<id>` (`:4,46`).
  - Lista vacía: nada seleccionado.
  - `cargar(true)` ante `EVENT_NOT_ASSIGNED` (crítica 16).
- **`server/api/auth/session.get.ts:22-24`:** cierra la sesión solo ante un 401. Cualquier otro error devuelve 503 `SESSION_UNAVAILABLE` sin tocar la cookie (crítica 9).
- **`composables/useApi.ts:16-20`:**
  - 401: navega a `/login` con `motivo=código`.
  - 403 `FORBIDDEN` o `EVENT_NOT_ASSIGNED`: llama `refrescarAcceso()` y `eventos.cargar(true)`, recalcula `redireccionPara` y navega si hace falta; después relanza el error.
- **`utils/errores.ts`:** mensajes para `FORBIDDEN`, `EVENT_NOT_ASSIGNED`, `ROLE_NOT_ASSIGNABLE`, `ADMIN_NOT_MANAGEABLE`, `LAST_OWNER`, `EVENTS_REQUIRED`, `PERMISSIONS_REQUIRED`, `PERMISSION_NOT_ELIGIBLE`, `OUT_OF_HOURS_NOT_ALLOWED`, `STATUS_NOT_ALLOWED` y `GOOGLE_SESSION_REQUIRED`.
- **`types/api.ts`:**
  - `:27` `Usuario.rolCodigo` pasa a la unión de los 4 códigos y agrega `acceso?`.
  - `:308` `Administrador` agrega `alcance`, `eventos` y `permisos`.
  - Nuevo `RolAsignable`.
  - Montos como `number|null`; `pago|null`.
- **`components/layout/AppSidebar.vue:5-33,41`:** usa `menuPara(auth.acceso)`; el logo lleva a `inicioPara`; el ítem pasa a llamarse "Equipo y administradores".
- **Enlaces condicionados:** `dashboard/SemanaSistemicaCard.vue:17` (Integraciones, con `eventos.configurar`) y `pages/index.vue:53-54` (crítica 23).
- **`definePageMeta` por página:**

  | Página | Permiso |
  |---|---|
  | `index.vue` | `resumen.ver` |
  | `inscripciones/index.vue` | `inscripciones.ver` |
  | `asistencia.vue` | `asistencia.ver` |
  | `ponencias.vue` | `ponencias.ver` |
  | `mensajes.vue` | `mensajes.ver` |
  | `eventos/*`, `tipos-inscripcion.vue` | `eventos.configurar` |
  | `consultas.vue` | `consultas_dni.gestionar` |
  | `participantes.vue` | `participantes.gestionar` |
  | `correo.vue:20` | `correo.configurar` |
  | `administradores.vue:8` | `administradores.gestionar` |
  | `sistema.vue:30` | `sistema.configurar` |

- **Botones y columnas:**
  - `index.vue`: línea 59 con `eventos.configurar`; líneas 67 y 111 (montos) con `pagos.ver`.
  - `inscripciones/index.vue`: línea 111 (exportar) con `inscripciones.exportar`; línea 193 (monto) con `pagos.ver`; línea 201 "Revisar" pasa a "Ver" sin `inscripciones.validar`.
  - `InscripcionDetalle.vue`: líneas 75 y 155-181 con `pagos.ver`; línea 219 con `credenciales.reenviar`; líneas 221-225 con `inscripciones.validar`. La opción CANCELADO requiere `inscripciones.cancelar`.
  - `asistencia.vue`:
    - Línea 111 (exportar) con `asistencia.exportar`; línea 115 con `eventos.configurar`.
    - Líneas 125-139 con `asistencia.marcar`; línea 131 con `asistencia.fuera_horario`; línea 158 "Anular" con `asistencia.anular`.
    - Envía `metodo` QR o DNI.
    - Nueva columna "Registrado por".
  - `mensajes.vue`: eliminar con `mensajes.eliminar`.
  - `eventos/[id].vue:25,113` y `EventoForm.vue:108,123,228,254`: con `correo.configurar`.
- **Menú de usuario** (`layouts/default.vue`): botón "Ver mi inscripción" si `acceso.perfilParticipante`.
- **`administradores.vue` y `utils/administradores.ts:13-21,46-64`:**
  - Roles tomados de `GET roles`.
  - Casillas de eventos si `alcance==='EVENTO'`.
  - Casillas de `permisosElegibles` para COMISION, con `conDependencias` y `asistencia.marcar` preseleccionado. `inscripciones.*` y `credenciales.reenviar` quedan desmarcados.
  - Columnas Rol y Alcance.
  - En la propia cuenta, rol, activo, correo (si no es OWNER), eventos y permisos quedan deshabilitados.
  - `cuerpoAdmin(form, editando, {propio})` no envía `rolCodigo`, `activo`, `eventoIds` ni `permisos` en la propia cuenta.
- **Documentación:**
  - `.specify/memory/constitution.md` principio VI, versión 1.2.0: "dos perfiles por audiencia; dentro de staff, roles y permisos declarados por página; el backend es la autoridad".
  - `AGENTS.md:45,63`, `docs/arquitectura.md:41-42` y `docs/overview.md:14-19`.

## 6) Pruebas

**Backend (jest)**
- **Infraestructura:**
  - `jest.config.cjs:7` agrega `setupFilesAfterEnv: ['<rootDir>/tests/setup-actor.ts']`, que hace `jest.mock('../src/core/actor-consulta')` sobre un registro en `tests/helpers/actores.ts`. `actorDesdeFila` queda real (crítica 10).
  - `tokenDeRol(rol, id?, {eventoIds, permisos, activo})` (`tests/helpers/tokens.ts:4`): registra la fila del actor. Sin id, asigna uno único. Si un id ya registrado se registra con otro rol, lanza.
  - Los 10 archivos que usan `tokenDeRol` siguen funcionando porque los códigos no cambian.
- **`tests/core/permisos.test.ts`:**
  - Dependencias y cierre.
  - `permisosEfectivos` por rol.
  - Un permiso no elegible guardado en la BD se ignora.
  - La intersección de los elegibles de COMISION con `{pagos.ver, inscripciones.validar, G*}` es vacía.
  - `rolesGestionables`.
- **`tests/core/actor.test.ts`:** cuenta inactiva o rol desconocido dan `null`; una cuenta global devuelve `eventoIds` vacío.
- **`tests/security/matriz-rutas.test.ts`:**
  - Recorre las 117 rutas igual que `routesLoader.ts:19-42`.
  - `MATRIZ` clasifica cada una como PUBLICA, SITIO, PARTICIPANTE, SESION o `{permisos, resolutor}`. Una ruta no listada hace fallar la prueba (crítica 8).
  - La guarda va antes de `upload` y `validateBody`.
  - Todo permiso E tiene resolutor o `filtraPorActor`.
  - No queda ningún uso de `requireRoles`.
- **`tests/security/literales-rol.test.ts`:** los literales `'SUPERADMIN'` y `'ADMIN'` solo aparecen en `catalogos.ts`, en `seed.ts` y en los `tipo:'ADMIN'` permitidos.
- **`tests/security/alcance.test.ts`** (HTTP), cuenta asignada al evento 2:
  - `/events/3/…`, `/events/0x3/…` y `/events/3.0/…` dan 403 `EVENT_NOT_ASSIGNED` (crítica 1).
  - UUID de ponencia en mayúsculas de otro evento da 403.
  - Un recurso inexistente da 404 a la cuenta por evento.
  - Las rutas mixtas #4 y #78 y `GET /events` dan 200 a TESORERO y COMISION (crítica 2).
  - Cuenta inactiva: 401 `SESSION_INVALIDATED`.
  - ADMIN: `settings` da 403; `email-credentials` da 200.
  - TESORERO: `GET /events` sin `credencialCorreo`.
  - Resumen, CSV, detalle y categorías: sin montos para COMISION y con montos para TESORERO.
  - Voucher y `PATCH status` dan 403 a COMISION.
  - TESORERO con destino CANCELADO: 403 `STATUS_NOT_ALLOWED`.
  - `participant-session` con sesión por contraseña: 403.
- **`tests/activity/asistencia.test.ts`** (nuevo; hoy no existen pruebas de activity):
  - Búsqueda limitada a las inscripciones del evento.
  - `fueraDeHorario` sin el permiso: 403.
  - Se guardan `registradoPorId` y `metodo`.
  - Anular y volver a marcar reactiva la asistencia.
  - Enmascarado del DNI.
  - Matriz sin anuladas.
  - La ruta legacy registra al actor.
- **`tests/admin/delegacion.test.ts`:**
  - ADMIN: crea TESORERO con eventos → 201; crea ADMIN → 403; edita a un OWNER → 403; edita su propio nombre enviando su `rolCodigo` → 200 (regresión de `:103`); cambia su propio correo → 409.
  - Degradar al último OWNER → 409.
  - COMISION con `pagos.ver` → 422; TESORERO sin eventos → 422; crear sin `rolCodigo` → 422.
  - Listas de `GET /admin` y `GET /roles` filtradas.
  - Borrar una cuenta con asistencias → se desactiva.
- **Actualizar:**
  - `tests/security/routes.test.ts:45-64`: 403 para ADMIN solo en settings; 403 para TESORERO en admin, email y tokens.
  - `tests/google-auth/google.test.ts:36,93`: `usuario.acceso`; rol desconocido rechazado.
  - `tests/inscription/*`: el reenvío reutiliza el PDF.

**Panel (vitest)**
- **`tests/permisos.test.ts`:**
  - `menuPara`: OWNER 12 ítems, ADMIN 11, TESORERO 5, COMISION solo Asistencia.
  - `inicioPara` y `accesoDeSesion`.
  - `conDependencias`.
- **`tests/sesion.test.ts:34-41`:** se reescriben con `permiso` y con `destinoTrasLogin(…, acceso)`.
- **`tests/administradores.test.ts`:** en la propia cuenta no se envían `rolCodigo`, `activo`, `eventoIds` ni `permisos`; los errores locales; `eventoIds` y `permisos` según el rol.
- **Prueba nueva:** helper puro `debeCerrarSesion(status)` que usa el BFF de sesión.

## 7) Fases (★ = imprescindible antes del 26-oct)

1. ★ **F0, del 1 al 2-oct:**
   - Respaldo de la BD.
   - Correr `verificar-roles-013.sql`; el OWNER decide cuenta por cuenta.
   - Cerrar las decisiones de la sección 9.
   - Specs 013 y 008 con su contrato.
   - Congelar `auth.ts`, `google-auth.ts`, `activity.ts`, el esquema de `asistencias` y `stores/auth.ts` para los demás bloques hasta que se fusione A.
2. ★ **F1, backend, del 2 al 7-oct**, en este orden:
   1. `permisos.ts` con sus pruebas.
   2. Esquema, migración y ensayo con el runbook de fallo.
   3. `actor` y resolutores.
   4. `requirePermiso` con la comprobación al arrancar.
   5. Recablear los 15 archivos de rutas y escribir la matriz.
   6. Vista reducida de eventos y ocultación de montos.
   7. Asistencia: búsqueda limitada al evento, auditoría, anulación lógica y límites.
   8. Delegación, `LAST_OWNER`, roles, sesión y login con `acceso`.
   9. Seed.
   10. Pruebas y documentación.

   Push a main el **miércoles 7-oct**; despliega y migra. Justo después, `reasignar-013.sql` si corresponde. El backend nuevo es compatible con el panel viejo, porque `SUPERADMIN` y `ADMIN` no cambian. No crear cuentas TESORERO ni COMISION hasta que llegue F2.
   - Recortable si falta tiempo: `participant-session`, el DNI enmascarado y el filtro de precios en #78.
3. ★ **F2, panel, del 7 al 8-oct:** todo lo de la sección 5. Despliegue el **jueves 8-oct**.
4. ★ **F3, del 12 al 16-oct:**
   - Prueba rápida con 4 cuentas de prueba en un evento en BORRADOR.
   - Crear las cuentas reales de TESORERO y COMISION del VIII.
   - Simulacro de escaneo con lector USB y DNI.
   - **Desde el 19-oct**, el Bloque A queda congelado salvo hotfix.
5. Mientras tanto, del 9 al 18-oct: bloques de portal/OTP y fotocheck, sobre A ya fusionado. El OTP siempre emite sesión de participante. El nuevo QR debe seguir aceptando el `participanteId` de las credenciales del VIII ya enviadas (`generatePdf.ts:41`).
6. **F4, después del 30-oct:**
   - Renombrar los códigos a OWNER y ADMINISTRADOR en dos despliegues (primero los alias, después el DML).
   - Caché del actor si hiciera falta.
   - Perfil propio de staff.
   - Permisos `certificados.*` en el mismo catálogo.
   - Alta manual de participantes, si se decide.

## 8) Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| Un permiso E sin resolutor filtra datos de otros eventos | Error al arrancar, matriz de 117 rutas y resolutores que fallan cerrado con `idParam` y el mismo regex de UUID |
| Las cuentas ADMIN actuales (unas 11, `docs/despliegue-ecosistema.md:62`) ganan correo, tokens, borrado de inscripciones y gestión del equipo | Preflight por cuenta, decisión del OWNER y `reasignar-013.sql` el mismo día. La guarda lee la BD, así que el cambio aplica al instante |
| La migración falla a medias (P3009 bloquea también a la imagen vieja) | DDL aditivo, `revertir-013.sql` + `migrate resolve --rolled-back` y ensayo sobre el respaldo |
| La COMISION enumera participantes por `participanteId` secuencial | Búsqueda limitada al evento, límite de 120 por minuto por actor, `registrado_por_id` y DNI enmascarado. El arreglo real (QR firmado) va en el bloque de fotocheck |
| Una marca de asistencia se borra y afecta los certificados | Anulación lógica auditada. Los certificados cuentan `anulado_en IS NULL` |
| Puppeteer y Brevo por abuso de reenvíos | PDF en caché y límite de 20 cada 15 min por actor |
| Un corte pasajero de la BD saca a los usuarios | El BFF cierra la sesión solo ante 401 y `refrescarAcceso` conserva la sesión |
| El panel queda desactualizado respecto a permisos o eventos | Reacción al 403 (refrescar y recargar eventos). El backend es la autoridad |
| Choque de calendario con otros bloques en archivos compartidos | Orden A → portal/fotocheck, archivos congelados y un agente por repositorio (`B/AGENTS.md`) |
| Staff que también está inscrito no llega al portal (`google-auth.ts:44-50`) | `participant-session` exigiendo sesión con Google, más la regla de que el OTP siempre da sesión de participante |
| Se pierde el último OWNER | `FOR UPDATE` y 409. La recuperación documentada es por SQL, porque `bootstrapAdmin.ts:32-35` no promueve cuentas existentes |

**Disposición de la crítica (26 puntos)**

| # | Estado | Cómo quedó |
|---|---|---|
| 1 | Aplicada | Resolutores con `idParam`, 404 cerrado y pruebas con `0x3`, `3.0` y UUID en mayúsculas |
| 2 | Aplicada | Regla por permiso; pruebas de las rutas mixtas |
| 3 | Aplicada | Preflight por cuenta y script de reasignación |
| 4 | Resuelta | Sin renombre y con runbook de reversión |
| 5 | Aplicada | `participant-session` y precedencia del OTP |
| 6 | Aplicada | `asistencia.exportar`, búsqueda limitada al evento, DNI enmascarado y límite por actor |
| 7 | Aplicada | Anulación lógica y `metodo` en un único `ALTER` |
| 8 | Aplicada | La matriz cubre las 117 rutas y el orden de la guarda |
| 9 | Parcial | El orden de despliegue ya no importa sin renombre; el cierre de sesión solo ante 401 sí se aplica |
| 10 | Aplicada | `actorDesdeFila` pura, mock de `actor-consulta` e ids únicos |
| 11 | Aplicada | `inscripciones.cancelar` G y decisión 2 |
| 12 | Aplicada | PDF en caché y límite |
| 13 | Aplicada | Orden entre bloques y congelamiento |
| 14 | Aplicada | Cierre de dependencias al cargar |
| 15 | Aplicada | `accesoDeSesion` y `AccesoPanel` |
| 16 | Aplicada | Recarga de eventos y clave por usuario |
| 17 | Aplicada | Precios y motivo de rechazo solo con `pagos.ver` |
| 18 | Aplicada | `FOR UPDATE` |
| 19 | Aplicada | Rechazo en el login y reutilización de `SESSION_INVALIDATED` |
| 20 | Aplicada | `rolCodigo` obligatorio |
| 21 | Aplicada | Excepción documentada: ADMIN solo edita su nombre y contraseña |
| 22 | Aplicada | La asistencia legacy guarda `registradoPorId` |
| 23 | Aplicada | Contrato 4, `overview.md` y enlaces condicionados |
| 24 | Descartada | No hay renombre, así que el seed viejo no recrea filas |
| 25 | Parcial | El panel ignora códigos desconocidos y el contrato es la fuente; no se agrega prueba entre repositorios |
| 26 | Aplicada | `datosPago` con `pagos.ver` |

"Certificado de ORGANIZADOR para staff no inscrito" se traslada al bloque de certificados: el destinatario puede ser una cuenta de `administradores`.

## 9) Decisiones abiertas para el usuario

1. **Las cuentas ADMIN actuales** pasan a ADMINISTRADOR con más poderes: correo, tokens, borrar inscripciones y crear TESORERO y COMISION. **Recomendación:** que el OWNER revise el listado del preflight el 2-oct y pase a TESORERO o COMISION, o desactive, a quien no deba configurar.
2. **Estados que puede poner el TESORERO.** **Recomendación:** puede aprobar, rechazar, poner en revisión y revertir un APROBADO a EN_REVISION o RECHAZADO (queda `revisadoPor`); `CANCELADO` solo OWNER y ADMINISTRADOR.
3. **COMISION y datos personales** (`inscripciones.ver` y `exportar`: DNI, correo, celular). **Recomendación:** elegibles pero desmarcados por defecto; en asistencia el DNI se muestra enmascarado.
4. **Staff que también está inscrito.** **Recomendación:** botón "Ver mi inscripción", un cambio de perfil en un solo sentido que exige haber entrado con Google; para volver al panel, cerrar sesión. La alternativa es no ofrecerlo y que use el OTP del portal en otro navegador.
5. **"Crear otros (los que se inscriben)".** ¿Se necesita registrar inscripciones o participantes manualmente desde el panel? Hoy solo existen listar, ver y editar (`participant.ts:16-18`). **Recomendación:** fuera del Bloque A. Para el VIII, la inscripción presencial se hace con el formulario de la landing; el alta manual se trata en una spec posterior.

### Critical Files for Implementation
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/middlewares/auth.ts
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/admin/services/admin.ts
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/activity/services/activity.ts
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/prisma/schema.prisma
- C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend/app/utils/sesion.ts

---

## Anexo: crítica adversarial

# Revisión adversarial del Bloque A (roles, permisos y alcance)

B = `C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic`, P = `C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend`. Todo lo que sigue está comprobado contra el código. Quedan fuera OTP, fotos y verificación pública, que no son parte de este bloque.

## ALTO

**1. Los resolutores dejan pasar cuando devuelven null, y un parseo distinto entre resolutor y controlador permite leer otros eventos.**
- **Diseño:** "si el recurso no existe devuelven `null` y la guarda deja pasar".
- **Controladores:** usan `idParam`, que es `Number(value)` (B/src/core/http-error.ts:26-29). Por eso aceptan `0x3`, ` 3` y `3.0` como id 3.
- **Ataque 1:** si `eventoDelParametro` usa `parseInt` o `/^\d+$/`, `GET /v1/events/0x3/inscriptions` da `null` en el resolutor, la guarda deja pasar y el controlador lee el evento 3.
- **Ataque 2:** la descarga de ponencias valida el UUID con `/i` (B/src/api/papers/controllers/papers.ts:59). La tabla usa `utf8mb4_unicode_ci` (B/prisma/migrations/20260928000000_paper_submissions/migration.sql), así que `findUnique` encuentra el UUID aunque venga en mayúsculas. Si el resolutor valida solo minúsculas, se descarga la ponencia de otro evento.
- **Corrección:**
  - Para cuentas con alcance EVENTO, un `null` debe responder 404 dentro de la guarda (fallar cerrado).
  - Los resolutores deben reutilizar `idParam` y la misma expresión del UUID.
  - Agregar pruebas con `0x3`, `3.0` y UUID en mayúsculas.

**2. La regla "si son permisos G y el actor no es global: 403" es ambigua y puede dejar el panel inutilizable para TESORERO y COMISION.**
- `requireActor = requirePermiso(PERMISOS, …)` incluye los 10 permisos G.
- Las rutas #4 y #78 mezclan permisos E y G.
- **Si se implementa como `requeridos.some(esG) && !global`:**
  - `GET /v1/events` da 403 a TESORERO y COMISION. Lo carga la tienda de eventos (P/app/stores/evento.ts:29) desde el layout (P/app/layouts/default.vue:9), así que se rompe todo el panel.
  - También fallan `activities` (P/app/pages/asistencia.vue:33) y `registration-categories` (P/app/pages/inscripciones/index.vue:51).
- **Corrección:** definir la regla por permiso: `permitidos = (requeridos ∩ actor.permisos).filter(p => alcance(p)==='E' || actor.global)`. Agregar pruebas de las rutas mixtas con TESORERO y COMISION.

**3. La migración amplía en silencio los privilegios de todas las cuentas ADMIN actuales.**
- En producción hay 11 administradores (B/docs/despliegue-ecosistema.md:62) y el reparto por rol no se conoce.
- Al pasar `ADMIN→ADMINISTRADOR`, esas cuentas ganan cuatro capacidades que hoy son solo de SuperAdmin:
  - credenciales de correo (B/src/api/email-credential/routes/email-credential.ts:9-14);
  - tokens de acceso (B/src/api/access-token/routes/access-token.ts:9-11);
  - borrar inscripciones (B/src/api/inscription/routes/inscription.ts:26,36);
  - gestionar cuentas (B/src/api/admin/routes/admin.ts:9-13).
- **Corrección:** en la Fase 0, el preflight debe listar cada cuenta (correo, rol, `google_sub`, última revisión). El OWNER decide cuenta por cuenta antes del push, y el runbook incluye el SQL de reasignación a TESORERO o COMISION ejecutado justo después de migrar.

**4. El rollback descrito es falso si la migración falla a medias.**
- `docker-entrypoint.sh` usa `set -e` y ejecuta `prisma migrate deploy` al arrancar (líneas 6 y 10).
- Si la migración falla después del DML, Prisma la registra como fallida y todo `migrate deploy` posterior se bloquea (P3009), incluida la imagen vieja. La API queda caída hasta ejecutar `migrate resolve`.
- Además, con los códigos ya renombrados, la imagen vieja emite JWT con `OWNER` (B/src/api/admin/services/admin.ts:22). `verifySuperAdminRole` (B/src/middlewares/auth.ts:57-58) respondería 403 a todos.
- **Corrección (elegir una):**
  - Separar en dos migraciones: primero el DDL aditivo; después, en un despliegue aparte, el renombre.
  - O no renombrar hasta después del 30-oct. La ambigüedad de `ADMIN` solo afecta a las búsquedas en el código.
- En ambos casos: ensayar el fallo sobre el respaldo y dejar escritos `migrate resolve --rolled-back` y el SQL inverso.

**5. El staff que también es participante nunca llega al portal, y este bloque multiplica esos casos.**
- Un admin activo tiene prioridad en el login con Google (B/src/api/google-auth/services/google-auth.ts:44-50).
- Los miembros de COMISION y TESORERO suelen ser estudiantes inscritos, y el usuario pidió certificados de ORGANIZADOR.
- No podrán ver su credencial, fotocheck, asistencia ni certificados.
- **Corrección:** decidirlo ya en este bloque, no en el del portal. Opciones: que el login devuelva ambos perfiles y el usuario elija (backend y P/server/api/auth/google.post.ts:33-35), o un botón "Cambiar a mi inscripción". Fijar la misma precedencia para el OTP.

## MEDIO

**6. El permiso `asistencia.ver` expone datos personales aunque `inscripciones.ver` esté desmarcado.**
- `asistencia.ver` va implícito en `asistencia.marcar`, que viene preseleccionado.
- **Qué expone:**
  - La exportación de asistencia lista a TODOS los aprobados con DNI, no solo a los asistentes (B/src/api/activity/services/activity.ts:148-176).
  - `listarAsistencias` muestra el DNI (:85-95).
  - El POST de asistencia devuelve nombre y DNI (:125). Como el `participanteId` es secuencial, se puede enumerar.
  - `PARTICIPANT_NOT_FOUND` (404) frente a `NOT_APPROVED` (403) (:107,112) revela si una persona existe en otros eventos.
- **Corrección:**
  - Crear `asistencia.exportar` separado, sin implicaciones.
  - Unificar esos dos errores para cuentas con alcance EVENTO.
  - Límite por actor en el POST.
- La mitigación "permiso + `registradoPorId`" no impide que alguien presente un QR con el id de otra persona (B/src/api/inscription/utils/generatePdf.ts:41). El arreglo del QR en el bloque de fotocheck debe seguir aceptando los ids de las credenciales del VIII ya enviadas.

**7. `asistencia.anular` borra sin dejar rastro.**
- `eliminarAsistencia` hace un borrado físico (B/src/api/activity/services/activity.ts:135-139).
- Una COMISION puede borrar marcas de otros, y los certificados dependen de la asistencia.
- **Corrección:** anulación lógica (`anulado_por_id`, `anulado_en`) en ESTA misma migración, coordinada con la columna `metodo` para no alterar `asistencias` dos veces. O limitarla a las marcas propias y recientes, y no dejarla elegible por defecto.

**8. La matriz de pruebas no detecta una ruta nueva sin ninguna guarda.**
- "Una ruta administrativa nueva sin entrada hace fallar la prueba" depende de que la ruta tenga guarda. Una ruta sin guarda, el caso más peligroso, pasaría.
- **Corrección:**
  - La `MATRIZ` debe cubrir las 116 rutas, clasificadas como PUBLICA, SITIO, PARTICIPANTE, SESION o permiso. Cualquier ruta no listada hace fallar la prueba.
  - Afirmar que la guarda va antes de `upload` y `validateBody`. Hoy se cumple (B/src/api/payment-qr/routes/payment-qr.ts:13), pero sin la prueba nada lo sostiene.

**9. Orden de despliegue y cierre de sesión por errores pasajeros.**
- **Entre despliegues:** con el panel viejo y el backend nuevo, `esSuperAdmin` (`rolCodigo==='SUPERADMIN'`, P/app/stores/auth.ts:23) deja de valer para el OWNER. Pierde Correo, Administradores y Sistema (P/app/components/layout/AppSidebar.vue:24-30, P/app/utils/sesion.ts:49) y la credencial de correo del evento (P/app/components/eventos/EventoForm.vue:108,123).
- **Corrección 1:** desplegar primero el panel, compatible con ambos juegos de códigos (el respaldo `accesoDe` ya lo permite), y después el backend.
- **Cierres de sesión:** `session.get.ts` cierra la sesión ante CUALQUIER error (P/server/api/auth/session.get.ts:22-24). Ahora `/v1/auth/session` consulta la BD y `refrescarAcceso` se llama en cada 403, así que un fallo pasajero de la BD saca al usuario.
- **Corrección 2:** cerrar la sesión solo ante un 401.

**10. El mock global del actor rompe pruebas existentes y crea dependencias de orden.**
- El login con Google devuelve `usuario` (B/tests/google-auth/google.test.ts:93-99). Si `acceso` se calcula con el `cargarActor` simulado, cuyo registro solo alimenta `tokenDeRol`, devuelve `null`.
- El registro por id se pisa: el token de nivel superior `tokenDeRol('SUPERADMIN',1)` (B/tests/admin/administradores.test.ts:22) cambia de rol si otra prueba registra el id 1.
- **Corrección:** una función pura `actorDesdeFila(admin)` que usen el login, la sesión y `cargarActor`, y simular solo la consulta. `tokenDeRol` debe asignar ids únicos o fallar si se registra un rol distinto para el mismo id.

**11. Contradicción con la decisión sobre TESORERO.**
- `PATCH status` acepta `CANCELADO` y permite revertir `APROBADO` (B/src/api/inscription/validation.ts:63-64).
- El usuario dijo: "aprobar/rechazar/en revisión".
- **Corrección:** limitar los estados destino según el permiso (CANCELADO solo para cuentas globales) o confirmarlo con el usuario.

**12. `credenciales.reenviar` es costoso y se puede abusar.**
- Cada reenvío lanza Puppeteer sin caché (B/src/api/inscription/services/inscription.ts:203-213, B/src/api/inscription/utils/generatePdf.ts:62-78) y envía un correo por Brevo.
- No hay límite por actor en las rutas administrativas (B/src/middlewares/rate-limit.ts).
- **Corrección:** crear un `limitador` con clave `actor`, reutilizar el PDF en caché al reenviar y no dejarlo elegible por defecto para COMISION.

**13. Riesgo de calendario.**
- Serían unos 5 días en el backend más 3-4 en el panel, con la regla de "un agente por repositorio a la vez" (B/AGENTS.md).
- Este bloque toca `auth.ts`, `google-auth.ts`, `activity.ts` y la tabla `asistencias`, igual que los bloques de portal/OTP y fotocheck.
- **Corrección:** fijar el orden entre bloques y congelar los archivos compartidos.

## BAJO

14. **Permisos al cargar:** solo se ignoran los códigos desconocidos. Un código conocido pero no elegible, insertado por SQL o que deje de ser elegible más adelante, seguiría valiendo; las dependencias solo se aplican al guardar. **Corrección:** al cargar, calcular `cierre(propios ∩ PERMISOS_ELEGIBLES_COMISION)`; para TESORERO, ignorar sus filas.
15. **Choque de nombres en Nuxt:** `accesoDe` ya existe y se auto-importa (P/app/utils/administradores.ts:26). Además, `FormAdmin.acceso` significa GOOGLE/CONTRASENA (:17). **Corrección:** renombrar las funciones y tipos nuevos (por ejemplo `accesoDeSesion` y `AccesoPanel`).
16. **Lista de eventos desactualizada:** `eventos.cargar` queda en caché (P/app/stores/evento.ts:25). Ante `EVENT_NOT_ASSIGNED` hay que llamar también a `eventos.cargar(true)`. La selección se guarda en localStorage (:4,46), lo que confunde en laptops de escaneo compartidas.
17. **Montos deducibles:** la ruta #78 devuelve `precio` y `precioInstitucional` con `inscripciones.ver`. Con el tipo y `esEstudianteUndc` de cada fila, el monto se puede calcular, y el CSV incluye el motivo de rechazo. **Corrección:** quitar los precios sin `pagos.ver`, o documentar que se acepta porque la landing los publica.
18. **`LAST_OWNER`:** hay riesgo de que dos degradaciones simultáneas pasen ambas (write skew en REPEATABLE READ); usar `FOR UPDATE`. Además, `bootstrapAdmin` no puede promover una cuenta existente (B/src/database/bootstrapAdmin.ts:32-35), así que la única recuperación es por SQL.
19. **Login con rol desconocido:** el login no valida el rol (B/src/api/admin/services/admin.ts:59, B/src/api/google-auth/services/google-auth.ts:45). Entra y luego recibe 401 en bucle. **Corrección:** rechazar en el login. Conviene reutilizar el código `SESSION_INVALIDATED` en vez de crear `SESSION_REVOKED`; ya existe en B/src/middlewares/auth.ts:71, P/app/utils/sesion.ts:63 y P/app/composables/usePortal.ts:16.
20. **Rol por defecto:** `createAdmin` usa `'ADMIN'` si no se envía rol (B/src/api/admin/services/admin.ts:86). Con delegación, `rolCodigo` debe ser obligatorio.
21. **Autoedición del ADMINISTRADOR:** permitirle editarse va contra la letra de "NO puede editar ADMINISTRADOR". Documentarlo como excepción y precisar si puede cambiar su propio correo.
22. **Rutas legacy de asistencia:** no registran `registradoPorId` (B/src/api/activity/controllers/activity.ts:41-47).
23. **Documentación y enlaces sin cubrir:**
    - Falta actualizar el contrato 4 (B/docs/arquitectura-ecosistema.md:260-266) y P/docs/overview.md:14-19.
    - El diseño no condiciona el enlace "Integraciones" (P/app/components/dashboard/SemanaSistemicaCard.vue:17) ni los enlaces de P/app/pages/index.vue:53-54.
24. **Seed viejo:** si se ejecuta tras la migración, `seed.ts:11-13` vuelve a crear `SUPERADMIN` y `ADMIN` como filas nuevas.
25. **Catálogo duplicado:** `PERMISOS` existe en el panel y en el backend y puede desincronizarse. Derivarlo de `GET /v1/roles` o agregar una prueba de contrato.
26. **Vista reducida sin datos de pago:** TESORERO no recibe `datosPago` en la vista reducida de eventos y podría necesitar las cuentas para validar vouchers; esas cuentas ya son públicas en la landing.

## Requisitos sin cubrir en este bloque
- Alta de participantes desde el panel ("otros, los que se inscriben"): hoy las rutas de participantes solo son list/find/update (B/src/api/participant/routes/participant.ts:16-18).
- Certificado de ORGANIZADOR para staff que no está inscrito (depende del punto 5).
