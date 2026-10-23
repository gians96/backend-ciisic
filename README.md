# Backend CIISIC — API multi-evento

API del Congreso Internacional de Ingeniería de Sistemas e Investigación Científica (UNDC):
eventos, inscripciones, tipos de inscripción, actividades y asistencia (escáner con el QR de la
credencial), ponencias, consultas de DNI con pool de tokens, verificación de estudiantes UNDC,
integración con deportes-fi y portal del participante (Google o código por correo, fotocheck
virtual, asistencia y perfil con foto).

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
| [008](specs/008-configuracion-sistema) | Configuración en la BD (API_UNDC, Google, URL del panel, rutas legacy) y solo 2 variables de entorno |
| [009](specs/009-api-sitio-abierta) | API abierta (CORS `*`) protegida por tokens, con límites por token |
| [010](specs/010-google-sign-in) | Acceso con Google: panel (admins e inscritos) y verificación opcional del correo en la landing |
| [011](specs/011-portal-participante) | Portal del inscrito: "Mis inscripciones" con estado y credencial |
| [012](specs/012-qr-billeteras) | Imagen del QR de las billeteras: subida desde el panel y entrega a la landing |
| [013](specs/013-roles-permisos) | Roles (Owner, Administrador del sistema, Tesorero, Comisión), permisos por ruta y alcance por evento |
| [014](specs/014-portal-fotocheck-asistencia) | Portal del participante (código por correo, perfil con foto, asistencia), fotocheck virtual con código de credencial y asistencia por QR |
| [016](specs/016-disponibilidad-tipos) | Disponibilidad de los tipos de inscripción: para todos, solo la comunidad UNDC o solo externos |
| [017](specs/017-reinscripcion) | Reinscripción tras un rechazo o una cancelación; eliminar inscripciones solo el Owner |
| [018](specs/018-modalidad-virtual) | Modalidad de asistencia (presencial o virtual) por tipo de inscripción: tarifas virtuales S/ 30 estudiantes y S/ 50 profesionales, filtro, CSV, resumen, credencial y correo |
| [019](specs/019-ponencias-especializadas) | Ponencias especializadas: programa, cupos, inscripción (landing y panel) y asistencia en puerta con el DNI; plan futuro de cobro |
| [020](specs/020-virtual-sin-estudiantes-undc) | Tipos de inscripción que no admiten estudiantes UNDC (interruptor por tipo, usado en los planes virtuales): docentes y externos sí pueden ser virtuales |
| [025](specs/025-reportes-asesores) | Reportes de seguimiento por asesor: padrón de estudiantes cargado desde el Excel de la facultad, cruce en vivo con las inscripciones, resumen, filtros y descarga en Excel o PDF por docente |
| [026](specs/026-enlaces-docentes) | Enlace público por docente: cada asesor ve, sin iniciar sesión, cómo van los pagos de sus estudiantes (token de 256 bits, solo lo mínimo necesario, administrable desde el panel) |
| [029](specs/029-delegaciones-planes) | Delegaciones con planes y tarifa propios: Con kit, Sin kit y Virtual por delegación (cada integrante elige el suyo), links del delegado e individual, filtro por correo institucional y permisos de Tesorero y Comisión (reemplaza la tarifa global de las specs 021–024) |
| [027](specs/027-enlaces-ciclo) | Enlace público por ciclo: quien lo recibe ve, sin iniciar sesión, cómo van los pagos de todo un ciclo (sin celulares ni datos personales) |
| [028](specs/028-docentes-dni) | DNI y secciones editables del docente, y una página común donde cada docente consulta a sus estudiantes con su DNI; recargar el Excel conserva lo editado |
| [030](specs/030-ponencias-validacion-congreso) | Ponencias especializadas solo para congresistas con pago aprobado (documento y correo), modo presencial o virtual (el virtual no ocupa aforo) e interruptor de acceso libre por evento |
| [031](specs/031-ponencias-resumen-personas) | Resumen por persona de las ponencias especializadas con su situación actual en el congreso, filtros y Excel; cancelar a quien no puede estar inscrito y enviarle un comunicado por correo |
| [032](specs/032-ponencias-coponentes) | Temas de ponencias especializadas que dictan varios ponentes a la misma hora y en el mismo ambiente (`coponentes`, hasta 3 además del principal) |

## Desarrollo local

```bash
cp .env.example .env          # DATABASE_URL y JWT_SECRET (nada más)
npm ci
npx prisma migrate deploy     # o `npx prisma migrate dev` en una BD de desarrollo
npm run seed                  # catálogos (idempotente); `npm run seed -- --demo` agrega tipos de ejemplo
npm run bootstrap:admin:dev -- --correo tu@undc.edu.pe   # Owner inicial (muestra una contraseña temporal)
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
src/middlewares/              auth por permisos, validación, uploads, rate limits, errores
src/api/<módulo>/             controllers · routes · services · validation
  event · registration-type · inscription · activity · participant · papers · contact
  document-lookup · student-verification · integration · admin · catalog
  email-credential · access-token · system-settings · google-auth · participant-auth
  participant-portal
tests/                        Jest (*.test.ts)
```

## Despliegue

Guía completa (orden, variables y verificación): [`docs/despliegue-ecosistema.md`](docs/despliegue-ecosistema.md).
La imagen Docker valida la configuración, aplica `prisma migrate deploy` e inicia la API
(`docker-entrypoint.sh`). Variables de entorno: solo `DATABASE_URL` y `JWT_SECRET`; el
resto se configura en el panel (Sistema, Correo, Consultas DNI).
