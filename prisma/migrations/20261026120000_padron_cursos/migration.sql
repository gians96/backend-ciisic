-- ─────────────────────────────────────────────────────────────────────────────
-- Spec 034 · Seguimiento por curso y docente según SIVIRENO
-- Aditiva: no cambia ningún dato. Agrega los cursos de la programación académica (`padron_cursos`), las matrículas de los
-- estudiantes del padrón en ellos (`padron_matriculas`) y el `id_docente` de SIVIRENO en cada docente (`asesores.jp_docente_id`).
-- Hasta cargarlos con `npm run padron:desde-jp` el seguimiento funciona como hasta ahora (sin cursos).
--
-- Para revertir: DROP TABLE `padron_matriculas`, `padron_cursos` (en ese orden);
-- ALTER TABLE `asesores` DROP INDEX `uq_asesores_evento_jp_docente`, DROP COLUMN `jp_docente_id`;
-- y `prisma migrate resolve --rolled-back 20261026120000_padron_cursos`.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE `asesores` ADD COLUMN `jp_docente_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `padron_cursos` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `jp_carga_id` INTEGER NOT NULL,
    `codigo` VARCHAR(30) NOT NULL,
    `nombre` VARCHAR(200) NOT NULL,
    `ciclo` VARCHAR(10) NOT NULL,
    `turno` VARCHAR(5) NULL,
    `seccion` VARCHAR(10) NOT NULL,
    `asesor_id` INTEGER NULL,
    `docente_nombre` VARCHAR(200) NULL,

    INDEX `idx_padron_cursos_evento_seccion`(`evento_id`, `ciclo`, `seccion`),
    INDEX `idx_padron_cursos_asesor`(`asesor_id`),
    UNIQUE INDEX `uq_padron_cursos_evento_carga`(`evento_id`, `jp_carga_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `padron_matriculas` (
    `evento_id` INTEGER NOT NULL,
    `codigo` VARCHAR(20) NOT NULL,
    `curso_id` INTEGER NOT NULL,

    INDEX `idx_padron_matriculas_curso`(`curso_id`),
    PRIMARY KEY (`evento_id`, `codigo`, `curso_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `uq_asesores_evento_jp_docente` ON `asesores`(`evento_id`, `jp_docente_id`);

-- AddForeignKey
ALTER TABLE `padron_cursos` ADD CONSTRAINT `fk_padron_cursos_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `padron_cursos` ADD CONSTRAINT `fk_padron_cursos_asesor` FOREIGN KEY (`asesor_id`) REFERENCES `asesores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `padron_matriculas` ADD CONSTRAINT `fk_padron_matriculas_estudiante` FOREIGN KEY (`evento_id`, `codigo`) REFERENCES `padron_estudiantes`(`evento_id`, `codigo`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `padron_matriculas` ADD CONSTRAINT `fk_padron_matriculas_curso` FOREIGN KEY (`curso_id`) REFERENCES `padron_cursos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
