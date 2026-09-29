-- ============================================================================
-- Spec 006 · Credenciales de correo en BD
-- La API key del proveedor (Brevo) se guarda cifrada (AES-256-GCM con SECRETS_ENCRYPTION_KEY).
-- Cada evento puede elegir su credencial; si no, se usa la predeterminada.
-- ============================================================================

CREATE TABLE `credenciales_correo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proveedor` ENUM('BREVO') NOT NULL DEFAULT 'BREVO',
    `nombre` VARCHAR(120) NOT NULL,
    `api_key_cifrada` TEXT NOT NULL,
    `api_key_sufijo` VARCHAR(8) NOT NULL,
    `remitente_correo` VARCHAR(191) NOT NULL,
    `remitente_nombre` VARCHAR(120) NULL,
    `es_predeterminada` BOOLEAN NOT NULL DEFAULT false,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `ultimo_estado` ENUM('OK', 'ERROR') NULL,
    `ultimo_error` VARCHAR(500) NULL,
    `ultima_prueba_en` DATETIME(3) NULL,
    `ultimo_envio_en` DATETIME(3) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `eventos` ADD COLUMN `credencial_correo_id` INTEGER NULL;
CREATE INDEX `idx_eventos_credencial_correo` ON `eventos`(`credencial_correo_id`);
ALTER TABLE `eventos` ADD CONSTRAINT `fk_eventos_credencial_correo` FOREIGN KEY (`credencial_correo_id`) REFERENCES `credenciales_correo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
