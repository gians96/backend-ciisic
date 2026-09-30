-- ============================================================================
-- Spec 013 · Plantilla para reasignar una cuenta existente después de migrar.
-- Reemplazar :correo y :codigo_evento. Ejecutar dentro de la transacción y revisar el SELECT final
-- antes de confirmar. La guarda lee la BD en cada petición: el cambio aplica al instante.
-- Lo normal es hacerlo desde el panel (Equipo y administradores); esto es para el día del despliegue.
-- ============================================================================

START TRANSACTION;

-- Pasar a Tesorero (todo lo operativo del congreso y validación de pagos en sus eventos)
UPDATE administradores SET rol_id = (SELECT id FROM roles WHERE codigo = 'TESORERO') WHERE correo = ':correo';
INSERT IGNORE INTO asignaciones_evento (administrador_id, evento_id)
SELECT a.id, e.id FROM administradores a JOIN eventos e ON e.codigo = ':codigo_evento' WHERE a.correo = ':correo';

-- O pasar a Comisión con solo «marcar asistencia»:
-- UPDATE administradores SET rol_id = (SELECT id FROM roles WHERE codigo = 'COMISION') WHERE correo = ':correo';
-- INSERT IGNORE INTO asignaciones_evento (administrador_id, evento_id)
-- SELECT a.id, e.id FROM administradores a JOIN eventos e ON e.codigo = ':codigo_evento' WHERE a.correo = ':correo';
-- INSERT IGNORE INTO permisos_administrador (administrador_id, permiso)
-- SELECT a.id, 'asistencia.marcar' FROM administradores a WHERE a.correo = ':correo';

-- Si `eventos` sale NULL, el código del evento no existe (el INSERT no hizo nada): ROLLBACK.
SELECT a.id, a.correo, r.codigo,
       (SELECT GROUP_CONCAT(evento_id) FROM asignaciones_evento WHERE administrador_id = a.id) AS eventos,
       (SELECT GROUP_CONCAT(permiso) FROM permisos_administrador WHERE administrador_id = a.id) AS permisos
FROM administradores a JOIN roles r ON r.id = a.rol_id
WHERE a.correo = ':correo';

-- COMMIT;   o   ROLLBACK;
