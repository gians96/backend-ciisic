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
salen de la fila del evento. Las rutas públicas se direccionan por `eventos.codigo`.

### II. Base de datos legible en español
- Tablas en `snake_case`, en español y en plural (`inscripciones`, `tipos_inscripcion`).
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
- Toda ruta no pública exige `verifyAdminRole` o `verifySuperAdminRole`.
- El servidor calcula precios, estados y montos; jamás acepta `estadoId`, `pago`,
  `descuento` ni rutas de archivo enviadas por el cliente.
- Todo texto de usuario que se inserta en HTML (PDF, correos) se escapa.
- Secretos salientes (tokens de proveedores, tokens de integraciones) se guardan
  cifrados (AES-256-GCM con `SECRETS_ENCRYPTION_KEY`) y la API solo expone su sufijo.
- Las rutas públicas con costo o abuso posible (consultas DNI, verificación, contacto,
  inscripción, ponencias) tienen rate limit.
- Las respuestas públicas no exponen datos personales de terceros.

### IV. Contratos explícitos
- Rutas nuevas bajo `/api/v1`; las públicas bajo `/api/v1/public/*`.
- Respuestas de éxito nuevas: `{ success: true, data, meta? }`. Errores:
  `{ success: false, code, message, fields? }` (normalizados por `normalizeErrorResponses`).
- Cualquier cambio de contrato se refleja en `specs/<feature>/contracts/` y, si afecta a
  otro sistema, en `docs/arquitectura-ecosistema.md`.
- Las rutas legacy que consume la landing actual se mantienen como alias del evento
  principal hasta que la nueva landing esté desplegada.

### V. Pruebas como puerta de calidad
- `npm run lint`, `npx tsc --noEmit` y `npm test` en verde antes de cada commit.
- Cada regla de negocio nueva (precios, verificación, rotación de tokens, cifrado,
  renovación de cuotas) tiene pruebas unitarias; cada ruta protegida tiene una prueba
  de acceso denegado.
- Los proveedores externos se prueban con `fetch` simulado; nunca con credenciales reales.

## Stack y convenciones

- Node 22, Express 5, TypeScript estricto (CommonJS), Prisma 6 sobre MySQL 8, yup para
  validación, jsonwebtoken (HS256, Bearer), multer, Puppeteer (PDF), Brevo (correo), Jest +
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
- Despliegue: respaldo de BD → `prisma migrate deploy` → nueva imagen → prueba de humo
  (ver runbook de `specs/001-esquema-bd-espanol/plan.md`).

## Gobernanza

Esta constitución prevalece sobre prácticas ad-hoc. Enmiendas: se documentan en este
archivo con fecha y motivo, y se revisan en el PR correspondiente.

**Versión**: 1.0.0 | **Ratificada**: 2026-09-29 | **Última enmienda**: 2026-09-29
