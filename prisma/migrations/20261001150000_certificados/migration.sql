-- ============================================================================
-- Spec 015 · Certificados
-- 1) Tipos de certificado (catálogo por código; se siembran PARTICIPANTE, ORGANIZADOR y PONENTE).
-- 2) Plantillas PDF por evento con sus campos en puntos PDF.
-- 3) Certificados con código fijo y aleatorio asignado antes de firmar:
--    PENDIENTE → PREPARADO → EN_FIRMA → FIRMADO | ANULADO. `clave_vigente` (evento, participante,
--    tipo y ponencia) es única y queda en NULL solo al anular (CHECK), para poder volver a emitir.
-- 4) Configuración de certificados en `configuracion_sistema` (columnas `certificados_*`, sin tabla
--    aparte): proveedor del código (LOCAL; UNDC pendiente), prefijo, proveedor confirmado y las
--    credenciales de la API UNDC (secreto cifrado con AES-256-GCM, solo Owner).
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema. Prisma ignora los CHECK
-- (`migrate diff` queda vacío igual que con 20260930120000_configuracion_sistema).
-- Si falla a medias (P3009): prisma/preflight/revertir-015.sql y
--   `prisma migrate resolve --rolled-back 20261001150000_certificados`, y volver a desplegar.
-- ============================================================================

-- Tipos de certificado
CREATE TABLE `tipos_certificado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(40) NOT NULL,
    `nombre` VARCHAR(80) NOT NULL,
    `texto_impreso` VARCHAR(80) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `uq_tipos_certificado_codigo`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Plantillas PDF por evento
CREATE TABLE `plantillas_certificado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `archivo_diseno` VARCHAR(80) NOT NULL,
    `archivo_original` VARCHAR(255) NOT NULL,
    `tamano_bytes` INTEGER NOT NULL,
    `paginas` INTEGER NOT NULL,
    `ancho_pt` DOUBLE NOT NULL,
    `alto_pt` DOUBLE NOT NULL,
    `campos` JSON NOT NULL,
    `horas_por_defecto` INTEGER NULL,
    `firmas_requeridas` INTEGER NOT NULL DEFAULT 1,
    `version` INTEGER NOT NULL DEFAULT 1,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_plantillas_certificado_archivo`(`archivo_diseno`),
    INDEX `idx_plantillas_certificado_evento`(`evento_id`),
    INDEX `idx_plantillas_certificado_creado_por`(`creado_por_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Certificados
CREATE TABLE `certificados` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `participante_id` INTEGER NOT NULL,
    `tipo_certificado_id` INTEGER NOT NULL,
    `plantilla_id` INTEGER NULL,
    `inscripcion_id` INTEGER NULL,
    `ponencia_id` VARCHAR(36) NULL,
    `numero` INTEGER NOT NULL,
    `codigo` VARCHAR(40) NOT NULL,
    `clave_vigente` VARCHAR(80) NULL,
    `estado` ENUM('PENDIENTE', 'PREPARADO', 'EN_FIRMA', 'FIRMADO', 'ANULADO') NOT NULL DEFAULT 'PENDIENTE',
    `nombre_impreso` VARCHAR(200) NOT NULL,
    `tipo_documento` VARCHAR(10) NOT NULL,
    `numero_documento` VARCHAR(20) NOT NULL,
    `detalle` VARCHAR(500) NULL,
    `horas` INTEGER NULL,
    `fecha_emision` DATE NOT NULL,
    `codigo_impreso` VARCHAR(80) NULL,
    `url_verificacion` VARCHAR(255) NULL,
    `plantilla_version` INTEGER NULL,
    `generacion` CHAR(8) NULL,
    `archivo_generado` VARCHAR(120) NULL,
    `hash_generado` CHAR(64) NULL,
    `bytes_generado` INTEGER NULL,
    `generado_en` DATETIME(3) NULL,
    `descargado_para_firmar_en` DATETIME(3) NULL,
    `archivo_firmado` VARCHAR(120) NULL,
    `hash_firmado` CHAR(64) NULL,
    `bytes_firmado` INTEGER NULL,
    `firmantes` JSON NULL,
    `firmas_detectadas` INTEGER NOT NULL DEFAULT 0,
    `coincidencia` ENUM('PREFIJO', 'METADATOS', 'FORZADO') NULL,
    `motivo_forzado` VARCHAR(500) NULL,
    `firmado_en` DATETIME(3) NULL,
    `codigo_externo` VARCHAR(80) NULL,
    `registro_externo` ENUM('NO_APLICA', 'PENDIENTE', 'REGISTRADO', 'ERROR') NOT NULL DEFAULT 'NO_APLICA',
    `registro_externo_error` VARCHAR(500) NULL,
    `registrado_externo_en` DATETIME(3) NULL,
    `anulado_en` DATETIME(3) NULL,
    `motivo_anulacion` VARCHAR(500) NULL,
    `emitido_por_id` INTEGER NULL,
    `editado_por_id` INTEGER NULL,
    `firmado_cargado_por_id` INTEGER NULL,
    `anulado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_certificados_codigo`(`codigo`),
    UNIQUE INDEX `uq_certificados_clave_vigente`(`clave_vigente`),
    UNIQUE INDEX `uq_certificados_codigo_externo`(`codigo_externo`),
    INDEX `idx_certificados_evento_estado`(`evento_id`, `estado`),
    INDEX `idx_certificados_participante`(`participante_id`),
    INDEX `idx_certificados_tipo`(`tipo_certificado_id`),
    INDEX `idx_certificados_plantilla`(`plantilla_id`),
    INDEX `idx_certificados_inscripcion`(`inscripcion_id`),
    INDEX `idx_certificados_ponencia`(`ponencia_id`),
    INDEX `idx_certificados_emitido_por`(`emitido_por_id`),
    INDEX `idx_certificados_editado_por`(`editado_por_id`),
    INDEX `idx_certificados_firmado_cargado_por`(`firmado_cargado_por_id`),
    INDEX `idx_certificados_anulado_por`(`anulado_por_id`),
    UNIQUE INDEX `uq_certificados_evento_numero`(`evento_id`, `numero`),
    PRIMARY KEY (`id`),
    -- Vigente (con clave) en todo estado menos ANULADO: anular libera la clave para volver a emitir
    CONSTRAINT `ck_certificados_clave_vigente` CHECK ((`estado` = 'ANULADO') = (`clave_vigente` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `plantillas_certificado` ADD CONSTRAINT `fk_plantillas_certificado_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `plantillas_certificado` ADD CONSTRAINT `fk_plantillas_certificado_creado_por` FOREIGN KEY (`creado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_tipo` FOREIGN KEY (`tipo_certificado_id`) REFERENCES `tipos_certificado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_plantilla` FOREIGN KEY (`plantilla_id`) REFERENCES `plantillas_certificado`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_inscripcion` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_ponencia` FOREIGN KEY (`ponencia_id`) REFERENCES `ponencias`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_emitido_por` FOREIGN KEY (`emitido_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_editado_por` FOREIGN KEY (`editado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_firmado_cargado_por` FOREIGN KEY (`firmado_cargado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_anulado_por` FOREIGN KEY (`anulado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Configuración de certificados en la fila única del sistema (valores por defecto: proveedor LOCAL
-- sin confirmar, prefijo CIISIC, sin credenciales UNDC)
ALTER TABLE `configuracion_sistema` ADD COLUMN `certificados_prefijo` VARCHAR(20) NOT NULL DEFAULT 'CIISIC',
    ADD COLUMN `certificados_proveedor` ENUM('LOCAL', 'UNDC') NOT NULL DEFAULT 'LOCAL',
    ADD COLUMN `certificados_proveedor_confirmado` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `certificados_undc_secreto_cifrado` TEXT NULL,
    ADD COLUMN `certificados_undc_secreto_sufijo` VARCHAR(8) NULL,
    ADD COLUMN `certificados_undc_timeout_ms` INTEGER NOT NULL DEFAULT 10000,
    ADD COLUMN `certificados_undc_ultima_prueba_en` DATETIME(3) NULL,
    ADD COLUMN `certificados_undc_ultimo_error` VARCHAR(500) NULL,
    ADD COLUMN `certificados_undc_ultimo_estado` ENUM('OK', 'ERROR') NULL,
    ADD COLUMN `certificados_undc_url` VARCHAR(255) NULL,
    ADD COLUMN `certificados_undc_usuario` VARCHAR(191) NULL;

-- Catálogo: docker-entrypoint.sh solo aplica migraciones (el seed no corre en producción)
INSERT INTO `tipos_certificado` (`codigo`, `nombre`, `texto_impreso`, `orden`) VALUES
    ('PARTICIPANTE', 'Participante', 'PARTICIPANTE', 1),
    ('ORGANIZADOR', 'Organizador', 'ORGANIZADOR', 2),
    ('PONENTE', 'Ponente', 'PONENTE', 3);
