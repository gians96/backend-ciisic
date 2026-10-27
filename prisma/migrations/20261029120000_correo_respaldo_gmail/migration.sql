-- ============================================================================
-- Spec 041 · Respaldo entre credenciales de correo y SMTP de Gmail
-- Se agrega el proveedor GMAIL_SMTP (la contraseña de aplicación se guarda cifrada en la misma
-- columna que la API key de Brevo) y la prioridad con la que se prueban las credenciales cuando
-- una falla o se queda sin créditos. Migración aditiva: backend primero, sin tocar los datos.
-- ============================================================================

ALTER TABLE `credenciales_correo`
    MODIFY `proveedor` ENUM('BREVO', 'GMAIL_SMTP') NOT NULL DEFAULT 'BREVO',
    ADD COLUMN `prioridad` INTEGER NOT NULL DEFAULT 0 AFTER `es_predeterminada`;

-- El orden actual se conserva: la predeterminada primero y las demás por antigüedad.
UPDATE `credenciales_correo` SET `prioridad` = `id`;
UPDATE `credenciales_correo` SET `prioridad` = 0 WHERE `es_predeterminada` = true;
