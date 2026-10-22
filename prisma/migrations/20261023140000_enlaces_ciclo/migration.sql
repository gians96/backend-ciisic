-- ============================================================================
-- Enlace público por ciclo (spec 027)
-- Una tabla nueva y aditiva: nada de lo existente cambia.
--  - `token`: token aleatorio (43 caracteres, 256 bits) del enlace del ciclo. Único. Se guarda en claro a
--    propósito: el panel debe poder mostrar y copiar el enlace cuando se quiera (la misma base ya contiene
--    los datos que el enlace muestra).
--  - Un enlace por evento y ciclo. Vive aparte del padrón, que se reemplaza en cada carga: recargarlo no
--    invalida los enlaces entregados.
-- Para revertir: DROP TABLE `enlaces_ciclo`;
--   y `prisma migrate resolve --rolled-back 20261023140000_enlaces_ciclo`.
-- ============================================================================

-- CreateTable
CREATE TABLE `enlaces_ciclo` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `ciclo` VARCHAR(10) NOT NULL,
    `token` VARCHAR(64) NOT NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ultimo_acceso` DATETIME(3) NULL,

    UNIQUE INDEX `uq_enlaces_ciclo_token`(`token`),
    UNIQUE INDEX `uq_enlaces_ciclo_evento_ciclo`(`evento_id`, `ciclo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `enlaces_ciclo` ADD CONSTRAINT `fk_enlaces_ciclo_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
