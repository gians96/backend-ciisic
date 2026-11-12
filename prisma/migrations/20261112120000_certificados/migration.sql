-- ============================================================================
-- Spec 015 · Certificados (fase 1: importación de certificados firmados fuera del sistema)
-- Solo crea la tabla `certificados` (aditiva). Si falla a medias: DROP TABLE IF EXISTS `certificados`
-- y `prisma migrate resolve --rolled-back 20261112120000_certificados` (docs/operacion.md).
--
-- `codigo` usa la collation utf8mb4_bin: los códigos externos distinguen mayúsculas («abc» ≠ «ABC»).
-- Prisma no describe la collation de una columna, así que `migrate diff` no la ve.
-- ============================================================================

CREATE TABLE `certificados` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `participante_id` INTEGER NOT NULL,
    `inscripcion_id` INTEGER NULL,
    `codigo` VARCHAR(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `clave_vigente` VARCHAR(120) NULL,
    `tipo` VARCHAR(40) NOT NULL,
    `estado` ENUM('SIN_ARCHIVO', 'LISTO', 'ANULADO') NOT NULL DEFAULT 'SIN_ARCHIVO',
    `nombre_impreso` VARCHAR(200) NOT NULL,
    `numero_documento` VARCHAR(20) NOT NULL,
    `observacion` VARCHAR(500) NULL,
    `archivo` VARCHAR(120) NULL,
    `hash_archivo` CHAR(64) NULL,
    `bytes_archivo` INTEGER NULL,
    `firmas_detectadas` INTEGER NOT NULL DEFAULT 0,
    `subido_en` DATETIME(3) NULL,
    `subido_por_id` INTEGER NULL,
    `enviado_en` DATETIME(3) NULL,
    `enviado_por_id` INTEGER NULL,
    `envio_error` VARCHAR(300) NULL,
    `importado_por_id` INTEGER NULL,
    `anulado_en` DATETIME(3) NULL,
    `anulado_por_id` INTEGER NULL,
    `motivo_anulacion` VARCHAR(500) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_certificados_codigo`(`codigo`),
    UNIQUE INDEX `uq_certificados_clave_vigente`(`clave_vigente`),
    INDEX `idx_certificados_evento_estado`(`evento_id`, `estado`),
    INDEX `idx_certificados_participante`(`participante_id`),
    INDEX `idx_certificados_inscripcion`(`inscripcion_id`),
    INDEX `idx_certificados_numero_documento`(`numero_documento`),
    INDEX `idx_certificados_importado_por`(`importado_por_id`),
    INDEX `idx_certificados_subido_por`(`subido_por_id`),
    INDEX `idx_certificados_enviado_por`(`enviado_por_id`),
    INDEX `idx_certificados_anulado_por`(`anulado_por_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ck_certificados_clave_vigente` CHECK ((`estado` = 'ANULADO') = (`clave_vigente` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_inscripcion` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_importado_por` FOREIGN KEY (`importado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_subido_por` FOREIGN KEY (`subido_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_enviado_por` FOREIGN KEY (`enviado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_anulado_por` FOREIGN KEY (`anulado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
