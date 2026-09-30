# Feature Specification: Roles, permisos y alcance por evento

**Feature Branch**: `feat/roles-permisos`
**Created**: 2026-09-30
**Status**: En implementación
**Input**: "como funciona el tema de los permisos y roles ... poner owner administrador de sistema, tesorero ... solo owner y administrador del sistema pueden ver la configuración ... el owner puede crear administradores y todo tipo y también el mismo owner, pero el administrador no, el tesorero solo puede ver resumen inscripciones todo lo que tiene que ver del congreso ... los administradores pueden designar a cierto equipo de la comisión tecnológica pero no acceso a todo para que puedan por ejemplo marcar asistencia de los inscritos"

Decisiones: el Owner puede todo y es el único con Sistema y el único que gestiona Owners y
Administradores; el Administrador del sistema configura los eventos (incluidas credenciales de
correo y borrados) y gestiona solo Tesoreros y Comisión; el Tesorero trabaja en sus eventos
(resumen, inscripciones con montos y vouchers, validar pagos sin cancelar, exportar, reenviar
credenciales, ver asistencia, ponencias y mensajes); la Comisión trabaja en sus eventos con los
permisos elegidos para cada cuenta, nunca pagos ni configuración. Sin `pagos.ver` los montos
salen en `null`. El VIII CIISIC es del 26 al 30-oct-2026: nada puede romper el panel actual.
Diseño y revisión adversarial: [research.md](research.md).

## User Scenarios & Testing

### User Story 1 - Owner y Administrador del sistema arman el equipo (Priority: P1)

**Acceptance Scenarios**:

1. **Given** que soy Owner, **When** creo una cuenta de cualquier rol (también otro Owner),
   **Then** se crea.
2. **Given** que soy Administrador del sistema, **When** creo un Tesorero o una cuenta de la
   Comisión con sus eventos, **Then** se crea; **When** intento crear o editar un Owner o un
   Administrador, **Then** `403 ROLE_NOT_ASSIGNABLE` o `403 ADMIN_NOT_MANAGEABLE`.
3. Crear un Tesorero o una Comisión (o pasar a esos roles) sin eventos → `422 EVENTS_REQUIRED`;
   Comisión sin permisos → `422 PERMISSIONS_REQUIRED`; con un permiso de pagos o de configuración →
   `422 PERMISSION_NOT_ELIGIBLE`. Una cuenta que se quedó sin eventos se puede editar y desactivar.
4. No puedo desactivarme ni cambiar mi propio rol, eventos o permisos (`409 SELF_UPDATE_FORBIDDEN`);
   sin ser Owner, tampoco mi correo ni mi vínculo con Google. Editar mi nombre enviando mi mismo
   `rolCodigo` (como hace el panel actual) sí funciona.
5. Degradar, desactivar o borrar al último Owner activo → `409 LAST_OWNER`.
6. Borrar una cuenta que revisó inscripciones o registró o anuló asistencias la desactiva.
7. Un Tesorero o Comisión que pasa a Owner o Administrador pierde la contraseña y el vínculo con
   Google (salvo una contraseña nueva en la misma petición), y sus sesiones se cierran.

### User Story 2 - El Tesorero valida los pagos de su evento (Priority: P1)

**Acceptance Scenarios**:

1. **Given** un Tesorero asignado al VIII, **When** entra al panel, **Then** solo ve el VIII y
   puede ver el resumen y las inscripciones con montos y vouchers, exportar el CSV y reenviar
   credenciales.
2. **When** aprueba, rechaza o pone en revisión, **Then** se guarda con él como revisor;
   `CANCELADO` → `403 STATUS_NOT_ALLOWED`.
3. Ve asistencia, ponencias y mensajes, pero marcar asistencia o configurar el evento →
   `403 FORBIDDEN`.
4. Un recurso de otro evento → `403 EVENT_NOT_ASSIGNED`.

### User Story 3 - La Comisión tecnológica marca asistencia (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una cuenta de la Comisión con solo "Marcar asistencia" en el VIII, **When** escanea
   el QR de la credencial o digita el documento, **Then** la asistencia queda registrada con quién
   la marcó y cómo (`QR`, `DOCUMENTO` o `MANUAL`).
2. Una persona no inscrita en el evento → `404 PARTICIPANT_NOT_FOUND`; un número de documento que
   comparten dos inscritos → `409 AMBIGUOUS_DOCUMENT` (indicar el tipo).
3. Fuera del horario solo con "Marcar fuera de horario": sin él → `403 OUT_OF_HOURS_NOT_ALLOWED`.
4. Sin "Ver inscritos" el documento sale como `****5678`; nunca recibe montos ni datos de pago.
5. Anular una marca la deja anulada (no la borra); volver a marcar la reactiva.

### User Story 4 - Los cambios de acceso aplican al instante (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una cuenta desactivada, borrada o con otros eventos o permisos, **When** hace su
   siguiente petición, **Then** la guarda ya lee la cuenta nueva: `401 SESSION_INVALIDATED` o `403`.
2. El login, Google, la sesión y la renovación devuelven `acceso` (alcance, permisos y eventos)
   para que el panel arme menús y botones; el backend sigue siendo la autoridad.
3. Cambiar el correo, la contraseña o el vínculo con Google de una cuenta cierra sus sesiones
   abiertas (`401 SESSION_INVALIDATED`); una sesión no se renueva más allá de 12 h desde el ingreso
   (`401 SESSION_EXPIRED`).

### User Story 5 - El panel actual no se rompe (Priority: P1)

**Acceptance Scenarios**:

1. **Given** el panel desplegado antes de esta spec, **When** el backend nuevo está en producción,
   **Then** Owner y Administrador reciben los mismos campos y `PUT /v1/admin/:id` sigue aceptando
   `rolCodigo`.
2. Los códigos `SUPERADMIN` y `ADMIN` no cambian: solo su nombre visible ("Owner" y
   "Administrador del sistema").

## Requirements

- **FR-001**: Cuatro roles: `SUPERADMIN` (Owner) y `ADMIN` (Administrador del sistema), globales;
  `TESORERO` y `COMISION`, por evento (`asignaciones_evento`). Los códigos históricos se conservan
  y el código los usa solo mediante `ROL.OWNER` y `ROL.ADMINISTRADOR`; el renombre queda para
  después del 30-oct-2026.
- **FR-002**: Catálogo de permisos con alcance G (solo cuentas globales) o E (por evento) y
  dependencias (`src/core/permisos.ts`). Owner: todos; Administrador: todos menos
  `sistema.configurar`; Tesorero: fijos; Comisión: los elegidos para la cuenta dentro de
  `PERMISOS_ELEGIBLES_COMISION` (por defecto `asistencia.marcar`), nunca pagos ni permisos G.
- **FR-003**: Toda ruta del staff usa `requirePermiso(permisos, { evento })` (basta uno de los
  permisos) o `requireActor`. La cuenta se lee de la BD en cada petición: `401 SESSION_INVALIDATED`
  si está inactiva, borrada o con un rol desconocido; `403 FORBIDDEN` sin el permiso. Con una cuenta
  por evento se resuelve el evento del recurso: `404 NOT_FOUND` si no existe y
  `403 EVENT_NOT_ASSIGNED` si no es suyo. La guarda va antes de `upload` y `validateBody`.
- **FR-004**: Delegación en `/v1/admin`: el Owner gestiona todos los roles y el Administrador solo
  Tesorero y Comisión; `rolCodigo` es obligatorio al crear; `eventoIds` y `permisos` reemplazan el
  conjunto completo (con dependencias); siempre queda un Owner activo (`FOR UPDATE`).
- **FR-005**: Login, Google, `GET /v1/auth/session` y `POST /v1/auth/refresh` devuelven
  `acceso: { alcance, permisos, eventoIds, perfilParticipante }`; `acceso` no va en el JWT. Una
  cuenta inactiva o con un rol desconocido no entra (`401 INVALID_CREDENTIALS` o
  `403 ACCOUNT_DISABLED`). El JWT lleva la huella de las credenciales (correo, contraseña, Google) y
  el inicio de la sesión; la renovación los conserva y se corta a las 12 h.
- **FR-006**: `GET /v1/events` sin `eventos.configurar` devuelve solo los eventos asignados con
  una vista reducida (sin credencial de correo ni configuración; `datosPago` solo con `pagos.ver`).
- **FR-007**: Sin `pagos.ver` las respuestas conservan las claves con montos, precios y datos de
  pago en `null`; el CSV omite las columnas de pago; el voucher responde 403.
- **FR-008**: `inscripciones.validar` aprueba, rechaza o pone en revisión; `CANCELADO` exige además
  `inscripciones.cancelar` (`403 STATUS_NOT_ALLOWED`). `revisadoPor` es la cuenta que valida.
- **FR-009**: Asistencia auditada (`registrado_por_id`, `metodo`, `es_fuera_de_horario`) con
  anulación lógica (`anulado_en`, `anulado_por_id`); la búsqueda de la persona no sale de las
  inscripciones del evento; las anuladas no cuentan en ningún listado ni exportación.
- **FR-010**: Límites por cuenta: marcar asistencia 120/min (solo cuentas por evento), reenviar
  credencial 20/15 min (reutiliza el PDF mientras siga al día) y renovar la sesión 30/15 min.
- **FR-011**: Migración aditiva `20260930150000_roles_permisos_alcance` con preflight de cuentas,
  plantilla de reasignación y script de reversión (`prisma/preflight/*-013.sql`).

## Success Criteria

- **SC-001**: Toda ruta protegida tiene una prueba de acceso denegado (403 para el rol sin permiso
  y 401 sin token).
- **SC-002**: Sin variables de entorno nuevas; roles y permisos por código.
- **SC-003**: Owner y Administrador usan el panel actual sin cambios durante el VIII CIISIC.
- **SC-004**: Una cuenta desactivada pierde el acceso en su siguiente petición, sin esperar a que
  caduque el JWT.
- **SC-005**: Ninguna respuesta a una cuenta sin `pagos.ver` lleva montos ni datos de pago.

## Limitaciones

- Al desplegar, los JWT emitidos por la imagen anterior (sin huella) dejan de valer: quien tenga el
  panel abierto vuelve a ingresar una vez.
- Si en un evento un DNI y un CE comparten número, el panel actual (que no envía `tipoDocumento`)
  recibe `409 AMBIGUOUS_DOCUMENT` al marcar por documento: se marca con el QR de la credencial hasta
  que el panel nuevo pida el tipo.
- `mensajes.eliminar` no es elegible para la Comisión ni lo tiene el Tesorero: solo lo usan las
  cuentas globales.
- `idParam` acepta `0x3` como 3: la guarda y el controlador resuelven el mismo recurso, así que
  responde `403 EVENT_NOT_ASSIGNED` (no 400) y nada se filtra.
- El cambio de staff a portal del inscrito (`acceso.perfilParticipante`) y el método `QR_LEGADO`
  llegan con la spec 014.
