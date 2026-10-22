-- ─────────────────────────────────────────────────────────────────────────────
-- Spec 030 · Ponencias especializadas solo para congresistas con pago aprobado
-- Solo agrega columnas con valores por defecto: no cambia ningún dato ni el comportamiento por sí sola
-- (el backend anterior las ignora). Las inscripciones existentes quedan «sin validar» (`inscripcion_congreso_id`
-- NULL) y presenciales; `npm run ponencias-especializadas:validar-existentes` las empareja con el congreso.
--
-- `eventos.ponencias_acceso_libre`: 0 (por defecto) exige ser congresista aprobado; 1 deja inscribirse solo con
-- el documento, como antes de esta spec.
--
-- Para revertir: ALTER TABLE `inscripciones_ponencia` DROP FOREIGN KEY `fk_inscripciones_ponencia_congreso`,
-- DROP INDEX `idx_inscripciones_ponencia_congreso`, DROP INDEX `idx_inscripciones_ponencia_cupo`,
-- DROP COLUMN `inscripcion_congreso_id`, DROP COLUMN `modo_asistencia`; ALTER TABLE `eventos` DROP COLUMN
-- `ponencias_acceso_libre`; y `prisma migrate resolve --rolled-back 20261024130000_ponencias_validacion_congreso`.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE `eventos` ADD COLUMN `ponencias_acceso_libre` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `inscripciones_ponencia`
    ADD COLUMN `inscripcion_congreso_id` INTEGER NULL,
    ADD COLUMN `modo_asistencia` ENUM('PRESENCIAL', 'VIRTUAL') NOT NULL DEFAULT 'PRESENCIAL';

-- CreateIndex
CREATE INDEX `idx_inscripciones_ponencia_congreso` ON `inscripciones_ponencia`(`inscripcion_congreso_id`);

-- CreateIndex
CREATE INDEX `idx_inscripciones_ponencia_cupo` ON `inscripciones_ponencia`(`ponencia_id`, `estado`, `modo_asistencia`);

-- AddForeignKey
ALTER TABLE `inscripciones_ponencia` ADD CONSTRAINT `fk_inscripciones_ponencia_congreso` FOREIGN KEY (`inscripcion_congreso_id`) REFERENCES `inscripciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
