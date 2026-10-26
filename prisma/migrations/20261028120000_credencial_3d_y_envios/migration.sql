-- ============================================================================
-- Specs 038 y 039 — Credencial 3D con enlace y envíos masivos a inscritos
-- Solo agrega columnas NULL (aditiva):
--   · configuracion_sistema.url_landing: origen de la landing, de donde salen los enlaces
--     (https://<landing>/credencial/<codigo> y /inscripcion-ponencias). Igual que url_panel.
--   · inscripciones.tecnologias_credencial: tecnologías que la persona elige en su credencial 3D.
--   · inscripciones.enlace_credencial_enviado_en / enlace_ponencias_enviado_en: marca de los
--     envíos masivos, para volver a elegir solo a quien aún no lo recibió.
-- ============================================================================

ALTER TABLE `configuracion_sistema` ADD COLUMN `url_landing` VARCHAR(255) NULL AFTER `url_panel`;

ALTER TABLE `inscripciones`
    ADD COLUMN `enlace_credencial_enviado_en` DATETIME(3) NULL AFTER `credencial_enviada_en`,
    ADD COLUMN `enlace_ponencias_enviado_en` DATETIME(3) NULL AFTER `enlace_credencial_enviado_en`,
    ADD COLUMN `tecnologias_credencial` JSON NULL AFTER `enlace_ponencias_enviado_en`;
