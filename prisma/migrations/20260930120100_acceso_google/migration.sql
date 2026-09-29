-- ============================================================================
-- Spec 010 · Acceso con Google
-- `google_sub` vincula la cuenta Google (identificador estable) al administrador o al
-- participante en su primer ingreso; se limpia si cambia el correo. La inscripción guarda si
-- el correo se verificó con Google (instantánea en `verificacion_correo`).
-- ============================================================================

ALTER TABLE `administradores`
    ADD COLUMN `google_sub` VARCHAR(255) NULL,
    ADD COLUMN `google_vinculado_en` DATETIME(3) NULL;
CREATE UNIQUE INDEX `uq_administradores_google_sub` ON `administradores`(`google_sub`);

ALTER TABLE `participantes`
    ADD COLUMN `google_sub` VARCHAR(255) NULL,
    ADD COLUMN `google_vinculado_en` DATETIME(3) NULL;
CREATE UNIQUE INDEX `uq_participantes_google_sub` ON `participantes`(`google_sub`);

ALTER TABLE `inscripciones`
    ADD COLUMN `es_correo_verificado` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `verificacion_correo` JSON NULL;
