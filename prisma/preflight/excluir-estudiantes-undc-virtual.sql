-- ============================================================================
-- Spec 020 · Enciende «No admitir estudiantes UNDC» en los tipos virtuales de un evento (datos de
-- producción). IDEMPOTENTE: solo hace UPDATE de la columna excluye_estudiantes_undc en los tipos
-- indicados; no borra ni crea nada y se puede ejecutar varias veces. Para apagarlo, cambia
-- @excluye a 0 y ejecuta de nuevo (o hazlo desde el panel: Eventos -> Tipos de inscripción).
--
-- Qué toca, en el evento cuyo código se fija en @codigo_evento (por defecto ciisic-viii-2026):
--   estudiantes_virtual y general_virtual -> excluye_estudiantes_undc = @excluye
-- Los demás tipos no se tocan. Las inscripciones ya hechas tampoco: la regla solo frena las nuevas.
--
-- Requisitos (si falta alguno, el script ABORTA sin escribir nada):
--   1) La migración 20261021120000_excluye_estudiantes_undc ya se aplicó (columna
--      tipos_inscripcion.excluye_estudiantes_undc).
--   2) El evento existe.
-- El aborto se ve como «ERROR 1048 Column '<comprobación>' cannot be null»: columna_no_existe o
-- evento_no_existe.
--
-- Cuándo: DESPUÉS de desplegar el backend con la spec 020 (un backend anterior no lee la columna y la
-- ignoraría en silencio). Antes, respaldo con mysqldump (ver docs/operacion.md).
--
-- Cómo ejecutarlo:
--   mysql --default-character-set=utf8mb4 -u <usuario> -p <base_de_datos> < prisma/preflight/excluir-estudiantes-undc-virtual.sql
-- Con el cliente mysql el script se detiene en el primer error (no uses --force). No lleva USE: la base
-- la eliges tú en la línea de comandos. Termina con SELECT de verificación (solo lectura).
-- ============================================================================

SET NAMES utf8mb4;

-- ── Parámetros ──────────────────────────────────────────────────────────────
SET @codigo_evento = 'ciisic-viii-2026';
-- 1 = los tipos virtuales no admiten estudiantes UNDC; 0 = los admiten (comportamiento anterior)
SET @excluye = 1;

-- Las comprobaciones abortan con un error de "NULL en columna NOT NULL", que solo es error en modo estricto
SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, IF(@@SESSION.sql_mode = '', '', ','), 'STRICT_ALL_TABLES');

-- ── Comprobaciones previas: abortan si falta algo ───────────────────────────
-- Tabla TEMPORAL: vive solo en esta sesión y desaparece sola al cerrarla (no deja nada en la base).
CREATE TEMPORARY TABLE comprobacion_excluye (
    columna_no_existe TINYINT NOT NULL DEFAULT 0,
    evento_no_existe TINYINT NOT NULL DEFAULT 0
);

INSERT INTO comprobacion_excluye (columna_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = DATABASE() AND table_name = 'tipos_inscripcion' AND column_name = 'excluye_estudiantes_undc'), 0, NULL));

INSERT INTO comprobacion_excluye (evento_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM eventos WHERE codigo = @codigo_evento COLLATE utf8mb4_unicode_ci), 0, NULL));

-- ── Cambio (una transacción) ────────────────────────────────────────────────
START TRANSACTION;

UPDATE tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
   SET t.excluye_estudiantes_undc = @excluye
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci
   AND t.codigo IN ('estudiantes_virtual', 'general_virtual');

COMMIT;

-- ── Verificación (solo lectura) ─────────────────────────────────────────────
-- 1) Los dos tipos con el interruptor como quedó
SELECT c.codigo AS categoria, t.id, t.codigo, t.modalidad, t.disponible_para, t.excluye_estudiantes_undc, t.activo
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.codigo IN ('estudiantes_virtual', 'general_virtual')
 ORDER BY c.orden, t.orden;

-- 2) Tipos virtuales que NO excluyen estudiantes (con @excluye = 1 debe salir vacío, salvo los que
--    la organización haya creado después con otro código)
SELECT c.codigo AS categoria, t.id, t.codigo, t.excluye_estudiantes_undc
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.modalidad = 'VIRTUAL' AND t.excluye_estudiantes_undc = 0;

-- 3) Estudiantes UNDC que YA estaban inscritos en tipos virtuales (la regla no los toca; la
--    organización decide si rechaza o cancela alguno desde el panel). Solo conteos, sin datos personales.
SELECT t.codigo, es.codigo AS estado,
       SUM(i.es_estudiante_undc = 1) AS verificados_sivireno,
       SUM(p.correo REGEXP '^[0-9]{8,12}@undc\\.edu\\.pe$') AS correo_de_estudiante,
       COUNT(*) AS inscripciones
  FROM inscripciones i
  JOIN eventos ev ON ev.id = i.evento_id
  JOIN participantes p ON p.id = i.participante_id
  JOIN tipos_inscripcion t ON t.id = i.tipo_inscripcion_id
  JOIN estados_inscripcion es ON es.id = i.estado_id
 WHERE ev.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.modalidad = 'VIRTUAL'
 GROUP BY t.codigo, es.codigo
 ORDER BY t.codigo, es.codigo;
