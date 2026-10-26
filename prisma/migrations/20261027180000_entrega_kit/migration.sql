-- ============================================================================
-- Spec 037 · Entrega del kit en la puerta
-- Cambio aditivo: nada de lo existente se borra ni se modifica, salvo el relleno de `incluye_kit` de más abajo.
--  - `tipos_inscripcion.incluye_kit`: el tipo incluye el kit de merchandising. Antes solo lo decía el texto de la etiqueta
--    («CON KIT») o del código (`estudiantes_con_kit`); ahora es una bandera que el editor de tipos puede cambiar.
--  - `inscripciones.kit_entregado_en` y `kit_entregado_por_id`: cuándo y quién entregó el kit (uno por persona y congreso).
--    NULL = aún no se entrega; deshacer la entrega las limpia. Si se borra la cuenta de quien lo entregó queda sin autor (SET NULL).
-- Relleno de `incluye_kit`: solo tipos PRESENCIALES cuyo código termina en `_con_kit` (estudiantes, público general, FI UNDC y el
-- plan `delegacion_con_kit` de cada delegación) o cuya etiqueta es «CON KIT». Todo lo demás queda en 0 (sin kit); un tipo
-- virtual nunca lleva kit. Se revisa con `prisma/preflight/verificar-kit.sql` y se ajusta desde el editor de tipos.
-- Para revertir: ALTER TABLE `inscripciones` DROP FOREIGN KEY `fk_inscripciones_kit_entregado_por`,
--   DROP COLUMN `kit_entregado_en`, DROP COLUMN `kit_entregado_por_id`; ALTER TABLE `tipos_inscripcion` DROP COLUMN `incluye_kit`;
--   y `prisma migrate resolve --rolled-back 20261027180000_entrega_kit`.
-- ============================================================================

-- AlterTable
ALTER TABLE `tipos_inscripcion` ADD COLUMN `incluye_kit` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `inscripciones` ADD COLUMN `kit_entregado_en` DATETIME(3) NULL,
    ADD COLUMN `kit_entregado_por_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `idx_inscripciones_kit_entregado_por` ON `inscripciones`(`kit_entregado_por_id`);

-- AddForeignKey
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_kit_entregado_por` FOREIGN KEY (`kit_entregado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Relleno: los tipos presenciales «con kit»
UPDATE `tipos_inscripcion`
SET `incluye_kit` = true
WHERE `modalidad` = 'PRESENCIAL'
  AND (`codigo` LIKE '%\_con\_kit' OR UPPER(TRIM(`etiqueta`)) = 'CON KIT');
