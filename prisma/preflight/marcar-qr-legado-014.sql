-- ============================================================================
-- Spec 014 · Marca el QR anterior (`es_qr_legado`) después de que la imagen anterior atendió con la
-- BD ya migrada: tras volver a la imagen 014 desde una vuelta atrás, o si el contenedor anterior
-- siguió atendiendo mientras arrancaba el nuevo (despliegue con solapamiento).
-- Por qué: la imagen anterior imprime en el QR el id del participante. Si aprobó, reenvió o descargó
-- la credencial de una inscripción que ya tenía código, ese QR se rechaza con
-- `422 LEGACY_QR_NOT_ALLOWED` hasta marcarla (`asegurarCodigoCredencial` solo marca las que no tienen
-- código). Marca todas las aprobadas o con credencial enviada: incluye algunas que nunca recibieron el
-- QR anterior (pueden presentarlo hasta el `fechaFin` del evento; el escáner lo muestra en ámbar).
-- Idempotente; no necesita `prisma migrate resolve`. Antes: respaldo con mysqldump.
-- ============================================================================

UPDATE inscripciones i
  JOIN estados_inscripcion e ON e.id = i.estado_id
   SET i.es_qr_legado = true
 WHERE (e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL) AND i.es_qr_legado = false;

-- Debe salir 0
SELECT COUNT(*) AS sin_marca_qr_anterior
  FROM inscripciones i
  JOIN estados_inscripcion e ON e.id = i.estado_id
 WHERE (e.codigo = 'APROBADO' OR i.credencial_enviada_en IS NOT NULL) AND i.es_qr_legado = false;
