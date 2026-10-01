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
  anterior, o usar el script de reversión o de completado que la migración documente (013 y 014,
  abajo).

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

## Migración 014 (portal y fotocheck)

`20261001120000_portal_fotocheck` es aditiva: crea `codigos_acceso` (códigos de acceso al portal,
solo su HMAC), agrega a `participantes` `foto_archivo` y `foto_actualizada_en`, y a `inscripciones`
`codigo_credencial` (se rellena con `RANDOM_BYTES` en las aprobadas o con credencial enviada y los
repetidos se regeneran; las pendientes lo reciben al aprobarse) y `es_qr_legado` (esas mismas, que
pudieron recibir el QR anterior). El índice único `uq_inscripciones_codigo_credencial` va al final:
es la única sentencia que puede fallar por los datos. No toca `asistencias` (su auditoría es de la
013). La imagen anterior sigue funcionando con la BD migrada: inserta sin código y la imagen nueva
lo completa al leer (y, si ya estaba aprobada, la marca con el QR anterior). Ensayo con el respaldo
(antes de este ajuste): 308 inscripciones, 307 aprobadas o con credencial enviada (todas con código
distinto y la marca del QR anterior), 585 asistencias sin cambios y `migrate diff` vacío.

**Desplegar primero el panel 009 y después el backend 014** (el mismo día, fuera del horario de
atención); nunca el backend 014 solo. Cada credencial que el backend 014 apruebe, reenvíe o deje
descargar lleva en el QR el código de 10 caracteres, que el escáner del panel anterior rechaza en
el navegador (solo lee el id del QR anterior; habría que marcar por documento). El panel 009 lee los
dos formatos (contrato 4 de `docs/arquitectura-ecosistema.md`) y muestra en ámbar el QR anterior,
que se acepta hasta el `fechaFin` de cada evento; contra el backend anterior es inocuo, porque
ningún PDF tiene todavía el código. La landing no necesita cambios (el aviso de `correoConservado`
es opcional).

Antes de desplegar:

- El `Dockerfile` copia `src/api/participant-auth/templates` a
  `dist/src/api/participant-auth/templates` (como las plantillas de inscripción; lo comprueba
  `tests/core/plantillas-docker.test.ts`). Sin ella el acceso por código queda apagado
  (`accesoCodigo.disponible: false`, `503 CODE_LOGIN_UNAVAILABLE` y el log «Falta la plantilla
  codigo-acceso.html»).
- Una credencial de correo **predeterminada y activa** que funcione (Correo → **Probar** y
  **Enviar prueba**): el código por correo y los avisos sin evento usan esa credencial. Revisar la
  cuota diaria de Brevo.
- El volumen de `/app/uploads` también guarda las fotos (`uploads/fotos`). Los PDF de credencial
  pasan a llamarse `<id>-<huella>.pdf` (con el QR nuevo): los `<id>.pdf` anteriores se regeneran al
  pedirlos (como mucho 2 a la vez; si se llena la cola, `503 PDF_BUSY` con `Retry-After`). Para
  que el día del evento no se regeneren todos a la vez, pregenerarlos tras desplegar (paso 6).
- El BFF del panel debe llamar al backend por la URL interna de Docker (`NUXT_BACKEND_BASE_URL`)
  para que los límites por IP (Google, código por correo) vean la IP de cada visitante.

Pasos:

1. **Respaldo** (arriba).
2. **Desplegar** el panel 009 y luego la imagen del backend (`migrate deploy` aplica la migración
   al arrancar).
3. **Verificar** (solo lectura): `mysql … ciisic_vii < prisma/preflight/verificar-014.sql`. Justo
   después de migrar: `total = con_codigo = distintos`, `formato_invalido = 0`,
   `sin_marca_qr_anterior = 0`, el índice existe con `non_unique = 0`, `codigos_acceso` vacía y los
   conteos de inscripciones, participantes y asistencias iguales a los del respaldo. Además, desde
   un contenedor puntual de la imagen,
   `./node_modules/.bin/prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
   debe salir 0.
4. **Si falla en el índice único** (error P3009 con «Duplicate entry … uq_inscripciones_codigo_credencial»;
   probabilidad ~1e-10): `mysql … ciisic_vii < prisma/preflight/completar-014.sql` (rellena,
   regenera los repetidos hasta que no quede ninguno, marca el QR anterior y crea el índice; se
   puede repetir) y `./node_modules/.bin/prisma migrate resolve --applied 20261001120000_portal_fotocheck`.
   Verificar como en el paso 3.
5. **Si falla antes** (falta la tabla o una columna; `completar-014.sql` lo detecta y se detiene):
   `mysql … ciisic_vii < prisma/preflight/revertir-014.sql` (usa `DELIMITER`; cada paso solo si el
   objeto existe), `./node_modules/.bin/prisma migrate resolve --rolled-back 20261001120000_portal_fotocheck`
   y volver a desplegar (la migración se aplica desde cero).
6. **Cuando ya no corre el contenedor anterior**: `mysql … ciisic_vii < prisma/preflight/marcar-qr-legado-014.sql`
   (idempotente, sin `migrate resolve`; debe terminar con `sin_marca_qr_anterior = 0`). Cubre lo que
   el contenedor anterior haya aprobado, reenviado o dejado descargar mientras convivía con el nuevo.
   Después, fuera de horario, pregenerar las credenciales del evento en curso desde un contenedor
   puntual de la imagen: `node dist/src/database/pregenerarCredenciales.js --evento ciisic-viii-2026`
   (de una en una; se puede repetir; termina con «Listo: N de N credenciales al día»).
7. **Volver a la imagen anterior no exige revertir**: el esquema es aditivo. Pero la imagen anterior
   imprime el QR anterior (id del participante): **al volver a la 014 hay que repetir el paso 6**
   (`marcar-qr-legado-014.sql`), o esos QR responden `422 LEGACY_QR_NOT_ALLOWED`. Revertir el
   esquema borra los códigos de las credenciales (los PDF y fotochecks con el QR nuevo dejan de
   valer), los códigos de acceso y la referencia a las fotos (los archivos quedan en `uploads/fotos`).
   Si se vuelve al panel anterior, su escáner solo lee los QR anteriores: a los demás se los marca
   por documento.

Mientras dure la convivencia, `codigo_credencial` admite NULL; `NOT NULL` va en una migración
posterior al 30-oct-2026.

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
| `JWT_SECRET` | Cambiar la variable y redeplegar; luego volver a guardar en el panel la API key de Brevo, los tokens DNI, la API key de API_UNDC y el token de deportes-fi | Se cierran las sesiones, caducan los tokens de verificación y los códigos de acceso por correo vigentes, y los secretos guardados no se pueden leer hasta volver a guardarlos. Los tokens de acceso de las landings **siguen sirviendo** |
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
| El panel no ofrece el código por correo (`accesoCodigo.disponible: false`) o responde `503 CODE_LOGIN_UNAVAILABLE` | No hay credencial de correo predeterminada activa, su último envío o prueba falló hace menos de 15 min, o la imagen no trae la plantilla (log «Falta la plantilla codigo-acceso.html») | Correo → **Probar** / **Enviar prueba** (con una prueba correcta vuelve de inmediato; si no, sola 15 min después de la última falla); revisar el `Dockerfile` |
| `503 CODE_LOGIN_PAUSED` | 150 verificaciones de código fallidas contra participantes existentes en una hora (posible fuerza bruta distribuida; log «Acceso por código pausado 1 h») | Esperar la hora (reiniciar el contenedor borra el disyuntor) y revisar el log; Google sigue disponible |
| `503 CODE_LOGIN_UNAVAILABLE` con `Retry-After` (log «se alcanzó el tope global de códigos enviados») | 400 códigos enviados en una hora o 2000 en un día (protege la cuota de Brevo de los correos de aprobación) | Esperar lo que indica `Retry-After`; Google sigue disponible. Si es tráfico legítimo, subir `ENVIOS_GLOBALES_*` en `participant-auth.ts` |
| `429 RATE_LIMITED` al pedir o verificar códigos | 200 solicitudes por hora o 50 códigos incorrectos por hora desde la misma IP (o subred /56 de IPv6) | Esperar; si toda la sede comparte una IP pública y es tráfico legítimo, entrar con Google |
| Una persona no recibe el código | Correo sin inscripción (la respuesta es la misma a propósito), spam, cuota de Brevo o fallo del envío (log «No se pudo enviar el código de acceso (solicitud N)») | Revisar el correo de la inscripción en Participantes y el estado de la credencial en Correo |
| `429 CODE_LOCKED` o `CODE_COOLDOWN` | Muchos intentos o códigos pedidos con ese correo | Esperar lo que indica `Retry-After` (bloqueo hasta 1 h; tope diario hasta 24 h) o entrar con Google |
| `503 PDF_BUSY` al descargar o `credencialEnviada: false` al aprobar | Más de 2 PDF generándose y 30 en cola (log «Servicio no disponible: PDF_BUSY») | Reintentar tras `Retry-After`; luego **Reenviar credencial**. Tras desplegar la 014, pregenerar (paso 6 de la migración 014) |
| `422 IMAGE_TOO_LARGE` al subir la foto | La imagen declara más de 4096 px por lado | El panel la reduce antes de subirla; si llega por otra vía, reducirla |
| `422 LEGACY_QR_NOT_ALLOWED` en el escáner | QR anterior de una inscripción que ya tiene el código nuevo, o pasado el `fechaFin` del evento | Pedir el fotocheck del portal o marcar por documento |
| Alguien se reinscribió con otro correo y no le llegó nada (`correoConservado: true`) | El formulario público nunca cambia el correo registrado (ni verificado con Google: evitaría una toma de cuenta con solo conocer el DNI); se avisa al correo registrado | Si la persona lo pide y se confirma su identidad, cambiar el correo en Participantes (se avisa al anterior) |
| El escáner responde `422 LEGACY_QR_NOT_ALLOWED` a muchos QR anteriores tras una vuelta atrás | La imagen anterior emitió credenciales con el QR anterior en inscripciones que ya tenían código | `prisma/preflight/marcar-qr-legado-014.sql` |

## Registros útiles

- Al arrancar: migraciones aplicadas, avisos `⚠️` de variables sobrantes o importadas, y
  `🚀 Server corriendo`.
- Cambios de configuración: `Configuración del sistema actualizada por el administrador <id>: <campos>`
  (nunca se registran valores).
- Cambio de correo de un participante desde el panel: `[participantes] La cuenta <id> cambió el
  correo del participante <id>` (solo ids).
- Código por correo: `Acceso por código pausado 1 h: …` (disyuntor), `Acceso por código: se alcanzó
  el tope global de códigos enviados` y `No se pudo enviar el código de acceso (solicitud <id>):
  <causa>`; nunca se registran correos ni códigos. Los fallos de esos envíos no cambian el estado de
  la credencial de correo (solo quedan en el log).
- Avisos en diferido: `No se pudo enviar <aviso> (inscripción <id> | participante <id>): <tipo de
  error> [<código de Prisma>]`; si Brevo rechaza un aviso, el detalle queda en la credencial
  (`ultimoError`, en Correo), no en el log.
- 503 de negocio (`PDF_BUSY`, `CODE_LOGIN_*`): `Servicio no disponible: <código>` (aviso); «Error
  interno» queda solo para errores inesperados.
