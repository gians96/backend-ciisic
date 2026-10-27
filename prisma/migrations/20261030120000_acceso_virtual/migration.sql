-- ============================================================================
-- Spec 043 — Enlace de acceso al congreso para los inscritos virtuales
-- Solo agrega una columna NULL (aditiva):
--   · inscripciones.enlace_virtual_enviado_en: marca del envío masivo del enlace de acceso,
--     para volver a elegir solo a quien aún no lo recibió (igual que las marcas de la spec 039).
-- ============================================================================

ALTER TABLE `inscripciones`
    ADD COLUMN `enlace_virtual_enviado_en` DATETIME(3) NULL AFTER `enlace_ponencias_enviado_en`;
