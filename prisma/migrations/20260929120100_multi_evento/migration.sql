-- ============================================================================
-- Spec 002 · Multi-evento
-- ----------------------------------------------------------------------------
-- Crea `eventos`. Los datos existentes pertenecen al VII CIISIC 2025 (id 1, FINALIZADO): se
-- crea ese evento solo si la BD ya tenía datos y se le asignan todos (backfill). El evento en
-- curso, VIII CIISIC 2026 (id 2), queda como principal y arranca con una copia de las
-- categorías y tipos de inscripción del VII (mismos códigos y precios). No borra datos.
-- ============================================================================

-- 1) Eventos (ediciones del congreso u otros eventos)
CREATE TABLE `eventos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(60) NOT NULL,
    `nombre` VARCHAR(200) NOT NULL,
    `nombre_corto` VARCHAR(80) NOT NULL,
    `descripcion` TEXT NULL,
    `sede` VARCHAR(200) NULL,
    `fecha_inicio` DATE NOT NULL,
    `fecha_fin` DATE NOT NULL,
    `inscripciones_inicio` DATETIME(3) NULL,
    `inscripciones_fin` DATETIME(3) NULL,
    `inscripciones_abiertas` BOOLEAN NOT NULL DEFAULT true,
    `estado` ENUM('BORRADOR', 'PUBLICADO', 'FINALIZADO', 'ARCHIVADO') NOT NULL DEFAULT 'BORRADOR',
    `es_principal` BOOLEAN NOT NULL DEFAULT false,
    `dominio_institucional` VARCHAR(100) NOT NULL DEFAULT 'undc.edu.pe',
    `correo_contacto` VARCHAR(191) NULL,
    `telefono_contacto` VARCHAR(30) NULL,
    `remitente_nombre` VARCHAR(120) NULL,
    `asunto_aprobacion` VARCHAR(200) NULL,
    `logo_archivo` VARCHAR(255) NULL,
    `datos_pago` JSON NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_eventos_codigo`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- VII CIISIC 2025 (21–23 oct 2025): edición histórica a la que pertenecen los datos existentes.
-- En una BD nueva (sin datos) no se crea.
INSERT INTO `eventos` (
    `id`, `codigo`, `nombre`, `nombre_corto`, `fecha_inicio`, `fecha_fin`,
    `inscripciones_inicio`, `inscripciones_fin`, `inscripciones_abiertas`, `estado`, `es_principal`,
    `dominio_institucional`, `remitente_nombre`, `asunto_aprobacion`, `actualizado_en`
)
SELECT
    1,
    'ciisic-vii-2025',
    'VII Congreso Internacional de Ingeniería de Sistemas e Investigación Científica',
    'VII CIISIC 2025',
    '2025-10-21',
    '2025-10-23',
    (SELECT MIN(`creado_en`) FROM `inscripciones`),
    (SELECT MAX(`creado_en`) FROM `inscripciones`),
    false,
    'FINALIZADO',
    false,
    'undc.edu.pe',
    'Inscripción al congreso',
    '✅ Tu inscripción ha sido aprobada',
    CURRENT_TIMESTAMP(3)
FROM DUAL
WHERE EXISTS (SELECT 1 FROM `inscripciones`)
   OR EXISTS (SELECT 1 FROM `categorias_inscripcion`)
   OR EXISTS (SELECT 1 FROM `actividades`)
   OR EXISTS (SELECT 1 FROM `ponencias`)
   OR EXISTS (SELECT 1 FROM `mensajes_contacto`);

-- VIII CIISIC 2026 (26–30 oct 2026): evento en curso y principal (rutas legacy de la landing).
-- El remitente del correo se toma de la credencial de correo (spec 006) salvo que se defina aquí.
INSERT INTO `eventos` (
    `id`, `codigo`, `nombre`, `nombre_corto`, `descripcion`, `sede`, `fecha_inicio`, `fecha_fin`,
    `inscripciones_abiertas`, `estado`, `es_principal`, `dominio_institucional`, `correo_contacto`,
    `telefono_contacto`, `asunto_aprobacion`, `datos_pago`, `actualizado_en`
) VALUES (
    2,
    'ciisic-viii-2026',
    'VIII Congreso Internacional de Ingeniería de Sistemas e Investigación Científica',
    'VIII CIISIC 2026',
    'Cinco días para compartir conocimiento, descubrir perspectivas y crear conexiones en Cañete.',
    'Auditorio Casa de la Cultura, San Vicente de Cañete',
    '2026-10-26',
    '2026-10-30',
    true,
    'PUBLICADO',
    true,
    'undc.edu.pe',
    'congreso@undc.edu.pe',
    '+51 949 026 908',
    '✅ Tu inscripción ha sido aprobada',
    JSON_OBJECT(
        'titular', 'Jhon Ismael Santiago Rojas',
        'bancos', JSON_ARRAY(JSON_OBJECT('codigo', 'bcp', 'nombre', 'BCP', 'numeroCuenta', '25519777007010', 'cci', '00225511977700701083')),
        'billeteras', JSON_ARRAY(JSON_OBJECT('codigo', 'yape', 'nombre', 'Yape', 'telefono', '924896551', 'qrUrl', '/images/qr/yape-2026.png'))
    ),
    CURRENT_TIMESTAMP(3)
);

-- 2) categorias_inscripcion: pertenecen a un evento y tienen código estable
ALTER TABLE `categorias_inscripcion`
    ADD COLUMN `evento_id` INTEGER NULL AFTER `id`,
    ADD COLUMN `codigo` VARCHAR(40) NULL AFTER `evento_id`,
    ADD COLUMN `es_estudiantil` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `orden` INTEGER NOT NULL DEFAULT 0;
UPDATE `categorias_inscripcion` SET
    `evento_id` = 1,
    `codigo` = CASE
        WHEN UPPER(TRIM(`nombre`)) = 'ESTUDIANTES' THEN 'ESTUDIANTES'
        WHEN UPPER(TRIM(`nombre`)) = 'PROFESIONALES Y PUBLICO EN GENERAL' THEN 'PUBLICO_GENERAL'
        ELSE CONCAT('CATEGORIA_', `id`) END,
    `orden` = `id`;
UPDATE `categorias_inscripcion` SET `es_estudiantil` = true WHERE `codigo` = 'ESTUDIANTES';
ALTER TABLE `categorias_inscripcion`
    MODIFY `evento_id` INTEGER NOT NULL,
    MODIFY `codigo` VARCHAR(40) NOT NULL;
ALTER TABLE `categorias_inscripcion` DROP INDEX `uq_categorias_inscripcion_nombre`;
ALTER TABLE `categorias_inscripcion` ADD UNIQUE INDEX `uq_categorias_inscripcion_evento_codigo` (`evento_id`, `codigo`);
ALTER TABLE `categorias_inscripcion` ADD CONSTRAINT `fk_categorias_inscripcion_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) tipos_inscripcion: código obligatorio y orden de presentación
ALTER TABLE `tipos_inscripcion` ADD COLUMN `orden` INTEGER NOT NULL DEFAULT 0;
UPDATE `tipos_inscripcion` SET `codigo` = CONCAT('tipo_', `id`) WHERE `codigo` IS NULL OR TRIM(`codigo`) = '';
UPDATE `tipos_inscripcion` SET `orden` = `id`;
ALTER TABLE `tipos_inscripcion` MODIFY `codigo` VARCHAR(80) NOT NULL;
ALTER TABLE `tipos_inscripcion` ADD UNIQUE INDEX `uq_tipos_inscripcion_categoria_codigo` (`categoria_id`, `codigo`);
ALTER TABLE `tipos_inscripcion` DROP INDEX `idx_tipos_inscripcion_categoria`;

-- 3b) El VIII arranca con la configuración del VII (categorías y tipos con los mismos códigos
--     y precios). Las inscripciones del VII siguen apuntando a los tipos del VII.
INSERT INTO `categorias_inscripcion` (`evento_id`, `codigo`, `nombre`, `descripcion`, `caracteristicas`, `precio_desde`, `es_estudiantil`, `orden`)
SELECT 2, `codigo`, `nombre`, `descripcion`, `caracteristicas`, `precio_desde`, `es_estudiantil`, `orden`
FROM `categorias_inscripcion`
WHERE `evento_id` = 1
ORDER BY `id`;
INSERT INTO `tipos_inscripcion` (`categoria_id`, `codigo`, `nombre`, `etiqueta`, `descripcion`, `caracteristicas`, `precio`, `precio_institucional`, `activo`, `orden`)
SELECT nueva.`id`, t.`codigo`, t.`nombre`, t.`etiqueta`, t.`descripcion`, t.`caracteristicas`, t.`precio`, t.`precio_institucional`, t.`activo`, t.`orden`
FROM `tipos_inscripcion` t
JOIN `categorias_inscripcion` anterior ON anterior.`id` = t.`categoria_id` AND anterior.`evento_id` = 1
JOIN `categorias_inscripcion` nueva ON nueva.`evento_id` = 2 AND nueva.`codigo` = anterior.`codigo`
ORDER BY t.`id`;

-- 4) inscripciones: evento + datos de revisión
ALTER TABLE `inscripciones`
    ADD COLUMN `evento_id` INTEGER NULL AFTER `id`,
    ADD COLUMN `motivo_rechazo` VARCHAR(500) NULL,
    ADD COLUMN `revisado_por_id` INTEGER NULL,
    ADD COLUMN `revisado_en` DATETIME(3) NULL,
    ADD COLUMN `credencial_enviada_en` DATETIME(3) NULL;
UPDATE `inscripciones` SET `evento_id` = 1;
ALTER TABLE `inscripciones` MODIFY `evento_id` INTEGER NOT NULL;
ALTER TABLE `inscripciones` ADD UNIQUE INDEX `uq_inscripciones_evento_participante` (`evento_id`, `participante_id`);
ALTER TABLE `inscripciones` ADD INDEX `idx_inscripciones_revisado_por` (`revisado_por_id`);
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_revisado_por` FOREIGN KEY (`revisado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 5) actividades: pertenecen a un evento
ALTER TABLE `actividades` ADD COLUMN `evento_id` INTEGER NULL AFTER `id`;
UPDATE `actividades` SET `evento_id` = 1;
ALTER TABLE `actividades` MODIFY `evento_id` INTEGER NOT NULL;
ALTER TABLE `actividades` ADD INDEX `idx_actividades_evento` (`evento_id`);
ALTER TABLE `actividades` ADD CONSTRAINT `fk_actividades_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) ponencias: pertenecen a un evento
ALTER TABLE `ponencias` ADD COLUMN `evento_id` INTEGER NULL AFTER `id`;
UPDATE `ponencias` SET `evento_id` = 1;
ALTER TABLE `ponencias` MODIFY `evento_id` INTEGER NOT NULL;
ALTER TABLE `ponencias` ADD INDEX `idx_ponencias_evento_creado` (`evento_id`, `creado_en`);
ALTER TABLE `ponencias` DROP INDEX `idx_ponencias_creado`;
ALTER TABLE `ponencias` ADD CONSTRAINT `fk_ponencias_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7) mensajes_contacto: evento opcional + marca de lectura
ALTER TABLE `mensajes_contacto`
    ADD COLUMN `evento_id` INTEGER NULL AFTER `id`,
    ADD COLUMN `leido` BOOLEAN NOT NULL DEFAULT false;
UPDATE `mensajes_contacto` SET `evento_id` = 1;
ALTER TABLE `mensajes_contacto` ADD INDEX `idx_mensajes_contacto_evento` (`evento_id`);
ALTER TABLE `mensajes_contacto` ADD CONSTRAINT `fk_mensajes_contacto_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 8) administradores: se pueden desactivar sin borrarlos
ALTER TABLE `administradores` ADD COLUMN `activo` BOOLEAN NOT NULL DEFAULT true AFTER `rol_id`;
