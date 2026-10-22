-- ============================================================================
-- Delegaciones con planes y tarifa propios (spec 029)
-- Cada delegación pasa a tener sus planes Con kit, Sin kit y Virtual: tres tipos de inscripción de su propia
-- categoría oculta (`categorias_inscripcion.delegacion_id`), cada uno con su precio, su estado y, opcional,
-- un precio promocional desde `delegaciones.min_integrantes` (`tipos_inscripcion.precio_promocional`).
-- La categoría compartida `DELEGACIONES` y su tarifa global (`eventos.delegaciones_*`) desaparecen.
--
-- 1) Esquema nuevo: dominio del correo, link individual, categoría de la delegación y precio promocional.
-- 2) Conversión de lo que ya existe, ANTES de borrar nada:
--    - por cada delegación crea su categoría `DELEGACION_<id>` y sus tres planes: Sin kit con los precios que ya
--      tenía (activo si era presencial), Virtual (activo si era virtual; si no, con el precio del tipo virtual del
--      evento) y Con kit (inactivo, S/ 0: un Owner o Administrador lo configura);
--    - mueve a cada integrante al plan equivalente (los montos que ya tenía no cambian);
--    - borra la categoría `DELEGACIONES` y sus tipos solo si ya nadie los usa.
-- 3) Quita lo que dejó de usarse: modalidad, precios y tipo de `delegaciones`, y la tarifa de `eventos`.
-- Es idempotente en la parte de datos (cada INSERT comprueba que la fila no exista).
-- Respaldo antes de aplicarla en producción: `mysqldump` de categorias_inscripcion, tipos_inscripcion,
-- delegaciones, delegacion_pagos, inscripciones y eventos. Verificación: `prisma/preflight/verificar-delegaciones-planes.sql`.
-- Para revertir (los datos de precios no se recuperan sin el respaldo): ADD de las columnas quitadas
--   y `prisma migrate resolve --rolled-back 20261024120000_delegaciones_planes`.
-- ============================================================================

-- 1) Esquema nuevo
ALTER TABLE `delegaciones`
    ADD COLUMN `dominio_correo` VARCHAR(100) NULL,
    ADD COLUMN `codigo_inscripcion` VARCHAR(100) NULL,
    ADD UNIQUE INDEX `uq_delegaciones_codigo_inscripcion`(`codigo_inscripcion`);

ALTER TABLE `tipos_inscripcion` ADD COLUMN `precio_promocional` DECIMAL(10, 2) NULL;

ALTER TABLE `categorias_inscripcion`
    ADD COLUMN `delegacion_id` INTEGER NULL,
    ADD UNIQUE INDEX `uq_categorias_inscripcion_delegacion`(`delegacion_id`),
    ADD CONSTRAINT `fk_categorias_inscripcion_delegacion` FOREIGN KEY (`delegacion_id`) REFERENCES `delegaciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- 2) Conversión de las delegaciones existentes
-- 2a) Una categoría oculta por delegación (`orden` alto: nunca se mezcla con las de la landing)
INSERT INTO `categorias_inscripcion` (`evento_id`, `codigo`, `nombre`, `descripcion`, `caracteristicas`, `precio_desde`, `es_estudiantil`, `orden`, `delegacion_id`)
SELECT d.`evento_id`, CONCAT('DELEGACION_', d.`id`), d.`nombre`, NULL, NULL, NULL, 0, 1000 + d.`id`, d.`id`
FROM `delegaciones` d
WHERE NOT EXISTS (SELECT 1 FROM `categorias_inscripcion` c WHERE c.`delegacion_id` = d.`id`);

-- 2b) Plan Con kit: inactivo y sin precio hasta que se configure
INSERT INTO `tipos_inscripcion` (`categoria_id`, `codigo`, `nombre`, `etiqueta`, `descripcion`, `caracteristicas`, `precio`, `precio_institucional`, `precio_promocional`, `disponible_para`, `modalidad`, `excluye_estudiantes_undc`, `activo`, `orden`)
SELECT c.`id`, 'delegacion_con_kit', LEFT(CONCAT('DELEGACION ', UPPER(d.`nombre`)), 191), 'CON KIT', NULL, NULL, 0, 0, NULL, 'TODOS', 'PRESENCIAL', 0, 0, 1
FROM `delegaciones` d
JOIN `categorias_inscripcion` c ON c.`delegacion_id` = d.`id`
WHERE NOT EXISTS (SELECT 1 FROM `tipos_inscripcion` t WHERE t.`categoria_id` = c.`id` AND t.`codigo` = 'delegacion_con_kit');

-- 2c) Plan Sin kit: lo que ya cobraba una delegación presencial (el promocional solo si de verdad rebaja)
INSERT INTO `tipos_inscripcion` (`categoria_id`, `codigo`, `nombre`, `etiqueta`, `descripcion`, `caracteristicas`, `precio`, `precio_institucional`, `precio_promocional`, `disponible_para`, `modalidad`, `excluye_estudiantes_undc`, `activo`, `orden`)
SELECT c.`id`, 'delegacion_sin_kit', LEFT(CONCAT('DELEGACION ', UPPER(d.`nombre`)), 191), 'SIN KIT', NULL, NULL,
       IF(d.`modalidad` = 'PRESENCIAL', d.`precio_estandar`, 0),
       IF(d.`modalidad` = 'PRESENCIAL', d.`precio_estandar`, 0),
       IF(d.`modalidad` = 'PRESENCIAL' AND d.`precio_promocional` < d.`precio_estandar`, d.`precio_promocional`, NULL),
       'TODOS', 'PRESENCIAL', 0, IF(d.`modalidad` = 'PRESENCIAL', 1, 0), 2
FROM `delegaciones` d
JOIN `categorias_inscripcion` c ON c.`delegacion_id` = d.`id`
WHERE NOT EXISTS (SELECT 1 FROM `tipos_inscripcion` t WHERE t.`categoria_id` = c.`id` AND t.`codigo` = 'delegacion_sin_kit');

-- 2d) Plan Virtual: el precio de la delegación virtual o, en una presencial, el del tipo virtual del evento (apagado)
INSERT INTO `tipos_inscripcion` (`categoria_id`, `codigo`, `nombre`, `etiqueta`, `descripcion`, `caracteristicas`, `precio`, `precio_institucional`, `precio_promocional`, `disponible_para`, `modalidad`, `excluye_estudiantes_undc`, `activo`, `orden`)
SELECT c.`id`, 'delegacion_virtual', LEFT(CONCAT('DELEGACION ', UPPER(d.`nombre`)), 191), 'VIRTUAL', NULL, NULL,
       IF(d.`modalidad` = 'VIRTUAL', d.`precio_estandar`, COALESCE(
           (SELECT t0.`precio` FROM `tipos_inscripcion` t0 JOIN `categorias_inscripcion` c0 ON c0.`id` = t0.`categoria_id`
            WHERE c0.`evento_id` = d.`evento_id` AND c0.`codigo` = 'DELEGACIONES' AND t0.`codigo` = 'delegacion_virtual' LIMIT 1), 0)),
       IF(d.`modalidad` = 'VIRTUAL', d.`precio_estandar`, COALESCE(
           (SELECT t0.`precio` FROM `tipos_inscripcion` t0 JOIN `categorias_inscripcion` c0 ON c0.`id` = t0.`categoria_id`
            WHERE c0.`evento_id` = d.`evento_id` AND c0.`codigo` = 'DELEGACIONES' AND t0.`codigo` = 'delegacion_virtual' LIMIT 1), 0)),
       NULL, 'TODOS', 'VIRTUAL', 0, IF(d.`modalidad` = 'VIRTUAL', 1, 0), 3
FROM `delegaciones` d
JOIN `categorias_inscripcion` c ON c.`delegacion_id` = d.`id`
WHERE NOT EXISTS (SELECT 1 FROM `tipos_inscripcion` t WHERE t.`categoria_id` = c.`id` AND t.`codigo` = 'delegacion_virtual');

-- 2e) Cada integrante pasa al plan equivalente a la modalidad de su delegación (monto y descuento no cambian)
UPDATE `inscripciones` i
JOIN `delegaciones` d ON d.`id` = i.`delegacion_id`
JOIN `categorias_inscripcion` c ON c.`delegacion_id` = d.`id`
JOIN `tipos_inscripcion` t ON t.`categoria_id` = c.`id` AND t.`codigo` = IF(d.`modalidad` = 'VIRTUAL', 'delegacion_virtual', 'delegacion_sin_kit')
SET i.`tipo_inscripcion_id` = t.`id`;

-- 2f) La categoría compartida `DELEGACIONES` y sus tipos se borran solo si ya nadie los usa
DELETE t FROM `tipos_inscripcion` t
JOIN `categorias_inscripcion` c ON c.`id` = t.`categoria_id`
WHERE c.`codigo` = 'DELEGACIONES'
  AND NOT EXISTS (SELECT 1 FROM `inscripciones` i WHERE i.`tipo_inscripcion_id` = t.`id`);

DELETE c FROM `categorias_inscripcion` c
WHERE c.`codigo` = 'DELEGACIONES'
  AND NOT EXISTS (SELECT 1 FROM `tipos_inscripcion` t WHERE t.`categoria_id` = c.`id`);

-- 3) Lo que dejó de usarse
ALTER TABLE `delegaciones` DROP FOREIGN KEY `fk_delegaciones_tipo_inscripcion`;

ALTER TABLE `delegaciones`
    DROP INDEX `idx_delegaciones_tipo_inscripcion`,
    DROP COLUMN `tipo_inscripcion_id`,
    DROP COLUMN `modalidad`,
    DROP COLUMN `precio_estandar`,
    DROP COLUMN `precio_promocional`;

ALTER TABLE `eventos`
    DROP COLUMN `delegaciones_min_integrantes`,
    DROP COLUMN `delegaciones_precio_estandar`,
    DROP COLUMN `delegaciones_precio_promocional`;
