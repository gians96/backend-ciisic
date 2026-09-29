# Tasks: Plataforma multi-evento

## Datos
- [x] T001 Migración `20260929120100_multi_evento` (eventos, backfill, restricciones)
- [x] T002 Modelos Prisma `Evento`, relaciones y restricciones únicas por evento
- [x] T003 Seeds idempotentes de catálogos y demo por evento (`npm run seed -- --demo`)

## Infraestructura
- [x] T004 `src/core`: `HttpError`, paginación, fechas Lima, `renderTemplate`, catálogos por código
- [x] T005 `errorHandler`: HttpError, yup, multer, Prisma; 404 JSON; CORS 403
- [x] T006 Rate limits por ruta pública (`middlewares/rate-limit.ts`)
- [x] T007 Auth por código de rol (`requireRoles('SUPERADMIN','ADMIN')`), login rechaza inactivos

## API pública
- [x] T008 `GET /public/events/:codigo`
- [x] T009 `GET /public/events/:codigo/registration-types`
- [x] T010 `POST /public/events/:codigo/inscriptions` (voucher obligatorio, precio en servidor)
- [x] T011 `POST /public/events/:codigo/papers` y `/contact`

## API administrativa
- [x] T012 CRUD de eventos + copia de configuración + resumen
- [x] T013 CRUD de categorías y tipos (sin borrar características en actualizaciones parciales)
- [x] T014 Inscripciones: listado filtrable/paginado, detalle, estado (motivo obligatorio al rechazar), credencial, voucher, CSV
- [x] T015 Actividades y asistencia por evento (hora de Lima)
- [x] T016 Participantes, mensajes, ponencias por evento, administradores sin defaults

## Compatibilidad y seguridad
- [x] T017 Alias legacy (`/v1/inscription`, `/v1/registration-types`, `/v1/papers`, `/v1/contact`, `/v1/reniec/dni`, catálogos, `/v1/attendances`)
- [x] T018 Ignorar `estadoId`/`pago`/`descuento`/`file` del cliente; escape HTML en PDF y correo; plantillas por evento
- [x] T019 Pruebas (Jest) de precios, creación, seguridad, eventos, ponencias
- [x] T020 Prueba de humo contra BD migrada
- [ ] T021 Retirar las rutas legacy cuando la nueva landing esté en producción
