# Modelo de datos — multi-evento

## eventos (nueva)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | INT PK | |
| `codigo` | VARCHAR(60) único | slug usado por la landing (`ciisic-viii-2026`) |
| `nombre` / `nombre_corto` | VARCHAR(200) / VARCHAR(80) | nombre completo y marca corta |
| `descripcion`, `sede` | TEXT / VARCHAR(200) | |
| `fecha_inicio`, `fecha_fin` | DATE | |
| `inscripciones_inicio`, `inscripciones_fin` | DATETIME(3) NULL | ventana opcional |
| `inscripciones_abiertas` | BOOLEAN | interruptor manual |
| `estado` | ENUM(BORRADOR, PUBLICADO, FINALIZADO, ARCHIVADO) | público solo PUBLICADO/FINALIZADO |
| `es_principal` | BOOLEAN | evento de las rutas legacy (uno solo) |
| `dominio_institucional` | VARCHAR(100) | `undc.edu.pe` |
| `correo_contacto`, `telefono_contacto` | | se imprimen en credencial y correo |
| `remitente_nombre`, `asunto_aprobacion` | | correo de aprobación |
| `logo_archivo` | VARCHAR(255) NULL | `uploads/logos/<archivo>` |
| `datos_pago` | JSON | `{ titular, bancos: [{codigo,nombre,numeroCuenta,cci}], billeteras: [{codigo,nombre,telefono,qrUrl}] }` |
| `creado_en`, `actualizado_en` | DATETIME(3) | |

## Cambios en tablas existentes

| Tabla | Nuevas columnas / restricciones |
|---|---|
| `categorias_inscripcion` | `evento_id` FK, `codigo`, `es_estudiantil`, `orden`; `UNIQUE(evento_id, codigo)` |
| `tipos_inscripcion` | `codigo` obligatorio, `orden`; `UNIQUE(categoria_id, codigo)` |
| `inscripciones` | `evento_id` FK, `motivo_rechazo`, `revisado_por_id` FK → administradores (SET NULL), `revisado_en`, `credencial_enviada_en`; `UNIQUE(evento_id, participante_id)` |
| `actividades` | `evento_id` FK |
| `ponencias` | `evento_id` FK; índice `(evento_id, creado_en)` |
| `mensajes_contacto` | `evento_id` FK nullable (SET NULL), `leido` |
| `administradores` | `activo` |

## Relaciones

```
eventos 1─* categorias_inscripcion 1─* tipos_inscripcion 1─* inscripciones *─1 participantes
eventos 1─* inscripciones *─1 estados_inscripcion
eventos 1─* actividades 1─* asistencias *─1 participantes
eventos 1─* ponencias · eventos 1─* mensajes_contacto · eventos 1─* integraciones_evento
administradores 1─* inscripciones (revisado_por)
```
