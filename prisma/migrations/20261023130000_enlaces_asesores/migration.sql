-- ============================================================================
-- Enlace público por docente (spec 026)
-- Tres columnas nuevas y aditivas en `asesores`: nada de lo existente cambia.
--  - `enlace_token`: token aleatorio (43 caracteres, 256 bits) del enlace del docente; NULL = sin enlace.
--    Único. Se guarda en claro a propósito: el panel debe poder mostrar y copiar el enlace cuando se
--    quiera (la misma base ya contiene los datos que el enlace muestra).
--  - `enlace_creado_en` y `enlace_ultimo_acceso`: cuándo se creó y cuándo lo abrió el docente por última vez.
-- Para revertir: ALTER TABLE `asesores` DROP INDEX `uq_asesores_enlace_token`, DROP COLUMN `enlace_token`,
--   DROP COLUMN `enlace_creado_en`, DROP COLUMN `enlace_ultimo_acceso`;
--   y `prisma migrate resolve --rolled-back 20261023130000_enlaces_asesores`.
-- ============================================================================

-- AlterTable
ALTER TABLE `asesores`
    ADD COLUMN `enlace_token` VARCHAR(64) NULL,
    ADD COLUMN `enlace_creado_en` DATETIME(3) NULL,
    ADD COLUMN `enlace_ultimo_acceso` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `uq_asesores_enlace_token` ON `asesores`(`enlace_token`);
