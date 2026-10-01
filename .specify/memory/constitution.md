# Constitución de backend-ciisic

API del congreso CIISIC (UNDC): gestión multi-evento de inscripciones, tipos de
inscripción, actividades y asistencia, ponencias, consultas de documentos (DNI),
verificación de estudiantes e integraciones con otros sistemas de la Facultad de
Ingeniería. Los contratos con otros sistemas viven en `docs/arquitectura-ecosistema.md`.

## Principios

### I. Multi-evento por diseño
Todo dato de negocio (categorías y tipos de inscripción, inscripciones, actividades,
ponencias, mensajes, integraciones) pertenece a un `Evento`. Ningún código asume un
evento fijo, un id mágico ni textos de una edición ("VIII CIISIC") embebidos: esos datos
salen de la fila del evento. La API del sitio (`/api/v1/site/*`) resuelve el evento a partir
del token de acceso del evento, nunca de un parámetro del cliente.

### II. Base de datos legible en español
- Tablas en `snake_case`, en español y en plural (`inscripciones`, `tipos_inscripcion`).
  Excepción: las tablas de fila única van en singular (`configuracion_sistema`) y fijan su
  única fila con una restricción `ck_<tabla>_fila_unica`.
- Columnas en `snake_case`; PK `id`; FK `<entidad_singular>_id`; booleanos `es_*`,
  `tiene_*` o `activo`; marcas de tiempo `creado_en` / `actualizado_en`; dinero `DECIMAL(10,2)`.
- Nombres de restricciones: `fk_<tabla>_<referencia>`, `uq_<tabla>_<columnas>`,
  `idx_<tabla>_<columnas>`.
- Prisma: modelos singulares en PascalCase y campos en camelCase, mapeados con `@@map` y
  `@map`. Los valores de catálogo se referencian por `codigo`, nunca por id.
- Las migraciones que tocan datos existentes se escriben a mano, **nunca** borran datos
  sin una verificación previa documentada, y se ensayan sobre un respaldo antes de
  producción. `prisma migrate diff` entre migraciones y esquema debe quedar vacío.

### III. Seguridad por defecto (NO NEGOCIABLE)
- Toda ruta no pública exige una guarda: `requirePermiso` / `requireActor` (staff,
  audiencia `ciisic-admin`), `requireParticipante` (portal del inscrito, audiencia
  `ciisic-participante`) o `requireTokenEvento` (API del sitio). Un token de un perfil nunca
  abre rutas de otro.
- La autorización del staff es por permisos: cada ruta declara los permisos que acepta
  (catálogo `src/core/permisos.ts`) y la cuenta (rol, estado, eventos asignados y permisos) se
  lee de la BD en cada petición, nunca del JWT; un cambio o una desactivación aplica en la
  siguiente petición. Las cuentas con alcance por evento solo operan en sus eventos: el evento
  se resuelve del recurso y, si no se puede, la guarda falla cerrada. Sin `pagos.ver` ninguna
  respuesta lleva montos ni datos de pago.
- La API está abierta a cualquier origen (CORS `*`, sin cookies): la protege el token, no una
  lista de orígenes. Las rutas del sitio tienen límite por visitante **y** por token.
- El servidor calcula precios, estados y montos; jamás acepta `estadoId`, `pago`,
  `descuento` ni rutas de archivo enviadas por el cliente.
- Todo texto de usuario que se inserta en HTML (PDF, correos) se escapa.
- Secretos salientes (tokens de proveedores, tokens de integraciones, credenciales de
  correo, API key de API_UNDC) se guardan cifrados (AES-256-GCM con una clave
  derivada de `JWT_SECRET`) y la API solo expone su sufijo.
- El entorno solo contiene lo que no puede vivir en la BD: `DATABASE_URL` y `JWT_SECRET`
  (`PORT` opcional). Toda otra configuración se gestiona en el panel (Sistema, Correo,
  Consultas DNI) o es una constante del código.
- Las URLs salientes configuradas por administradores se validan contra SSRF
  (`src/core/url-saliente.ts`): https y, en producción, nunca destinos internos.
- Las rutas públicas con costo o abuso posible (consultas DNI, verificación, contacto,
  inscripción, ponencias, verificación de certificados) tienen rate limit.
- Las respuestas públicas no exponen datos personales de terceros. Única excepción: la
  verificación de un certificado FIRMADO o ANULADO muestra lo que ya va impreso en él (titular,
  tipo, evento, fechas y horas), nunca el documento, el correo, el motivo de una anulación ni el
  archivo.
- La familia pública `/api/v1/public/*` (sin sesión ni token) solo admite consultas de solo
  lectura por un código no adivinable (al menos 30 bits aleatorios), con límite por IP **y** uno
  global, `404` idéntico para lo que no existe o no debe mostrarse (un código con otro formato no
  llega a la BD) y `Cache-Control: no-store`.

### IV. Contratos explícitos
- Rutas nuevas bajo `/api/v1`: administración con JWT de admin, `/api/v1/site/*` para la
  landing de cada evento (token de acceso), `/api/v1/me/*` para el portal del inscrito,
  `/api/v1/auth/*` para sesiones y configuración pública y `/api/v1/public/*` para verificaciones
  públicas sin token (principio III; hoy, la de certificados). Una ruta nueva en esta familia se
  justifica en su spec y se declara como pública intencional en las pruebas de seguridad; nunca
  comparte prefijo con rutas administrativas.
- Respuestas de éxito nuevas: `{ success: true, data, meta? }`. Errores:
  `{ success: false, code, message, fields? }` (normalizados por `normalizeErrorResponses`).
- Cualquier cambio de contrato se refleja en `specs/<feature>/contracts/` y, si afecta a
  otro sistema, en `docs/arquitectura-ecosistema.md`.
- Las rutas legacy que consume la landing anterior se mantienen como alias del evento
  principal hasta que se desactiven desde el panel (Sistema → Landing anterior).

### V. Pruebas como puerta de calidad
- `npm run lint`, `npx tsc --noEmit` y `npm test` en verde antes de cada commit.
- Cada regla de negocio nueva (precios, verificación, rotación de tokens, cifrado,
  renovación de cuotas) tiene pruebas unitarias; cada ruta protegida tiene una prueba
  de acceso denegado.
- Los proveedores externos se prueban con `fetch` simulado; nunca con credenciales reales.

## Stack y convenciones

- Node 22, Express 5, TypeScript estricto (CommonJS), Prisma 6 sobre MySQL 8, yup para
  validación, jsonwebtoken (HS256, Bearer), multer, Puppeteer (PDF de credenciales), pdf-lib +
  @pdf-lib/fontkit (certificados sobre un diseño PDF), yazl (ZIP en flujo), Brevo (correo), Jest +
  supertest.
- Módulos en `src/api/<nombre-en-ingles-kebab>/{controllers,routes,services}` +
  `validation.ts`; las rutas se autocargan (`src/loaders/routesLoader.ts`) con
  `buildRouter(AppRoute[])` (`src/core/routes.ts`).
- Validación con `validateBody(schema)` en la ruta (422 `VALIDATION_ERROR`).
- Errores de dominio: lanzar `HttpError` (`src/core/http-error.ts`) con `status` y `code`;
  el `errorHandler` los normaliza.
- Estilo: comillas simples, sin punto y coma, sin `any`.
- Mensajes para usuarios en español.

## Flujo de trabajo

- Cada cambio empieza con una spec en `specs/NNN-nombre/` (spec → plan → tasks) usando
  Spec Kit; `tasks.md` se marca a medida que se implementa.
- Ramas `feat/*`; commits pequeños con mensajes convencionales en español.
- Despliegue: respaldo de BD → nueva imagen (el contenedor valida la configuración y aplica
  `prisma migrate deploy` al arrancar) → prueba de humo (ver `docs/despliegue-ecosistema.md`).

## Gobernanza

Esta constitución prevalece sobre prácticas ad-hoc. Enmiendas: se documentan en este
archivo con fecha y motivo, y se revisan en el PR correspondiente.

**Versión**: 1.4.0 | **Ratificada**: 2026-09-29 | **Última enmienda**: 2026-10-01

- 1.4.0 (2026-10-01): principios III y IV, familia pública `/api/v1/public/*` para verificar
  certificados con el QR impreso (spec 015): sin token, solo lectura, código no adivinable,
  límites por IP y global, `404` idéntico para lo que no esté FIRMADO ni ANULADO y sin documento,
  correo ni archivo; excepción explícita a «las respuestas públicas no exponen datos personales de
  terceros» para lo que ya va impreso en el certificado. Motivo: cualquiera que reciba un
  certificado firmado debe poder verificarlo sin sesión, y la revisión adversarial pidió una familia
  propia en lugar de una ruta pública bajo un prefijo administrativo (`/v1/certificates/verify`).
  Stack: pdf-lib + fontkit y yazl.

- 1.3.0 (2026-09-30): principio III, autorización del staff por permisos (`requirePermiso` /
  `requireActor`) con la cuenta leída de la BD en cada petición, en lugar de roles fijos leídos
  del JWT (`verifyAdminRole` / `verifySuperAdminRole`). Motivo: roles Tesorero y Comisión
  tecnológica con alcance por evento y delegación del equipo (spec 013), y que un cambio de
  rol, de permisos o una desactivación aplique al instante.

- 1.2.0 (2026-09-30): el entorno ya no lleva `SECRETS_ENCRYPTION_KEY`; la clave de los
  secretos se deriva de `JWT_SECRET` (pedido del responsable del despliegue: una variable menos).

- 1.1.0 (2026-09-30): configuración en la BD y solo tres variables de entorno; API abierta
  (CORS `*`) protegida por tokens con límites por token; perfiles de sesión (admin,
  participante) con audiencias JWT; tablas de fila única; validación anti-SSRF.
