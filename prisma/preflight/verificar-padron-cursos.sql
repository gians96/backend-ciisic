-- Spec 034 · Verificación después de `npm run padron:desde-jp -- --aplicar` (solo lectura).
-- Cambia @evento por el id del evento (VIII CIISIC = 2). Los conteos deben coincidir con los de la simulación.
SET @evento = 2;

-- 1) Cursos, matrículas y alumnos (SIVIRENO 2026-2 de Sistemas: 120 cursos y 2666 matrículas)
SELECT COUNT(*) AS cursos, SUM(asesor_id IS NULL) AS cursos_sin_docente FROM padron_cursos WHERE evento_id = @evento;
SELECT COUNT(*) AS matriculas, COUNT(DISTINCT codigo) AS alumnos_con_curso FROM padron_matriculas WHERE evento_id = @evento;
SELECT COUNT(*) AS estudiantes FROM padron_estudiantes WHERE evento_id = @evento;
SELECT COUNT(*) AS estudiantes_sin_curso
  FROM padron_estudiantes e
 WHERE e.evento_id = @evento
   AND NOT EXISTS (SELECT 1 FROM padron_matriculas m WHERE m.evento_id = e.evento_id AND m.codigo = e.codigo);
SELECT COUNT(*) AS estudiantes_sin_seccion
  FROM padron_estudiantes e
 WHERE e.evento_id = @evento
   AND NOT EXISTS (SELECT 1 FROM padron_secciones s WHERE s.evento_id = e.evento_id AND s.codigo = e.codigo);

-- 2) Docentes: todos de SIVIRENO, cuántos con DNI y con enlace personal (no se muestra el DNI)
SELECT COUNT(*) AS docentes,
       SUM(jp_docente_id IS NOT NULL) AS de_sivireno,
       SUM(documento IS NOT NULL) AS con_dni,
       SUM(enlace_token IS NOT NULL) AS con_enlace_personal
  FROM asesores WHERE evento_id = @evento;

-- 3) Cursos y alumnos distintos por docente (deben coincidir con la simulación)
SELECT a.nombre, a.documento IS NOT NULL AS tiene_dni,
       COUNT(DISTINCT c.id) AS cursos, COUNT(DISTINCT m.codigo) AS alumnos
  FROM asesores a
  LEFT JOIN padron_cursos c ON c.asesor_id = a.id
  LEFT JOIN padron_matriculas m ON m.curso_id = c.id
 WHERE a.evento_id = @evento
 GROUP BY a.id, a.nombre, a.documento
 ORDER BY alumnos DESC, a.nombre;

-- 4) Cursos con sus matriculados (primeros 15)
SELECT c.ciclo, c.seccion, c.nombre, c.docente_nombre, COUNT(m.codigo) AS alumnos
  FROM padron_cursos c LEFT JOIN padron_matriculas m ON m.curso_id = c.id
 WHERE c.evento_id = @evento
 GROUP BY c.id, c.ciclo, c.seccion, c.nombre, c.docente_nombre
 ORDER BY FIELD(c.ciclo, 'I','II','III','IV','V','VI','VII','VIII','IX','X'), c.seccion, c.nombre
 LIMIT 15;
