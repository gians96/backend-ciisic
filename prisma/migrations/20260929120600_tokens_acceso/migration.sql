-- ============================================================================
-- Spec 007 · Tokens de acceso del sitio por evento
-- La landing de cada evento consume `/api/v1/site/*` con `X-Api-Key`. Solo se guarda el hash
-- HMAC-SHA256 del token; el valor en claro se muestra una única vez al crearlo.
-- ============================================================================

CREATE TABLE `tokens_acceso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `prefijo` VARCHAR(24) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `ultimo_uso_en` DATETIME(3) NULL,
    `expira_en` DATETIME(3) NULL,
    `revocado_en` DATETIME(3) NULL,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_tokens_acceso_prefijo`(`prefijo`),
    UNIQUE INDEX `uq_tokens_acceso_token_hash`(`token_hash`),
    INDEX `idx_tokens_acceso_evento`(`evento_id`),
    INDEX `idx_tokens_acceso_creado_por`(`creado_por_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tokens_acceso` ADD CONSTRAINT `fk_tokens_acceso_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `tokens_acceso` ADD CONSTRAINT `fk_tokens_acceso_creado_por` FOREIGN KEY (`creado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
