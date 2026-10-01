-- ============================================================================
-- Spec 015 · Reversión de 20261001150000_certificados si quedó a medias (error P3009).
-- MySQL no revierte DDL: cada paso se ejecuta solo si el objeto existe (se puede repetir). Después:
--   npx prisma migrate resolve --rolled-back 20261001150000_certificados
-- y volver a desplegar (la migración se aplica de nuevo desde cero). Con `set -e` en
-- docker-entrypoint.sh el contenedor principal no arranca mientras la migración esté fallida: ejecutar
-- esto y el `migrate resolve` en un contenedor aparte con la misma imagen y la misma DATABASE_URL.
-- Volver a la imagen anterior NO exige revertir: el esquema nuevo es aditivo y la imagen anterior
-- funciona con él. Revertir BORRA los tipos, las plantillas y los certificados (con sus estados,
-- códigos y firmas registradas) y la configuración de certificados de `configuracion_sistema`
-- (incluidas las credenciales UNDC); los archivos de uploads/certificados quedan en disco.
-- Antes: respaldo con mysqldump (y de uploads/certificados si ya hay firmados).
-- Ejecutar con el cliente mysql (usa DELIMITER).
-- ============================================================================

DROP PROCEDURE IF EXISTS revertir_015;
DELIMITER //
CREATE PROCEDURE revertir_015()
BEGIN
    DECLARE esquema VARCHAR(64) DEFAULT DATABASE();

    -- Certificados (primero: referencia a tipos y plantillas)
    DROP TABLE IF EXISTS certificados;
    DROP TABLE IF EXISTS plantillas_certificado;
    DROP TABLE IF EXISTS tipos_certificado;

    -- Columnas certificados_* de la configuración del sistema
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_prefijo') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_prefijo;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_proveedor') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_proveedor;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_proveedor_confirmado') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_proveedor_confirmado;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_secreto_cifrado') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_secreto_cifrado;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_secreto_sufijo') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_secreto_sufijo;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_timeout_ms') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_timeout_ms;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_ultima_prueba_en') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_ultima_prueba_en;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_ultimo_error') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_ultimo_error;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_ultimo_estado') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_ultimo_estado;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_url') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_url;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = esquema AND table_name = 'configuracion_sistema' AND column_name = 'certificados_undc_usuario') THEN
        ALTER TABLE configuracion_sistema DROP COLUMN certificados_undc_usuario;
    END IF;
END //
DELIMITER ;
CALL revertir_015();
DROP PROCEDURE revertir_015;
