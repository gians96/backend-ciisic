-- ============================================================================
-- Delegaciones · inscripción por grupos o instituciones
-- 1) `delegaciones`: grupo de un evento con su link público (`codigo_link`) y su tarifa por persona
--    (estándar y promocional a partir de `min_integrantes`).
-- 2) `inscripciones.delegacion_id`: la inscripción puede pertenecer a una delegación. Es NULL en las
--    inscripciones individuales y al borrar la delegación (SET NULL): la inscripción se conserva.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema (no lee las columnas y sus
-- inserciones dejan `delegacion_id` en NULL).
-- Para revertir: ALTER TABLE `inscripciones` DROP FOREIGN KEY `fk_inscripciones_delegacion`,
--   DROP INDEX `idx_inscripciones_delegacion`, DROP COLUMN `delegacion_id`; DROP TABLE `delegaciones`;
--   y `prisma migrate resolve --rolled-back 20261018120000_delegaciones`.
-- ============================================================================

CREATE TABLE `delegaciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `nombre` VARCHAR(191) NOT NULL,
    `codigo_link` VARCHAR(100) NOT NULL,
    `institucion` VARCHAR(191) NULL,
    `representante_nombre` VARCHAR(191) NULL,
    `representante_email` VARCHAR(191) NULL,
    `representante_telefono` VARCHAR(191) NULL,
    `min_integrantes` INTEGER NOT NULL DEFAULT 10,
    `precio_estandar` DECIMAL(10, 2) NOT NULL DEFAULT 60.00,
    `precio_promocional` DECIMAL(10, 2) NOT NULL DEFAULT 50.00,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_delegaciones_codigo_link`(`codigo_link`),
    INDEX `idx_delegaciones_evento`(`evento_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delegaciones` ADD CONSTRAINT `fk_delegaciones_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `inscripciones` ADD COLUMN `delegacion_id` INTEGER NULL,
    ADD INDEX `idx_inscripciones_delegacion`(`delegacion_id`),
    ADD CONSTRAINT `fk_inscripciones_delegacion` FOREIGN KEY (`delegacion_id`) REFERENCES `delegaciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
