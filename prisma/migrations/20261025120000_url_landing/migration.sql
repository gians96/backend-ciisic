-- ============================================================================
-- Spec 020 — URL de la landing en la configuración del sistema
-- Para que el correo de aprobación pueda enlazar la credencial 3D
-- (https://<landing>/credencial/<codigo>). Igual que url_panel: origen sin ruta.
-- ============================================================================

ALTER TABLE `configuracion_sistema` ADD COLUMN `url_landing` VARCHAR(255) NULL AFTER `url_panel`;
