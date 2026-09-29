# Modelo de datos

Convención (constitución, principio II): tablas en español, `snake_case` y plural (salvo las de
fila única); modelos Prisma singulares con `@@map`/`@map`; restricciones `fk_*`, `uq_*`,
`idx_*`, `ck_*`. Esquema completo: [`prisma/schema.prisma`](../prisma/schema.prisma); mapa de
renombrado desde el esquema anterior: [`specs/001-esquema-bd-espanol/data-model.md`](../specs/001-esquema-bd-espanol/data-model.md).

| Tabla | Contenido | Reglas clave |
|---|---|---|
| `eventos` | Ediciones y eventos | `codigo` único; un solo `es_principal`; `estado` BORRADOR/PUBLICADO/FINALIZADO/ARCHIVADO; `datos_pago` JSON; `credencial_correo_id` opcional |
| `categorias_inscripcion` / `tipos_inscripcion` | Planes por evento | únicos `(evento_id, codigo)` y `(categoria_id, codigo)`; precio y precio institucional `DECIMAL(10,2)` |
| `participantes` | Personas | únicos `(tipo_documento_id, numero_documento)` y `correo`; `google_sub` único (vínculo con Google) |
| `inscripciones` | Inscripción de un participante a un evento | único `(evento_id, participante_id)`; `numero_operacion` único; estado por código; monto calculado por el servidor; evidencia de verificación de estudiante y de correo (Google) |
| `estados_inscripcion`, `tipos_documento`, `clasificaciones`, `roles` | Catálogos | se referencian por `codigo` |
| `administradores` | Usuarios del panel | `correo` único; `activo`; `google_sub` único |
| `actividades` / `asistencias` | Asistencia por actividad | única `(participante_id, actividad_id)` |
| `ponencias`, `mensajes_contacto` | Por evento | |
| `tokens_consulta`, `consultas_documento`, `personas_consultadas` | Pool DNI, bitácora enmascarada y caché | tokens cifrados |
| `integraciones_evento` | deportes-fi por evento | token cifrado |
| `credenciales_correo` | Brevo | API key cifrada; una predeterminada |
| `tokens_acceso` | Tokens de la API del sitio | solo hash HMAC; prefijo visible; revocación |
| `configuracion_sistema` | Configuración global | **fila única** (`ck_configuracion_sistema_fila_unica`) |

Migraciones: [`prisma/migrations/`](../prisma/migrations). Las que tocan datos existentes están
escritas a mano y se ensayaron con el respaldo real de producción (spec 001). Verificaciones:
[`prisma/preflight/`](../prisma/preflight).
