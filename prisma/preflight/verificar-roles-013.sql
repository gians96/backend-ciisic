-- ============================================================================
-- Spec 013 · Preflight de roles (solo lectura). Ejecutar sobre un respaldo antes de desplegar.
-- Tras la migración, las cuentas ADMIN pasan a «Administrador del sistema»: pueden gestionar
-- credenciales de correo, borrar inscripciones y crear Tesoreros y Comisión. El Owner decide
-- cuenta por cuenta si alguna debe pasar a TESORERO o COMISION (ver reasignar-013.sql).
-- ============================================================================

SELECT a.id, a.correo, CONCAT(a.nombres, ' ', a.apellidos) AS nombre, r.codigo AS rol, a.activo,
       a.google_sub IS NOT NULL AS google_vinculado, a.contrasena_hash IS NOT NULL AS tiene_contrasena,
       (SELECT MAX(i.revisado_en) FROM inscripciones i WHERE i.revisado_por_id = a.id) AS ultima_revision,
       (SELECT COUNT(*) FROM inscripciones i WHERE i.revisado_por_id = a.id) AS revisiones
FROM administradores a
JOIN roles r ON r.id = a.rol_id
ORDER BY r.codigo, a.id;

-- Roles presentes (deben existir SUPERADMIN y ADMIN; ninguno ROL_<id>)
SELECT r.id, r.codigo, r.nombre, (SELECT COUNT(*) FROM administradores a WHERE a.rol_id = r.id) AS cuentas
FROM roles r
ORDER BY r.id;
