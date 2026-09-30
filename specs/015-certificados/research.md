> **Borrador de diseño (2026-09-30).** Generado por arquitectos y revisado adversarialmente antes de la spec.
> Donde contradiga a `spec.md`/`plan.md` de esta carpeta o a la reconciliación de abajo, **mandan la spec y el plan**.
>
> Reconciliación transversal (acordada con el usuario):
> - Permisos con punto de `src/core/permisos.ts` (p. ej. `asistencia.marcar`, `certificados.operar`); los nombres `ASISTENCIA_REGISTRAR`, `GESTION`, etc. quedan reemplazados.
> - Columnas de `asistencias` (`metodo` ENUM QR/QR_LEGADO/DOCUMENTO/MANUAL, `registrado_por_id`, `es_fuera_de_horario`, `anulado_en`, `anulado_por_id`) van en la migración de la spec 013; la anulación es lógica y volver a marcar reactiva la fila.
> - Cambio staff → portal: `POST /v1/auth/participant/switch` (spec 014). El código por correo se envía también a cuentas vinculadas a Google.
> - Reinscripción sin verificación: se **conserva** el correo registrado (sin 409) y se avisa (`correoConservado`).
> - Código de inscripción: columna `codigo_credencial`. Foto para el escáner: `GET /v1/inscriptions/:id/photo`.
> - Configuración de certificados en columnas `certificados_*` de `configuracion_sistema` (no tabla aparte); credenciales UNDC solo Owner (Sistema); el resto con `certificados.gestionar`. Descarga para firmar solo con proveedor confirmado.
> - Certificados: editor visual (pdfjs-dist) en la primera fase; el portal muestra solo los FIRMADOS.
> - Sesión del staff renovable con `POST /v1/auth/refresh`; participante 12 h.

# Bloque C, certificados: diseño final (backend spec 015 y panel spec 010)

## 1) Resumen

- **Modelo nuevo.** Tipos de certificado por código. Plantilla PDF por evento con campos posicionados. Certificado con **código fijo y aleatorio** asignado antes de firmar, con el ciclo PENDIENTE → PREPARADO → (EN_FIRMA) → FIRMADO | ANULADO. Configuración del proveedor del código: LOCAL ahora; la API de la UNDC queda como adaptador pendiente que responde 501.
- **Motor.** `pdf-lib` estampa sobre el PDF de diseño, con fuentes TTF incluidas y QR vectorial. Puppeteer se queda solo para la credencial.
- **Sin procesos en segundo plano ni subidas grandes.** Generar y subir firmados se hace **en tandas síncronas, idempotentes y reanudables** que maneja el panel: 10 certificados por solicitud y ≤10 MB por subida. El ZIP de firmados se abre en el navegador. Con esto desaparecen el procesador de lotes, yauzl, los temporales y los problemas de BFF/Traefik que señaló la crítica.
- **Un firmado solo se acepta si coincide con lo que se generó.** Se compara el prefijo de bytes (SHA-256) o, si la herramienta reescribió el archivo, el `Subject` `ciisic:<código>:<generación>`. Si no coincide, se rechaza; solo GESTION puede forzar un caso individual y queda auditado. Las firmas se cuentan con los campos `/Sig` que tienen `/V`, sin contar los `/DocTimeStamp`.
- **Salidas.** Portal `/v1/me/certificates` (solo FIRMADO descargable) y verificación pública en una familia nueva `/v1/public/*`, con enmienda de la constitución, sin documento y con 404 para todo lo que no sea FIRMADO ni ANULADO. Se despliega **después del evento** (31-oct o más tarde); antes del 26-oct solo hay insumos y decisiones (F0).

---

## 2) Modelo de datos

**Relaciones inversas en modelos existentes:**
- `Administrador` (`schema.prisma:40-42`): `plantillasCertificado`, `certificadosEmitidos`, `certificadosEditados`, `certificadosFirmadosCargados`, `certificadosAnulados`, `configuracionesCertificados`.
- `Evento` (`:82-88`): `plantillasCertificado`, `certificados`.
- `Participante` (`:118-119`), `Inscripcion` (`:207-212`) y `Ponencia` (`:254-268`): `certificados`.

```prisma
// ─── Certificados (spec 015) ─────────────────────────────────────────────────
enum EstadoCertificado { PENDIENTE PREPARADO EN_FIRMA FIRMADO ANULADO }
enum CoincidenciaFirmado { PREFIJO METADATOS FORZADO }
enum EstadoRegistroExterno { NO_APLICA PENDIENTE REGISTRADO ERROR }
enum ProveedorCodigoCertificado { LOCAL UNDC }

model TipoCertificado {
  id           Int           @id @default(autoincrement())
  codigo       String        @unique(map: "uq_tipos_certificado_codigo") @db.VarChar(40)
  nombre       String        @db.VarChar(80)
  textoImpreso String        @map("texto_impreso") @db.VarChar(80)
  activo       Boolean       @default(true)
  orden        Int           @default(0)
  certificados Certificado[]
  @@map("tipos_certificado")
}

/// Diseño PDF por evento; `campos` en pt PDF (origen abajo-izquierda), validado con yup (≤30).
model PlantillaCertificado {
  id               Int            @id @default(autoincrement())
  eventoId         Int            @map("evento_id")
  nombre           String         @db.VarChar(120)
  archivoDiseno    String         @unique(map: "uq_plantillas_certificado_archivo") @map("archivo_diseno") @db.VarChar(80)
  archivoOriginal  String         @map("archivo_original") @db.VarChar(255)
  tamanoBytes      Int            @map("tamano_bytes")
  paginas          Int
  anchoPt          Float          @map("ancho_pt")
  altoPt           Float          @map("alto_pt")
  campos           Json
  horasPorDefecto  Int?           @map("horas_por_defecto")
  firmasRequeridas Int            @default(1) @map("firmas_requeridas")
  version          Int            @default(1)
  activa           Boolean        @default(true)
  creadoPorId      Int?           @map("creado_por_id")
  creadoEn         DateTime       @default(now()) @map("creado_en")
  actualizadoEn    DateTime       @updatedAt @map("actualizado_en")
  evento           Evento         @relation(fields: [eventoId], references: [id], map: "fk_plantillas_certificado_evento")
  creadoPor        Administrador? @relation("PlantillaCertificadoCreadaPor", fields: [creadoPorId], references: [id], onDelete: SetNull, map: "fk_plantillas_certificado_creado_por")
  certificados     Certificado[]
  @@index([eventoId], map: "idx_plantillas_certificado_evento")
  @@index([creadoPorId], map: "idx_plantillas_certificado_creado_por")
  @@map("plantillas_certificado")
}

model Certificado {
  id                    Int                    @id @default(autoincrement())
  eventoId              Int                    @map("evento_id")
  participanteId        Int                    @map("participante_id")
  tipoCertificadoId     Int                    @map("tipo_certificado_id")
  plantillaId           Int?                   @map("plantilla_id")
  inscripcionId         Int?                   @map("inscripcion_id")
  ponenciaId            String?                @map("ponencia_id") @db.VarChar(36)
  numero                Int
  codigo                String                 @unique(map: "uq_certificados_codigo") @db.VarChar(40)
  /// "<evento>:<participante>:<tipo>:<ponencia|->"; NULL solo si ANULADO (CHECK) → re-emisión posible
  claveVigente          String?                @unique(map: "uq_certificados_clave_vigente") @map("clave_vigente") @db.VarChar(80)
  estado                EstadoCertificado      @default(PENDIENTE)
  nombreImpreso         String                 @map("nombre_impreso") @db.VarChar(200)
  tipoDocumento         String                 @map("tipo_documento") @db.VarChar(10)
  numeroDocumento       String                 @map("numero_documento") @db.VarChar(20)
  detalle               String?                @db.VarChar(500)
  horas                 Int?
  fechaEmision          DateTime               @map("fecha_emision") @db.Date
  codigoImpreso         String?                @map("codigo_impreso") @db.VarChar(80)
  urlVerificacion       String?                @map("url_verificacion") @db.VarChar(255)
  plantillaVersion      Int?                   @map("plantilla_version")
  generacion            String?                @db.Char(8)
  archivoGenerado       String?                @map("archivo_generado") @db.VarChar(120)
  hashGenerado          String?                @map("hash_generado") @db.Char(64)
  bytesGenerado         Int?                   @map("bytes_generado")
  generadoEn            DateTime?              @map("generado_en")
  descargadoParaFirmarEn DateTime?             @map("descargado_para_firmar_en")
  archivoFirmado        String?                @map("archivo_firmado") @db.VarChar(120)
  hashFirmado           String?                @map("hash_firmado") @db.Char(64)
  firmasDetectadas      Int                    @default(0) @map("firmas_detectadas")
  coincidencia          CoincidenciaFirmado?
  motivoForzado         String?                @map("motivo_forzado") @db.VarChar(500)
  firmadoEn             DateTime?              @map("firmado_en")
  codigoExterno         String?                @unique(map: "uq_certificados_codigo_externo") @map("codigo_externo") @db.VarChar(80)
  registroExterno       EstadoRegistroExterno  @default(NO_APLICA) @map("registro_externo")
  registroExternoError  String?                @map("registro_externo_error") @db.VarChar(500)
  registradoExternoEn   DateTime?              @map("registrado_externo_en")
  anuladoEn             DateTime?              @map("anulado_en")
  motivoAnulacion       String?                @map("motivo_anulacion") @db.VarChar(500)
  emitidoPorId          Int?                   @map("emitido_por_id")
  editadoPorId          Int?                   @map("editado_por_id")
  firmadoCargadoPorId   Int?                   @map("firmado_cargado_por_id")
  anuladoPorId          Int?                   @map("anulado_por_id")
  creadoEn              DateTime               @default(now()) @map("creado_en")
  actualizadoEn         DateTime               @updatedAt @map("actualizado_en")
  evento                Evento                 @relation(fields: [eventoId], references: [id], map: "fk_certificados_evento")
  participante          Participante           @relation(fields: [participanteId], references: [id], map: "fk_certificados_participante")
  tipo                  TipoCertificado        @relation(fields: [tipoCertificadoId], references: [id], map: "fk_certificados_tipo")
  plantilla             PlantillaCertificado?  @relation(fields: [plantillaId], references: [id], onDelete: SetNull, map: "fk_certificados_plantilla")
  inscripcion           Inscripcion?           @relation(fields: [inscripcionId], references: [id], onDelete: SetNull, map: "fk_certificados_inscripcion")
  ponencia              Ponencia?              @relation(fields: [ponenciaId], references: [id], onDelete: SetNull, map: "fk_certificados_ponencia")
  emitidoPor            Administrador?         @relation("CertificadoEmitidoPor", fields: [emitidoPorId], references: [id], onDelete: SetNull, map: "fk_certificados_emitido_por")
  editadoPor            Administrador?         @relation("CertificadoEditadoPor", fields: [editadoPorId], references: [id], onDelete: SetNull, map: "fk_certificados_editado_por")
  firmadoCargadoPor     Administrador?         @relation("CertificadoFirmadoCargadoPor", fields: [firmadoCargadoPorId], references: [id], onDelete: SetNull, map: "fk_certificados_firmado_cargado_por")
  anuladoPor            Administrador?         @relation("CertificadoAnuladoPor", fields: [anuladoPorId], references: [id], onDelete: SetNull, map: "fk_certificados_anulado_por")
  @@unique([eventoId, numero], map: "uq_certificados_evento_numero")
  @@index([eventoId, estado], map: "idx_certificados_evento_estado")
  @@index([participanteId], map: "idx_certificados_participante")
  @@index([tipoCertificadoId], map: "idx_certificados_tipo")
  @@index([plantillaId], map: "idx_certificados_plantilla")
  @@index([inscripcionId], map: "idx_certificados_inscripcion")
  @@index([ponenciaId], map: "idx_certificados_ponencia")
  @@index([emitidoPorId], map: "idx_certificados_emitido_por")
  @@index([editadoPorId], map: "idx_certificados_editado_por")
  @@index([firmadoCargadoPorId], map: "idx_certificados_firmado_cargado_por")
  @@index([anuladoPorId], map: "idx_certificados_anulado_por")
  @@map("certificados")
}

/// Fila única (id = 1). PUT solo OWNER; url/prefijo se bloquean cuando existe un certificado generado.
model ConfiguracionCertificados {
  id                 Int                        @id @default(1)
  proveedorCodigo    ProveedorCodigoCertificado @default(LOCAL) @map("proveedor_codigo")
  prefijoCodigo      String                     @default("CIISIC") @map("prefijo_codigo") @db.VarChar(20)
  urlVerificacion    String?                    @map("url_verificacion") @db.VarChar(255)
  undcUrl            String?                    @map("undc_url") @db.VarChar(255)
  undcUsuario        String?                    @map("undc_usuario") @db.VarChar(191)
  undcSecretoCifrado String?                    @map("undc_secreto_cifrado") @db.Text
  undcSecretoSufijo  String?                    @map("undc_secreto_sufijo") @db.VarChar(8)
  undcTimeoutMs      Int                        @default(10000) @map("undc_timeout_ms")
  undcUltimoEstado   EstadoIntegracion?         @map("undc_ultimo_estado")
  undcUltimoError    String?                    @map("undc_ultimo_error") @db.VarChar(500)
  undcUltimaPruebaEn DateTime?                  @map("undc_ultima_prueba_en")
  actualizadoPorId   Int?                       @map("actualizado_por_id")
  creadoEn           DateTime                   @default(now()) @map("creado_en")
  actualizadoEn      DateTime                   @updatedAt @map("actualizado_en")
  actualizadoPor     Administrador?             @relation("ConfiguracionCertificadosEditadaPor", fields: [actualizadoPorId], references: [id], onDelete: SetNull, map: "fk_configuracion_certificados_actualizado_por")
  @@index([actualizadoPorId], map: "idx_configuracion_certificados_actualizado_por")
  @@map("configuracion_certificados")
}
```

**`campos` (yup en `validation.ts`, máximo 30 campos):**
- Cada campo: `{id, tipo: NOMBRE|TIPO|CODIGO|QR|FECHA_EMISION|HORAS|EVENTO|DOCUMENTO|DETALLE|TEXTO, pagina, x, y (línea base), ancho?, fuente?, tamano 4–200, tamanoMinimo?, color #rrggbb, alineacion IZQUIERDA|CENTRO|DERECHA, capitalizacion ORIGINAL|MAYUSCULAS|TITULO, lineasMax, interlineado, texto? con marcadores {nombre} {tipo} {evento} {eventoCorto} {horas} {fecha} {detalle} {codigo} {documento}, formatoFecha LARGO|CORTO}`.
- QR: lado de 36 a 300 pt, anclado en su esquina inferior izquierda.

**Migración escrita a mano** (`prisma/migrations/2026110XHHMMSS_certificados/migration.sql`; la fecha real se pone al crearla y debe ser posterior a las migraciones de 013 y 014):

```sql
-- ============================================================================
-- Spec 015 · Certificados
-- Tipos, plantillas PDF por evento, certificados con código fijo antes de firmar y
-- configuración del proveedor de códigos (LOCAL; UNDC pendiente). Solo crea tablas:
-- si falla a medias, DROP TABLE IF EXISTS de estas 4 tablas y
-- `prisma migrate resolve --rolled-back <carpeta>` (docs/operacion.md).
-- ============================================================================
CREATE TABLE `tipos_certificado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `codigo` VARCHAR(40) NOT NULL,
    `nombre` VARCHAR(80) NOT NULL,
    `texto_impreso` VARCHAR(80) NOT NULL,
    `activo` BOOLEAN NOT NULL DEFAULT true,
    `orden` INTEGER NOT NULL DEFAULT 0,
    UNIQUE INDEX `uq_tipos_certificado_codigo`(`codigo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `plantillas_certificado` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `nombre` VARCHAR(120) NOT NULL,
    `archivo_diseno` VARCHAR(80) NOT NULL,
    `archivo_original` VARCHAR(255) NOT NULL,
    `tamano_bytes` INTEGER NOT NULL,
    `paginas` INTEGER NOT NULL,
    `ancho_pt` DOUBLE NOT NULL,
    `alto_pt` DOUBLE NOT NULL,
    `campos` JSON NOT NULL,
    `horas_por_defecto` INTEGER NULL,
    `firmas_requeridas` INTEGER NOT NULL DEFAULT 1,
    `version` INTEGER NOT NULL DEFAULT 1,
    `activa` BOOLEAN NOT NULL DEFAULT true,
    `creado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,
    UNIQUE INDEX `uq_plantillas_certificado_archivo`(`archivo_diseno`),
    INDEX `idx_plantillas_certificado_evento`(`evento_id`),
    INDEX `idx_plantillas_certificado_creado_por`(`creado_por_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `certificados` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `evento_id` INTEGER NOT NULL,
    `participante_id` INTEGER NOT NULL,
    `tipo_certificado_id` INTEGER NOT NULL,
    `plantilla_id` INTEGER NULL,
    `inscripcion_id` INTEGER NULL,
    `ponencia_id` VARCHAR(36) NULL,
    `numero` INTEGER NOT NULL,
    `codigo` VARCHAR(40) NOT NULL,
    `clave_vigente` VARCHAR(80) NULL,
    `estado` ENUM('PENDIENTE', 'PREPARADO', 'EN_FIRMA', 'FIRMADO', 'ANULADO') NOT NULL DEFAULT 'PENDIENTE',
    `nombre_impreso` VARCHAR(200) NOT NULL,
    `tipo_documento` VARCHAR(10) NOT NULL,
    `numero_documento` VARCHAR(20) NOT NULL,
    `detalle` VARCHAR(500) NULL,
    `horas` INTEGER NULL,
    `fecha_emision` DATE NOT NULL,
    `codigo_impreso` VARCHAR(80) NULL,
    `url_verificacion` VARCHAR(255) NULL,
    `plantilla_version` INTEGER NULL,
    `generacion` CHAR(8) NULL,
    `archivo_generado` VARCHAR(120) NULL,
    `hash_generado` CHAR(64) NULL,
    `bytes_generado` INTEGER NULL,
    `generado_en` DATETIME(3) NULL,
    `descargado_para_firmar_en` DATETIME(3) NULL,
    `archivo_firmado` VARCHAR(120) NULL,
    `hash_firmado` CHAR(64) NULL,
    `firmas_detectadas` INTEGER NOT NULL DEFAULT 0,
    `coincidencia` ENUM('PREFIJO', 'METADATOS', 'FORZADO') NULL,
    `motivo_forzado` VARCHAR(500) NULL,
    `firmado_en` DATETIME(3) NULL,
    `codigo_externo` VARCHAR(80) NULL,
    `registro_externo` ENUM('NO_APLICA', 'PENDIENTE', 'REGISTRADO', 'ERROR') NOT NULL DEFAULT 'NO_APLICA',
    `registro_externo_error` VARCHAR(500) NULL,
    `registrado_externo_en` DATETIME(3) NULL,
    `anulado_en` DATETIME(3) NULL,
    `motivo_anulacion` VARCHAR(500) NULL,
    `emitido_por_id` INTEGER NULL,
    `editado_por_id` INTEGER NULL,
    `firmado_cargado_por_id` INTEGER NULL,
    `anulado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,
    UNIQUE INDEX `uq_certificados_codigo`(`codigo`),
    UNIQUE INDEX `uq_certificados_clave_vigente`(`clave_vigente`),
    UNIQUE INDEX `uq_certificados_codigo_externo`(`codigo_externo`),
    UNIQUE INDEX `uq_certificados_evento_numero`(`evento_id`, `numero`),
    INDEX `idx_certificados_evento_estado`(`evento_id`, `estado`),
    INDEX `idx_certificados_participante`(`participante_id`),
    INDEX `idx_certificados_tipo`(`tipo_certificado_id`),
    INDEX `idx_certificados_plantilla`(`plantilla_id`),
    INDEX `idx_certificados_inscripcion`(`inscripcion_id`),
    INDEX `idx_certificados_ponencia`(`ponencia_id`),
    INDEX `idx_certificados_emitido_por`(`emitido_por_id`),
    INDEX `idx_certificados_editado_por`(`editado_por_id`),
    INDEX `idx_certificados_firmado_cargado_por`(`firmado_cargado_por_id`),
    INDEX `idx_certificados_anulado_por`(`anulado_por_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ck_certificados_clave_vigente` CHECK ((`estado` = 'ANULADO') = (`clave_vigente` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `configuracion_certificados` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `proveedor_codigo` ENUM('LOCAL', 'UNDC') NOT NULL DEFAULT 'LOCAL',
    `prefijo_codigo` VARCHAR(20) NOT NULL DEFAULT 'CIISIC',
    `url_verificacion` VARCHAR(255) NULL,
    `undc_url` VARCHAR(255) NULL,
    `undc_usuario` VARCHAR(191) NULL,
    `undc_secreto_cifrado` TEXT NULL,
    `undc_secreto_sufijo` VARCHAR(8) NULL,
    `undc_timeout_ms` INTEGER NOT NULL DEFAULT 10000,
    `undc_ultimo_estado` ENUM('OK', 'ERROR') NULL,
    `undc_ultimo_error` VARCHAR(500) NULL,
    `undc_ultima_prueba_en` DATETIME(3) NULL,
    `actualizado_por_id` INTEGER NULL,
    `creado_en` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `actualizado_en` DATETIME(3) NOT NULL,
    INDEX `idx_configuracion_certificados_actualizado_por`(`actualizado_por_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `ck_configuracion_certificados_fila_unica` CHECK (`id` = 1)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `plantillas_certificado` ADD CONSTRAINT `fk_plantillas_certificado_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `plantillas_certificado` ADD CONSTRAINT `fk_plantillas_certificado_creado_por` FOREIGN KEY (`creado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_evento` FOREIGN KEY (`evento_id`) REFERENCES `eventos`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_participante` FOREIGN KEY (`participante_id`) REFERENCES `participantes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_tipo` FOREIGN KEY (`tipo_certificado_id`) REFERENCES `tipos_certificado`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_plantilla` FOREIGN KEY (`plantilla_id`) REFERENCES `plantillas_certificado`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_inscripcion` FOREIGN KEY (`inscripcion_id`) REFERENCES `inscripciones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_ponencia` FOREIGN KEY (`ponencia_id`) REFERENCES `ponencias`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_emitido_por` FOREIGN KEY (`emitido_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_editado_por` FOREIGN KEY (`editado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_firmado_cargado_por` FOREIGN KEY (`firmado_cargado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `certificados` ADD CONSTRAINT `fk_certificados_anulado_por` FOREIGN KEY (`anulado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `configuracion_certificados` ADD CONSTRAINT `fk_configuracion_certificados_actualizado_por` FOREIGN KEY (`actualizado_por_id`) REFERENCES `administradores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Catálogos: docker-entrypoint.sh solo aplica migraciones (el seed no corre en producción).
INSERT INTO `tipos_certificado` (`codigo`, `nombre`, `texto_impreso`, `orden`) VALUES
    ('PARTICIPANTE', 'Participante', 'PARTICIPANTE', 1),
    ('ORGANIZADOR', 'Organizador', 'ORGANIZADOR', 2),
    ('PONENTE', 'Ponente', 'PONENTE', 3);
INSERT INTO `configuracion_certificados` (`id`, `actualizado_en`) VALUES (1, CURRENT_TIMESTAMP(3));
```

**Cómo validar la migración:** se ensaya contra el respaldo real y `prisma migrate diff` debe quedar vacío (Prisma ignora los CHECK, igual que `20260930120000_configuracion_sistema:26`). El tipo `VARCHAR(36)` y la collation `utf8mb4_unicode_ci` coinciden con `ponencias`, así que la FK es válida.

**Archivos en disco** (carpeta por **`eventoId`**, que no cambia; `evento.codigo` sí es editable en `event.ts:45`):
- `uploads/certificados/plantillas/plantilla-<uuid>.pdf`
- `uploads/certificados/<eventoId>/generados/<codigo>-<generacion>.pdf`
- `uploads/certificados/<eventoId>/firmados/<codigo>-<rand>.pdf`

La BD guarda solo el nombre del archivo, y toda escritura es atómica (`.tmp` y luego `rename`).

---

## 3) Contratos de API

**Permisos.** Todas las rutas van bajo `/api`, con el formato de éxito `{success, data, meta?}` y el de error `{success:false, code, message, fields?}`.

| Permiso | Quién lo tiene | Guarda mientras no llegue el bloque A |
|---|---|---|
| **GESTION** | OWNER o ADMINISTRADOR, globales | `verifyAdminRole` |
| **OPERAR** | GESTION, más COMISION con el permiso elegible `CERTIFICADOS_OPERAR` en eventos asignados | `verifyAdminRole` |
| **VER** | OPERAR, más COMISION con `CERTIFICADOS_VER` | `verifyAdminRole` |
| **OWNER** | Solo OWNER | `verifySuperAdminRole` |

Las rutas por id cargan el `eventoId` del recurso y aplican la guarda de alcance del bloque A.

| Método | Ruta | Permiso | Respuesta | Errores |
|---|---|---|---|---|
| GET | `/v1/certificate-types` | VER | `[{id,codigo,nombre,textoImpreso,activo,orden}]` | |
| POST · PUT | `/v1/certificate-types` · `/:id` | GESTION | 201/200. El código cumple `^[A-Z][A-Z0-9_]{1,39}$` y no se edita; no hay DELETE, se desactiva | 409 `DUPLICATE_RECORD`; 422 |
| GET | `/v1/certificate-fonts` | GESTION | `[{codigo,nombre}]` | |
| GET | `/v1/certificate-settings` | GESTION | `{proveedorCodigo,prefijoCodigo,urlVerificacion,urlEfectiva,bloqueado,undc:{url,usuario,secretoSufijo,timeoutMs,ultimoEstado,ultimoError}}` | |
| PUT | `/v1/certificate-settings` | **OWNER** | URL solo https (`validarUrlSaliente`); prefijo `^[A-Z0-9]{2,20}$`; secreto de solo escritura | 409 `CERTIFICATE_SETTINGS_LOCKED` (URL o prefijo con certificados ya generados); 422 `INVALID_URL`/`HOST_NOT_ALLOWED` |
| POST | `/v1/certificate-settings/undc/test` | OWNER | 501 hasta que haya API | `CERTIFICATE_PROVIDER_PENDING` |
| GET · POST | `/v1/events/:eventId/certificate-templates` | GESTION | lista con `enUso` / multipart `file` + `nombre` → 201 (≤5 MB, 1–2 páginas, sin rotación ni cifrado) | 422 `INVALID_PDF`/`PDF_ENCRYPTED`/`PDF_ROTATED`/`PDF_TOO_MANY_PAGES`; 413 `UPLOAD_LIMIT_EXCEEDED` |
| GET · PUT · DELETE | `/v1/certificate-templates/:id` | GESTION | PUT `{nombre?,campos?,horasPorDefecto?,firmasRequeridas?,activa?}`; la versión sube en 1 si cambian los campos | 422 `INVALID_TEMPLATE_FIELDS` (fields); 409 `TEMPLATE_IN_USE` |
| GET · PUT | `/v1/certificate-templates/:id/design` | GESTION | PDF del diseño / reemplazar el diseño (versión +1) | igual que POST |
| POST | `/v1/certificate-templates/:id/preview` | GESTION, `limiteVistaPrevia` 30/min por admin | `{campos?,tipoCodigo?,datos?}` → `application/pdf`; `X-Avisos` = `encodeURIComponent(JSON)` | 422 campos |
| GET | `/v1/events/:eventId/certificates?estado&tipo&plantillaId&q&page&pageSize` | VER | `{data, meta:{page,pageSize,total,resumen:{PENDIENTE:n,…}}}`, con `tieneGenerado`/`tieneFirmado` y sin rutas. El DNI se enmascara si no es GESTION | |
| GET | `/v1/certificates/:id` | VER | detalle | 404 `CERTIFICATE_NOT_FOUND` |
| POST | `/v1/events/:eventId/certificates` | GESTION | individual, con `participanteId` o `persona{…}`, `tipoCodigo`, `plantillaId`, `ponenciaId?` → 201 | 409 `CERTIFICATE_EXISTS`; 422 `TEMPLATE_OTHER_EVENT`/`TEMPLATE_INACTIVE`/`EMAIL_IN_USE` |
| POST | `/v1/events/:eventId/certificates/from-inscriptions` | GESTION | `{tipoCodigo,plantillaId,horas?,fechaEmision?,filtro:{tipoInscripcionIds?,actividadIds?,asistenciaMinima?},nombreOficial?,simular}` → `{candidatos,crear,yaEmitidos,excluidosPorAsistencia,muestra}` / 201 `{creados}` | |
| POST | `/v1/events/:eventId/certificates/import` | GESTION | `{plantillaId,tipoCodigo,filas[≤300],simular}` → `[{fila,resultado:CREAR\|CREADO\|YA_EMITIDO\|ERROR,participante:{id?,nuevo},mensaje}]` | 422 `IMPORT_TOO_LARGE` |
| PUT | `/v1/certificates/:id` | GESTION | `{nombreImpreso?,detalle?,horas?,plantillaId?,fechaEmision?,sincronizarNombre?,confirmar?}` → vuelve a PENDIENTE (`editadoPorId`) | 409 `CERTIFICATE_LOCKED` (EN_FIRMA/FIRMADO/ANULADO); 409 `CERTIFICATE_SENT_TO_SIGN` sin `confirmar` |
| DELETE | `/v1/certificates/:id` | GESTION | solo PENDIENTE, nunca generado | 409 `CERTIFICATE_LOCKED` |
| POST | `/v1/events/:eventId/certificates/generate` | OPERAR | `{ids[≤10]}` o `{pendientes:true, regenerar?:false}` → 200 `{procesados:[{id,resultado:GENERADO\|OMITIDO\|ERROR,avisos,mensaje}],restantes}` (síncrono, idempotente) | 422 `VERIFICATION_URL_NOT_CONFIGURED`; 501 `CERTIFICATE_PROVIDER_PENDING`; por ítem `CERTIFICATE_SENT_TO_SIGN` si `regenerar` sin `confirmar` |
| GET | `/v1/certificates/:id/file?version=generado\|firmado` | generado: OPERAR (marca `descargadoParaFirmarEn`); firmado: VER | `application/pdf` | 404 |
| GET | `/v1/events/:eventId/certificates/zip?version=para-firmar\|firmados&estado&tipo&ids&parte&porParte≤500` | OPERAR | `application/zip` en flujo (yazl, sin comprimir) + `manifiesto.csv` (`celdaCsv`; documento solo para GESTION). Para firmar entrega la versión más reciente: el firmado parcial o el generado | 422 `NOTHING_TO_DOWNLOAD` |
| POST | `/v1/events/:eventId/certificates/signed` | OPERAR | multipart `files[]` (solo PDF, ≤10 archivos, ≤10 MB cada uno, `Content-Length` ≤25 MB) + `reemplazar?` → 200 `{resumen:{firmados,parciales,sinFirma,noCoincide,noEncontrados,otroEvento,anulados,yaFirmados,duplicados,invalidos},detalle[]}` | 413; 411 sin `Content-Length`; 422 `INVALID_FILE_TYPE` |
| PUT | `/v1/certificates/:id/signed` | OPERAR (`forzar`+`motivo`: GESTION) | un archivo, sin emparejar por nombre | 422 `SIGNATURE_NOT_FOUND`/`SIGNED_MISMATCH` |
| DELETE | `/v1/certificates/:id/signed` | GESTION | quita el firmado → PREPARADO | |
| POST | `/v1/certificates/:id/annul` | GESTION | `{motivo}` obligatorio → ANULADO, `claveVigente=NULL` | 409 `CERTIFICATE_ALREADY_ANNULLED` |
| POST | `/v1/events/:eventId/certificates/register-external` | GESTION | tandas `{ids[≤10]}` (F3) | 501 `CERTIFICATE_PROVIDER_PENDING` |
| GET | `/v1/public/certificates/:codigo` | **pública**: `limiteVerificacionCertificado` 30/min por IP + `limiteVerificacionGlobal` 1200/min | `{codigo,estado:VALIDO\|ANULADO,titular,tipo,evento:{nombre,fechaInicio,fechaFin},fechaEmision,horas,firmadoEn,anuladoEn?,codigoExterno?,urlExterna?}` **sin documento** | 404 `CERTIFICATE_NOT_FOUND` (formato inválido → 404 sin consultar la BD; PENDIENTE, PREPARADO y EN_FIRMA → 404) |
| GET | `/v1/me/certificates` | requireParticipante + `limitePortal` | `[{id,codigoImpreso,evento,tipo,estado:FIRMADO\|EN_PREPARACION,fechaEmision,horas,detalle,firmadoEn,urlVerificacion,descargable}]` (sin anulados) | |
| GET | `/v1/me/certificates/:id/file` | requireParticipante + `limiteCredencialPortal` | solo el FIRMADO propio | 404 `CERTIFICATE_NOT_FOUND` |

---

## 4) Cambios backend por archivo (`B = backend-ciisic`)

**Nuevos** (`B/src/api/certificate/`):

**Rutas y controladores**
- `routes/certificate.ts`, `routes/certificate-template.ts`, `routes/public-certificate.ts`. El loader toma todos los archivos de `routes/`.
- `controllers/{certificate,certificate-template,public-certificate}.ts`.

**`services/`**
- `tipos.ts`.
- `configuracion.ts`:
  - caché de 30 s, como `core/configuracion-sistema.ts`;
  - `urlEfectiva` = `urlVerificacion` o, si no hay, `${urlPanel}/verificar`; si las dos faltan → `VERIFICATION_URL_NOT_CONFIGURED`;
  - la primera generación **congela** la URL resuelta en la fila;
  - bloqueo de URL y prefijo con certificados ya generados;
  - secreto con `cifrar`/`descifrar` (`core/crypto.ts:16,24`).
- `plantillas.ts`.
- `certificados.ts`: listar, detalle, editar, borrar, anular y `eventoDeRecurso` para la guarda de alcance.
- `destinatarios.ts`:
  - usa `matrizAsistencia` (`activity.ts:148`), `nombresOficiales`/`apellidosDe` (`cache.ts:37,46`) y `consultarDni(n,'PANEL')` (`lookup.ts:143`), con tope de 50 consultas por solicitud;
  - `claveVigente` incluye `ponenciaId`.
- `generacion.ts`:
  - hasta 10 certificados por solicitud, en secuencia, con `setImmediate` entre cada uno;
  - `generacion` = 8 caracteres en base32 aleatorio;
  - `update where {id, generacion: anterior}` (optimista); el archivo perdedor se borra.
- `firmados.ts`: emparejamiento, conteo de firmas y coincidencia.
- `descargas.ts`: yazl.
- `verificacion.ts`.
- `archivos.ts`: rutas por `eventoId`, escritura atómica y borrado.

**`codigos/`**
- `codigo.ts`:
  - `generarCodigo` → `<PREFIJO>-<AÑO>-<NNNNNN>-<XXXXXX>` con Crockford y `crypto.randomInt` (30 bits);
  - `numero` = `max+1` en una transacción, con hasta 5 reintentos ante P2002;
  - `extraerCodigo(nombre)` con la regex `/([A-Z0-9]{2,20})-(\d{4})-(\d{6})-([0-9A-HJKMNP-TV-Z]{6})/i` en cualquier parte del nombre (tolera `[R]`, `_firmado`, `-signed`), o `codigoExterno` exacto.
- `proveedor.ts`: interfaz `resolverImpresion`/`registrar`/`probarConexion` y `proveedorActivo()`.
- `local.ts`.
- `undc.ts`: 501 por ahora. Cuando haya API: `validarUrlSaliente`/`asegurarDestinoPublico` (`core/url-saliente.ts:50,75`).

**`pdf/`**
- `estampar.ts`:
  - `PDFDocument.load(diseño,{updateMetadata:false})` y fontkit;
  - fuente embebida con `subset:true`, o `subset:false` si falla;
  - NFC y respaldo en DejaVu cuando falta un glifo, con aviso;
  - `setTitle('Certificado <código>')` y `setSubject('ciisic:<codigo>:<generacion>')`;
  - `save({useObjectStreams:false})` para compatibilidad con las herramientas de firma.
- `texto.ts`: `ajustarTexto`, `capitalizarTitulo` y `reemplazarMarcadores`, todas puras.
- `qr.ts`: vectorial, a partir de `QRCode.create(url,{errorCorrectionLevel:'M'})`.
- `fuentes.ts`: catálogo y caché de bytes.
- `firmas.ts` → `contarFirmas(bytes)`:
  - con pdf-lib (`ignoreEncryption`): campos `/FT /Sig` con `/V` cuyo diccionario no sea `/Type /DocTimeStamp`;
  - si falla, regex `/Type\s*\/Sig\b` que tenga `/ByteRange`.
- `firmas.ts` → `verificarCoincidencia`:
  - `sha256(firmado[0..bytesGenerado]) === hashGenerado` → PREFIJO;
  - si no, `getSubject()` igual a `ciisic:<codigo>:<generacion vigente>` → METADATOS;
  - si no → `SIGNED_MISMATCH`, que se rechaza.
- `validar-diseno.ts`.
- `pdf/fuentes/*.ttf`: Montserrat, Poppins, Barlow, Playfair Display, Great Vibes y DejaVu Sans, con `OFL.txt` más **`LICENSE-DejaVu.txt`** (la licencia de DejaVu no es OFL).

**Resto de archivos nuevos**
- `upload.ts`:
  - `plantillaUpload` en memoria: 5 MB, 1 archivo, 1 campo;
  - `firmadosUpload` en memoria: 10 MB × 10, precedido de `limiteContenido(25 MB)` (413 si se pasa, 411 si falta `Content-Length`);
  - acepta `application/pdf`, `.pdf` y la firma de bytes.
- `validation.ts`.
- `B/src/core/pdf.ts`: recibe `hasPdfSignature`.
- `B/tests/helpers/pdf.ts`: `disenoDePrueba()` y `firmarSimulado(bytes,{firmas,sello})`, que agrega una actualización incremental con objetos `/Sig`.
- `B/tests/certificate/*.test.ts`.
- `B/specs/015-certificados/{spec,plan,tasks}.md` y `contracts/api-certificados.md`.

**Archivos existentes que cambian:**
- `prisma/schema.prisma`: los modelos y las relaciones inversas de la sección 2.
- `package.json`: se agregan `pdf-lib`, `@pdf-lib/fontkit` y `yazl`; en desarrollo, `@types/yazl`. **No se agrega yauzl.**
- `Dockerfile` (después de `:77`): `COPY --from=builder --chown=nodejs:nodejs /app/src/api/certificate/pdf/fuentes ./dist/src/api/certificate/pdf/fuentes`.
- `src/core/almacenamiento.ts`: `DIRECTORIO_CERTIFICADOS`, `MAX_BYTES_PLANTILLA=5MB`, `MAX_BYTES_PDF_FIRMADO=10MB`, `MAX_BYTES_CARGA_FIRMADOS=25MB` y `REGEX_ARCHIVO_PLANTILLA`.
- `src/api/papers/upload.ts:19`: reexporta `hasPdfSignature` desde `core/pdf.ts`.
- `src/middlewares/rate-limit.ts:7,22-26`:
  - `Clave` suma `'admin'` (`admin:<req.user.id>`) y `'global'` (clave fija);
  - limitadores nuevos: `limiteVerificacionCertificado`, `limiteVerificacionGlobal` y `limiteVistaPrevia`.
- `src/api/event/services/event.ts:174-191`:
  - 409 si el evento tiene certificados (se suma al conteo);
  - la transacción borra las plantillas y después sus archivos.
- `src/api/inscription/services/inscription.ts:253`: 409 `INSCRIPTION_HAS_CERTIFICATE` si la inscripción tiene un certificado vigente.
- `src/api/participant-portal/routes/participant-portal.ts:8-10`, más su controlador y servicio: `/me/certificates` y su archivo.
- `src/api/participant/services/participant.ts`: `obtenerOCrearParticipante()`.
  - Correo obligatorio (`schema.prisma:111`); celular `''`.
  - `EMAIL_IN_USE` por fila.
  - Si el DNI existe con otro correo, se conserva el registrado y se avisa.
- `src/database/seed.ts`: tipos de certificado y fila de configuración.
- `tests/security/routes.test.ts`: filas nuevas, y la ruta `/v1/public/*` en la lista de rutas públicas intencionales.
- `.specify/memory/constitution.md` (versión MINOR):
  - **III**: excepción para la verificación de certificados (titular, tipo, evento y fecha; código no adivinable; límite; sin documento);
  - **IV**: nueva familia `/api/v1/public/*`.
- `docs/{api,data-model,operacion,arquitectura-ecosistema}.md`:
  - respaldo de `uploads/certificados` después de cada carga de firmados;
  - procedimiento si la migración falla (P3009): `DROP` más `migrate resolve` ejecutados en un contenedor aparte, porque `set -e` en `docker-entrypoint.sh` impide que el principal arranque;
  - contrato de verificación;
  - contrato con la UNDC marcado como pendiente.
- `README.md` y `AGENTS.md`: reglas de certificados (no regenerar un firmado; carpeta por `eventoId`).
- **Sin cambios en `server.ts`**: no hay procesador de lotes.

---

## 5) Cambios panel por archivo (`P = administrator-ciisic-frontend`)

**Archivos existentes:**
- `server/utils/proxy.ts:52`: `streamRequest: esMultipart(event)`. Hoy el cuerpo se lee entero con `readRawBody` (`h3/dist/index.mjs:1152-1156`). Después del cambio hay que volver a probar la subida del QR y de las ponencias.
- `package.json`: `fflate` (descomprimir el ZIP en el navegador, F2) y `pdfjs-dist` (solo en F3).
- `app/components/layout/AppSidebar.vue:5-15`: ítem **Certificados** (`heroicons:academic-cap`) en "Congreso", visible con VER usando la función de permisos del bloque A. No se usa `esSuperAdmin` ni el código `ADMIN`.
- `app/types/router.d.ts`: `publica?: boolean`.
- `app/middleware/auth.global.ts:7-19` y `app/utils/sesion.ts`: si la página es `to.meta.publica`, se sale antes de `cargarSesion`.
- `.specify/memory/constitution.md`, principio VI: enmienda para admitir páginas públicas sin sesión (`/verificar`).
- `app/types/api.ts`: `TipoCertificado`, `PlantillaCertificado`, `CampoPlantilla`, `Certificado`, `ResultadoGeneracion`, `ResultadoCarga`, `CertificadoPortal`, `VerificacionCertificado`.
- `app/utils/errores.ts`: mensajes para los códigos de la sección 3.
- `app/layouts/participante.vue`: enlace "Mis certificados", coordinado con el menú del bloque B.

**Archivos nuevos:**

*Páginas y BFF*
- `app/pages/certificados/index.vue`:
  - `AppTabs` con cuatro pestañas: Certificados, Plantillas, Tipos y Configuración. Plantillas y Tipos son de GESTION; Configuración es de lectura para GESTION y editable para OWNER.
  - KPIs de `meta.resumen` que funcionan como filtros; tabla paginada con selección.
  - Acciones: Emitir, Generar (tandas), Descargar para firmar (ZIP por partes), Subir firmados y Descargar firmados.
  - Aviso fijo mientras el proveedor sea LOCAL.
- `app/pages/certificados/plantillas/[id].vue` (**F1**):
  - formulario numérico por campo (`CampoPropiedades.vue`), con valores por defecto: NOMBRE centrado, TIPO, TEXTO, FECHA, CODIGO y QR;
  - "Centrar horizontalmente";
  - vista previa real (POST preview → blob en `AppModal` con iframe, y avisos leídos con `decodeURIComponent`).
- `app/pages/mis-certificados.vue`: `layout:'participante'`, `perfil:'participante'`.
- `app/pages/verificar/index.vue` y `verificar/[codigo].vue`: `layout:'blank'`, `publica:true`.
- `server/api/publico/certificados/[codigo].get.ts`:
  - valida el formato del código;
  - aplica `server/utils/limite.ts` (nuevo, en memoria, 20/min por `getRequestIP(event,{xForwardedFor:true})`);
  - hace `$fetch` a `/api/v1/public/certificates/:codigo` reenviando `x-forwarded-for`, igual que `server/api/auth/login.post.ts:18`.

*Componentes* (`app/components/certificados/`)
- `EmitirCertificadosModal.vue`: pestañas Desde inscritos (simular y emitir), Individual (buscar con `participants?q=` o crear con `document-lookup/dni/:n`) y Por lista (CSV o texto pegado, simular y emitir en tandas de 300; ponencias como origen para prellenar el detalle).
- `CargaFirmadosModal.vue`:
  - soltar PDFs o un ZIP; el ZIP se abre con `fflate`, ignorando lo que no sea `.pdf`, `__MACOSX` y las carpetas (solo el nombre base);
  - vista previa del emparejamiento con `codigoDeArchivo`;
  - envío por XHR en tandas de ≤10 MB con progreso;
  - reporte acumulado con el filtro "no emparejados".
- `CertificadoDetalle.vue`, `TiposCertificadoPanel.vue`, `ConfigCertificadosForm.vue` (secreto de solo escritura, igual que en Correo), `PlantillasPanel.vue`.
- **F3**: `EditorPlantilla.vue` y `VisorPdf.vue`. Usan pdf.js, `page.view` como CropBox, las fórmulas `xPt=view[0]+xPx/s` e `yPt=view[3]−yPx/s`, arrastre con puntero y movimiento con flechas de 1 pt o 10 pt.

*Composables y utils*
- Composables:
  - `useTandas.ts`: bucle de generación y de subida con cancelación y reanudación. Se reanuda con "Generar pendientes".
  - `useSubida.ts`: XHR a `/api/backend/...`.
  - `usePdfJs.ts` (F3).
- Utils:
  - `plantillaCertificado.ts`: validación, marcadores, `capitalizarTitulo` y conversión px↔pt.
  - `listaCertificados.ts`: separadores `; , \t`, BOM, encabezados, duplicados.
  - `certificados.ts`: etiquetas y tonos por estado, `codigoDeArchivo` (misma regex que el backend) y `partirPorTamano`.
  - `zipCliente.ts`: filtrado de entradas.
  - `misCertificados.ts`.
- `specs/010-certificados/{spec,plan,tasks}.md`.

---

## 6) Pruebas

**Backend** (jest y supertest, prisma simulado por archivo; `CIISIC_UPLOADS_PRUEBAS` aísla los archivos).

*Motor PDF, plantillas y códigos*
- `estampado.test.ts`:
  - diseño A4 creado con pdf-lib y estampado de "María José Ñahuinlla Güemes": el resultado carga, tiene 1 página y registra la fuente embebida;
  - `Subject` = `ciisic:<codigo>:<gen>`;
  - un carácter sin glifo usa DejaVu y genera aviso;
  - `ajustarTexto`: reducción al mínimo, `desborda` y varias líneas;
  - alineaciones y `capitalizarTitulo`.
- `qr.test.ts`: página simulada que registra `drawRectangle`; los rectángulos deben coincidir con los módulos de `QRCode.create(url)`. No se rasteriza.
- `plantillas.test.ts`:
  - rechaza un PDF cifrado (fixture escrita a mano con `/Encrypt`), uno rotado (`setRotation(degrees(90))`), 3 páginas, contenido que no es PDF y más de 5 MB (413);
  - campos inválidos → `fields`;
  - versión +1, `TEMPLATE_IN_USE` y alcance.
- `codigo.test.ts`:
  - formato y alfabeto Crockford; reintento ante P2002;
  - `extraerCodigo` con `[R]`, `_firmado`, minúsculas y prefijos;
  - prefijo inválido → 422; proveedor UNDC → 501.

*Destinatarios y generación*
- `destinatarios.test.ts`:
  - aprobados con filtro de asistencia; omite los ya emitidos;
  - re-emisión después de anular;
  - `ponenciaId` distingue dos certificados PONENTE de la misma persona;
  - importación: participante nuevo, `EMAIL_IN_USE` por fila, DNI desde caché o consulta simulada, tope de 50 consultas, `IMPORT_TOO_LARGE`.
- `generacion.test.ts`:
  - como máximo 10 por solicitud; idempotente (omite PREPARADO);
  - `CERTIFICATE_SENT_TO_SIGN` y `VERIFICATION_URL_NOT_CONFIGURED`;
  - la URL se congela en la primera generación;
  - carrera optimista (el archivo perdedor se borra);
  - carpeta por `eventoId`.

*Firmados y descargas*
- `firmados.test.ts` (con `firmarSimulado`):
  - sin firma → `SIN_FIRMA`;
  - firma + `DocTimeStamp` cuentan como 1;
  - 1 de 2 firmas → EN_FIRMA; 2 de 2 → FIRMADO;
  - prefijo igual → PREFIJO;
  - reescrito con el `Subject` vigente → METADATOS; con una generación anterior → `SIGNED_MISMATCH`;
  - certificado de otro evento, ANULADO, FIRMADO sin `reemplazar` y duplicado en la misma carga;
  - `Content-Length` por encima del límite → 413;
  - `forzar` solo con GESTION.
- `descargas.test.ts`:
  - `Content-Type`, nombres `<codigo>.pdf` y `manifiesto.csv` (sin documento para OPERAR);
  - `parte`/`porParte`;
  - marca `descargadoParaFirmarEn`.

*Verificación, portal, acceso y cambios en módulos existentes*
- `verificacion.test.ts`:
  - formato inválido → 404 sin llamar a prisma;
  - PENDIENTE, PREPARADO y EN_FIRMA → 404;
  - VALIDO sin documento; ANULADO; búsqueda por `codigoExterno`.
- `tests/participant-portal`:
  - solo los certificados propios y sin anulados;
  - PREPARADO → `EN_PREPARACION` y sin archivo (404);
  - archivo de otra persona → 404.
- `tests/security/routes.test.ts` y `rutas.test.ts`:
  - sin token → 401; token de participante en rutas de administración → 403;
  - TESORERO y COMISION sin permiso → 403;
  - COMISION con VER no genera; con OPERAR no emite, no anula y no fuerza;
  - alcance por id en otro evento → 403 o 404;
  - PUT de la configuración con ADMINISTRADOR → 403.
- `tests/event/event.test.ts`: `eliminarEvento` con certificados → 409; plantillas y archivos borrados.
- Inscripción con certificado vigente → 409 al borrarla.
- `rate-limit`: claves `admin` y `global`.

**Panel** (vitest, funciones puras):
- `plantillaCertificado.test.ts`: validación, marcadores y `capitalizarTitulo`. Los casos se copian literalmente de los del backend. La conversión px↔pt con la CropBox desplazada entra en F3.
- `listaCertificados.test.ts`: separadores, BOM, encabezados, DNI inválido, duplicados y tandas de 300.
- `certificados.test.ts`: `codigoDeArchivo` y `partirPorTamano` (tandas de ≤10 MB; un archivo más grande que el límite sale solo).
- `zipCliente.test.ts`: `__MACOSX`, archivos que no son PDF, rutas con `\` y `../` (solo se toma el nombre base).
- `misCertificados.test.ts`.
- `sesion.test.ts`: una página `publica` no redirige.

---

## 7) Fases

**F0 · IMPRESCINDIBLE ANTES DEL 26-OCT (no se despliega código de C):**
1. Cerrar las decisiones 1–3 de la sección 9, sobre todo la **URL impresa en el QR** y si la UNDC exige su propio código.
2. Diseños finales en PDF: A4 sin rotación, ≤5 MB (exportados como "tamaño reducido"), con espacio libre para nombre, tipo, código y QR.
3. **Actividades del VIII creadas y asistencia marcada durante el evento.** Depende de los bloques A y B para que la comisión pueda marcar. Sin esto no hay filtro de asistencia.
4. Listas de organizadores, ponentes y comisión con DNI, **correo** y detalle (por ejemplo, el título de la ponencia).
5. Pedir a la UNDC el acceso a la API de certificados.undc.edu.pe y preguntar si acepta registrar nuestro código.
6. **Prueba de firma:** firmar con FirmaPerú o ReFirma cualquier PDF exportado (el diseño sirve) y entregar el resultado. Con eso se comprueba si la firma es incremental, cómo se renombran los archivos y si hay sellos de tiempo.
7. Congelar los despliegues del backend del 23 al 30 de octubre, porque un push a main despliega y migra.

**F1 · Núcleo.** Se desarrolla en una rama después de fusionar A; se despliega a partir del 31-oct.
- Backend:
  - T001 esquema y migración;
  - T002 dependencias, fuentes y Dockerfile;
  - T003 tipos y configuración (OWNER, congelado);
  - T004 plantillas y vista previa;
  - T005 motor PDF;
  - T006 código LOCAL;
  - T007 emisión individual, desde inscritos y por lista;
  - T008 generación en tandas;
  - T009 ZIP para firmar;
  - T010 `eliminarEvento` y `eliminarInscripcion`;
  - T011 pruebas y contratos.
- Panel: página Certificados, editor por formulario con vista previa, tipos y configuración.

**F2 · Firma y entrega (1 al 10 de noviembre):**
- Backend: subida de firmados en tandas, `SIGNED_MISMATCH`, EN_FIRMA/FIRMADO, quitar firmado, anular, ZIP de firmados, `/me/certificates`, `/v1/public` y enmienda de la constitución.
- Panel: `CargaFirmadosModal` con fflate, `streamRequest` para multipart, `mis-certificados`, `/verificar` y BFF público.
- Operación: respaldo de `uploads/certificados`.

**F3 · Cuando se pueda:**
- editor visual con pdf.js (arrastre);
- adaptador UNDC: prueba de conexión, `register-external`, "reasignar a código UNDC" para lo que aún no está firmado y enlace externo en la verificación.

**F4 · Opcional:**
- correo de aviso al quedar FIRMADO (enlace al portal, sin adjunto);
- `/verificar` en la landing;
- fuentes subidas por el administrador;
- purga de los generados de los ya firmados;
- confirmación del DNI por el visitante en la verificación.

---

## 8) Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| El BFF carga el cuerpo entero en memoria (`proxy.ts:52` sin `streamRequest`) y Traefik corta a los 60 s (`readTimeout`) | Tandas de ≤10 MB (unos 16 s a 5 Mbps), `streamRequest` solo para multipart, sin ZIP del lado del servidor. Revisar los timeouts en Dokploy antes de F2 |
| Firmado de otra persona o de una versión anterior | Rechazo si no coincide el prefijo ni el `Subject` de la generación vigente. Forzar solo individualmente, con GESTION y motivo auditado. Aviso al regenerar algo ya descargado para firmar |
| La herramienta de firma reescribe el PDF, no firma de forma incremental o renombra los archivos | Prueba F0-6. Respaldo por METADATOS. Regex de código tolerante a sufijos. `useObjectStreams:false` |
| Conteo de firmas incorrecto | Campos `/Sig` con `/V` sin contar `DocTimeStamp`. El panel nunca dice "firma válida"; dice "N firmas detectadas" |
| Falla el subsetting de alguna fuente, o falta el `COPY` en el Dockerfile | Prueba por cada fuente del catálogo, con `subset:false` como respaldo. Prueba de humo en staging antes de producción |
| CPU síncrona: cada certificado ejecuta `PDFDocument.load` | Diseño de ≤5 MB, tandas de 10, `setImmediate` entre certificados. Medir en F1; si hace falta, `worker_threads` |
| Pérdida de los firmados, que no se pueden reponer | Carpeta por `eventoId`, escritura atómica y respaldo del volumen después de cada carga |
| El personal que también es participante no llega al portal (`google-auth.ts:41-50` da prioridad al administrador) | Escenario de aceptación en 015 que depende de B: acceso con código por correo en "Acceso de inscritos" → Mis certificados |
| Organizador o ponente sin correo (`schema.prisma:111`) | La lista exige correo; se reporta por fila |
| Enumeración de códigos o DoS en la verificación | 30 bits aleatorios, límites en el BFF, por IP en el backend (la IP se reenvía) y global; no se expone el documento |
| Un ADMINISTRADOR redirige el QR a otro dominio | Configuración editable solo por OWNER, https obligatorio, URL congelada en la primera generación |
| La UNDC impone su código después de firmar | Decidirlo en F0. Lo ya firmado se verifica en nuestro sitio y se registra afuera (`codigoExterno`) |
| Migración a medias: P3009 y el contenedor no arranca | Solo crea tablas; procedimiento `DROP` + `migrate resolve` documentado y ensayado con el respaldo |
| El bloque A se atrasa, o quitar un permiso tarda hasta 1 h en aplicarse (el token dura 1 h y `auth.ts:43-55` no revalida) | Guardas provisionales `verifyAdminRole`/`verifySuperAdminRole`; la revalidación la resuelve A. No reutilizar el código `ADMIN` |

---

## 9) Decisiones abiertas para el usuario

1. **URL impresa en el QR y el código.** Quedan en el papel para siempre.
   - Recomendación: `https://admin-ciisic.episundc.pe/verificar/<código>` (o un subdominio estable que apunte al panel), con código local `CIISIC-2026-000123-7KQ2XM`.
   - Firmar sin esperar a la UNDC, salvo que la UNDC exija que su propio código vaya impreso.
2. **Firma: herramienta y número de firmantes.**
   - Recomendación: FirmaPerú o ReFirma, con 1 firmante por plantilla.
   - Si son 2, se usa `firmasRequeridas=2` (el estado EN_FIRMA ya lo contempla).
   - Validarlo con la prueba F0-6 antes del 26-oct.
3. **Criterio para el certificado de PARTICIPANTE y las horas.**
   - Recomendación: inscripción APROBADO con ≥60 % de las actividades marcadas.
   - Horas por defecto en la plantilla, editables por certificado.
4. **Acceso del personal a certificados.**
   - Recomendación: COMISION con los permisos elegibles `CERTIFICADOS_VER` o `CERTIFICADOS_OPERAR` (generar, descargar para firmar y subir firmados). Nunca emitir, anular, tocar plantillas ni la configuración.
   - TESORERO sin acceso.
5. **Qué ve el participante.**
   - Recomendación: solo los FIRMADO se pueden descargar; PREPARADO y EN_FIRMA aparecen como "En preparación".
   - El correo de aviso al firmarse va en F4, con enlace y sin adjunto.

---

### Tratamiento de la crítica (verificado en el código)

| # | Resultado |
|---|---|
| 1 BFF sin flujo | **Válido** (`proxy.ts:52`; `h3 index.mjs:1152-1156`). Tandas de ≤10 MB y `streamRequest` para multipart |
| 2 firmado que no coincide | **Válido**. Se rechaza; queda el respaldo por METADATOS y forzar individual auditado |
| 3 `evento.codigo` editable | **Válido** (`event.ts:45`, `validation.ts:33`). Carpeta por `eventoId` |
| 4 yauzl | **Válido** (`yauzl/index.js:421-426,607-617`). Deja de aplicar: ya no se lee ZIP en el servidor (fflate en el navegador) |
| 5 IP detrás del BFF | **Válido**: el BFF sí reenvía la IP (`login.post.ts:18`). El BFF público reenvía XFF, 30/min por IP más un tope global; `limiteVistaPrevia` por admin |
| 6 constitución III/IV | **Válido** (`constitution.md:51,54-56`). `/v1/public`, enmienda, sin documento y 404 salvo FIRMADO/ANULADO |
| 7 `contarFirmas` | **Válido**. Campos `/Sig` con `/V` sin `DocTimeStamp` |
| 8 `X-Avisos` | **Válido**. `encodeURIComponent(JSON)` |
| 9 URL/prefijo en manos del ADMINISTRADOR | **Válido**. PUT solo OWNER; congelado; `VERIFICATION_URL_NOT_CONFIGURED` |
| 10 lotes con dos instancias | La premisa es válida (`configuracion-sistema.ts:7-8`), pero **deja de aplicar**: se elimina el procesador de lotes |
| 11 temporales de subida | **Deja de aplicar**: subida en memoria y síncrona |
| 12 COMISION | **Válido**. Se agrega `CERTIFICADOS_OPERAR`; el manifiesto sin documento fuera de GESTION |
| 13 organizador en el portal | **Válido** (`google-auth.ts:44-50`). Escenario de aceptación que depende de B |
| 14 plazos | **Válido**. MVP con editor por formulario y el editor visual en F3 |
| Menores | Todos aceptados: límite de 5 MB, prueba de QR sin rasterizar, licencia de DejaVu, `resumen` dentro de `meta`, `ponenciaId`, DELETE solo en PENDIENTE, validación del prefijo, procedimiento ante P3009, `editadoPorId`, 409 al borrar inscripción, `useObjectStreams:false`. La revocación tardía queda en el bloque A |

### Critical Files for Implementation
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/prisma/schema.prisma
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/participant-portal/routes/participant-portal.ts (y el nuevo C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/api/certificate/pdf/estampar.ts)
- C:/Users/HP/Desktop/dev/UNDC/congreso/backend-ciisic/src/middlewares/rate-limit.ts
- C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend/server/utils/proxy.ts
- C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend/app/middleware/auth.global.ts (y C:/Users/HP/Desktop/dev/UNDC/congreso/administrator-ciisic-frontend/app/components/layout/AppSidebar.vue)

---

## Anexo: crítica adversarial

# Revisión adversarial del Bloque C (certificados, specs backend 015 y panel 010)

## ALTO

**1. El BFF no transmite la subida en flujo: carga todo el archivo en memoria.** La premisa de §0 y §a.4 es falsa.
- Evidencia:
  - `P/server/utils/proxy.ts:52-65` llama `proxyRequest` sin `streamRequest`.
  - En h3 1.15.11 (`P/node_modules/h3/dist/index.mjs:1151-1157`), sin `streamRequest` se ejecuta `body = await readRawBody(event, false)`.
  - El comentario de `proxy.ts:29` ("sin cargarlos en memoria") solo es cierto para la respuesta (`sendProxy`).
- Impacto:
  - Un ZIP de 300 MB queda como un Buffer completo en Nitro, con riesgo de OOM del panel.
  - Además, Traefik v3 cierra por `readTimeout` 60 s y Node por `requestTimeout` 300 s (también en Express).
  - Las tandas de 40 MB a 5 Mbps tardan unos 64 s y se cortan.
- Corrección:
  - Agregar `streamRequest: true` en `proxyAutenticado`. Probar de nuevo voucher, QR y ponencias.
  - Bajar `MAX_BYTES_CARGA_FIRMADOS` a 50 MB o quitar la subida por ZIP.
  - Tandas de 15 MB o menos.
  - Verificar los timeouts de Dokploy antes de F2.

**2. Se acepta un firmado aunque `coincideConGenerado = false` (solo un ⚠).** Así se cruzan personas o versiones.
- El emparejamiento se hace solo por nombre de archivo (§a.4). Un PDF de otra persona, o una versión anterior a `regenerar` o a `PUT /certificates/:id`, quedaría FIRMADO:
  - descargable en `/me` (fuga del nombre y DNI de otra persona);
  - "VALIDO" en la verificación pública.
- El PUT individual `/certificates/:id/signed` tiene el mismo riesgo.
- Corrección:
  - Rechazar por defecto con `NO_COINCIDE`. Solo el PUT individual con `forzar` puede aceptarlo, y queda auditado.
  - Agregar `descargadoParaFirmarEn` y bloquear `regenerar`, PUT y DELETE después de esa descarga, o guardar el historial de hashes generados.

**3. Las rutas de archivo dependen de `evento.codigo`, que es editable.**
- Evidencia:
  - `event/services/event.ts:45` (`data.codigo = input.codigo`) y `validation.ts:33`, hasta 60 caracteres.
  - `archivoGenerado`/`archivoFirmado` son `VarChar(120)`. Una ruta relativa `certificados/<60>/generados/<39>.pdf` mide unos 127 caracteres y no entra.
  - Si solo se guarda el nombre, renombrar el evento deja huérfanos los firmados, que no se pueden reponer.
  - `rutaCredencial` (`generatePdf.ts:15`) ya tiene este defecto, pero allí es una caché que se regenera.
- Corrección: carpeta por `evento.id`, o `409` al cambiar el código si hay certificados. Columnas `VarChar(255)`.

**4. yauzl no se comporta como dice el diseño, y la prueba propuesta es imposible.**
- Evidencia: `backend-ciisic/node_modules/yauzl/index.js:421-426,607-617` (2.10.0).
  - Con `strictFileNames: true`, cualquier `\` hace fallar **todo** el ZIP. Pasa con `Compress-Archive` de PowerShell 5.1, que usa `\` en carpetas.
  - Una entrada `../x.pdf` también aborta todo el ZIP (`emitErrorAndAutoClose`); no se "ignora".
  - yazl rechaza `../` al agregar la entrada (según su código conocido; yazl no está instalado, no lo pude comprobar), así que la prueba no puede construir ese ZIP con yazl.
- Corrección:
  - `strictFileNames: false` (normaliza `\`).
  - Error de nombre → `422 INVALID_ARCHIVE` explícito, o `decodeStrings: false` con validación propia para poder ignorar entradas.
  - Fixture binario escrito a mano para la prueba de zip-slip.

## MEDIO

**5. Premisa falsa sobre la IP detrás del BFF, y riesgo de DoS en la verificación.**
- Evidencia:
  - El BFF reenvía la IP real: `P/server/api/auth/login.post.ts:18`, `google.post.ts:60` y `P/docs/configuracion-y-despliegue.md:7`.
  - `getProxyRequestHeaders` reenvía `x-forwarded-for`, y el backend tiene `app.set('trust proxy', 1)` (`B/src/app.ts:13`).
- Impacto: si `server/api/publico/...` usa `$fetch` sin reenviar XFF, el backend ve una sola IP. Entonces el límite de 120/min es global y basta un atacante para dejar la verificación sin servicio para todos.
- Corrección:
  - Reenviar `x-forwarded-for: getRequestIP(event, { xForwardedFor: true })` igual que el login, y bajar el límite del backend a unos 30/min por IP.
  - `limiteVistaPrevia` por administrador: nueva clave `'admin'` en `claveDe` (`rate-limit.ts:22-26`).
  - `server/utils/limite.ts` no existe; es un archivo nuevo.

**6. La verificación pública contradice la constitución del backend.**
- Evidencia:
  - III: "Las respuestas públicas no exponen datos personales de terceros". El diseño devuelve `titular` y `DNI ****5678`.
  - IV: las familias de rutas son `/site`, `/me` y `/auth`. `/v1/certificates/verify/:codigo` sin guarda comparte prefijo con rutas administrativas.
- Además, los PREPARADO y EN_FIRMA salen públicamente como `EN_FIRMA`: un borrador sin firmar que se filtre "verifica".
- Corrección:
  - Enmendar III y IV y usar una familia pública propia (`/v1/public/certificates/:codigo`).
  - 404 para todo lo que no sea FIRMADO o ANULADO.
  - No mostrar el documento, o solo confirmarlo si el visitante escribe su DNI.

**7. `contarFirmas` sobreestima.**
- Contar `/ByteRange` incluye los sellos `/DocTimeStamp` (PAdES-LTA). Una firma más un sello cuenta como 2, y el certificado queda FIRMADO con `firmasRequeridas = 2`.
- Corrección: contar diccionarios `/Type /Sig` con `/ByteRange`, excluyendo `/DocTimeStamp`. Mejor aún: campos `/FT /Sig` con `/V`, leídos con pdf-lib.

**8. El encabezado `X-Avisos` rompe la vista previa.**
- Node rechaza en los encabezados los caracteres fuera de latin1 (> U+00FF) con `ERR_INVALID_CHAR`.
- El aviso de "carácter fuera de la fuente" suele nombrar justo esos caracteres, así que la vista previa responde 500 precisamente cuando hay aviso.
- Corrección: `encodeURIComponent(JSON.stringify(avisos))`, o respuesta JSON con el PDF en base64.

**9. `urlVerificacion` y `prefijoCodigo` quedan en manos del ADMINISTRADOR (CERT_GESTION).**
- La URL del panel está en Sistema, que es solo OWNER. Con este campo el ADMINISTRADOR puede redirigir el QR impreso, para siempre, a otro dominio.
- Además `urlPanel` es nullable (`schema.prisma:478`) y el diseño no dice qué pasa si está vacío.
- Corrección:
  - Esos dos campos solo para OWNER, con https obligatorio, y bloqueados una vez que existan certificados PREPARADO o posteriores.
  - Si no hay URL: error `VERIFICATION_URL_NOT_CONFIGURED` al generar.

**10. El procesador de lotes no está preparado para dos instancias.**
- `B/src/core/configuracion-sistema.ts:7-8` ya asume "otras instancias". En un despliegue solapado, el paso "PROCESANDO → PENDIENTE al iniciar" le roba el lote vivo al contenedor viejo y se procesa dos veces.
- Corrección: columna `latidoEn`, actualizada cada 10 certificados; recuperar solo los lotes con latido de más de 5 minutos.

**11. Temporales de subida que no se borran.**
- `errorHandler.ts:56` solo borra `req.file`. Con `files[]` guardados en disco, un error después de multer deja archivos en `uploads/tmp`.
- La limpieza de más de 24 h solo corre al arrancar.
- Corrección: borrar también `req.files` en el `errorHandler` y limpiar periódicamente dentro del mismo `setInterval`.

**12. El diseño es más estricto que la decisión del usuario sobre COMISION.**
- La decisión solo prohíbe a COMISION la configuración y los pagos; los permisos son elegibles por cuenta. El diseño dice "nunca emitir, generar ni subir".
- Por otro lado, `CERTIFICADOS_VER` permite bajar el ZIP masivo con `manifiesto.csv` que trae los DNI completos.
- Corrección:
  - Permiso elegible `CERTIFICADOS_OPERAR` (generar, descargar para firmar, subir firmados), sin plantillas, configuración ni anulación.
  - Sacar el ZIP masivo de CERT_VER, o manifiesto sin documento.

**13. El requisito "organizador lo ve desde allí" no está asegurado.**
- `google-auth.ts:44-50` da prioridad al administrador: el personal nunca llega al portal.
- El diseño lo delega al bloque B sin un criterio verificable.
- Corrección: un escenario de aceptación en 015 que dependa de B (elegir perfil o código OTP de participante), o "Mis certificados" dentro del panel para el personal, emparejado por correo.

**14. Plazos.**
- F1 son unos 40 archivos de backend más unos 25 del panel, con editor pdf.js, en paralelo con A y B, con congelamiento del 23 al 30 de octubre, y F2 en 10 días.
- Corrección, un MVP:
  - editor con formulario numérico y vista previa (sin arrastrar);
  - `firmasRequeridas = 1`, sin EN_FIRMA;
  - el editor visual pasa a F3.

## BAJO

- **Costo síncrono por certificado.** pdf-lib no permite reutilizar un documento cargado: `PDFDocument.load` se ejecuta en cada certificado. Con diseños de 10 MB, entre 0,5 y 2 s síncronos cada uno. Corrección: límite de 5 MB, o `worker_threads` desde F1 si el diseño pesa más de 3 MB.
- **Prueba de QR inviable.** "Lo que se lee coincide con la URL" requiere rasterizar el PDF. Corrección: comparar la matriz de `QRCode.create` con los operadores `re` del content stream.
- **Licencia de DejaVu Sans.** No es OFL (licencia Bitstream Vera/DejaVu); hay que incluir su propio LICENSE.
- **Formato de respuesta.** `{data, meta, resumen}` no sigue `{success, data, meta?}` (constitución IV). Corrección: `resumen` dentro de `meta`.
- **Ponentes.** La unicidad (evento, participante, tipo) impide dar un certificado por ponencia (D8). Además `Ponencia` no tiene DNI ni correo (`papers/validation.ts:3-7`). Corrección: referencia opcional (`ponenciaId`) dentro de `claveVigente`, y prellenar la lista desde las ponencias.
- **Correlativos repetidos.** Borrar la última fila hace que `max+1` reutilice ese `numero`. Corrección: contador persistente, o DELETE solo en PENDIENTE que nunca se descargó.
- **Validar el prefijo.** Debe cumplir `^[A-Z0-9]{2,20}$`; si no, `extraerCodigo` deja de funcionar.
- **Migración a medias.** Deja la migración fallida (P3009) y, con `set -e` en `docker-entrypoint.sh:10`, el contenedor no arranca. Como la migración solo crea tablas, documentar `DROP TABLE IF EXISTS` más `migrate resolve --rolled-back` en vez de restaurar todo el respaldo.
- **Revocación tardía.** `requireRoles` solo lee el token (`auth.ts:43-55`): quitar `CERTIFICADOS_VER` tarda hasta 1 h en aplicarse. Depende del bloque A.
- **Edición sin auditoría.** `PUT /certificates/:id`, que cambia `nombreImpreso`, no registra quién lo hizo. Agregar `editadoPorId`.
- **Borrado de inscripciones.** El DELETE de inscripciones (solo SA) deja un certificado FIRMADO con `inscripcionId = NULL`. Corrección: `409` si tiene certificado vigente.
- **Objetos comprimidos en el PDF.** `useObjectStreams: true` puede dar problemas con herramientas de firma antiguas; probarlo en F0-6.

## Verificado sin problema

- Las líneas del esquema citadas en §a.1 (`:40-42`, `:82-88`, `:111-112`, `:118-119`, `:207-212`, `:478`) son correctas.
- El patrón CHECK de fila única coincide con `20260930120000_configuracion_sistema`.
- `EstadoIntegracion` tiene los valores `OK`/`ERROR`.
- `OrigenConsulta.PANEL` existe.
- La línea `COPY` de las fuentes sigue el patrón de las plantillas (`Dockerfile:77`).
- `server.ts:14-18` es el lugar correcto para iniciar el procesador; `app.ts` no.
- El cargador toma todos los archivos de `routes/` y no hay choque de rutas con las legacy.
- `limitePortal` y `limiteCredencialPortal` existen (`rate-limit.ts:72-73`).
- El panel tiene el layout `blank`, `urlArchivo`, `AppTabs` y `AppModal`.
- No existe borrado de participantes, así que la FK RESTRICT no genera errores.
- Hoy no hay pruebas de `eliminarEvento` que se rompan.
