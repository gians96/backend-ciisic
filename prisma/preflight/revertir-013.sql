-- ============================================================================
-- Spec 013 · Reversión de 20260930150000_roles_permisos_alcance si quedó a medias (error P3009).
-- MySQL no revierte DDL: cada paso se ejecuta solo si el objeto existe. Después:
--   npx prisma migrate resolve --rolled-back 20260930150000_roles_permisos_alcance
-- Requiere que ninguna cuenta use TESORERO ni COMISION (la FK de administradores lo impide).
-- Ejecutar con el cliente mysql (usa DELIMITER).
-- ============================================================================

DROP PROCEDURE IF EXISTS revertir_013;
DELIMITER //
CREATE PROCEDURE revertir_013()
BEGIN
    DECLARE esquema VARCHAR(64) DEFAULT DATABASE();
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = esquema AND constraint_name = 'fk_asistencias_registrado_por') THEN
        ALTER TABLE asistencias DROP FOREIGN KEY fk_asistencias_registrado_por;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = esquema AND constraint_name = 'fk_asistencias_anulado_por') THEN
        ALTER TABLE asistencias DROP FOREIGN KEY fk_asistencias_anulado_por;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = esquema AND table_name = 'asistencias' AND index_name = 'idx_asistencias_registrado_por') THEN
        DROP INDEX idx_asistencias_registrado_por ON asistencias;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = esquema AND table_name = 'asistencias' AND index_name = 'idx_asistencias_anulado_por') THEN
        DROP INDEX idx_asistencias_anulado_por ON asistencias;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'asistencias' AND column_name = 'metodo') THEN
        ALTER TABLE asistencias DROP COLUMN metodo;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'asistencias' AND column_name = 'registrado_por_id') THEN
        ALTER TABLE asistencias DROP COLUMN registrado_por_id;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'asistencias' AND column_name = 'es_fuera_de_horario') THEN
        ALTER TABLE asistencias DROP COLUMN es_fuera_de_horario;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'asistencias' AND column_name = 'anulado_en') THEN
        ALTER TABLE asistencias DROP COLUMN anulado_en;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'asistencias' AND column_name = 'anulado_por_id') THEN
        ALTER TABLE asistencias DROP COLUMN anulado_por_id;
    END IF;
    DROP TABLE IF EXISTS permisos_administrador;
    DROP TABLE IF EXISTS asignaciones_evento;
    DELETE FROM roles WHERE codigo IN ('TESORERO', 'COMISION');
    UPDATE roles SET nombre = 'SuperAdmin' WHERE codigo = 'SUPERADMIN';
    UPDATE roles SET nombre = 'Admin' WHERE codigo = 'ADMIN';
END //
DELIMITER ;
CALL revertir_013();
DROP PROCEDURE revertir_013;
