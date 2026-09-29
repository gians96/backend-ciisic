# Implementation Plan: Esquema de BD en español

**Branch**: `feat/multi-evento-sdd` | **Spec**: [spec.md](spec.md) | **Modelo**: [data-model.md](data-model.md)

## Summary

Renombrar in-place tablas, columnas, índices y claves foráneas de `ciisic_vii` a la
convención en español (`snake_case`, plural) mediante una migración SQL escrita a mano, y
actualizar el esquema Prisma (modelos singulares con `@@map`/`@map`) y todo el código.

## Technical Context

- MySQL 8 (producción: Dokploy), Prisma 6, Express 5 + TypeScript.
- `lower_case_table_names=0` en Linux; la migración también contempla `=1`.
- El DDL de MySQL **no es transaccional**: una falla a mitad deja la BD parcialmente
  migrada → respaldo obligatorio y ensayo previo.

## Archivos

| Archivo | Cambio |
|---|---|
| `prisma/migrations/20260929120000_esquema_bd_espanol/migration.sql` | Renombrado in-place |
| `prisma/schema.prisma` | Modelos en español con `@@map`/`@map` |
| `prisma/preflight/verificar-esquema.sql` | Verificaciones bloqueantes/informativas previas |
| `prisma/preflight/conteos-despues.sql` | Conteos posteriores |
| `src/**` | Accesores Prisma nuevos (`prisma.participante`, `prisma.actividad`, …) |
| `src/database/seeders/*` | Upserts idempotentes por código |

## Orden de la migración

1. `DROP FOREIGN KEY` de las 9 FKs.
2. `RENAME TABLE` (en dos pasos para `Administradores`/`Roles`).
3. Por tabla: `RENAME COLUMN`, `CHANGE COLUMN` (cuando cambia el tipo), `RENAME INDEX`,
   limpieza de índices redundantes.
4. `participantes`: `numero_documento := dni`, `tipo_documento_id` nulo → `dni`, se elimina `dni`.
5. `roles` y `estados_inscripcion`: columna `codigo` con backfill por id.
6. `ADD CONSTRAINT fk_*` con los nombres nuevos.

## Validación

- `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …` → vacío.
- `prisma migrate diff --from-url <bd migrada> --to-schema-datamodel …` → vacío.
- Conteos idénticos (preflight vs `conteos-despues.sql`).
- Ensayo realizado el 2026-09-29 sobre una BD sintética con el esquema de producción
  (30 participantes, 28 inscripciones, 16 asistencias, 3 ponencias): 0 filas perdidas,
  diff vacío. **Pendiente**: repetir con el respaldo real de producción.

## Runbook de producción

1. **Anunciar ventana** (≈10 min) y detener el backend (`backend-ciisic-vii` en Dokploy).
2. **Respaldo**:
   `mysqldump --single-transaction --routines --triggers -h <host> -u <user> -p ciisic_vii > ciisic_vii_$(date +%F_%H%M).sql`
3. **Preflight**: `mysql … ciisic_vii < prisma/preflight/verificar-esquema.sql`. Todas las
   verificaciones `[BLOQUEANTE]` deben estar en 0 (FKs 9/9, índices 20/20 o 19/20 si
   `PaperSubmission` aún no existe). Guardar la salida (conteos de referencia).
4. **Migrar**: desplegar la nueva imagen sin iniciarla o ejecutar desde un contenedor
   efímero con `DATABASE_URL` de producción: `npx prisma migrate deploy`.
   Se aplican en orden: `20260928000000_paper_submissions` (si faltaba),
   `20260929120000_esquema_bd_espanol`, `20260929120100_multi_evento`,
   `20260929120200_consultas_dni`, `20260929120300_verificacion_estudiante`,
   `20260929120400_integraciones_evento`.
5. **Verificar**: `mysql … ciisic_vii < prisma/preflight/conteos-despues.sql` y comparar
   con el paso 3.
6. **Iniciar** el backend nuevo y probar: `GET /health`, `GET /api/v1/public/events/ciisic-viii-2026`,
   `GET /api/v1/registration-types` (legacy) y login del panel.
7. **Rollback** (si algo falla en 4–6): detener el backend, `DROP DATABASE ciisic_vii;
   CREATE DATABASE ciisic_vii;`, restaurar el respaldo del paso 2 y volver a desplegar la
   imagen anterior. No intentar "arreglar a mano" una migración a medias.
