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
| `estados_inscripcion`, `tipos_documento`, `clasificaciones`, `roles` | Catálogos | se referencian por `codigo`. Roles (spec 013): `SUPERADMIN` «Owner», `ADMIN` «Administrador del sistema», `TESORERO` «Tesorero», `COMISION` «Comisión tecnológica»; los dos primeros conservan su código hasta después del 30-oct-2026 |
| `administradores` | Cuentas del staff | `correo` único; `activo`; `google_sub` único; `contrasena_hash` NULL = entra solo con Google; se desactiva en lugar de borrarse si revisó inscripciones o registró o anuló asistencias |
| `asignaciones_evento` | Eventos de las cuentas por evento (Tesorero, Comisión) | PK `(administrador_id, evento_id)`; en cascada con la cuenta y el evento; las cuentas globales no tienen filas |
| `permisos_administrador` | Permisos elegidos para cada cuenta de la Comisión | PK `(administrador_id, permiso)`; códigos de `src/core/permisos.ts` (se guardan con sus dependencias); solo la Comisión tiene filas y al cargar se ignoran los no elegibles |
| `actividades` / `asistencias` | Asistencia por actividad | única `(participante_id, actividad_id)`; `metodo` ENUM `QR`/`QR_LEGADO`/`DOCUMENTO`/`MANUAL` (NULL en las anteriores), `registrado_por_id`, `es_fuera_de_horario`; **anulación lógica** (`anulado_en`, `anulado_por_id`): una anulada no cuenta en ningún listado y volver a marcar reactiva la fila |
| `ponencias`, `mensajes_contacto` | Por evento | |
| `tokens_consulta`, `consultas_documento`, `personas_consultadas` | Pool DNI, bitácora enmascarada y caché | tokens cifrados |
| `integraciones_evento` | deportes-fi por evento | token cifrado |
| `credenciales_correo` | Brevo | API key cifrada; una predeterminada |
| `tokens_acceso` | Tokens de la API del sitio | solo hash SHA-256; prefijo visible; revocación |
| `configuracion_sistema` | Configuración global | **fila única** (`ck_configuracion_sistema_fila_unica`) |

Migraciones: [`prisma/migrations/`](../prisma/migrations). Las que tocan datos existentes están
escritas a mano y se ensayaron con el respaldo real de producción (spec 001). Verificaciones:
[`prisma/preflight/`](../prisma/preflight) (spec 013: preflight de cuentas, reasignación y reversión;
ver [operación](operacion.md#migración-013-roles-y-permisos)).
