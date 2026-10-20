-- ============================================================================
-- Tipos de inscripción de delegación (spec 019)
-- 1) `delegaciones.tipo_inscripcion_id`: el tipo que eligió el representante en la
--    landing (Delegación General / Promocional). Si el tipo se elimina, la
--    delegación conserva sus datos y el campo pasa a NULL (SetNull).
-- 2) `idx_delegaciones_tipo_inscripcion`: el panel puede filtrar/agrupar por tipo.
-- Todo es aditivo: las delegaciones existentes quedan en NULL y siguen funcionando.
-- Para revertir: ALTER TABLE `delegaciones` DROP INDEX `idx_delegaciones_tipo_inscripcion`,
--   DROP FOREIGN KEY `fk_delegaciones_tipo_inscripcion`, DROP COLUMN `tipo_inscripcion_id`;
--   y `prisma migrate resolve --rolled-back 20261020160000_tipos_delegacion`.
-- ============================================================================

ALTER TABLE `delegaciones`
    ADD COLUMN `tipo_inscripcion_id` INTEGER NULL;

ALTER TABLE `delegaciones` ADD CONSTRAINT `fk_delegaciones_tipo_inscripcion`
    FOREIGN KEY (`tipo_inscripcion_id`) REFERENCES `tipos_inscripcion`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `delegaciones` ADD INDEX `idx_delegaciones_tipo_inscripcion`(`tipo_inscripcion_id`);
