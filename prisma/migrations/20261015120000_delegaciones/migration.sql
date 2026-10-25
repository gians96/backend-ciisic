-- ============================================================================
-- Spec 018 — Delegaciones e inscripción manual del staff
-- 1) `delegaciones`: grupos de participantes por evento (salón, ciclo u otro) con delegado
--    (participante responsable) y borrado lógico (`activo`).
-- 2) `inscripciones.delegacion_id`: vínculo opcional de una inscripción (creada por el staff
--    con `POST /v1/events/:eventId/manual-inscriptions`) a su delegación.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema (no lee estas tablas
-- ni la columna nueva, que admite NULL). Al borrar una delegación sus inscripciones quedan
-- desvinculadas (ON DELETE SET NULL); al borrar el evento, sus delegaciones se borran en cascada.
-- Si falla: `prisma migrate resolve --rolled-back 20261015120000_delegaciones` y volver a
-- desplegar. Verificación: `npx prisma migrate diff --from-migrations prisma/migrations
--   --to-schema-datamodel prisma/schema.prisma --shadow-database-url <shadow> --exit-code`
-- ============================================================================

CREATE TABLE `delegaciones` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `tipo` ENUM('SALON', 'CICLO', 'OTRO') NOT NULL DEFAULT 'OTRO',
    `abreviatura` VARCHAR(20) NULL,
    `delegado_id` INTEGER NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_delegaciones_evento_nombre`(`evento_id`, `nombre`),
    INDEX `idx_delegaciones_evento`(`evento_id`),
    INDEX `idx_delegaciones_delegado`(`delegado_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `delegaciones` ADD CONSTRAINT `fk_delegaciones_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `delegaciones` ADD CONSTRAINT `fk_delegaciones_delegado` FOREIGN KEY (`delegado_id`) REFERENCES `participantes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Vínculo de la inscripción con su delegación (NULL en todas las filas existentes)
ALTER TABLE `inscripciones` ADD COLUMN `delegacion_id` INTEGER NULL;
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_delegacion` FOREIGN KEY (`delegacion_id`) REFERENCES `delegaciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX `idx_inscripciones_delegacion` ON `inscripciones`(`delegacion_id`);
