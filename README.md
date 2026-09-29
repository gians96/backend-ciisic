# Backend CIISIC — API multi-evento

API del Congreso Internacional de Ingeniería de Sistemas e Investigación Científica (UNDC):
eventos, inscripciones, tipos de inscripción, actividades y asistencia, ponencias, consultas
de DNI con pool de tokens, verificación de estudiantes UNDC e integración con deportes-fi.

- **Stack**: Node 22 · Express 5 · TypeScript · Prisma 6 · MySQL 8 · yup · Jest
- **Documentación** (visión general, configuración, API, datos, operación): [`docs/`](docs/README.md)
- **Guía para agentes de IA y forma de trabajar**: [`AGENTS.md`](AGENTS.md)
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
| [008](specs/008-configuracion-sistema) | Configuración en la BD (API_UNDC, Google, URL del panel, rutas legacy) y solo 3 variables de entorno |
| [009](specs/009-api-sitio-abierta) | API abierta (CORS `*`) protegida por tokens, con límites por token |
| [010](specs/010-google-sign-in) | Acceso con Google: panel (admins e inscritos) y verificación opcional del correo en la landing |
| [011](specs/011-portal-participante) | Portal del inscrito: "Mis inscripciones" con estado y credencial |

## Desarrollo local

```bash
cp .env.example .env          # DATABASE_URL, JWT_SECRET, SECRETS_ENCRYPTION_KEY (nada más)
npm ci
npx prisma migrate deploy     # o `npx prisma migrate dev` en una BD de desarrollo
npm run seed                  # catálogos (idempotente); `npm run seed -- --demo` agrega tipos de ejemplo
npm run bootstrap:admin:dev -- --correo tu@undc.edu.pe   # SuperAdmin inicial (muestra una contraseña temporal)
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
  email-credential · access-token · system-settings · google-auth · participant-portal
tests/                        Jest (*.test.ts)
```

## Despliegue

Guía completa (orden, variables y verificación): [`docs/despliegue-ecosistema.md`](docs/despliegue-ecosistema.md).
La imagen Docker valida la configuración, aplica `prisma migrate deploy` e inicia la API
(`docker-entrypoint.sh`). Variables de entorno: solo `DATABASE_URL`, `JWT_SECRET` y
`SECRETS_ENCRYPTION_KEY`; el resto se configura en el panel (Sistema, Correo, Consultas DNI).
