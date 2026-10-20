-- CreateTable
CREATE TABLE `ponencias_especializadas` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `tema` VARCHAR(300) NOT NULL,
    `fecha` DATE NOT NULL,
    `hora_inicio` DATETIME(3) NOT NULL,
    `hora_fin` DATETIME(3) NOT NULL,
    `ambiente` VARCHAR(120) NOT NULL,
    `modalidad` ENUM('PRESENCIAL', 'VIRTUAL') NOT NULL DEFAULT 'PRESENCIAL',
    `precio` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    `cupo` INTEGER NULL,
    `ponente_nombre` VARCHAR(200) NOT NULL,
    `ponente_bio` TEXT NULL,
    `ponente_foto` VARCHAR(255) NULL,
    `ponente_externo` BOOLEAN NOT NULL DEFAULT false,
    `publicada` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `idx_ponencias_especializadas_evento_fecha`(`evento_id`, `fecha`, `hora_inicio`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `asistentes_ponencia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `tipo_documento_id` VARCHAR(191) NOT NULL,
    `numero_documento` VARCHAR(20) NOT NULL,
    `nombres` VARCHAR(120) NOT NULL,
    `apellidos` VARCHAR(120) NOT NULL,
    `correo` VARCHAR(191) NULL,
    `celular` VARCHAR(20) NULL,
    `procedencia` ENUM('INTERNO', 'EXTERNO') NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uq_asistentes_ponencia_documento`(`tipo_documento_id`, `numero_documento`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inscripciones_ponencia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ponencia_id` INTEGER NOT NULL,
    `asistente_id` INTEGER NOT NULL,
    `estado` ENUM('INSCRITO', 'CANCELADO') NOT NULL DEFAULT 'INSCRITO',
    `origen` ENUM('LANDING', 'STAFF', 'PUERTA') NOT NULL,
    `registrado_por_id` INTEGER NULL,
    `asistio_en` DATETIME(3) NULL,
    `asistencia_por_id` INTEGER NULL,
    `es_fuera_de_horario` BOOLEAN NOT NULL DEFAULT false,
    `cancelado_en` DATETIME(3) NULL,
    `motivo_cancelacion` ENUM('STAFF', 'CAMBIO_EN_PUERTA') NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,

    INDEX `idx_inscripciones_ponencia_asistente`(`asistente_id`),
    INDEX `idx_inscripciones_ponencia_registrado_por`(`registrado_por_id`),
    INDEX `idx_inscripciones_ponencia_asistencia_por`(`asistencia_por_id`),
    UNIQUE INDEX `uq_inscripciones_ponencia_asistente`(`ponencia_id`, `asistente_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ponencias_especializadas` ADD CONSTRAINT `fk_ponencias_especializadas_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `asistentes_ponencia` ADD CONSTRAINT `fk_asistentes_ponencia_tipo_documento` FOREIGN KEY (`tipo_documento_id`) REFERENCES `tipos_documento`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inscripciones_ponencia` ADD CONSTRAINT `fk_inscripciones_ponencia_ponencia` FOREIGN KEY (`ponencia_id`) REFERENCES `ponencias_especializadas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inscripciones_ponencia` ADD CONSTRAINT `fk_inscripciones_ponencia_asistente` FOREIGN KEY (`asistente_id`) REFERENCES `asistentes_ponencia`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inscripciones_ponencia` ADD CONSTRAINT `fk_inscripciones_ponencia_registrado_por` FOREIGN KEY (`registrado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inscripciones_ponencia` ADD CONSTRAINT `fk_inscripciones_ponencia_asistencia_por` FOREIGN KEY (`asistencia_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
