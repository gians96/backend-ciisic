-- Conteos posteriores a la migración (spec 001/002). Deben coincidir con los del preflight.
SELECT 'administradores (Administradores)' AS tabla, COUNT(*) FROM administradores
UNION ALL SELECT 'roles (Roles)', COUNT(*) FROM roles
UNION ALL SELECT 'participantes (Usuario)', COUNT(*) FROM participantes
UNION ALL SELECT 'tipos_documento (TipoDocumento)', COUNT(*) FROM tipos_documento
UNION ALL SELECT 'categorias_inscripcion (TipoPlanInscripcion)', COUNT(*) FROM categorias_inscripcion
UNION ALL SELECT 'tipos_inscripcion (TipoInscripcion)', COUNT(*) FROM tipos_inscripcion
UNION ALL SELECT 'clasificaciones (Clasificacion)', COUNT(*) FROM clasificaciones
UNION ALL SELECT 'estados_inscripcion (EstadoInscripcion)', COUNT(*) FROM estados_inscripcion
UNION ALL SELECT 'inscripciones (Inscripcion)', COUNT(*) FROM inscripciones
UNION ALL SELECT 'mensajes_contacto (Contact)', COUNT(*) FROM mensajes_contacto
UNION ALL SELECT 'actividades (Evento)', COUNT(*) FROM actividades
UNION ALL SELECT 'asistencias (Asistencia)', COUNT(*) FROM asistencias
UNION ALL SELECT 'ponencias (PaperSubmission)', COUNT(*) FROM ponencias
UNION ALL SELECT 'eventos (nuevo, debe ser 1)', COUNT(*) FROM eventos;

-- Integridad del backfill multi-evento: todo debe pertenecer a un evento
SELECT 'inscripciones_sin_evento' AS verificacion, COUNT(*) FROM inscripciones WHERE evento_id IS NULL;
SELECT 'suma_montos_aprobados' AS verificacion, SUM(i.monto) FROM inscripciones i JOIN estados_inscripcion e ON e.id = i.estado_id WHERE e.codigo = 'APROBADO';
