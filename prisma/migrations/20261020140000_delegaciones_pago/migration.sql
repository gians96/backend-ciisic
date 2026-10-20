-- ============================================================================
-- Delegaciones · pago conjunto del grupo (spec 018)
-- 1) `delegaciones` gana los datos del pago: una delegación paga **una vez** por todo el grupo
--    (un solo voucher y un solo número de operación), así que no caben en `inscripciones`, donde
--    `numero_operacion` es único por inscripción y `voucher_archivo` es por persona.
-- 2) `uq_delegaciones_evento_numero_operacion`: dos delegaciones del mismo evento no pueden
--    compartir el código de un mismo pago (MySQL admite varios NULL, así que las delegaciones
--    sin pagar no se bloquean entre sí).
-- 3) `monto_total_pagado`: lo que se pagó por el grupo. Lo calcula el backend; nunca lo envía
--    el cliente.
-- 4) `eventos.delegaciones_*`: la tarifa por defecto de las delegaciones del evento. Cada
--    delegación la copia al crearse, así un cambio de precio no altera lo ya cobrado.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema (no lee las columnas y
-- sus inserciones las dejan en NULL/0).
-- Para revertir: ALTER TABLE `delegaciones` DROP INDEX `uq_delegaciones_evento_numero_operacion`,
--   DROP COLUMN `monto_total_pagado`, DROP COLUMN `voucher_archivo`, DROP COLUMN `fecha_pago`,
--   DROP COLUMN `numero_operacion`, DROP COLUMN `tipo_operacion`, DROP COLUMN `billetera_digital`,
--   DROP COLUMN `banco`, DROP COLUMN `modalidad_pago`;
--   ALTER TABLE `eventos` DROP COLUMN `delegaciones_precio_promocional`,
--   DROP COLUMN `delegaciones_precio_estandar`, DROP COLUMN `delegaciones_min_integrantes`;
--   y `prisma migrate resolve --rolled-back 20261020140000_delegaciones_pago`.
-- ============================================================================

ALTER TABLE `delegaciones`
    ADD COLUMN `modalidad_pago` VARCHAR(40) NULL,
    ADD COLUMN `banco` VARCHAR(40) NULL,
    ADD COLUMN `billetera_digital` VARCHAR(40) NULL,
    ADD COLUMN `tipo_operacion` VARCHAR(40) NULL,
    ADD COLUMN `numero_operacion` VARCHAR(100) NULL,
    ADD COLUMN `fecha_pago` DATETIME(3) NULL,
    ADD COLUMN `voucher_archivo` VARCHAR(191) NULL,
    ADD COLUMN `monto_total_pagado` DECIMAL(10, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE `delegaciones` ADD UNIQUE INDEX `uq_delegaciones_evento_numero_operacion`(`evento_id`, `numero_operacion`);

ALTER TABLE `eventos`
    ADD COLUMN `delegaciones_min_integrantes` INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN `delegaciones_precio_estandar` DECIMAL(10, 2) NOT NULL DEFAULT 60.00,
    ADD COLUMN `delegaciones_precio_promocional` DECIMAL(10, 2) NOT NULL DEFAULT 50.00;
