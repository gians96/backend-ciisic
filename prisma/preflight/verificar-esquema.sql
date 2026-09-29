-- ============================================================================
-- Verificación previa a la migración 20260929120000_esquema_bd_espanol (spec 001)
-- Ejecutar sobre la BD ACTUAL (esquema antiguo) ANTES de `prisma migrate deploy`.
--   mysql -u <usuario> -p <base> < prisma/preflight/verificar-esquema.sql
-- Todas las consultas marcadas [BLOQUEANTE] deben devolver 0 filas / 0.
-- ============================================================================

-- [BLOQUEANTE] Migraciones previas fallidas o sin terminar
SELECT 'migraciones_fallidas' AS verificacion, migration_name
FROM _prisma_migrations
WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;

-- [BLOQUEANTE] Claves foráneas esperadas (deben aparecer las 9)
SELECT 'fks_esperadas' AS verificacion, COUNT(*) AS encontradas, 9 AS esperadas
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_NAME IN (
    'Administradores_rolId_fkey', 'Usuario_idTipoDocumentoId_fkey', 'TipoInscripcion_tipoPlanId_fkey',
    'Inscripcion_usuarioId_fkey', 'Inscripcion_tipoInscripcionId_fkey', 'Inscripcion_clasificacionId_fkey',
    'Inscripcion_estadoId_fkey', 'Asistencia_id_evento_fkey', 'Asistencia_id_usuario_fkey');

-- [BLOQUEANTE] Índices esperados (deben aparecer los 20)
SELECT 'indices_esperados' AS verificacion, COUNT(DISTINCT CONCAT(TABLE_NAME, '.', INDEX_NAME)) AS encontrados, 20 AS esperados
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND CONCAT(TABLE_NAME, '.', INDEX_NAME) IN (
    'Administradores.Administradores_correoElectronico_key', 'Administradores.Administradores_rolId_fkey',
    'Usuario.Usuario_dni_key', 'Usuario.Usuario_numero_key', 'Usuario.Usuario_idTipoDocumentoId_fkey',
    'Usuario.Usuario_correoElectronico_key', 'TipoDocumento.TipoDocumento_abreviatura_key',
    'TipoPlanInscripcion.TipoPlanInscripcion_nombre_key', 'TipoInscripcion.TipoInscripcion_tipoPlanId_fkey',
    'EstadoInscripcion.EstadoInscripcion_nombre_key', 'Inscripcion.Inscripcion_numeroOperacion_key',
    'Inscripcion.Inscripcion_usuarioId_fkey', 'Inscripcion.Inscripcion_tipoInscripcionId_fkey',
    'Inscripcion.Inscripcion_clasificacionId_fkey', 'Inscripcion.Inscripcion_estadoId_fkey',
    'Evento.evento_pkey', 'Asistencia.uq_asistencia_persona_evento', 'Asistencia.idx_asistencia_evento',
    'Asistencia.idx_asistencia_id', 'PaperSubmission.PaperSubmission_createdAt_idx');
-- Nota: si PaperSubmission aún no existe, se crea con la migración 20260928000000 antes de esta; el
-- índice faltante en ese caso no es bloqueante (esperados = 19).

-- [BLOQUEANTE] Más de una inscripción por persona (violaría uq_inscripciones_evento_participante)
SELECT 'inscripciones_duplicadas' AS verificacion, usuarioId, COUNT(*) AS total
FROM Inscripcion GROUP BY usuarioId HAVING COUNT(*) > 1;

-- [BLOQUEANTE] Tipos de inscripción con el mismo código dentro de una categoría
SELECT 'tipos_codigo_duplicado' AS verificacion, tipoPlanId, value, COUNT(*) AS total
FROM TipoInscripcion WHERE value IS NOT NULL AND TRIM(value) <> ''
GROUP BY tipoPlanId, value HAVING COUNT(*) > 1;

-- [BLOQUEANTE] Montos fuera de rango para DECIMAL(10,2)
SELECT 'montos_fuera_de_rango' AS verificacion, COUNT(*) AS total
FROM Inscripcion WHERE pago >= 100000000 OR descuento >= 100000000;

-- [BLOQUEANTE] Documento duplicado tras unificar dni/numero
SELECT 'documento_duplicado' AS verificacion, COALESCE(idTipoDocumentoId, 'dni') AS tipo, dni, COUNT(*) AS total
FROM Usuario GROUP BY COALESCE(idTipoDocumentoId, 'dni'), dni HAVING COUNT(*) > 1;

-- [INFORMATIVO] Filas donde dni ≠ numero (se conservará dni)
SELECT 'dni_distinto_de_numero' AS verificacion, id, dni, numero FROM Usuario WHERE dni <> numero;

-- [INFORMATIVO] Participantes sin tipo de documento (se completará con 'dni')
SELECT 'sin_tipo_documento' AS verificacion, COUNT(*) AS total FROM Usuario WHERE idTipoDocumentoId IS NULL OR idTipoDocumentoId = '';

-- [INFORMATIVO] Categorías y el código que recibirán
SELECT 'categorias' AS verificacion, id, nombre,
  CASE WHEN UPPER(TRIM(nombre)) = 'ESTUDIANTES' THEN 'ESTUDIANTES'
       WHEN UPPER(TRIM(nombre)) = 'PROFESIONALES Y PUBLICO EN GENERAL' THEN 'PUBLICO_GENERAL'
       ELSE CONCAT('CATEGORIA_', id) END AS codigo_asignado
FROM TipoPlanInscripcion;

-- [INFORMATIVO] Estados y roles fuera de los ids conocidos (recibirán código genérico)
SELECT 'estados_no_estandar' AS verificacion, id, nombre FROM EstadoInscripcion WHERE id NOT IN (1, 2, 3, 4, 5);
SELECT 'roles_no_estandar' AS verificacion, id, nombre FROM Roles WHERE id NOT IN (1, 2);

-- [INFORMATIVO] Conteos de referencia (comparar con prisma/preflight/conteos-despues.sql)
SELECT 'Administradores' AS tabla, COUNT(*) FROM Administradores
UNION ALL SELECT 'Roles', COUNT(*) FROM Roles
UNION ALL SELECT 'Usuario', COUNT(*) FROM Usuario
UNION ALL SELECT 'TipoDocumento', COUNT(*) FROM TipoDocumento
UNION ALL SELECT 'TipoPlanInscripcion', COUNT(*) FROM TipoPlanInscripcion
UNION ALL SELECT 'TipoInscripcion', COUNT(*) FROM TipoInscripcion
UNION ALL SELECT 'Clasificacion', COUNT(*) FROM Clasificacion
UNION ALL SELECT 'EstadoInscripcion', COUNT(*) FROM EstadoInscripcion
UNION ALL SELECT 'Inscripcion', COUNT(*) FROM Inscripcion
UNION ALL SELECT 'Contact', COUNT(*) FROM Contact
UNION ALL SELECT 'Evento', COUNT(*) FROM Evento
UNION ALL SELECT 'Asistencia', COUNT(*) FROM Asistencia;
