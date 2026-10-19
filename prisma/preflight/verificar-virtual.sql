-- ============================================================================
-- Spec 018 · Verificación de la modalidad virtual (SOLO LECTURA: únicamente SELECT).
-- Se puede ejecutar antes y después de configurar-virtual.sql y de desplegar:
--   mysql --default-character-set=utf8mb4 -u <usuario> -p <base_de_datos> < prisma/preflight/verificar-virtual.sql
-- Esperado tras migrar y crear los tipos (evento ciisic-viii-2026):
--   1) la columna modalidad existe (NOT NULL, DEFAULT 'PRESENCIAL');
--   2) los tipos anteriores siguen PRESENCIAL; los dos nuevos son VIRTUAL;
--   3) los tipos virtuales cumplen precio = precio_institucional, disponible_para TODOS y no
--      prometen certificado ni horas: todas las anomalías en 0;
--   4) ningún tipo «VIRTUAL» (por etiqueta o por código) con otra modalidad: la comprobación 5 debe salir
--      vacía. Si aparece uno, se creó o se editó desde el panel con el backend anterior, que descarta la
--      modalidad en silencio: corrige su Modalidad desde el panel (con el backend ya desplegado);
--   5) prisma migrate diff … --exit-code debe salir 0.
-- ============================================================================

SET NAMES utf8mb4;
SET @codigo_evento = 'ciisic-viii-2026';

-- 1) La columna (debe devolver una fila: ENUM('PRESENCIAL','VIRTUAL'), NO, PRESENCIAL)
SELECT column_name, column_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'tipos_inscripcion' AND column_name = 'modalidad';

-- 2) Tipos por evento y modalidad (los anteriores deben seguir en PRESENCIAL)
SELECT e.codigo AS evento, t.modalidad, COUNT(*) AS tipos, SUM(t.activo = 1) AS activos
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 GROUP BY e.codigo, t.modalidad
 ORDER BY e.codigo, t.modalidad;

-- 3) Los tipos virtuales del evento
SELECT e.codigo AS evento, c.codigo AS categoria, t.id, t.codigo, t.nombre, t.etiqueta, t.precio, t.precio_institucional,
       t.disponible_para, t.modalidad, t.activo, t.orden
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.modalidad = 'VIRTUAL'
 ORDER BY c.orden, t.orden;

-- 4) Anomalías de los tipos virtuales (todas deben ser 0)
SELECT COUNT(*) AS virtuales,
       SUM(t.precio <> t.precio_institucional) AS con_descuento,
       SUM(t.disponible_para <> 'TODOS') AS no_para_todos,
       SUM(c.codigo NOT IN ('ESTUDIANTES', 'PUBLICO_GENERAL')) AS en_otra_categoria,
       SUM(t.etiqueta IS NULL OR t.etiqueta <> 'VIRTUAL') AS sin_etiqueta_virtual,
       SUM(COALESCE(t.descripcion, '') REGEXP 'certific|hora' OR COALESCE(CAST(t.caracteristicas AS CHAR), '') REGEXP 'certific|hora') AS promete_certificado_u_horas
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.modalidad = 'VIRTUAL';

-- 5) Tipos «VIRTUAL» que NO son VIRTUAL (debe devolver CERO filas). Son los que se crearon o editaron desde
--    el panel antes de desplegar el backend: el backend anterior descarta la modalidad y el tipo queda
--    PRESENCIAL, con su precio de 30 o 50 y la etiqueta «VIRTUAL», sin que nada falle. La comprobación 4
--    no los ve porque solo mira los tipos que ya son VIRTUAL.
SELECT e.codigo AS evento, c.codigo AS categoria, t.id, t.codigo, t.nombre, t.etiqueta, t.precio, t.activo, t.modalidad
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.modalidad <> 'VIRTUAL'
   AND (t.codigo IN ('estudiantes_virtual', 'general_virtual') OR t.etiqueta = 'VIRTUAL')
 ORDER BY c.orden, t.orden;

-- 6) Los dos tipos esperados existen exactamente una vez (cada uno debe dar 1)
SELECT t.codigo, COUNT(*) AS veces
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND t.codigo IN ('estudiantes_virtual', 'general_virtual')
 GROUP BY t.codigo;

-- 7) Inscripciones por modalidad del tipo (las que no tienen tipo, cortesías, cuentan como PRESENCIAL)
SELECT COALESCE(t.modalidad, 'PRESENCIAL') AS modalidad, e.codigo AS estado, COUNT(*) AS inscripciones, SUM(i.monto) AS monto
  FROM inscripciones i
  JOIN eventos ev ON ev.id = i.evento_id
  JOIN estados_inscripcion e ON e.id = i.estado_id
  LEFT JOIN tipos_inscripcion t ON t.id = i.tipo_inscripcion_id
 WHERE ev.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci
 GROUP BY COALESCE(t.modalidad, 'PRESENCIAL'), e.codigo
 ORDER BY modalidad, estado;

-- 8) Lo que no se toca debe seguir igual que antes (comparar con el respaldo)
SELECT 'inscripciones' AS tabla, COUNT(*) AS filas FROM inscripciones
UNION ALL SELECT 'participantes', COUNT(*) FROM participantes
UNION ALL SELECT 'tipos_inscripcion', COUNT(*) FROM tipos_inscripcion
UNION ALL SELECT 'categorias_inscripcion', COUNT(*) FROM categorias_inscripcion;
