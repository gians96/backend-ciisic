-- Spec 033 · Verificación después de `npm run padron:desde-jp -- --aplicar` (solo lectura).
-- Cambia @evento por el id del evento (VIII CIISIC = 2). Los conteos deben coincidir con los de la simulación.
SET @evento = 2;

-- 1) Estudiantes del padrón y sus secciones (todos deben tener al menos una)
SELECT COUNT(*) AS estudiantes FROM padron_estudiantes WHERE evento_id = @evento;
SELECT COUNT(*) AS estudiantes_sin_seccion
  FROM padron_estudiantes e
 WHERE e.evento_id = @evento
   AND NOT EXISTS (SELECT 1 FROM padron_secciones s WHERE s.evento_id = e.evento_id AND s.codigo = e.codigo);
SELECT COUNT(*) AS estudiantes_en_varios_grupos
  FROM (SELECT codigo FROM padron_secciones WHERE evento_id = @evento GROUP BY codigo HAVING COUNT(*) > 1) t;

-- 2) Alumnos por grupo (uno cuenta en cada grupo en que cursa)
SELECT ciclo, seccion, turno, COUNT(*) AS alumnos
  FROM padron_secciones WHERE evento_id = @evento
 GROUP BY ciclo, seccion, turno
 ORDER BY FIELD(ciclo, 'I','II','III','IV','V','VI','VII','VIII','IX','X'), seccion;

-- 3) Secciones del padrón sin ningún docente (deben ser 0 filas)
SELECT s.ciclo, s.seccion, COUNT(*) AS alumnos
  FROM padron_secciones s
 WHERE s.evento_id = @evento
   AND NOT EXISTS (SELECT 1 FROM asesores_secciones a WHERE a.evento_id = s.evento_id AND a.ciclo = s.ciclo AND a.seccion = s.seccion)
 GROUP BY s.ciclo, s.seccion;

-- 4) Docentes: cuántos tienen DNI y secciones (no se muestra el DNI)
SELECT COUNT(*) AS docentes,
       SUM(documento IS NOT NULL) AS con_dni,
       SUM(enlace_token IS NOT NULL) AS con_enlace_personal
  FROM asesores WHERE evento_id = @evento;
SELECT a.nombre, a.documento IS NOT NULL AS tiene_dni,
       GROUP_CONCAT(CONCAT(s.ciclo, '-', s.seccion) ORDER BY s.ciclo, s.seccion SEPARATOR ' ') AS secciones
  FROM asesores a LEFT JOIN asesores_secciones s ON s.asesor_id = a.id
 WHERE a.evento_id = @evento
 GROUP BY a.id, a.nombre, a.documento
 ORDER BY a.nombre;
