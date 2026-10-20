-- ============================================================================
-- Spec 020 · Tipos de inscripción que no admiten estudiantes UNDC
-- Cada tipo puede excluir a los estudiantes de la UNDC (estudiante verificado con SIVIRENO o correo
-- institucional con parte local numérica). Se usa en los planes virtuales: los estudiantes UNDC asisten
-- de forma presencial; docentes, administrativos y externos pueden ser virtuales.
-- Los tipos existentes quedan en 0 (los admiten): nada cambia hasta que se encienda el interruptor.
-- Es una columna aparte y no un valor nuevo de `disponible_para`: la imagen anterior sigue funcionando
-- con este esquema (no lee la columna, el valor por defecto cubre sus inserciones y un valor de enum
-- desconocido le haría fallar la lectura del tipo). No se borra ni se modifica ningún dato.
-- Para revertir: ALTER TABLE `tipos_inscripcion` DROP COLUMN `excluye_estudiantes_undc`; y
-- `prisma migrate resolve --rolled-back 20261021120000_excluye_estudiantes_undc`.
-- ============================================================================

ALTER TABLE `tipos_inscripcion` ADD COLUMN `excluye_estudiantes_undc` BOOLEAN NOT NULL DEFAULT false;
