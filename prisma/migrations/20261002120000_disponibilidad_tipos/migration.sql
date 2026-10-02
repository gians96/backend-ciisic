-- ============================================================================
-- Spec 016 · Disponibilidad de los tipos de inscripción
-- Cada tipo dice a quién se ofrece: TODOS (como hasta ahora), INSTITUCIONAL (solo a quien recibe el
-- precio institucional: estudiante UNDC verificado o correo del dominio) o EXTERNOS (nunca a ellos).
-- Los tipos existentes quedan en TODOS: nada cambia hasta que el panel elija otro valor.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema (no lee la columna y el
-- valor por defecto cubre sus inserciones).
-- Para revertir: ALTER TABLE `tipos_inscripcion` DROP COLUMN `disponible_para`; y
-- `prisma migrate resolve --rolled-back 20261002120000_disponibilidad_tipos`.
-- ============================================================================

ALTER TABLE `tipos_inscripcion` ADD COLUMN `disponible_para` ENUM('TODOS', 'INSTITUCIONAL', 'EXTERNOS') NOT NULL DEFAULT 'TODOS';
