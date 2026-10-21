-- ============================================================================
-- Spec 023 · Verifica (SOLO LECTURA) que las delegaciones con convenio están listas en un evento:
--   1) el esquema de la spec 023 (tablas y columnas) existe;
--   2) los tres tipos de contrato de la categoría DELEGACIONES existen, activos y con el precio y la
--      modalidad esperados (60 y 50 presenciales, 30 virtual);
--   3) lo que ya se registró (delegaciones, integrantes y vouchers).
-- No hay INSERT, UPDATE ni DELETE. Se puede ejecutar cuantas veces haga falta.
--
--   mysql --default-character-set=utf8mb4 -u <usuario> -p <base_de_datos> < prisma/preflight/verificar-delegacion-virtual.sql
-- ============================================================================

SET NAMES utf8mb4;
SET @codigo_evento = 'ciisic-viii-2026';

-- 1) Esquema: las cinco comprobaciones deben dar 1
SELECT
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'delegaciones') AS tabla_delegaciones,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'delegacion_pagos') AS tabla_delegacion_pagos,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'delegaciones' AND column_name = 'modalidad') AS columna_modalidad,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inscripciones' AND column_name = 'delegacion_id') AS columna_delegacion_id,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'eventos' AND column_name = 'delegaciones_min_integrantes') AS columna_min_integrantes;

-- 2) Tipos de contrato: deben salir tres filas con estado OK
--    (delegacion_general 60, delegacion_grupal 50, delegacion_virtual 30 VIRTUAL, todas activas)
SELECT t.id, t.codigo, t.nombre, t.precio, t.precio_institucional, t.modalidad, t.disponible_para, t.activo, t.orden,
       CASE
           WHEN t.codigo = 'delegacion_general' AND t.precio = 60 AND t.modalidad = 'PRESENCIAL' AND t.activo = 1 THEN 'OK'
           WHEN t.codigo = 'delegacion_grupal' AND t.precio = 50 AND t.modalidad = 'PRESENCIAL' AND t.activo = 1 THEN 'OK'
           WHEN t.codigo = 'delegacion_virtual' AND t.precio = 30 AND t.modalidad = 'VIRTUAL' AND t.activo = 1 THEN 'OK'
           ELSE 'REVISAR'
       END AS estado
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND c.codigo = 'DELEGACIONES'
 ORDER BY t.orden;

-- 3) Delegaciones registradas: integrantes activos, tipo vigente y vouchers declarados
SELECT d.id, d.nombre, d.modalidad, d.min_integrantes, d.precio_estandar, d.precio_promocional, t.codigo AS tipo_vigente,
       (SELECT COUNT(*) FROM inscripciones i JOIN estados_inscripcion s ON s.id = i.estado_id
         WHERE i.delegacion_id = d.id AND s.codigo NOT IN ('RECHAZADO', 'CANCELADO')) AS integrantes,
       (SELECT COUNT(*) FROM delegacion_pagos p WHERE p.delegacion_id = d.id) AS vouchers,
       (SELECT COALESCE(SUM(p.monto), 0) FROM delegacion_pagos p WHERE p.delegacion_id = d.id AND p.estado <> 'RECHAZADO') AS declarado,
       d.activo
  FROM delegaciones d
  JOIN eventos e ON e.id = d.evento_id
  LEFT JOIN tipos_inscripcion t ON t.id = d.tipo_inscripcion_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci
 ORDER BY d.id;
