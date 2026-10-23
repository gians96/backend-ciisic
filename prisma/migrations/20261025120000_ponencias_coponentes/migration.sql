-- ─────────────────────────────────────────────────────────────────────────────
-- Spec 032 · Temas de ponencias especializadas compartidos por varios ponentes
-- Solo agrega una columna nula: no cambia ningún dato ni la forma de leer el ponente principal.
--
-- `coponentes`: arreglo JSON `[{ "nombre", "bio", "foto", "externo" }]` con los ponentes que comparten el tema
-- (misma hora y ambiente) además del principal, que sigue en `ponente_*`. NULL = un solo ponente.
--
-- Para revertir: ALTER TABLE `ponencias_especializadas` DROP COLUMN `coponentes`; y
-- `prisma migrate resolve --rolled-back 20261025120000_ponencias_coponentes`.
-- ─────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE `ponencias_especializadas` ADD COLUMN `coponentes` JSON NULL;
