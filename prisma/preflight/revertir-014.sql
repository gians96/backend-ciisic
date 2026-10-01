-- ============================================================================
-- Spec 014 · Reversión de 20261001120000_portal_fotocheck si quedó a medias (error P3009).
-- MySQL no revierte DDL: cada paso se ejecuta solo si el objeto existe (se puede repetir). Después:
--   npx prisma migrate resolve --rolled-back 20261001120000_portal_fotocheck
-- y volver a desplegar (la migración se aplica de nuevo desde cero).
-- Volver a la imagen anterior NO exige revertir: el esquema nuevo es aditivo y la imagen anterior
-- funciona con él. Revertir borra los códigos de las credenciales (los PDF y fotochecks con el QR
-- nuevo dejan de valer), los códigos de acceso por correo y la referencia a las fotos (los archivos
-- de uploads/fotos quedan en disco). Antes: respaldo con mysqldump.
-- Ejecutar con el cliente mysql (usa DELIMITER).
-- ============================================================================

DROP PROCEDURE IF EXISTS revertir_014;
DELIMITER //
CREATE PROCEDURE revertir_014()
BEGIN
    DECLARE esquema VARCHAR(64) DEFAULT DATABASE();
    IF EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = esquema AND table_name = 'inscripciones' AND index_name = 'uq_inscripciones_codigo_credencial') THEN
        DROP INDEX uq_inscripciones_codigo_credencial ON inscripciones;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'inscripciones' AND column_name = 'codigo_credencial') THEN
        ALTER TABLE inscripciones DROP COLUMN codigo_credencial;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'inscripciones' AND column_name = 'es_qr_legado') THEN
        ALTER TABLE inscripciones DROP COLUMN es_qr_legado;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'participantes' AND column_name = 'foto_archivo') THEN
        ALTER TABLE participantes DROP COLUMN foto_archivo;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'participantes' AND column_name = 'foto_actualizada_en') THEN
        ALTER TABLE participantes DROP COLUMN foto_actualizada_en;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = esquema AND constraint_name = 'fk_codigos_acceso_participante') THEN
        ALTER TABLE codigos_acceso DROP FOREIGN KEY fk_codigos_acceso_participante;
    END IF;
    DROP TABLE IF EXISTS codigos_acceso;
END //
DELIMITER ;
CALL revertir_014();
DROP PROCEDURE revertir_014;
