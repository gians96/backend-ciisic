-- ============================================================================
-- DNI del docente (spec 028)
-- Una columna nueva y aditiva en `asesores`: nada de lo existente cambia.
--  - `documento`: DNI del docente (8 dígitos). NULL = sin DNI. Con él entra el docente a la página común de
--    consulta. Es único por evento (MySQL permite varios NULL en un índice único, así que los docentes sin DNI
--    no chocan entre sí).
-- Para revertir: ALTER TABLE `asesores` DROP INDEX `uq_asesores_evento_documento`, DROP COLUMN `documento`;
--   y `prisma migrate resolve --rolled-back 20261023150000_asesores_documento`.
-- ============================================================================

-- AlterTable
ALTER TABLE `asesores` ADD COLUMN `documento` VARCHAR(20) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `uq_asesores_evento_documento` ON `asesores`(`evento_id`, `documento`);
