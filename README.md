# Backend CIISIC — API multi-evento

API del Congreso Internacional de Ingeniería de Sistemas e Investigación Científica (UNDC):
eventos, inscripciones, tipos de inscripción, actividades y asistencia, ponencias, consultas
de DNI con pool de tokens, verificación de estudiantes UNDC e integración con deportes-fi.

- **Stack**: Node 22 · Express 5 · TypeScript · Prisma 6 · MySQL 8 · yup · Jest
- **Arquitectura y contratos entre sistemas**: [`docs/arquitectura-ecosistema.md`](docs/arquitectura-ecosistema.md)
- **Despliegue del ecosistema (orden y variables)**: [`docs/despliegue-ecosistema.md`](docs/despliegue-ecosistema.md)
- **Especificaciones (SDD con GitHub Spec Kit)**: [`specs/`](specs) y la constitución en
  [`.specify/memory/constitution.md`](.specify/memory/constitution.md)

| Spec | Tema |
|---|---|
| [001](specs/001-esquema-bd-espanol) | Esquema de BD en español (migración in-place, runbook) |
| [002](specs/002-multi-evento) | Multi-evento, API pública y administrativa, compatibilidad |
| [003](specs/003-consultas-dni) | Consultas DNI (Decolecta, apiperu) con rotación de tokens |
| [004](specs/004-verificacion-estudiante) | Verificación de estudiantes con API_UNDC |
| [005](specs/005-integracion-deportes) | Integración con deportes-fi (Semana Sistémica) |
| [006](specs/006-credenciales-correo) | Credenciales de correo (Brevo) cifradas en BD, por evento |
| [007](specs/007-tokens-acceso-evento) | Token de acceso por evento y API del sitio (`/api/v1/site`) para la landing |

## Desarrollo local

```bash
cp .env.example .env          # completar DATABASE_URL, JWT_SECRET, etc.
npm ci
npx prisma migrate deploy     # o `npx prisma migrate dev` en una BD de desarrollo
npm run seed                  # catálogos (idempotente); `npm run seed -- --demo` agrega tipos de ejemplo
npm run bootstrap:admin:dev   # SuperAdmin inicial (BOOTSTRAP_ADMIN_* en .env)
npm run dev
```

Calidad: `npm run lint`, `npx tsc --noEmit`, `npm test`.

## Estructura

```
config/env.ts                 variables de entorno validadas
prisma/schema.prisma          modelos en español (@@map / @map)
prisma/migrations/            migraciones (las de renombrado están escritas a mano)
prisma/preflight/             verificaciones previas y conteos para producción
src/core/                     errores, fechas (Lima), cifrado, plantillas, paginación
src/middlewares/              auth por rol, validación, uploads, rate limits, errores
src/api/<módulo>/             controllers · routes · services · validation
  event · registration-type · inscription · activity · participant · papers · contact
  document-lookup · student-verification · integration · admin · catalog
  email-credential · access-token
tests/                        Jest (*.test.ts)
```

## Despliegue

Guía completa (orden, variables y verificación): [`docs/despliegue-ecosistema.md`](docs/despliegue-ecosistema.md).
La imagen Docker valida la configuración, aplica `prisma migrate deploy` e inicia la API
(`docker-entrypoint.sh`; `MIGRATE_ON_START=false` para omitir la migración).
Obligatorias en producción: `DATABASE_URL`, `JWT_SECRET`, `SECRETS_ENCRYPTION_KEY`.
