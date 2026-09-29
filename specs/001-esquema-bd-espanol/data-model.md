# Modelo de datos — renombrado en español

## Convención

| Elemento | Regla | Ejemplo |
|---|---|---|
| Tabla | español, `snake_case`, plural | `tipos_inscripcion` |
| Columna | `snake_case` | `numero_operacion` |
| PK | `id` | `id` |
| FK | `<entidad_singular>_id` | `participante_id` |
| Booleano | `es_*`, `tiene_*`, `activo` | `es_correo_institucional` |
| Marcas de tiempo | `creado_en`, `actualizado_en` | |
| Dinero | `DECIMAL(10,2)` | `monto` |
| FK constraint | `fk_<tabla>_<referencia>` | `fk_inscripciones_participante` |
| Único | `uq_<tabla>_<columnas>` | `uq_participantes_documento` |
| Índice | `idx_<tabla>_<columnas>` | `idx_inscripciones_estado` |
| Modelo Prisma | singular PascalCase + `@@map` | `model Participante { … @@map("participantes") }` |
| Campo Prisma | camelCase + `@map` | `numeroDocumento @map("numero_documento")` |

## Mapa de tablas

| Tabla actual | Modelo actual | Tabla nueva | Modelo nuevo |
|---|---|---|---|
| `Administradores` | `Administradores` | `administradores` | `Administrador` |
| `Roles` | `Roles` | `roles` | `Rol` |
| `Usuario` | `Usuario` | `participantes` | `Participante` |
| `TipoDocumento` | `TipoDocumento` | `tipos_documento` | `TipoDocumento` |
| `TipoPlanInscripcion` | `TipoPlanInscripcion` | `categorias_inscripcion` | `CategoriaInscripcion` |
| `TipoInscripcion` | `TipoInscripcion` | `tipos_inscripcion` | `TipoInscripcion` |
| `Clasificacion` | `Clasificacion` | `clasificaciones` | `Clasificacion` |
| `EstadoInscripcion` | `EstadoInscripcion` | `estados_inscripcion` | `EstadoInscripcion` |
| `Inscripcion` | `Inscripcion` | `inscripciones` | `Inscripcion` |
| `Contact` | `Contact` | `mensajes_contacto` | `MensajeContacto` |
| `Evento` (sesiones de asistencia) | `Evento` | `actividades` | `Actividad` |
| `Asistencia` | `Asistencia` | `asistencias` | `Asistencia` |
| `PaperSubmission` | `PaperSubmission` | `ponencias` | `Ponencia` |

`Evento` pasa a significar la **edición del congreso** (tabla nueva `eventos`, spec 002);
por eso las sesiones de asistencia se renombran a `actividades`.

## Mapa de columnas

### administradores
| Actual | Nuevo |
|---|---|
| `correoElectronico` | `correo` |
| `contrasena` | `contrasena_hash` |
| `creadoEn` / `actualizadoEn` | `creado_en` / `actualizado_en` |
| `rolId` | `rol_id` |

### roles
| Actual | Nuevo |
|---|---|
| — | `codigo` VARCHAR(30) único (`SUPERADMIN`, `ADMIN`) |

### participantes
| Actual | Nuevo |
|---|---|
| `dni` CHAR(8) + `numero` | `numero_documento` VARCHAR(20) (se conserva el valor de `dni`) |
| `idTipoDocumentoId` (nullable) | `tipo_documento_id` NOT NULL (nulos → `dni`) |
| `correoElectronico` | `correo` |
| `celular` CHAR(9) | `celular` VARCHAR(20) |
| `creadoEn` / `actualizadoEn` | `creado_en` / `actualizado_en` |
| únicos `dni`, `numero` | único `(tipo_documento_id, numero_documento)` |

### categorias_inscripcion
| Actual | Nuevo |
|---|---|
| `precioDesde` DECIMAL(65,30) | `precio_desde` DECIMAL(10,2) |

### tipos_inscripcion
| Actual | Nuevo |
|---|---|
| `badge` | `etiqueta` |
| `value` | `codigo` |
| `precio` DECIMAL(65,30) | `precio` DECIMAL(10,2) |
| `institutionalPrice` | `precio_institucional` DECIMAL(10,2) |
| `tipoPlanId` | `categoria_id` |
| `descripcion` VARCHAR(191) | `descripcion` TEXT |

### estados_inscripcion
| Actual | Nuevo |
|---|---|
| — | `codigo` VARCHAR(30) único (`PENDIENTE`, `APROBADO`, `RECHAZADO`, `EN_REVISION`, `CANCELADO`) |

### inscripciones
| Actual | Nuevo |
|---|---|
| `usuarioId` | `participante_id` |
| `tipoInscripcionId` | `tipo_inscripcion_id` |
| `clasificacionId` | `clasificacion_id` |
| `estadoId` | `estado_id` |
| `modalidadDeposito` | `modalidad_pago` |
| `bancoSeleccionado` | `banco` |
| `tipoOperacion` | `tipo_operacion` |
| `billeteraDigital` | `billetera_digital` |
| `numeroOperacion` | `numero_operacion` |
| `fechaPago` | `fecha_pago` |
| `pago` DECIMAL(65,30) | `monto` DECIMAL(10,2) |
| `descuento` DECIMAL(65,30) | `descuento` DECIMAL(10,2) |
| `hasDiscount` | `tiene_descuento` |
| `esEmailInstitucional` | `es_correo_institucional` |
| `file` | `voucher_archivo` |
| `creadoEn` / `actualizadoEn` | `creado_en` / `actualizado_en` |

### mensajes_contacto
| Actual | Nuevo |
|---|---|
| `firstName` / `lastName` | `nombres` / `apellidos` |
| `email` | `correo` |
| `subject` | `asunto` |
| `message` VARCHAR(191) | `mensaje` TEXT |
| `timestamp` | `creado_en` |

### actividades
| Actual | Nuevo |
|---|---|
| `hora_comienzo` / `hora_termino` | `hora_inicio` / `hora_fin` |
| índice redundante `evento_pkey` | eliminado |

### asistencias
| Actual | Nuevo |
|---|---|
| `dia_hora` | `registrado_en` |
| `id_usuario` | `participante_id` |
| `id_evento` | `actividad_id` |

### ponencias
| Actual | Nuevo |
|---|---|
| `title` | `titulo` |
| `mainAuthor` / `coauthors` | `autor_principal` / `coautores` |
| `filename` / `originalFilename` | `archivo` / `archivo_original` |
| `size` | `tamano_bytes` |
| `createdAt` | `creado_en` |

## Claves foráneas

| Nueva FK | Columna → referencia | ON DELETE |
|---|---|---|
| `fk_administradores_rol` | `administradores.rol_id → roles.id` | RESTRICT |
| `fk_participantes_tipo_documento` | `participantes.tipo_documento_id → tipos_documento.id` | RESTRICT |
| `fk_tipos_inscripcion_categoria` | `tipos_inscripcion.categoria_id → categorias_inscripcion.id` | RESTRICT |
| `fk_inscripciones_participante` | `inscripciones.participante_id → participantes.id` | RESTRICT |
| `fk_inscripciones_tipo_inscripcion` | `inscripciones.tipo_inscripcion_id → tipos_inscripcion.id` | SET NULL |
| `fk_inscripciones_clasificacion` | `inscripciones.clasificacion_id → clasificaciones.id` | SET NULL |
| `fk_inscripciones_estado` | `inscripciones.estado_id → estados_inscripcion.id` | RESTRICT |
| `fk_asistencias_actividad` | `asistencias.actividad_id → actividades.id` | RESTRICT |
| `fk_asistencias_participante` | `asistencias.participante_id → participantes.id` | RESTRICT |
