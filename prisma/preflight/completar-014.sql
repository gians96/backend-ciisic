-- ============================================================================
-- Spec 014 · Completa 20261001120000_portal_fotocheck si falló en el índice único (error P3009 con
-- «Duplicate entry … uq_inscripciones_codigo_credencial»; probabilidad ~1e-10). Se puede repetir:
--   1) rellena los códigos que falten en las aprobadas o con credencial enviada (las pendientes lo
--   reciben al aprobarse), 2) regenera los repetidos hasta que no quede ninguno, 3) marca el QR
--   anterior en las aprobadas o con credencial enviada, 4) crea el índice si falta.
-- Si falta la tabla o alguna columna, la migración falló antes: usa revertir-014.sql.
-- Después:
--   npx prisma migrate resolve --applied 20261001120000_portal_fotocheck
-- y verifica con verificar-014.sql. Antes: respaldo con mysqldump.
-- Ejecutar con el cliente mysql (usa DELIMITER).
-- ============================================================================

DROP PROCEDURE IF EXISTS completar_014;
DELIMITER //
CREATE PROCEDURE completar_014()
BEGIN
    DECLARE esquema VARCHAR(64) DEFAULT DATABASE();
    IF (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = esquema AND (
            (table_name = 'inscripciones' AND column_name IN ('codigo_credencial', 'es_qr_legado'))
         OR (table_name = 'participantes' AND column_name IN ('foto_archivo', 'foto_actualizada_en')))) <> 4
       OR NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = esquema AND constraint_name = 'fk_codigos_acceso_participante') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La migracion 014 fallo antes del indice: usa revertir-014.sql';
    END IF;

    UPDATE inscripciones i
      JOIN estados_inscripcion e ON e.id = i.estado_id
       SET i.codigo_credencial = RIGHT(LPAD(CONV(HEX(RANDOM_BYTES(8)), 16, 36), 13, '0'), 10)
     WHERE i.codigo_credencial IS NULL AND (e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL);

    WHILE EXISTS (SELECT 1 FROM inscripciones WHERE codigo_credencial IS NOT NULL GROUP BY codigo_credencial HAVING COUNT(*) > 1) DO
        UPDATE inscripciones i
          JOIN (SELECT codigo_credencial FROM inscripciones WHERE codigo_credencial IS NOT NULL
                 GROUP BY codigo_credencial HAVING COUNT(*) > 1) d ON d.codigo_credencial = i.codigo_credencial
           SET i.codigo_credencial = RIGHT(LPAD(CONV(HEX(RANDOM_BYTES(8)), 16, 36), 13, '0'), 10);
    END WHILE;

    UPDATE inscripciones i
      JOIN estados_inscripcion e ON e.id = i.estado_id
       SET i.es_qr_legado = true
     WHERE e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL;

    IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = esquema AND table_name = 'inscripciones' AND index_name = 'uq_inscripciones_codigo_credencial') THEN
        CREATE UNIQUE INDEX uq_inscripciones_codigo_credencial ON inscripciones (codigo_credencial);
    END IF;
END //
DELIMITER ;
CALL completar_014();
DROP PROCEDURE completar_014;
