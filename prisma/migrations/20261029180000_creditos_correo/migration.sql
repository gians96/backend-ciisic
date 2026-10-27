-- ============================================================================
-- Spec 042 · Créditos de envío de cada credencial de correo
-- Brevo informa cuántos envíos le quedan a la cuenta (`/account`). Se guardan para no intentar
-- con una cuenta sin créditos y para mostrar en el panel quién puede enviar. NULL = no se sabe
-- (nunca se revisó, o es Gmail, que no lo informa). Migración aditiva, sin tocar los datos.
-- ============================================================================

ALTER TABLE `credenciales_correo`
    ADD COLUMN `creditos_disponibles` INTEGER NULL AFTER `prioridad`,
    ADD COLUMN `creditos_verificados_en` DATETIME(3) NULL AFTER `creditos_disponibles`;
