-- ============================================================================
-- Spec 029 · Verifica (SOLO LECTURA) que las delegaciones con planes propios quedaron listas:
--   1) el esquema de la spec 029 existe y lo que ella retiró ya no está;
--   2) la categoría compartida DELEGACIONES (spec 023) ya no existe;
--   3) cada delegación tiene su categoría oculta y sus tres planes (CON KIT, SIN KIT y VIRTUAL);
--   4) ninguna inscripción de una delegación quedó sin plan ni con un tipo de otra delegación;
--   5) el resumen de cada delegación: planes activos, integrantes y lo que suman.
-- No hay INSERT, UPDATE ni DELETE. Se puede ejecutar cuantas veces haga falta.
--
--   mysql --default-character-set=utf8mb4 -u <usuario> -p <base_de_datos> < prisma/preflight/verificar-delegaciones-planes.sql
-- ============================================================================

SET NAMES utf8mb4;

-- 1) Esquema: las cinco primeras comprobaciones deben dar 1 y las cuatro últimas 0
SELECT
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'delegaciones' AND column_name = 'dominio_correo') AS dominio_correo,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'delegaciones' AND column_name = 'codigo_inscripcion') AS codigo_inscripcion,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'tipos_inscripcion' AND column_name = 'precio_promocional') AS precio_promocional,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'categorias_inscripcion' AND column_name = 'delegacion_id') AS categoria_delegacion_id,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'delegacion_pagos') AS tabla_delegacion_pagos,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'delegaciones' AND column_name IN ('modalidad', 'precio_estandar', 'precio_promocional', 'tipo_inscripcion_id')) AS columnas_retiradas_de_delegaciones,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'eventos' AND column_name LIKE 'delegaciones\_%') AS columnas_retiradas_de_eventos;

-- 2) Debe dar 0: la categoría compartida DELEGACIONES ya no existe en ningún evento
SELECT COUNT(*) AS categorias_DELEGACIONES_restantes FROM categorias_inscripcion WHERE codigo = 'DELEGACIONES';

-- 3) Delegaciones sin sus tres planes (debe salir vacío)
SELECT d.id, d.nombre,
       (SELECT COUNT(*) FROM categorias_inscripcion c WHERE c.delegacion_id = d.id) AS categorias,
       (SELECT COUNT(*) FROM tipos_inscripcion t JOIN categorias_inscripcion c ON c.id = t.categoria_id
         WHERE c.delegacion_id = d.id AND t.codigo IN ('delegacion_con_kit', 'delegacion_sin_kit', 'delegacion_virtual')) AS planes
  FROM delegaciones d
HAVING categorias <> 1 OR planes <> 3;

-- 4) Integrantes sin plan o con el plan de otra delegación (debe salir vacío)
SELECT i.id, i.delegacion_id, i.tipo_inscripcion_id, c.delegacion_id AS delegacion_del_plan
  FROM inscripciones i
  LEFT JOIN tipos_inscripcion t ON t.id = i.tipo_inscripcion_id
  LEFT JOIN categorias_inscripcion c ON c.id = t.categoria_id
 WHERE i.delegacion_id IS NOT NULL
   AND (i.tipo_inscripcion_id IS NULL OR c.delegacion_id IS NULL OR c.delegacion_id <> i.delegacion_id);

-- 5) Resumen por delegación: planes activos, integrantes activos y lo que suman sus montos
SELECT d.id, d.nombre, d.min_integrantes, d.dominio_correo, IF(d.codigo_inscripcion IS NULL, 'apagado', 'activo') AS link_individual,
       (SELECT GROUP_CONCAT(CONCAT(t.etiqueta, ' S/ ', t.precio, IF(t.precio_promocional IS NULL, '', CONCAT(' (promo ', t.precio_promocional, ')'))) ORDER BY t.orden SEPARATOR ' · ')
          FROM tipos_inscripcion t JOIN categorias_inscripcion c ON c.id = t.categoria_id WHERE c.delegacion_id = d.id AND t.activo = 1) AS planes_activos,
       (SELECT COUNT(*) FROM inscripciones i JOIN estados_inscripcion s ON s.id = i.estado_id
         WHERE i.delegacion_id = d.id AND s.codigo NOT IN ('RECHAZADO', 'CANCELADO')) AS integrantes,
       (SELECT COALESCE(SUM(i.monto), 0) FROM inscripciones i JOIN estados_inscripcion s ON s.id = i.estado_id
         WHERE i.delegacion_id = d.id AND s.codigo NOT IN ('RECHAZADO', 'CANCELADO')) AS total_a_pagar,
       (SELECT COUNT(*) FROM delegacion_pagos p WHERE p.delegacion_id = d.id) AS vouchers
  FROM delegaciones d
 ORDER BY d.id;
