-- ============================================================================
-- Seguimiento por asesor (spec 025)
-- Tres tablas nuevas y aditivas: nada de lo existente cambia.
--  1) `asesores`: docentes que acompañan secciones de estudiantes (por evento).
--  2) `asesores_secciones`: ciclo y sección que atiende cada asesor (una sección puede tener varios).
--  3) `padron_estudiantes`: estudiantes del semestre que sigue cada asesor. El pago NO se guarda:
--     se cruza en cada consulta con `inscripciones` (documento, código de estudiante o correo).
-- Para revertir: DROP TABLE `asesores_secciones`, `asesores`, `padron_estudiantes` (en ese orden)
--   y `prisma migrate resolve --rolled-back 20261023120000_seguimiento_asesores`.
-- ============================================================================

-- CreateTable
CREATE TABLE `asesores` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `nombre` VARCHAR(200) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_asesores_evento_nombre`(`evento_id`, `nombre`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asesores_secciones` (
    `asesor_id` INTEGER NOT NULL,
    `evento_id` INTEGER NOT NULL,
    `ciclo` VARCHAR(10) NOT NULL,
    `seccion` VARCHAR(10) NOT NULL,

    INDEX `idx_asesores_secciones_evento_seccion`(`evento_id`, `ciclo`, `seccion`),
    PRIMARY KEY (`asesor_id`, `ciclo`, `seccion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `padron_estudiantes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `semestre` VARCHAR(10) NOT NULL,
    `documento` VARCHAR(20) NOT NULL,
    `codigo` VARCHAR(20) NOT NULL,
    `correo` VARCHAR(191) NULL,
    `nombre` VARCHAR(200) NOT NULL,
    `celular` VARCHAR(20) NULL,
    `carrera` VARCHAR(120) NOT NULL,
    `ciclo` VARCHAR(10) NOT NULL,
    `turno` VARCHAR(5) NULL,
    `seccion` VARCHAR(10) NOT NULL,
    `distrito` VARCHAR(80) NULL,
    `provincia` VARCHAR(80) NULL,
    `departamento` VARCHAR(80) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_padron_estudiantes_evento_seccion`(`evento_id`, `ciclo`, `seccion`),
    INDEX `idx_padron_estudiantes_evento_documento`(`evento_id`, `documento`),
    UNIQUE INDEX `uq_padron_estudiantes_evento_codigo`(`evento_id`, `codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `asesores` ADD CONSTRAINT `fk_asesores_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asesores_secciones` ADD CONSTRAINT `fk_asesores_secciones_asesor` FOREIGN KEY (`asesor_id`) REFERENCES `asesores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `padron_estudiantes` ADD CONSTRAINT `fk_padron_estudiantes_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
