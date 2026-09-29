-- ============================================================================
-- Spec 008 · Configuración del sistema (fila única)
-- Reemplaza variables de entorno por valores gestionados desde el panel: API_UNDC (URL,
-- API key cifrada con AES-256-GCM, timeout y último estado), client ID de Google, URL del
-- panel y el interruptor de las rutas de la landing anterior.
-- ============================================================================

CREATE TABLE `configuracion_sistema` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `undc_api_url` VARCHAR(255) NULL,
    `undc_api_key_cifrada` TEXT NULL,
    `undc_api_key_sufijo` VARCHAR(8) NULL,
    `undc_api_timeout_ms` INTEGER NOT NULL DEFAULT 8000,
    `undc_ultimo_estado` ENUM('OK', 'ERROR') NULL,
    `undc_ultimo_error` VARCHAR(500) NULL,
    `undc_ultima_prueba_en` DATETIME(3) NULL,
    `google_client_id` VARCHAR(255) NULL,
    `url_panel` VARCHAR(255) NULL,
    `rutas_legacy_activas` BOOLEAN NOT NULL DEFAULT true,
    `actualizado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `idx_configuracion_sistema_actualizado_por`(`actualizado_por_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ck_configuracion_sistema_fila_unica` CHECK (`id` = 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `configuracion_sistema` ADD CONSTRAINT `fk_configuracion_sistema_actualizado_por` FOREIGN KEY (`actualizado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- La fila única existe siempre (valores por defecto: nada configurado, rutas legacy activas).
INSERT INTO `configuracion_sistema` (`id`, `actualizado_en`) VALUES (1, CURRENT_TIMESTAMP(3));
