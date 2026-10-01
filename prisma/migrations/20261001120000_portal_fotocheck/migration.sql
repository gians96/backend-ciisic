-- ============================================================================
-- Spec 014 · Portal del participante, fotocheck y asistencia por QR
-- 1) Códigos de acceso al portal por correo: solo el HMAC del código (clave derivada de JWT_SECRET).
-- 2) Foto opcional del participante (uploads/fotos).
-- 3) Código aleatorio de la inscripción para el QR del fotocheck (`codigo_credencial`, 10 caracteres
--    base 36). Admite NULL para convivir con la imagen anterior, que inserta sin él; la aplicación lo
--    completa al leer o al aprobar (`asegurarCodigoCredencial`). `es_qr_legado` marca a quien pudo
--    recibir la credencial con el QR anterior (id del participante). Aquí solo reciben código las
--    aprobadas o con credencial enviada (todas con la marca): las pendientes lo reciben al aprobarse,
--    así una que apruebe la imagen anterior mientras convive con la nueva (despliegue, vuelta atrás)
--    queda sin código y la imagen nueva la marca al completarlo.
--    Tras una vuelta atrás a la imagen anterior: prisma/preflight/marcar-qr-legado-014.sql.
-- La auditoría de asistencias ya está en la spec 013: esta migración no toca `asistencias`.
-- Todo es aditivo: la imagen anterior sigue funcionando con este esquema. MySQL no revierte DDL:
-- la sentencia riesgosa (índice único) va al final.
-- Si falla el índice único: prisma/preflight/completar-014.sql y
--   `prisma migrate resolve --applied 20261001120000_portal_fotocheck`.
-- Si falla antes: prisma/preflight/revertir-014.sql,
--   `prisma migrate resolve --rolled-back 20261001120000_portal_fotocheck` y volver a desplegar.
-- Verificación: prisma/preflight/verificar-014.sql.
-- ============================================================================

-- Códigos de acceso al portal por correo
CREATE TABLE `codigos_acceso` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `correo` VARCHAR(191) NOT NULL,
    `codigo_hash` CHAR(64) NOT NULL,
    `participante_id` INTEGER NULL,
    `ip` VARCHAR(45) NULL,
    `intentos` INTEGER NOT NULL DEFAULT 0,
    `expira_en` DATETIME(3) NOT NULL,
    `usado_en` DATETIME(3) NULL,
    `invalidado_en` DATETIME(3) NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_codigos_acceso_correo_creado`(`correo`, `creado_en`),
    INDEX `idx_codigos_acceso_ip_creado`(`ip`, `creado_en`),
    INDEX `idx_codigos_acceso_participante`(`participante_id`),
    INDEX `idx_codigos_acceso_creado`(`creado_en`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `codigos_acceso` ADD CONSTRAINT `fk_codigos_acceso_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Foto opcional del participante
ALTER TABLE `participantes` ADD COLUMN `foto_actualizada_en` DATETIME(3) NULL,
    ADD COLUMN `foto_archivo` VARCHAR(80) NULL;

-- Código del QR de cada inscripción y marca del QR anterior
ALTER TABLE `inscripciones` ADD COLUMN `codigo_credencial` CHAR(10) NULL,
    ADD COLUMN `es_qr_legado` BOOLEAN NOT NULL DEFAULT false;

-- 64 bits aleatorios → base 36 en mayúsculas → últimos 10 caracteres (~51 bits), solo en las
-- aprobadas o con credencial enviada. No toca `actualizado_en` (lo mantiene Prisma, no MySQL).
UPDATE `inscripciones` i
  JOIN `estados_inscripcion` e ON e.`id` = i.`estado_id`
   SET i.`codigo_credencial` = RIGHT(LPAD(CONV(HEX(RANDOM_BYTES(8)), 16, 36), 13, '0'), 10)
 WHERE i.`codigo_credencial` IS NULL AND (e.`codigo` = 'APROBADO' OR i.`credencial_enviada_en` IS NOT NULL);

-- Colisión (probabilidad ~1e-10): se regeneran las filas repetidas antes de crear el índice
UPDATE `inscripciones` i
  JOIN (SELECT `codigo_credencial` FROM `inscripciones` WHERE `codigo_credencial` IS NOT NULL
         GROUP BY `codigo_credencial` HAVING COUNT(*) > 1) d ON d.`codigo_credencial` = i.`codigo_credencial`
   SET i.`codigo_credencial` = RIGHT(LPAD(CONV(HEX(RANDOM_BYTES(8)), 16, 36), 13, '0'), 10);

-- Quien ya está aprobado o recibió la credencial pudo quedarse con el QR anterior
UPDATE `inscripciones` i
  JOIN `estados_inscripcion` e ON e.`id` = i.`estado_id`
   SET i.`es_qr_legado` = true
 WHERE e.`codigo` = 'APROBADO' OR i.`credencial_enviada_en` IS NOT NULL;

-- Al final: la única sentencia que puede fallar por los datos
CREATE UNIQUE INDEX `uq_inscripciones_codigo_credencial` ON `inscripciones`(`codigo_credencial`);
