-- ============================================================================
-- Spec 004 · Verificación de estudiantes UNDC en las inscripciones
-- ============================================================================

ALTER TABLE `inscripciones`
    ADD COLUMN `es_estudiante_undc` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `codigo_estudiante` VARCHAR(20) NULL,
    ADD COLUMN `verificacion_estudiante` JSON NULL;
