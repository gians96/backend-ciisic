-- ============================================================================
-- Spec 010 · Administradores solo con Google
-- La contraseña pasa a ser opcional: un administrador sin contraseña (NULL) entra únicamente
-- con «Continuar con Google» usando su correo. Los existentes conservan la suya.
-- ============================================================================

ALTER TABLE `administradores` MODIFY `contrasena_hash` VARCHAR(191) NULL;
