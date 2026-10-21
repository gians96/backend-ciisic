-- ============================================================================
-- Spec 023 · Crea el tipo de inscripción «Delegación virtual» de un evento (datos de producción).
-- IDEMPOTENTE y NO DESTRUCTIVO: solo INSERT ... SELECT ... WHERE NOT EXISTS. No hay DROP, DELETE,
-- TRUNCATE ni UPDATE: si el tipo ya existe (mismo evento, categoría y código) no se toca, aunque
-- alguien lo haya editado en el panel. Se puede ejecutar varias veces.
--
-- Qué crea, en el evento cuyo código se fija en @codigo_evento (por defecto ciisic-viii-2026):
--   categoría DELEGACIONES -> delegacion_virtual «DELEGACION VIRTUAL»  VIRTUAL  S/ 30
-- precio = precio_institucional (el descuento es 0 con cualquier correo), disponible_para = TODOS,
-- modalidad = VIRTUAL, orden = (máximo de la categoría) + 1. Una delegación virtual paga S/ 30 por
-- persona sin escalas: el backend copia ese precio a la delegación al crearla.
-- El código `delegacion_virtual` es contrato (spec 023): con él el servidor tipifica y tarifica a los
-- grupos virtuales. Mientras no exista, la modalidad virtual de delegaciones no se ofrece.
--
-- Requisitos (si falta alguno, el script ABORTA sin escribir nada):
--   1) Las migraciones de la spec 023 ya se aplicaron (tabla delegacion_pagos; `prisma migrate deploy`).
--   2) El evento existe y tiene la categoría DELEGACIONES.
-- El aborto se ve como «ERROR 1048 Column '<comprobación>' cannot be null»; el nombre de la columna
-- dice qué falta (tabla_delegaciones_no_existe, evento_no_existe o categoria_delegaciones_no_existe).
--
-- Cuándo: es el ÚLTIMO paso del despliegue (respaldo -> backend -> panel y landing -> este script ->
-- verificar-delegacion-virtual.sql). También se puede crear desde el panel (Eventos -> Tipos de
-- inscripción, categoría DELEGACIONES, código `delegacion_virtual`, modalidad Virtual); es lo mismo.
--
-- Cómo ejecutarlo (siempre después del respaldo con mysqldump; ver docs/operacion.md):
--   mysql --default-character-set=utf8mb4 -u <usuario> -p <base_de_datos> < prisma/preflight/configurar-delegacion-virtual.sql
-- Con el cliente mysql el script se detiene en el primer error (no uses --force). No lleva USE: la base
-- la eliges tú en la línea de comandos. Antes de ejecutarlo revisa @codigo_evento y @activo.
-- ============================================================================

SET NAMES utf8mb4;

-- ── Parámetros ──────────────────────────────────────────────────────────────
SET @codigo_evento = 'ciisic-viii-2026';
-- 1 = el tipo nace activo; 0 = nace oculto y se activa desde el panel cuando la organización lo decida.
SET @activo = 1;

-- Las comprobaciones abortan con un error de "NULL en columna NOT NULL", que solo es error en modo estricto
SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, IF(@@SESSION.sql_mode = '', '', ','), 'STRICT_ALL_TABLES');

-- ── Comprobaciones previas: abortan si falta algo ───────────────────────────
-- Tabla TEMPORAL: vive solo en esta sesión y desaparece sola al cerrarla (no deja nada en la base).
CREATE TEMPORARY TABLE comprobacion_delegacion_virtual (
    tabla_delegaciones_no_existe TINYINT NOT NULL DEFAULT 0,
    evento_no_existe TINYINT NOT NULL DEFAULT 0,
    categoria_delegaciones_no_existe TINYINT NOT NULL DEFAULT 0
);

INSERT INTO comprobacion_delegacion_virtual (tabla_delegaciones_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = DATABASE() AND table_name = 'delegacion_pagos'), 0, NULL));

SET @evento_id = NULL;
SELECT id INTO @evento_id FROM eventos WHERE codigo = @codigo_evento COLLATE utf8mb4_unicode_ci LIMIT 1;
INSERT INTO comprobacion_delegacion_virtual (evento_no_existe) VALUES (IF(@evento_id IS NULL, NULL, 0));

INSERT INTO comprobacion_delegacion_virtual (categoria_delegaciones_no_existe)
VALUES (IF(EXISTS (SELECT 1 FROM categorias_inscripcion WHERE evento_id = @evento_id AND codigo = 'DELEGACIONES'), 0, NULL));

-- ── Alta (una transacción) ──────────────────────────────────────────────────
START TRANSACTION;

INSERT INTO tipos_inscripcion
    (categoria_id, codigo, nombre, etiqueta, descripcion, caracteristicas, precio, precio_institucional, disponible_para, modalidad, activo, orden)
SELECT c.id, 'delegacion_virtual', 'DELEGACION VIRTUAL', 'VIRTUAL',
       'Tarifa de inscripción para delegaciones que asisten de forma virtual. El costo por persona es de S/ 30.00, sin importar el número de participantes.',
       CAST('[{"icon": "heroicons:computer-desktop", "text": "Participación virtual en las ponencias transmitidas"}, {"icon": "heroicons:x-mark", "text": "No incluye kit ni ingreso presencial"}]' AS JSON),
       30.00, 30.00, 'TODOS', 'VIRTUAL', @activo,
       (SELECT COALESCE(MAX(t.orden), 0) + 1 FROM tipos_inscripcion t WHERE t.categoria_id = c.id)
  FROM categorias_inscripcion c
 WHERE c.evento_id = @evento_id AND c.codigo = 'DELEGACIONES'
   AND NOT EXISTS (SELECT 1 FROM tipos_inscripcion x WHERE x.categoria_id = c.id AND x.codigo = 'delegacion_virtual');
SET @insertados = ROW_COUNT();

COMMIT;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Primera ejecución: insertados = 1. Repetida: 0 (ya existía; no se tocó nada).
SELECT @codigo_evento AS evento, @insertados AS insertados;

SELECT e.codigo AS evento, c.codigo AS categoria, t.id, t.codigo, t.nombre, t.etiqueta, t.precio, t.precio_institucional,
       t.disponible_para, t.modalidad, t.activo, t.orden
  FROM tipos_inscripcion t
  JOIN categorias_inscripcion c ON c.id = t.categoria_id
  JOIN eventos e ON e.id = c.evento_id
 WHERE e.codigo = @codigo_evento COLLATE utf8mb4_unicode_ci AND c.codigo = 'DELEGACIONES'
 ORDER BY t.orden;
