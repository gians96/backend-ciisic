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
  anterior, o usar el script de reversión o de completado que la migración documente (013, 014 y
  015, abajo).

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

## Migración 015 (certificados)

`20261001150000_certificados` es aditiva: crea `tipos_certificado` (con `PARTICIPANTE`,
`ORGANIZADOR` y `PONENTE`), `plantillas_certificado` y `certificados` (con el CHECK
`ck_certificados_clave_vigente`) y agrega a `configuracion_sistema` las 11 columnas
`certificados_*` (proveedor `LOCAL` sin confirmar, prefijo `CIISIC`, sin credenciales UNDC). No toca
datos existentes. La imagen anterior sigue funcionando con la BD migrada (no conoce las tablas
nuevas). Ensayo (1-oct-2026, con la versión corregida que agrega `bytes_firmado` y `firmantes`) en
una copia desechable recién hecha de `ciisic_ensayo`: aplicó las 4 migraciones pendientes (013,
`administradores_solo_google`, 014 y 015) con `migrate diff --exit-code` en 0 y los mismos conteos
(308 inscripciones, 308 participantes, 585 asistencias); el CHECK rechazó un PENDIENTE sin clave y
un ANULADO con clave; `firmantes` guardó y devolvió el JSON (MySQL reordena sus claves);
`revertir-015.sql` se corrió dos veces seguidas; con la migración marcada como fallida (P3009
simulado), `migrate resolve --rolled-back` y otro `migrate deploy` la aplicaron de nuevo y el diff
volvió a 0. `migrate resolve --rolled-back` solo acepta una migración **fallida**: sobre una aplicada
responde «not in a failed state».

**Cuándo**: después del VIII CIISIC (31-oct-2026 o más tarde): del 24 al 30-oct no se despliega
(un push a `main` del backend despliega y migra). Primero el backend 015 (el panel actual no usa las
rutas nuevas) y después el panel 010.

Antes de desplegar:

- El `Dockerfile` copia las fuentes: `src/api/certificate/pdf/fuentes` →
  `dist/src/api/certificate/pdf/fuentes` (14 TTF y 7 licencias; `tsc` no copia binarios). Sin ellas
  la vista previa y la generación fallan (`GENERATION_FAILED`). Comprobarlo con
  `docker run --rm --entrypoint ls <imagen> dist/src/api/certificate/pdf/fuentes`.
- El volumen de `/app/uploads` guarda también `uploads/certificados` (plantillas, generados,
  firmados y `firmados/reemplazados/`, donde quedan los firmados reemplazados o quitados): los
  **firmados no se pueden reponer**. Respaldo después de cada carga (abajo).
- **Sistema → URL del panel** con la URL definitiva: la de verificación (`<url_panel>/verificar/<código>`)
  queda impresa en el QR de cada certificado y congelada al generarlo.
- El BFF del panel llama por la URL interna de Docker y reenvía la IP real (`X-Forwarded-For`): la
  verificación pública tiene límites por IP. Las cargas de firmados son de hasta 25 MB por solicitud
  y deben llevar `Content-Length` (revisar los límites y tiempos de espera del proxy en Dokploy).

Pasos:

1. **Respaldo** (arriba).
2. **Desplegar** la imagen: `migrate deploy` aplica la migración al arrancar.
3. **Verificar** (solo lectura):

   ```sql
   SELECT codigo, nombre, texto_impreso, activo FROM tipos_certificado ORDER BY orden;  -- PARTICIPANTE, ORGANIZADOR, PONENTE
   SELECT certificados_proveedor, certificados_prefijo, certificados_proveedor_confirmado FROM configuracion_sistema;  -- LOCAL, CIISIC, 0
   SELECT (SELECT COUNT(*) FROM plantillas_certificado) AS plantillas, (SELECT COUNT(*) FROM certificados) AS certificados;  -- 0, 0
   SELECT constraint_name FROM information_schema.check_constraints
    WHERE constraint_schema = DATABASE() AND constraint_name = 'ck_certificados_clave_vigente';  -- 1 fila
   ```

   Los conteos de inscripciones, participantes y asistencias, iguales a los del respaldo; y, desde un
   contenedor puntual de la imagen,
   `./node_modules/.bin/prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code`
   debe salir 0.
4. **Configurar** (panel): Certificados → Configuración: el prefijo (se bloquea en cuanto se genera
   el primer PDF) y **confirmar el proveedor LOCAL** (sin confirmar no se descarga para firmar). Dar
   a la Comisión «Ver» u «Operar» certificados solo a quien corresponda (nunca vienen marcados).
5. **Si la migración falla a medias** (P3009: con `set -e` en `docker-entrypoint.sh` el contenedor
   no arranca, tampoco con la imagen anterior): en un contenedor aparte con la misma imagen y
   `DATABASE_URL`,
   1. `mysql … ciisic_vii < prisma/preflight/revertir-015.sql` (usa `DELIMITER`; cada paso solo si el
      objeto existe; se puede repetir);
   2. `./node_modules/.bin/prisma migrate resolve --rolled-back 20261001150000_certificados`;
   3. volver a desplegar (la migración se aplica desde cero).
6. **Volver a la imagen anterior no exige revertir**: el esquema es aditivo. Revertir el esquema
   **borra** tipos, plantillas, certificados (estados, códigos, firmas registradas) y la configuración
   de certificados, incluidas las credenciales UNDC; los archivos de `uploads/certificados` quedan en
   disco. Antes de revertir con certificados ya firmados: respaldo de la BD y de `uploads/certificados`.

## Certificados: flujo operativo y respaldo

1. **Plantilla** (Certificados → Plantillas, `certificados.gestionar`): subir el diseño en PDF (A4,
   1–2 páginas, ≤5 MB —exportarlo como «tamaño reducido»—, sin rotar ni proteger), ubicar los campos
   (nombre, tipo, texto, código, QR…), revisar la **vista previa** y sus avisos, e indicar las firmas
   requeridas (1 por defecto) y las horas por defecto.
2. **Emitir**: desde los inscritos aprobados (simular primero; asistencia mínima opcional), uno por
   uno (organizadores, ponentes: DNI y **correo**) o por lista (en partes de 300 filas). Repetir una
   emisión no duplica.
3. **Generar** los pendientes: el panel pide tandas de 10 hasta terminar; si se corta, «Generar
   pendientes» continúa. Requiere la URL del panel en Sistema.
4. **Confirmar el proveedor** (Certificados → Configuración): LOCAL mientras la UNDC no dé acceso a su
   API. Sin esto no se descarga para firmar (`409 PROVIDER_NOT_CONFIRMED`).
5. **Descargar para firmar**: ZIP por partes (200 por defecto) con `<código>.pdf` y `manifiesto.csv`.
6. **Firmar** con FirmaPerú o ReFirma (firma por lote). No editar los PDF ni quitar el código del
   nombre del archivo (la herramienta puede agregar `[R]` o `_firmado`). La firma debe ser
   **incremental** (la que hacen estas herramientas por defecto): si la herramienta reescribe el PDF,
   cada archivo sale `SIGNED_REWRITTEN` y solo quien gestiona puede aceptarlo uno por uno. Si la
   plantilla pide 2 firmas, el segundo firmante firma **sobre el PDF del primero** (ZIP «para firmar»
   de los `EN_FIRMA`): dos firmantes que firman a la vez el mismo generado no suman firmas (se conserva
   el primero que se sube).
7. **Subir los firmados** (PDF sueltos o el ZIP; el panel envía tandas de ≤10 MB) y revisar el
   reporte: `NO_COINCIDE` (se firmó una versión anterior o de otra persona: regenerar, descargar y
   firmar de nuevo; forzar uno solo con motivo y tras revisarlo a mano), `NO_ENCONTRADO` (el nombre
   perdió el código: subirlo desde el certificado), `SIN_FIRMA`, `INVALIDO`. Revisar en el detalle
   los **firmantes** (nombre y emisor del certificado de firma): las firmas se verifican, pero no
   contra la raíz de RENIEC, así que un firmante inesperado es una alerta.
8. **Respaldo de `uploads/certificados` después de cada carga de firmados**, junto con un `mysqldump`
   del mismo momento (la BD guarda los nombres y los hashes de los archivos; se restauran juntos):

   ```bash
   # sobre el volumen de /app/uploads (o desde un contenedor puntual que lo monte)
   tar -czf certificados_$(date +%F_%H%M).tgz -C <ruta del volumen uploads> certificados
   ```

9. **Entrega**: el participante ve y descarga sus firmados en su portal (Google o código por correo)
   y cualquiera verifica en `<url_panel>/verificar/<código>` (el QR).

Correcciones: editar un certificado lo devuelve a PENDIENTE (hay que regenerarlo y firmarlo de
nuevo; si ya se descargó para firmar, pide confirmación); un firmado equivocado se quita (vuelve a
PREPARADO; el archivo pasa a `firmados/reemplazados/`); reemplazar un firmado es de quien gestiona
los certificados; uno emitido por error se anula con motivo (sale del portal, la verificación lo
muestra ANULADO y se puede volver a emitir con otro código). Un PENDIENTE nunca generado se puede
borrar. Si se bajan las firmas requeridas de una plantilla, sus certificados `EN_FIRMA` que ya las
tienen pasan solos a `FIRMADO`.

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
| `JWT_SECRET` | Cambiar la variable y redeplegar; luego volver a guardar en el panel la API key de Brevo, los tokens DNI, la API key de API_UNDC, el secreto de la API de certificados de la UNDC (si se configuró) y el token de deportes-fi | Se cierran las sesiones, caducan los tokens de verificación y los códigos de acceso por correo vigentes, y los secretos guardados no se pueden leer hasta volver a guardarlos. Los tokens de acceso de las landings **siguen sirviendo** |
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
| `409 PROVIDER_NOT_CONFIRMED` al descargar certificados para firmar | El proveedor del código no está confirmado (o se cambió el proveedor o el prefijo, que lo desconfirma) | Certificados → Configuración → confirmar el proveedor LOCAL |
| `422 VERIFICATION_URL_NOT_CONFIGURED` al generar certificados | Falta la URL del panel en Sistema | Sistema → URL del panel (la definitiva: queda impresa en el QR) |
| `501 CERTIFICATE_PROVIDER_PENDING` | Se eligió el proveedor UNDC, cuya API aún no está disponible | Volver al proveedor LOCAL |
| `503 GENERATION_BUSY` o `503 PDF_BUSY` (vista previa) | Ya hay 2 tandas (o 2 vistas previas) en curso en el proceso | El panel reintenta tras `Retry-After`; no abrir varias generaciones a la vez |
| La generación devuelve `GENERATION_FAILED` en todos (log «No se pudo generar el certificado …») | La imagen no trae `dist/src/api/certificate/pdf/fuentes` o el diseño está dañado | Revisar el `COPY` de las fuentes en el `Dockerfile`; probar la vista previa de la plantilla |
| Muchos `NO_COINCIDE` (`SIGNED_MISMATCH`) al subir firmados | Se firmó una versión anterior (se editó o regeneró después de descargar) o un PDF de otra persona | Regenerar, descargar y firmar de nuevo; forzar solo uno a uno, con motivo, tras revisarlo |
| Todos salen `SIGNED_REWRITTEN` | La herramienta de firma reescribe el PDF en vez de firmar de forma incremental | Configurarla para firmar de forma incremental (o probar ReFirma/FirmaPerú); forzar solo uno a uno, con motivo |
| `SIGNED_MODIFIED` | El PDF cambió después de generarse (otro contenido, anotaciones o recuadros agregados sin firma, xref alterado) | No aceptarlo: pedir que se firme el PDF descargado sin editarlo; forzar solo tras revisarlo a mano |
| `INVALIDO` con `SIGNATURE_INVALID` o `PDF_ACTIVE_CONTENT` | Una firma no verifica (archivo dañado o alterado después de firmar) o el PDF trae JavaScript, adjuntos o multimedia | Volver a firmar el PDF descargado; estos no se pueden forzar |
| `409 SIGNATURES_NOT_EXTENDED` o `PARCIAL` «no continúa sus firmas» | Se subió una copia vieja del parcial o dos firmantes firmaron a la vez el mismo PDF | El segundo firmante debe firmar el PDF del primero (ZIP «para firmar») |
| `503 SIGNED_UPLOAD_BUSY` | Ya hay 2 cargas de firmados en curso y 4 en espera en el proceso | El panel reintenta tras `Retry-After` |
| `422 PDF_HAS_FORM_FIELDS` o `PDF_ACTIVE_CONTENT` al subir un diseño | El diseño trae campos de formulario o firmas, o JavaScript, adjuntos o multimedia | Exportarlo de nuevo como PDF plano, sin firmar |
| `NO_ENCONTRADO` al subir firmados | El nombre del archivo ya no tiene el código del certificado | Renombrarlo con el código o subirlo desde el certificado (uno a uno) |
| Todos quedan `PARCIAL` / `EN_FIRMA` | La plantilla pide más firmas (`firmasRequeridas`) de las que tiene el PDF; los sellos de tiempo no cuentan | Agregar la firma que falta y volver a subir, o corregir las firmas requeridas de la plantilla |
| `411 LENGTH_REQUIRED` o `413` al subir firmados | La subida no indica su tamaño (proxy con `Transfer-Encoding: chunked`) o pasa de 25 MB | Revisar que el BFF envíe `Content-Length`; subir en tandas más pequeñas |
| `409 CERTIFICATE_SETTINGS_LOCKED` al cambiar el prefijo | Ya hay certificados con PDF generado o firmado con el prefijo actual | El prefijo se mantiene (los códigos impresos ya circulan) |
| El manifiesto dice «El archivo no está en el servidor» o `404 CERTIFICATE_FILE_NOT_FOUND` | Falta el PDF en `uploads/certificados` (volumen perdido o restaurado a medias) | Restaurar el respaldo de `uploads/certificados` del mismo momento que la BD; si no estaba firmado, regenerarlo |
| `409 EVENT_HAS_INSCRIPTIONS` al borrar un evento con certificados, `409 INSCRIPTION_HAS_CERTIFICATE` al borrar una inscripción | Los certificados no se borran con el evento ni con la inscripción | Archivar el evento; anular el certificado antes de borrar la inscripción |
| `429 RATE_LIMITED` en `/verificar` | 30 verificaciones por minuto desde una IP, o (log «Tope global de verificaciones fallidas alcanzado») más de 1200 códigos inexistentes en un minuto en total: posible recorrido de códigos; los códigos reales siguen respondiendo | Esperar un minuto; revisar el log y el BFF del panel (que reenvíe la IP real) |

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
- 5xx de negocio (`PDF_BUSY`, `CODE_LOGIN_*`, `GENERATION_BUSY`, `CERTIFICATE_PROVIDER_PENDING`):
  `Servicio no disponible: <código>` (aviso); «Error interno» queda solo para errores inesperados.
- Certificados (spec 015): `Configuración de certificados actualizada por el administrador <id>:
  <campos>`, `Firmado forzado (FORZADO|METADATOS): certificado <id> por la cuenta <id>` y `Firmado
  reemplazado: certificado <id> por la cuenta <id>` (avisos), `Firmado quitado: certificado <id> por
  la cuenta <id>`, `Certificado <id> anulado por la cuenta <id>`, `Plantilla <id>: <n> certificado(s)
  en firma pasaron a FIRMADO al bajar las firmas requeridas`, `No se pudo generar el certificado <id>
  (evento <id>): <error>`, `No se pudo completar el ZIP de certificados del evento <id>: <causa>`,
  `No se pudo archivar el firmado anterior del certificado <id>: <causa>` y `Tope global de
  verificaciones fallidas alcanzado`. Nunca se registran documentos ni correos.
