-- ============================================================================
-- Spec 001 · Esquema de base de datos legible en español (renombrado in-place)
-- ----------------------------------------------------------------------------
-- NO borra tablas ni datos. La única columna eliminada es `Usuario.dni`, cuyo valor
-- se copia antes a `numero_documento`.
-- ANTES de aplicarla en producción: respaldo completo + prisma/preflight/verificar-esquema.sql
-- (runbook en specs/001-esquema-bd-espanol/plan.md).
-- ============================================================================

-- 1) Quitar claves foráneas (se recrean al final con nombres nuevos)
ALTER TABLE `Administradores` DROP FOREIGN KEY `Administradores_rolId_fkey`;
ALTER TABLE `Usuario` DROP FOREIGN KEY `Usuario_idTipoDocumentoId_fkey`;
ALTER TABLE `TipoInscripcion` DROP FOREIGN KEY `TipoInscripcion_tipoPlanId_fkey`;
ALTER TABLE `Inscripcion` DROP FOREIGN KEY `Inscripcion_usuarioId_fkey`;
ALTER TABLE `Inscripcion` DROP FOREIGN KEY `Inscripcion_tipoInscripcionId_fkey`;
ALTER TABLE `Inscripcion` DROP FOREIGN KEY `Inscripcion_clasificacionId_fkey`;
ALTER TABLE `Inscripcion` DROP FOREIGN KEY `Inscripcion_estadoId_fkey`;
ALTER TABLE `Asistencia` DROP FOREIGN KEY `Asistencia_id_evento_fkey`;
ALTER TABLE `Asistencia` DROP FOREIGN KEY `Asistencia_id_usuario_fkey`;

-- 2) Renombrar tablas (las que solo cambian mayúsculas pasan por un nombre temporal
--    para funcionar también con lower_case_table_names=1)
RENAME TABLE
    `Administradores` TO `_tmp_administradores`,
    `_tmp_administradores` TO `administradores`,
    `Roles` TO `_tmp_roles`,
    `_tmp_roles` TO `roles`,
    `Usuario` TO `participantes`,
    `TipoDocumento` TO `tipos_documento`,
    `TipoPlanInscripcion` TO `categorias_inscripcion`,
    `TipoInscripcion` TO `tipos_inscripcion`,
    `Clasificacion` TO `clasificaciones`,
    `EstadoInscripcion` TO `estados_inscripcion`,
    `Inscripcion` TO `inscripciones`,
    `Contact` TO `mensajes_contacto`,
    `Evento` TO `actividades`,
    `Asistencia` TO `asistencias`,
    `PaperSubmission` TO `ponencias`;

-- 3) administradores
ALTER TABLE `administradores`
    RENAME COLUMN `correoElectronico` TO `correo`,
    RENAME COLUMN `contrasena` TO `contrasena_hash`,
    RENAME COLUMN `creadoEn` TO `creado_en`,
    RENAME COLUMN `actualizadoEn` TO `actualizado_en`,
    RENAME COLUMN `rolId` TO `rol_id`;
ALTER TABLE `administradores`
    RENAME INDEX `Administradores_correoElectronico_key` TO `uq_administradores_correo`,
    RENAME INDEX `Administradores_rolId_fkey` TO `idx_administradores_rol`;

-- 4) roles: código estable
ALTER TABLE `roles` ADD COLUMN `codigo` VARCHAR(30) NULL AFTER `id`;
UPDATE `roles` SET `codigo` = CASE `id` WHEN 1 THEN 'SUPERADMIN' WHEN 2 THEN 'ADMIN' ELSE CONCAT('ROL_', `id`) END;
ALTER TABLE `roles` MODIFY `codigo` VARCHAR(30) NOT NULL;
ALTER TABLE `roles` ADD UNIQUE INDEX `uq_roles_codigo` (`codigo`);

-- 5) participantes (ex Usuario): documento único por tipo
ALTER TABLE `participantes`
    RENAME COLUMN `correoElectronico` TO `correo`,
    RENAME COLUMN `creadoEn` TO `creado_en`,
    RENAME COLUMN `actualizadoEn` TO `actualizado_en`,
    RENAME COLUMN `idTipoDocumentoId` TO `tipo_documento_id`,
    RENAME COLUMN `numero` TO `numero_documento`;
UPDATE `participantes` SET `numero_documento` = `dni`;
UPDATE `participantes` SET `tipo_documento_id` = 'dni' WHERE `tipo_documento_id` IS NULL OR `tipo_documento_id` = '';
ALTER TABLE `participantes`
    DROP INDEX `Usuario_dni_key`,
    DROP INDEX `Usuario_numero_key`,
    DROP INDEX `Usuario_idTipoDocumentoId_fkey`,
    DROP COLUMN `dni`;
ALTER TABLE `participantes`
    MODIFY `tipo_documento_id` VARCHAR(191) NOT NULL,
    MODIFY `numero_documento` VARCHAR(20) NOT NULL,
    MODIFY `celular` VARCHAR(20) NOT NULL;
ALTER TABLE `participantes`
    RENAME INDEX `Usuario_correoElectronico_key` TO `uq_participantes_correo`,
    ADD UNIQUE INDEX `uq_participantes_documento` (`tipo_documento_id`, `numero_documento`);

-- 6) tipos_documento
ALTER TABLE `tipos_documento` RENAME INDEX `TipoDocumento_abreviatura_key` TO `uq_tipos_documento_abreviatura`;

-- 7) categorias_inscripcion (ex TipoPlanInscripcion)
ALTER TABLE `categorias_inscripcion` CHANGE COLUMN `precioDesde` `precio_desde` DECIMAL(10, 2) NULL;
ALTER TABLE `categorias_inscripcion` RENAME INDEX `TipoPlanInscripcion_nombre_key` TO `uq_categorias_inscripcion_nombre`;

-- 8) tipos_inscripcion
ALTER TABLE `tipos_inscripcion`
    RENAME COLUMN `badge` TO `etiqueta`,
    RENAME COLUMN `value` TO `codigo`;
ALTER TABLE `tipos_inscripcion`
    CHANGE COLUMN `institutionalPrice` `precio_institucional` DECIMAL(10, 2) NOT NULL,
    CHANGE COLUMN `tipoPlanId` `categoria_id` INTEGER NOT NULL,
    MODIFY `precio` DECIMAL(10, 2) NOT NULL,
    MODIFY `descripcion` TEXT NULL;
ALTER TABLE `tipos_inscripcion` RENAME INDEX `TipoInscripcion_tipoPlanId_fkey` TO `idx_tipos_inscripcion_categoria`;

-- 9) estados_inscripcion: código estable
ALTER TABLE `estados_inscripcion` ADD COLUMN `codigo` VARCHAR(30) NULL AFTER `id`;
UPDATE `estados_inscripcion` SET `codigo` = CASE `id`
    WHEN 1 THEN 'PENDIENTE'
    WHEN 2 THEN 'APROBADO'
    WHEN 3 THEN 'RECHAZADO'
    WHEN 4 THEN 'EN_REVISION'
    WHEN 5 THEN 'CANCELADO'
    ELSE CONCAT('ESTADO_', `id`) END;
ALTER TABLE `estados_inscripcion` MODIFY `codigo` VARCHAR(30) NOT NULL;
ALTER TABLE `estados_inscripcion`
    ADD UNIQUE INDEX `uq_estados_inscripcion_codigo` (`codigo`),
    RENAME INDEX `EstadoInscripcion_nombre_key` TO `uq_estados_inscripcion_nombre`;

-- 10) inscripciones
ALTER TABLE `inscripciones`
    RENAME COLUMN `usuarioId` TO `participante_id`,
    RENAME COLUMN `tipoInscripcionId` TO `tipo_inscripcion_id`,
    RENAME COLUMN `clasificacionId` TO `clasificacion_id`,
    RENAME COLUMN `estadoId` TO `estado_id`,
    RENAME COLUMN `creadoEn` TO `creado_en`,
    RENAME COLUMN `actualizadoEn` TO `actualizado_en`,
    RENAME COLUMN `bancoSeleccionado` TO `banco`,
    RENAME COLUMN `billeteraDigital` TO `billetera_digital`,
    RENAME COLUMN `esEmailInstitucional` TO `es_correo_institucional`,
    RENAME COLUMN `fechaPago` TO `fecha_pago`,
    RENAME COLUMN `file` TO `voucher_archivo`,
    RENAME COLUMN `hasDiscount` TO `tiene_descuento`,
    RENAME COLUMN `modalidadDeposito` TO `modalidad_pago`,
    RENAME COLUMN `numeroOperacion` TO `numero_operacion`,
    RENAME COLUMN `tipoOperacion` TO `tipo_operacion`;
ALTER TABLE `inscripciones`
    CHANGE COLUMN `pago` `monto` DECIMAL(10, 2) NOT NULL,
    MODIFY `descuento` DECIMAL(10, 2) NOT NULL DEFAULT 0;
ALTER TABLE `inscripciones`
    RENAME INDEX `Inscripcion_numeroOperacion_key` TO `uq_inscripciones_numero_operacion`,
    RENAME INDEX `Inscripcion_usuarioId_fkey` TO `idx_inscripciones_participante`,
    RENAME INDEX `Inscripcion_tipoInscripcionId_fkey` TO `idx_inscripciones_tipo_inscripcion`,
    RENAME INDEX `Inscripcion_clasificacionId_fkey` TO `idx_inscripciones_clasificacion`,
    RENAME INDEX `Inscripcion_estadoId_fkey` TO `idx_inscripciones_estado`;

-- 11) mensajes_contacto (ex Contact)
ALTER TABLE `mensajes_contacto`
    RENAME COLUMN `firstName` TO `nombres`,
    RENAME COLUMN `lastName` TO `apellidos`,
    RENAME COLUMN `email` TO `correo`,
    RENAME COLUMN `subject` TO `asunto`,
    RENAME COLUMN `timestamp` TO `creado_en`;
ALTER TABLE `mensajes_contacto` CHANGE COLUMN `message` `mensaje` TEXT NOT NULL;

-- 12) actividades (ex Evento: sesiones de asistencia)
ALTER TABLE `actividades`
    RENAME COLUMN `hora_comienzo` TO `hora_inicio`,
    RENAME COLUMN `hora_termino` TO `hora_fin`;
ALTER TABLE `actividades` DROP INDEX `evento_pkey`;

-- 13) asistencias
ALTER TABLE `asistencias`
    RENAME COLUMN `dia_hora` TO `registrado_en`,
    RENAME COLUMN `id_usuario` TO `participante_id`,
    RENAME COLUMN `id_evento` TO `actividad_id`;
ALTER TABLE `asistencias`
    RENAME INDEX `uq_asistencia_persona_evento` TO `uq_asistencias_participante_actividad`,
    RENAME INDEX `idx_asistencia_evento` TO `idx_asistencias_actividad`;
ALTER TABLE `asistencias` DROP INDEX `idx_asistencia_id`;

-- 14) ponencias (ex PaperSubmission)
ALTER TABLE `ponencias`
    RENAME COLUMN `title` TO `titulo`,
    RENAME COLUMN `mainAuthor` TO `autor_principal`,
    RENAME COLUMN `coauthors` TO `coautores`,
    RENAME COLUMN `filename` TO `archivo`,
    RENAME COLUMN `originalFilename` TO `archivo_original`,
    RENAME COLUMN `size` TO `tamano_bytes`,
    RENAME COLUMN `createdAt` TO `creado_en`;
ALTER TABLE `ponencias` RENAME INDEX `PaperSubmission_createdAt_idx` TO `idx_ponencias_creado`;

-- 15) Recrear claves foráneas con nombres legibles
ALTER TABLE `administradores` ADD CONSTRAINT `fk_administradores_rol` FOREIGN KEY (`rol_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `participantes` ADD CONSTRAINT `fk_participantes_tipo_documento` FOREIGN KEY (`tipo_documento_id`) REFERENCES `tipos_documento`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `tipos_inscripcion` ADD CONSTRAINT `fk_tipos_inscripcion_categoria` FOREIGN KEY (`categoria_id`) REFERENCES `categorias_inscripcion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_tipo_inscripcion` FOREIGN KEY (`tipo_inscripcion_id`) REFERENCES `tipos_inscripcion`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_clasificacion` FOREIGN KEY (`clasificacion_id`) REFERENCES `clasificaciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `inscripciones` ADD CONSTRAINT `fk_inscripciones_estado` FOREIGN KEY (`estado_id`) REFERENCES `estados_inscripcion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_actividad` FOREIGN KEY (`actividad_id`) REFERENCES `actividades`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `asistencias` ADD CONSTRAINT `fk_asistencias_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
