# Operación

## Respaldo (antes de cada despliegue)

```bash
mysqldump --single-transaction --quick --routines --triggers --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 -h <host> -u <usuario> -p ciisic_vii > ciisic_vii_$(date +%F_%H%M).sql
```

Restaurar: `DROP DATABASE ciisic_vii; CREATE DATABASE ciisic_vii;` e importar el respaldo con
`--default-character-set=utf8mb4`.

## Migraciones

- La imagen aplica `prisma migrate deploy` al arrancar (`docker-entrypoint.sh`), después de
  validar la configuración. No hay un paso manual.
- Antes de una migración con datos: `prisma/preflight/verificar-esquema.sql` (bloqueantes en 0)
  y, después, `prisma/preflight/conteos-despues.sql`.
- Nunca "arreglar a mano" una migración a medias: restaurar el respaldo y volver a la imagen
  anterior, o usar el script de reversión que la migración documente (013, abajo).

## Migración 013 (roles y permisos)

`20260930150000_roles_permisos_alcance` es aditiva: crea `asignaciones_evento` y
`permisos_administrador`, agrega a `asistencias` `metodo`, `registrado_por_id`,
`es_fuera_de_horario`, `anulado_en` y `anulado_por_id`, cambia el nombre visible de `SUPERADMIN`
(«Owner») y `ADMIN` («Administrador del sistema») sin tocar sus códigos y agrega los roles
`TESORERO` y `COMISION`. La imagen anterior sigue funcionando con la BD migrada (las cuentas
TESORERO y COMISION reciben 403 en ella).

1. **Respaldo** (arriba).
2. **Preflight** (solo lectura): `mysql … ciisic_vii < prisma/preflight/verificar-roles-013.sql`.
   Lista cada cuenta con su rol, estado, vínculo con Google, contraseña y revisiones. Al migrar, las
   cuentas `ADMIN` pasan a Administrador del sistema y **ganan** credenciales de correo, tokens de
   acceso, borrar inscripciones y crear Tesoreros y Comisión: el Owner decide cuenta por cuenta.
3. **Desplegar** la imagen: `migrate deploy` aplica la migración al arrancar. Los JWT de la imagen
   anterior no traen la huella de las credenciales: quien tenga el panel abierto vuelve a ingresar
   una vez (desplegar fuera del horario de atención).
4. **Justo después**, si el Owner lo decidió: `prisma/preflight/reasignar-013.sql` (reemplazar
   `:correo` y `:codigo_evento`, revisar el `SELECT` final —si `eventos` sale vacío, el código del
   evento no existe— y terminar con `COMMIT` o `ROLLBACK`), o
   desactivar la cuenta. La guarda lee la BD en cada petición: el cambio aplica al instante. Hasta
   desplegar el panel con permisos (spec 008 del panel) no crear cuentas de Tesorero ni de Comisión:
   el panel anterior les muestra menús que responden 403.
5. **Si la migración falla a medias** (error P3009: el contenedor no arranca, tampoco con la imagen
   anterior, porque `docker-entrypoint.sh` ejecuta `migrate deploy` con `set -e`):
   1. `mysql … ciisic_vii < prisma/preflight/revertir-013.sql` (usa `DELIMITER`; cada paso solo si
      el objeto existe; requiere que ninguna cuenta use TESORERO ni COMISION).
   2. Desde un contenedor puntual de la imagen:
      `./node_modules/.bin/prisma migrate resolve --rolled-back 20260930150000_roles_permisos_alcance`
      (en local, `npx prisma migrate resolve --rolled-back …`).
   3. Volver a arrancar. Alternativa: restaurar el respaldo (pierde lo registrado desde entonces).

**Último Owner.** La API impide dejar el sistema sin un Owner activo (`409 LAST_OWNER`) y
`bootstrap:admin` no promueve cuentas existentes. Si aun así pasa (por un cambio hecho por SQL), se
recupera así:

```sql
UPDATE administradores SET rol_id = (SELECT id FROM roles WHERE codigo = 'SUPERADMIN'), activo = 1 WHERE correo = '<correo>';
DELETE FROM asignaciones_evento WHERE administrador_id = (SELECT id FROM administradores WHERE correo = '<correo>');
DELETE FROM permisos_administrador WHERE administrador_id = (SELECT id FROM administradores WHERE correo = '<correo>');
```

## Primer Owner

```bash
npm run bootstrap:admin -- --correo tu@undc.edu.pe --nombres "Nombre" --apellidos "Apellidos"
```

Crea la cuenta con el rol Owner (`SUPERADMIN`) si no existe y muestra una contraseña temporal una
sola vez (en la imagen: `node dist/src/database/bootstrapAdmin.js --correo …`). El resto del equipo
se crea en el panel (Equipo y administradores).

## Rotación de secretos

| Secreto | Cómo rotar | Efecto |
|---|---|---|
| `JWT_SECRET` | Cambiar la variable y redeplegar; luego volver a guardar en el panel la API key de Brevo, los tokens DNI, la API key de API_UNDC y el token de deportes-fi | Se cierran las sesiones, caducan los tokens de verificación y los secretos guardados no se pueden leer hasta volver a guardarlos. Los tokens de acceso de las landings **siguen sirviendo** |
| API key de Brevo, tokens DNI, token de deportes-fi, API key de API_UNDC | Editar en el panel (Correo, Consultas DNI, Integraciones, Sistema) | Inmediato |
| Token de acceso de una landing | Panel → Eventos → Acceso → generar uno nuevo, configurarlo en la landing y revocar el anterior | Inmediato |
| Contraseña de la BD | Cambiarla en MySQL y en `DATABASE_URL` | Requiere redeplegar |

## Incidencias frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El contenedor no arranca y el log dice "…es obligatoria" | Falta una variable (`DATABASE_URL` o `JWT_SECRET`) | Agregarla; la BD no se tocó |
| Una credencial falla con "No se pudo descifrar un secreto guardado" | Cambió `JWT_SECRET` | Volver a guardarla en el panel (Correo, Consultas DNI, Sistema o Integraciones) |
| La landing responde `EVENT_TOKEN_REQUIRED` / `INVALID_EVENT_TOKEN` | Token faltante, revocado o expirado | Generar uno nuevo en Eventos → Acceso |
| Consulta DNI siempre 503 | Sin tokens vigentes | Consultas DNI → agregar o reiniciar tokens y **Probar** |
| Verificación de estudiante "no disponible" | API_UNDC sin configurar o caída | Sistema → API UNDC → **Probar** |
| **Probar** dice "La URL redirige a otra página" | Se guardó la URL de un sitio web (p. ej. SIGENET, `https://jp.episundc.pe`) | Usar la URL de la API: `https://api-jp.episundc.pe`, con tiempo de espera de 15000 ms |
| No salen los correos de aprobación | Credencial de Brevo inválida o remitente no verificado | Correo → **Probar** / **Enviar prueba**; luego "Reenviar credencial" |
| Rutas antiguas responden 410 | "Landing anterior" desactivada | Es lo esperado cuando la landing nueva está publicada |
| `429 RATE_LIMITED` en un sitio | Límite por visitante o por token | Revisar el log (`Límite por token alcanzado …`); revocar el token si hay abuso |
| El panel pide volver a ingresar (`SESSION_INVALIDATED`) | La cuenta se desactivó, se borró o tiene un rol desconocido; o cambiaron su correo, su contraseña o su vínculo con Google | Revisarla en Equipo y administradores (la guarda lee la BD en cada petición); tras un cambio de credenciales es lo esperado |
| El panel pide volver a ingresar tras 12 h (`SESSION_EXPIRED`) | Tope de la sesión del staff | Volver a ingresar |
| `409 ADMIN_CHANGED` al guardar una cuenta | Otra persona cambió su rol mientras tanto | Recargar la cuenta y volver a guardar |
| `403 EVENT_NOT_ASSIGNED` a un Tesorero o a la Comisión | La cuenta no tiene asignado ese evento | Asignarlo en Equipo y administradores |
| Botón de Google con error de origen | Dominio no autorizado en Google Cloud | Agregar el origen al client ID |

## Registros útiles

- Al arrancar: migraciones aplicadas, avisos `⚠️` de variables sobrantes o importadas, y
  `🚀 Server corriendo`.
- Cambios de configuración: `Configuración del sistema actualizada por el administrador <id>: <campos>`
  (nunca se registran valores).
