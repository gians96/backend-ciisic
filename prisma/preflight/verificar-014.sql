-- ============================================================================
-- Spec 014 · Verificación después de 20261001120000_portal_fotocheck (solo lectura).
-- Esperado justo después de migrar:
--   con_codigo = distintos = qr_legado = aprobadas_o_enviadas (las pendientes, sin código hasta que
--   se aprueben); formato_invalido = 0; sin_marca_qr_anterior = 0; aprobadas_sin_codigo = 0;
--   el índice único existe (non_unique = 0); codigos_acceso vacía; ninguna foto.
-- Más adelante `sin_marca_qr_anterior` crece con las aprobaciones nuevas (tienen el QR nuevo).
-- También: prisma migrate diff … --exit-code debe salir 0.
-- ============================================================================

SELECT COUNT(*) AS total, COUNT(i.codigo_credencial) AS con_codigo, COUNT(DISTINCT i.codigo_credencial) AS distintos,
       SUM(i.es_qr_legado = 1) AS qr_legado,
       SUM(e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL) AS aprobadas_o_enviadas
  FROM inscripciones i
  JOIN estados_inscripcion e ON e.id = i.estado_id;

SELECT COUNT(*) AS aprobadas_sin_codigo
  FROM inscripciones i
  JOIN estados_inscripcion e ON e.id = i.estado_id
 WHERE (e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL) AND i.codigo_credencial IS NULL;

SELECT COUNT(*) AS formato_invalido
  FROM inscripciones
 WHERE codigo_credencial IS NOT NULL AND NOT REGEXP_LIKE(codigo_credencial, '^[0-9A-Z]{10}$', 'c');

SELECT COUNT(*) AS sin_marca_qr_anterior
  FROM inscripciones i
  JOIN estados_inscripcion e ON e.id = i.estado_id
 WHERE (e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL) AND i.es_qr_legado = 0;

SELECT index_name, non_unique, column_name
  FROM information_schema.statistics
 WHERE table_schema = DATABASE() AND table_name = 'inscripciones' AND index_name = 'uq_inscripciones_codigo_credencial';

SELECT COUNT(*) AS codigos_acceso FROM codigos_acceso;
SELECT COUNT(*) AS participantes, COUNT(foto_archivo) AS con_foto FROM participantes;

-- Lo que la migración no toca debe seguir igual que antes (comparar con el respaldo)
SELECT 'inscripciones' AS tabla, COUNT(*) FROM inscripciones
UNION ALL SELECT 'participantes', COUNT(*) FROM participantes
UNION ALL SELECT 'asistencias', COUNT(*) FROM asistencias;
