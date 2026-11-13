-- ============================================================================
-- Spec 046 — Puerto SMTP de las credenciales de Gmail
-- Solo agrega una columna NULL (aditiva):
--   · credenciales_correo.smtp_puerto: 465 (SSL) o 587 (STARTTLS); NULL = 465, lo de antes.
--     Si el puerto elegido no conecta, el servidor prueba el otro. Brevo la deja en NULL.
-- ============================================================================

ALTER TABLE `credenciales_correo`
    ADD COLUMN `smtp_puerto` INTEGER NULL AFTER `remitente_nombre`;
