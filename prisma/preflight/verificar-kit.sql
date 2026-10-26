-- ============================================================================
-- Spec 037 · Verificación de «Incluye kit» (SOLO LECTURA, no modifica nada)
-- Correr después de aplicar la migración `20261027180000_entrega_kit`. Cada tipo debe estar donde corresponde:
-- los «CON KIT» con incluye_kit = 1 y el resto (SIN KIT, virtuales) en 0. Cualquier otro se corrige desde
-- Eventos → Tipos (interruptor «Incluye kit»).
-- ============================================================================

-- 1) Tipos del evento principal (también los planes de las delegaciones: categoría DELEGACION_<id>)
SELECT e.codigo AS evento,
       c.codigo AS categoria,
       t.id,
       t.codigo,
       t.etiqueta,
       t.modalidad,
       t.incluye_kit,
       t.activo,
       (SELECT COUNT(*) FROM inscripciones i WHERE i.tipo_inscripcion_id = t.id) AS inscripciones
FROM tipos_inscripcion t
JOIN categorias_inscripcion c ON c.id = t.categoria_id
JOIN eventos e ON e.id = c.evento_id
ORDER BY e.id, c.orden, t.orden, t.id;

-- 2) Sospechosos: dicen «kit» en el código o la etiqueta pero no coinciden con la bandera
SELECT t.id, t.codigo, t.etiqueta, t.modalidad, t.incluye_kit
FROM tipos_inscripcion t
WHERE (UPPER(CONCAT(t.codigo, ' ', COALESCE(t.etiqueta, ''))) LIKE '%CON%KIT%' AND t.incluye_kit = 0)
   OR (UPPER(CONCAT(t.codigo, ' ', COALESCE(t.etiqueta, ''))) LIKE '%SIN%KIT%' AND t.incluye_kit = 1)
   OR (t.modalidad = 'VIRTUAL' AND t.incluye_kit = 1);

-- 3) Entregas registradas (debe estar vacío antes del evento)
SELECT COUNT(*) AS kits_entregados FROM inscripciones WHERE kit_entregado_en IS NOT NULL;
