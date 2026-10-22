-- ─────────────────────────────────────────────────────────────────────────────
-- Spec 031 · Resumen por persona de las ponencias especializadas, cancelación y comunicado
-- Solo agrega un valor al enum de motivos de cancelación y una columna nula: no cambia ningún dato.
--
-- `motivo_cancelacion = 'SIN_CONGRESO'`: la cancelación que hace el staff desde el resumen porque la persona no está
-- inscrita al congreso con el pago aprobado. `aviso_enviado_en`: cuándo se le envió el comunicado por correo.
--
-- Para revertir: ALTER TABLE `inscripciones_ponencia` DROP COLUMN `aviso_enviado_en`, MODIFY `motivo_cancelacion`
-- ENUM('STAFF', 'CAMBIO_EN_PUERTA') NULL (antes pasa a STAFF lo que sea SIN_CONGRESO); y
-- `prisma migrate resolve --rolled-back 20261024150000_ponencias_resumen_aviso`.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE `inscripciones_ponencia`
    MODIFY `motivo_cancelacion` ENUM('STAFF', 'CAMBIO_EN_PUERTA', 'SIN_CONGRESO') NULL,
    ADD COLUMN `aviso_enviado_en` DATETIME(3) NULL;
