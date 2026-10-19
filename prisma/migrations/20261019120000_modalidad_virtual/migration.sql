-- ============================================================================
-- Spec 018 · Modalidad de asistencia (presencial / virtual)
-- Cada tipo de inscripción dice cómo se asiste: PRESENCIAL (todo lo existente) o VIRTUAL.
-- Los tipos existentes quedan en PRESENCIAL: nada cambia hasta que se cree o edite un tipo virtual.
-- No es la modalidad de pago (`inscripciones.modalidad_pago`: banco, billetera, cortesía).
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema (no lee la columna y el
-- valor por defecto cubre sus inserciones). No se borra ni se modifica ningún dato.
-- Para revertir: ALTER TABLE `tipos_inscripcion` DROP COLUMN `modalidad`; y
-- `prisma migrate resolve --rolled-back 20261019120000_modalidad_virtual`.
-- ============================================================================

ALTER TABLE `tipos_inscripcion` ADD COLUMN `modalidad` ENUM('PRESENCIAL', 'VIRTUAL') NOT NULL DEFAULT 'PRESENCIAL';
