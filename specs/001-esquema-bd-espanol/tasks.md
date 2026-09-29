# Tasks: Esquema de BD en español

- [x] T001 Levantar MySQL 8.4 local y una BD sintética con el esquema actual de producción
- [x] T002 Documentar convención y mapa (`data-model.md`)
- [x] T003 Escribir `prisma/migrations/20260929120000_esquema_bd_espanol/migration.sql`
- [x] T004 Reescribir `prisma/schema.prisma` con modelos en español y `@@map`/`@map`
- [x] T005 Escribir `prisma/preflight/verificar-esquema.sql` y `conteos-despues.sql`
- [x] T006 Ensayar: restaurar respaldo sintético → preflight → `migrate deploy` → conteos (0 pérdidas)
- [x] T007 Verificar `prisma migrate diff` vacío (desde migraciones y desde la BD migrada)
- [x] T008 Actualizar servicios, controladores y tipos a los modelos nuevos
- [x] T009 Seeds idempotentes (upsert por código; sin `deleteMany` ni `ALTER TABLE`)
- [x] T010 Actualizar pruebas y dejar lint/tsc/jest en verde
- [x] T011 Ensayar con el respaldo real de producción: preflight, imagen Docker migrando al arrancar, conteos idénticos y `migrate diff` vacío (2026-09-29)
- [ ] T012 Ejecutar el runbook en producción (desplegar la imagen en Dokploy; la BD se migra al arrancar)
