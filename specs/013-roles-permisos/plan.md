# Implementation Plan: Roles, permisos y alcance por evento

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-roles-permisos.md](contracts/api-roles-permisos.md) | **Diseño**: [research.md](research.md)

- Núcleo:
  - `src/core/catalogos.ts`: `ROLES`, `ROL` (`OWNER`→`SUPERADMIN`, `ADMINISTRADOR`→`ADMIN`),
    `ROLES_GLOBALES`, `esCodigoRol` y `METODOS_ASISTENCIA`.
  - `src/core/permisos.ts`: `ALCANCE`, `PERMISOS_POR_ROL`, `PERMISOS_ELEGIBLES_COMISION`,
    `PERMISOS_COMISION_POR_DEFECTO`, `DEPENDENCIAS`, `cierre`, `permisosEfectivos`,
    `rolesGestionables`, `alcanceDeRol` y `ETIQUETAS_PERMISO`.
  - `src/core/actor-consulta.ts` (solo la consulta, para simularla en pruebas) y
    `src/core/actor.ts` (`actorDesdeFila` pura, `cargarActor`, `accesoPublico`, `usuarioDeActor`).
  - `src/core/resolutores-evento.ts`: `eventoDelParametro`, `eventoDeInscripcion`,
    `eventoDeActividad`, `eventoDeAsistencia`, `eventoDeMensaje`, `eventoDePonencia` y
    `uuidRecepcion` (parsean con `idParam` como los controladores).
- `src/middlewares/auth.ts`: `requirePermiso` y `requireActor`. `requireRoles`,
  `verifyAdminRole` y `verifySuperAdminRole` quedan obsoletos y se retiran al final.
- `src/middlewares/rate-limit.ts`: clave `actor`; `limiteMarcarAsistencia`,
  `limiteReenvioCredencial` y `limiteRenovacionSesion` (van justo después de la guarda).
- Esquema y migración `20260930150000_roles_permisos_alcance`: `asignaciones_evento`,
  `permisos_administrador`, columnas de `asistencias` (`metodo`, `registrado_por_id`,
  `es_fuera_de_horario`, `anulado_en`, `anulado_por_id`) y nombres de roles.
  `prisma/preflight/verificar-roles-013.sql`, `reasignar-013.sql` y `revertir-013.sql`.
- Rutas de los 15 módulos recableadas según la tabla del contrato; los comentarios "solo SuperAdmin"
  pasan al nuevo significado.
- `src/api/admin`: delegación (`ADMIN_NOT_MANAGEABLE`, `ROLE_NOT_ASSIGNABLE`, eventos y permisos
  validados según el rol final, conjuntos reemplazados en una transacción), `LAST_OWNER` con
  `FOR UPDATE`, borrado que desactiva si hay revisiones o asistencias, `session` leída de la BD y
  `refresh`. `usuarioConAcceso` arma el usuario con `acceso` (login, Google, sesión y renovación).
- `src/api/google-auth`: `usuario.acceso`; un rol desconocido da `403 ACCOUNT_DISABLED` y no cae al
  portal.
- `src/api/catalog`: `listRoles` filtra por `rolesGestionables` y agrega los metadatos de permisos;
  clasificaciones con `catalogos.configurar`.
- `src/api/event`: `aEventoOperativo` y `listarEventosOperativos` (vista reducida);
  `resumenEvento` con montos en null sin `pagos.ver`.
- `src/api/inscription`: `conPago` en mapeadores, lista, filtro `q` y CSV; `STATUS_NOT_ALLOWED`;
  `revisadoPor = req.actor.id`; el reenvío reutiliza el PDF.
- `src/api/registration-type` (precios en null) e `src/api/integration` (`sports-summary` con
  `resumen.ver` y montos en null).
- `src/api/activity`: búsqueda limitada al evento, `metodo` y auditoría, fuera de horario con
  permiso, anulación lógica, documento enmascarado sin `inscripciones.ver` y rutas legacy con el
  actor.
- `src/api/papers`: `uuidRecepcion()` del núcleo en lugar del regex duplicado.
- `src/database/seed.ts` (nombres de los 4 roles con `upsert`) y `bootstrapAdmin.ts` (`ROL.OWNER`).
- Panel (spec 008 del panel): menús, páginas y botones por `acceso.permisos`, formulario del equipo
  con eventos y permisos, montos que toleran `null` y reacción a `403 EVENT_NOT_ASSIGNED`.

## Pruebas

Infraestructura: `tests/setup-actor.ts` simula `consultarActor` con el registro de
`tests/helpers/actores.ts` (`actorDesdeFila` es real); `tokenDeRol(rol, id?, { eventoIds, permisos,
activo, correo, metodo })` registra la cuenta y firma el JWT; `olvidarActor(id)` simula una cuenta
borrada.

- `tests/admin/delegacion.test.ts`: delegación, errores de eventos y permisos, autoedición (regresión
  del `rolCodigo` del panel actual), `LAST_OWNER`, listas filtradas y borrado que desactiva.
- `tests/admin/administradores.test.ts`, `tests/google-auth/google.test.ts`: `acceso`, login de
  cuentas inactivas o con rol desconocido, Tesorero que también es inscrito.
- `tests/auth/sesion.test.ts`, `tests/auth/refresh.test.ts`: sesión fresca de la BD,
  `SESSION_INVALIDATED`, renovación con el mismo método.
- `tests/catalog/roles.test.ts`, `tests/catalog/clasificaciones.test.ts`.
- `tests/event/event.test.ts`, `tests/inscription/admin.test.ts`,
  `tests/registration-type/categorias.test.ts`, `tests/integration/permisos.test.ts`,
  `tests/papers/papers.test.ts`, `tests/contact/contact.test.ts`: vista reducida, montos en null,
  `STATUS_NOT_ALLOWED`, `EVENT_NOT_ASSIGNED` (también con `0x3` y UUID en mayúsculas), 404 a cuentas
  por evento y 403 del Tesorero en cada escritura.
- `tests/activity/asistencia.test.ts`: búsqueda en el evento, auditoría, fuera de horario,
  `AMBIGUOUS_DOCUMENT`, carreras (P2002), anulación y reactivación, enmascarado y legacy.
- `tests/email/credenciales.test.ts`, `tests/site/token-acceso.test.ts`,
  `tests/system-settings/configuracion.test.ts`, `tests/payment-qr/payment-qr.test.ts`,
  `tests/participant/participantes.test.ts`, `tests/document-lookup/acceso.test.ts`: el
  Administrador entra a correo y tokens, solo el Owner a Sistema, y Tesorero y Comisión reciben 403
  sin tocar la BD (la guarda va antes de la validación).
- `tests/security/matriz-rutas.test.ts`: toda ruta clasificada (pública, sitio, participante,
  sesión o permiso) con la guarda esperada y antes de `upload` y `validateBody`; una ruta nueva sin
  clasificar hace fallar la prueba. `tests/security/alcance.test.ts`: cuentas por evento con ids
  escritos de otra forma (`0x3`, `3.0`, `03`).
- `tests/security/routes.test.ts`: se actualiza a la nueva matriz de roles (el Administrador ya entra
  a `/admin`, correo y tokens; solo el Owner a Sistema).
