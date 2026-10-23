-- ============================================================================
-- Corregir el tipo de una inscripción (spec 035)
-- Una tabla nueva y aditiva: nada de lo existente cambia.
--  - `cambios_tipo_inscripcion`: una fila por cada corrección que hace el Owner. Guarda el texto de los dos tipos
--    (`anterior`, `nuevo`) y no sus ids, para que el historial se siga leyendo si después se renombra o se borra un tipo.
--  - Se borra junto con la inscripción (CASCADE); si se borra la cuenta del Owner queda sin autor (SET NULL).
-- Para revertir: DROP TABLE `cambios_tipo_inscripcion`;
--   y `prisma migrate resolve --rolled-back 20261026150000_cambios_tipo_inscripcion`.
-- ============================================================================

-- CreateTable
CREATE TABLE `cambios_tipo_inscripcion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `inscripcion_id` INTEGER NOT NULL,
    `anterior` VARCHAR(400) NOT NULL,
    `nuevo` VARCHAR(400) NOT NULL,
    `motivo` VARCHAR(500) NULL,
    `realizado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_cambios_tipo_inscripcion`(`inscripcion_id`, `creado_en`),
    INDEX `idx_cambios_tipo_realizado_por`(`realizado_por_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cambios_tipo_inscripcion` ADD CONSTRAINT `fk_cambios_tipo_inscripcion` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cambios_tipo_inscripcion` ADD CONSTRAINT `fk_cambios_tipo_realizado_por` FOREIGN KEY (`realizado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
