-- ============================================================================
-- Spec 003 · Consultas de documentos (pool de tokens DNI, bitácora y caché)
-- ============================================================================

CREATE TABLE `tokens_consulta` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `proveedor` ENUM('DECOLECTA', 'APIPERU') NOT NULL,
    `nombre` VARCHAR(100) NOT NULL,
    `token_cifrado` TEXT NOT NULL,
    `token_sufijo` VARCHAR(8) NOT NULL,
    `limite_consultas` INTEGER NULL,
    `consultas_usadas` INTEGER NOT NULL DEFAULT 0,
    `periodo_renovacion` ENUM('DIARIO', 'MENSUAL', 'ANUAL', 'NINGUNO') NOT NULL DEFAULT 'MENSUAL',
    `fecha_renovacion` DATETIME(3) NULL,
    `prioridad` INTEGER NOT NULL DEFAULT 100,
    `estado` ENUM('ACTIVO', 'AGOTADO', 'INVALIDO') NOT NULL DEFAULT 'ACTIVO',
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `ultimo_error` VARCHAR(500) NULL,
    `ultimo_uso_en` DATETIME(3) NULL,
    `agotado_en` DATETIME(3) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `idx_tokens_consulta_seleccion`(`activo`, `estado`, `prioridad`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `consultas_documento` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token_consulta_id` INTEGER NULL,
    `proveedor` ENUM('DECOLECTA', 'APIPERU') NULL,
    `tipo_documento` VARCHAR(10) NOT NULL DEFAULT 'dni',
    `numero_mascara` VARCHAR(20) NOT NULL,
    `resultado` ENUM('EXITO', 'NO_ENCONTRADO', 'AGOTADO', 'TOKEN_INVALIDO', 'ERROR', 'CACHE', 'SIN_TOKENS') NOT NULL,
    `codigo_http` INTEGER NULL,
    `duracion_ms` INTEGER NULL,
    `origen` ENUM('LANDING', 'PANEL', 'SISTEMA') NOT NULL,
    `detalle` VARCHAR(300) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_consultas_documento_creado`(`creado_en`),
    INDEX `idx_consultas_documento_token_creado`(`token_consulta_id`, `creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `personas_consultadas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo_documento` VARCHAR(10) NOT NULL DEFAULT 'dni',
    `numero_documento` VARCHAR(20) NOT NULL,
    `nombres` VARCHAR(120) NOT NULL,
    `apellido_paterno` VARCHAR(120) NOT NULL,
    `apellido_materno` VARCHAR(120) NOT NULL,
    `proveedor` ENUM('DECOLECTA', 'APIPERU') NOT NULL,
    `consultado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_personas_consultadas_documento`(`tipo_documento`, `numero_documento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `consultas_documento` ADD CONSTRAINT `fk_consultas_documento_token` FOREIGN KEY (`token_consulta_id`) REFERENCES `tokens_consulta`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
