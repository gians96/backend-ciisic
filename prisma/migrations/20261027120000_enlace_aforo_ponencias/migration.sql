-- ============================================================================
-- Enlace público del aforo de las ponencias especializadas (spec 036)
-- Una tabla nueva y aditiva: nada de lo existente cambia.
--  - Un enlace por evento (`evento_id` único).
--  - `token`: token aleatorio (43 caracteres, 256 bits). Único. Se guarda en claro a propósito, como los
--    enlaces de los docentes y de los ciclos: el panel debe poder mostrar y copiar el enlace cuando se quiera.
-- Para revertir: DROP TABLE `enlaces_aforo_ponencias`;
--   y `prisma migrate resolve --rolled-back 20261027120000_enlace_aforo_ponencias`.
-- ============================================================================

-- CreateTable
CREATE TABLE `enlaces_aforo_ponencias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ultimo_acceso` DATETIME(3) NULL,

    UNIQUE INDEX `uq_enlaces_aforo_ponencias_evento`(`evento_id`),
    UNIQUE INDEX `uq_enlaces_aforo_ponencias_token`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `enlaces_aforo_ponencias` ADD CONSTRAINT `fk_enlaces_aforo_ponencias_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
