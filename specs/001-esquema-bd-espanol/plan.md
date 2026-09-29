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
  diff vacío.
- **Ensayo con el respaldo real de producción** (2026-09-29, `mysqldump` de solo lectura de
  `ciisic_vii`, MySQL 8.0.33): preflight sin bloqueantes (FKs 9/9, índices 19/20 porque
  `PaperSubmission` no existía, 1 participante con `numero` vacío que conserva su `dni`); la
  imagen Docker aplicó las 8 migraciones pendientes al arrancar; conteos idénticos (11
  administradores, 308 participantes, 308 inscripciones —307 aprobadas, S/ 18 800—, 585
  asistencias, 4 actividades); los datos quedaron en el evento VII CIISIC 2025 y el VIII se
  creó como principal con copia de categorías y tipos; `migrate diff` contra la BD migrada vacío.

## Runbook de producción

La imagen Docker (`docker-entrypoint.sh`) valida la configuración, ejecuta
`prisma migrate deploy` y recién entonces inicia la API. Así la BD se migra en el mismo
momento en que arranca la versión nueva, sin una ventana con la BD migrada y el código viejo.

1. **Respaldo**: `mysqldump --single-transaction --routines --triggers --no-tablespaces
   --set-gtid-purged=OFF -h <host> -u <user> -p ciisic_vii > ciisic_vii_$(date +%F_%H%M).sql`
2. **Preflight** (opcional, ya ensayado): `mysql … ciisic_vii < prisma/preflight/verificar-esquema.sql`.
3. **Variables** en Dokploy: ver `docs/despliegue-ecosistema.md` (sección backend-ciisic).
4. **Desplegar** la imagen de `feat/multi-evento-sdd`. En el log deben verse las migraciones
   aplicadas, los avisos de importación de credenciales y `🚀 Server corriendo…`.
5. **Verificar**: `GET /health`, `GET /api/v1/registration-types` (legacy, 4 tipos del VIII) y
   `mysql … ciisic_vii < prisma/preflight/conteos-despues.sql` (mismos conteos del paso 2).
6. **Rollback** (si algo falla en 4–5): volver a desplegar la imagen anterior, `DROP DATABASE
   ciisic_vii; CREATE DATABASE ciisic_vii;` y restaurar el respaldo del paso 1. No intentar
   "arreglar a mano" una migración a medias.
