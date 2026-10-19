-- ============================================================================
-- Spec 018 · Crea los tipos de inscripción VIRTUALES de un evento (datos de producción).
-- IDEMPOTENTE y NO DESTRUCTIVO: solo INSERT ... SELECT ... WHERE NOT EXISTS. No hay DROP, DELETE,
-- TRUNCATE ni UPDATE: si un tipo ya existe (mismo evento, categoría y código) no se toca, aunque
-- alguien lo haya editado en el panel. Se puede ejecutar varias veces.
--
-- Qué crea, en el evento cuyo código se fija en @codigo_evento (por defecto ciisic-viii-2026):
--   categoría ESTUDIANTES       -> estudiantes_virtual  «ESTUDIANTES»                        VIRTUAL  S/ 30
--   categoría PUBLICO_GENERAL   -> general_virtual      «PROFESIONALES Y PUBLICO EN GENERAL» VIRTUAL  S/ 50
-- precio = precio_institucional (el descuento es 0 con cualquier correo), disponible_para = TODOS,
-- modalidad = VIRTUAL, orden = (máximo de la categoría) + 1. No promete certificado ni horas.
--
-- Requisitos (si falta alguno, el script ABORTA sin escribir nada):
--   1) La migración 20261019120000_modalidad_virtual ya se aplicó (columna tipos_inscripcion.modalidad).
--   2) El evento existe, y tiene las categorías ESTUDIANTES y PUBLICO_GENERAL.
-- El aborto se ve como «ERROR 1048 Column '<comprobación>' cannot be null»; el nombre de la columna
-- dice qué falta (columna_modalidad_no_existe, evento_no_existe, categoria_estudiantes_no_existe o
-- categoria_publico_general_no_existe).
--
-- Cuándo: es el ÚLTIMO paso del despliegue (respaldo -> backend -> panel y landing -> este script ->
-- verificar-virtual.sql). Los tipos nacen activos y la landing anterior ignora la modalidad: los mostraría
-- como planes normales, mezclados con los presenciales. Si hay que correrlo antes de publicar la landing
-- nueva, pon @activo = 0 y activa los tipos desde el panel cuando ya esté publicada.
--
-- Cómo ejecutarlo (siempre después del respaldo con mysqldump; ver docs/operacion.md):
--   mysql --default-character-set=utf8mb4 -u <usuario> -p <base_de_datos> < prisma/preflight/configurar-virtual.sql
-- Con el cliente mysql el script se detiene en el primer error (no uses --force). No lleva USE: la base
-- la eliges tú en la línea de comandos. Antes de ejecutarlo revisa @codigo_evento y @activo.
-- Los tipos también se pueden crear desde el panel (Eventos -> Tipos de inscripción); es lo mismo.
-- Termina con un SELECT de verificación (y prisma/preflight/verificar-virtual.sql, de solo lectura).
-- ============================================================================

SET NAMES utf8mb4;

-- ── Parámetros ──────────────────────────────────────────────────────────────
SET @codigo_evento = 'ciisic-viii-2026';
-- 1 = los tipos nacen activos (la landing los muestra de inmediato: usar solo con la landing nueva ya
-- publicada); 0 = nacen ocultos y se activan desde el panel cuando la organización lo decida.
SET @activo = 1;

-- Las comprobaciones abortan con un error de "NULL en columna NOT NULL", que solo es error en modo estricto
SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, IF(@@SESSION.sql_mode = '', '', ','), 'STRICT_ALL_TABLES');

-- ── Comprobaciones previas: abortan si falta algo ───────────────────────────
-- Tabla TEMPORAL: vive solo en esta sesión y desaparece sola al cerrarla (no deja nada en la base).
CREATE TEMPORARY TABLE comprobacion_virtual (
    columna_modalidad_no_existe TINYINT NOT NULL DEFAULT 0,
    evento_no_existe TINYINT NOT NULL DEFAULT 0,
    categoria_estudiantes_no_existe TINYINT NOT NULL DEFAULT 0,
    categoria_publico_general_no_existe TINYINT NOT NULL DEFAULT 0
);

INSERT INTO comprobacion_virtual (columna_modalidad_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = DATABASE() AND table_name = 'tipos_inscripcion' AND column_name = 'modalidad'), 0, NULL));

SET @evento_id = NULL;
SELECT id INTO @evento_id FROM eventos WHERE codigo = @codigo_evento COLLATE utf8mb4_unicode_ci LIMIT 1;
INSERT INTO comprobacion_virtual (evento_no_existe) VALUES (IF(@evento_id IS NULL, NULL, 0));

INSERT INTO comprobacion_virtual (categoria_estudiantes_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM categorias_inscripcion WHERE evento_id = @evento_id AND codigo = 'ESTUDIANTES'), 0, NULL));

INSERT INTO comprobacion_virtual (categoria_publico_general_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM categorias_inscripcion WHERE evento_id = @evento_id AND codigo = 'PUBLICO_GENERAL'), 0, NULL));

-- ── Altas (una transacción: o quedan los dos tipos que faltaban, o ninguno) ──
START TRANSACTION;

INSERT INTO tipos_inscripcion
    (categoria_id, codigo, nombre, etiqueta, descripcion, caracteristicas, precio, precio_institucional, disponible_para, modalidad, activo, orden)
SELECT c.id, 'estudiantes_virtual', 'ESTUDIANTES', 'VIRTUAL',
       'Participación a distancia de estudiantes en las ponencias transmitidas del congreso.',
       CAST('[{"icon": "heroicons:computer-desktop", "text": "Participación virtual en las ponencias transmitidas"}, {"icon": "heroicons:x-mark", "text": "No incluye kit ni ingreso presencial"}]' AS JSON),
       30.00, 30.00, 'TODOS', 'VIRTUAL', @activo,
       (SELECT COALESCE(MAX(t.orden), 0) + 1 FROM tipos_inscripcion t WHERE t.categoria_id = c.id)
  FROM categorias_inscripcion c
 WHERE c.evento_id = @evento_id AND c.codigo = 'ESTUDIANTES'
   AND NOT EXISTS (SELECT 1 FROM tipos_inscripcion x WHERE x.categoria_id = c.id AND x.codigo = 'estudiantes_virtual');
SET @insertados_estudiantes = ROW_COUNT();

INSERT INTO tipos_inscripcion
    (categoria_id, codigo, nombre, etiqueta, descripcion, caracteristicas, precio, precio_institucional, disponible_para, modalidad, activo, orden)
SELECT c.id, 'general_virtual', 'PROFESIONALES Y PUBLICO EN GENERAL', 'VIRTUAL',
       'Participación a distancia de profesionales y público en general en las ponencias transmitidas del congreso.',
       CAST('[{"icon": "heroicons:computer-desktop", "text": "Participación virtual en las ponencias transmitidas"}, {"icon": "heroicons:x-mark", "text": "No incluye kit ni ingreso presencial"}]' AS JSON),
       50.00, 50.00, 'TODOS', 'VIRTUAL', @activo,
       (SELECT COALESCE(MAX(t.orden), 0) + 1 FROM tipos_inscripcion t WHERE t.categoria_id = c.id)
  FROM categorias_inscripcion c
 WHERE c.evento_id = @evento_id AND c.codigo = 'PUBLICO_GENERAL'
   AND NOT EXISTS (SELECT 1 FROM tipos_inscripcion x WHERE x.categoria_id = c.id AND x.codigo = 'general_virtual');
SET @insertados_general = ROW_COUNT();

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Primera ejecución: insertados = 1 y 1. Repetida: 0 y 0 (ya existían; no se tocó nada).
SELECT @codigo_evento AS evento, @insertados_estudiantes AS insertados_estudiantes, @insertados_general AS insertados_general;

SELECT e.codigo AS evento, c.codigo AS categoria, t.id, t.codigo, t.nombre, t.etiqueta, t.precio, t.precio_institucional,
       t.disponible_para, t.modalidad, t.activo, t.orden,
       JSON_UNQUOTE(JSON_EXTRACT(t.caracteristicas, '$[0].text')) AS caracteristica_1,
       JSON_UNQUOTE(JSON_EXTRACT(t.caracteristicas, '$[1].text')) AS caracteristica_2
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.codigo IN ('estudiantes_virtual', 'general_virtual')
 ORDER BY c.orden, t.orden;
