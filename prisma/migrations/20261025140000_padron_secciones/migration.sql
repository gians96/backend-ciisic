-- ─────────────────────────────────────────────────────────────────────────────
-- Spec 033 · Secciones del curso en el padrón de seguimiento
-- Un estudiante puede cursar en varias secciones (la sección va ligada al curso): `padron_secciones` guarda cada una.
-- Es aditiva y **rellena** la tabla con la sección que ya tiene cada estudiante (una fila, `cursos = 1`), así que al
-- desplegar el seguimiento queda igual hasta que se cargue el padrón con las secciones reales (`npm run padron:desde-jp`).
-- `padron_estudiantes.ciclo/turno/seccion` se conservan como la sección principal.
--
-- Para revertir: DROP TABLE `padron_secciones`; y `prisma migrate resolve --rolled-back 20261025140000_padron_secciones`.
-- ─────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE `padron_secciones` (
    `evento_id` INTEGER NOT NULL,
    `codigo` VARCHAR(20) NOT NULL,
    `ciclo` VARCHAR(10) NOT NULL,
    `seccion` VARCHAR(10) NOT NULL,
    `turno` VARCHAR(5) NULL,
    `cursos` INTEGER NOT NULL DEFAULT 1,

    INDEX `idx_padron_secciones_evento_seccion`(`evento_id`, `ciclo`, `seccion`),
    PRIMARY KEY (`evento_id`, `codigo`, `ciclo`, `seccion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `padron_secciones` ADD CONSTRAINT `fk_padron_secciones_estudiante` FOREIGN KEY (`evento_id`, `codigo`) REFERENCES `padron_estudiantes`(`evento_id`, `codigo`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Datos: la sección que cada estudiante ya tenía
INSERT INTO `padron_secciones` (`evento_id`, `codigo`, `ciclo`, `seccion`, `turno`, `cursos`)
SELECT `evento_id`, `codigo`, `ciclo`, `seccion`, `turno`, 1 FROM `padron_estudiantes`;
