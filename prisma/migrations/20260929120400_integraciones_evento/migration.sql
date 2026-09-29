-- ============================================================================
-- Spec 005 · Integraciones por evento (deportes-fi / Semana Sistémica)
-- ============================================================================

CREATE TABLE `integraciones_evento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `tipo` ENUM('DEPORTES_FI') NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `url_base` VARCHAR(255) NOT NULL,
    `token_cifrado` TEXT NOT NULL,
    `token_sufijo` VARCHAR(8) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `ultimo_estado` ENUM('OK', 'ERROR') NULL,
    `ultimo_error` VARCHAR(500) NULL,
    `ultima_sincronizacion_en` DATETIME(3) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `idx_integraciones_evento_evento`(`evento_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `integraciones_evento` ADD CONSTRAINT `fk_integraciones_evento_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
