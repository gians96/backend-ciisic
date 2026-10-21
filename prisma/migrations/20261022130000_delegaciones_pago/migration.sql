-- ============================================================================
-- Delegaciones · pagos múltiples del grupo (spec 021 y 023)
-- 1) `delegacion_pagos`: una delegación puede pagar en varias partes. Cada fila es un voucher con su
--    archivo, su número de operación, su fecha y el monto que declara el delegado; el staff lo marca
--    como VERIFICADO o RECHAZADO. No caben en `inscripciones`, donde `numero_operacion` es único por
--    inscripción y `voucher_archivo` es por persona.
-- 2) `uq_delegacion_pagos_evento_numero_operacion`: el mismo número de operación no se registra dos
--    veces en un evento (`evento_id` va denormalizado para poder indexarlo).
-- 3) `eventos.delegaciones_*`: la tarifa por defecto de las delegaciones del evento. Cada delegación la
--    copia al crearse, así un cambio de precio no altera lo ya cobrado.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema (no lee las tablas ni las
-- columnas nuevas).
-- Para revertir: DROP TABLE `delegacion_pagos`; ALTER TABLE `eventos`
--   DROP COLUMN `delegaciones_precio_promocional`, DROP COLUMN `delegaciones_precio_estandar`,
--   DROP COLUMN `delegaciones_min_integrantes`;
--   y `prisma migrate resolve --rolled-back 20261022130000_delegaciones_pago`.
-- ============================================================================

CREATE TABLE `delegacion_pagos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `delegacion_id` INTEGER NOT NULL,
    `evento_id` INTEGER NOT NULL,
    `modalidad_pago` VARCHAR(40) NOT NULL,
    `banco` VARCHAR(40) NULL,
    `billetera_digital` VARCHAR(40) NULL,
    `tipo_operacion` VARCHAR(40) NULL,
    `numero_operacion` VARCHAR(100) NOT NULL,
    `fecha_pago` DATETIME(3) NOT NULL,
    `monto` DECIMAL(10, 2) NOT NULL,
    `voucher_archivo` VARCHAR(191) NOT NULL,
    `estado` ENUM('PENDIENTE', 'VERIFICADO', 'RECHAZADO') NOT NULL DEFAULT 'PENDIENTE',
    `motivo_rechazo` VARCHAR(500) NULL,
    `revisado_por_id` INTEGER NULL,
    `revisado_en` DATETIME(3) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_delegacion_pagos_delegacion`(`delegacion_id`),
    INDEX `idx_delegacion_pagos_revisado_por`(`revisado_por_id`),
    UNIQUE INDEX `uq_delegacion_pagos_evento_numero_operacion`(`evento_id`, `numero_operacion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delegacion_pagos` ADD CONSTRAINT `fk_delegacion_pagos_delegacion` FOREIGN KEY (`delegacion_id`) REFERENCES `delegaciones`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `delegacion_pagos` ADD CONSTRAINT `fk_delegacion_pagos_revisado_por` FOREIGN KEY (`revisado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `eventos`
    ADD COLUMN `delegaciones_min_integrantes` INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN `delegaciones_precio_estandar` DECIMAL(10, 2) NOT NULL DEFAULT 60.00,
    ADD COLUMN `delegaciones_precio_promocional` DECIMAL(10, 2) NOT NULL DEFAULT 50.00;
