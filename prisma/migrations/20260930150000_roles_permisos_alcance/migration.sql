-- ============================================================================
-- Spec 013 · Roles, permisos y alcance por evento
-- Roles TESORERO y COMISION. SUPERADMIN y ADMIN conservan su código (el código y los JWT vivos
-- lo usan) y solo cambian su nombre visible: «Owner» y «Administrador del sistema».
-- Eventos asignados y permisos elegidos por cuenta, y auditoría y anulación lógica de asistencias.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema.
-- Si falla a medias: prisma/preflight/revertir-013.sql y
-- `prisma migrate resolve --rolled-back 20260930150000_roles_permisos_alcance`.
-- ============================================================================

-- Asistencias: quién la registró, cómo, si fue fuera de horario y anulación lógica
ALTER TABLE `asistencias` ADD COLUMN `anulado_en` DATETIME(3) NULL,
    ADD COLUMN `anulado_por_id` INTEGER NULL,
    ADD COLUMN `es_fuera_de_horario` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `metodo` ENUM('QR', 'QR_LEGADO', 'DOCUMENTO', 'MANUAL') NULL,
    ADD COLUMN `registrado_por_id` INTEGER NULL;

-- Eventos asignados a cuentas con alcance por evento (Tesorero, Comisión)
CREATE TABLE `asignaciones_evento` (
    `administrador_id` INTEGER NOT NULL,
    `evento_id` INTEGER NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_asignaciones_evento_evento`(`evento_id`),
    PRIMARY KEY (`administrador_id`, `evento_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Permisos elegidos para cada cuenta de la Comisión (códigos de src/core/permisos.ts)
CREATE TABLE `permisos_administrador` (
    `administrador_id` INTEGER NOT NULL,
    `permiso` VARCHAR(60) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`administrador_id`, `permiso`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `idx_asistencias_registrado_por` ON `asistencias`(`registrado_por_id`);
CREATE INDEX `idx_asistencias_anulado_por` ON `asistencias`(`anulado_por_id`);

ALTER TABLE `asignaciones_evento` ADD CONSTRAINT `fk_asignaciones_evento_administrador` FOREIGN KEY (`administrador_id`) REFERENCES `administradores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `asignaciones_evento` ADD CONSTRAINT `fk_asignaciones_evento_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `permisos_administrador` ADD CONSTRAINT `fk_permisos_administrador_administrador` FOREIGN KEY (`administrador_id`) REFERENCES `administradores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_registrado_por` FOREIGN KEY (`registrado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_anulado_por` FOREIGN KEY (`anulado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Roles: nombres visibles nuevos y roles con alcance por evento (idempotente, por código)
UPDATE `roles` SET `nombre` = 'Owner' WHERE `codigo` = 'SUPERADMIN';
UPDATE `roles` SET `nombre` = 'Administrador del sistema' WHERE `codigo` = 'ADMIN';
INSERT INTO `roles` (`codigo`, `nombre`) VALUES ('TESORERO', 'Tesorero'), ('COMISION', 'Comisión tecnológica')
    ON DUPLICATE KEY UPDATE `nombre` = VALUES(`nombre`);
