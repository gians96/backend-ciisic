# Feature Specification: Portal del participante, fotocheck virtual y asistencia por QR

**Feature Branch**: `feat/portal-fotocheck`
**Created**: 2026-10-01
**Status**: En implementación (backend listo; faltan el panel, la prueba integrada y el despliegue)
**Input**: "los participantes también podrían ingresar para ver su inscripción ... su certificado otorgado, perfil, su asistencia, su fotocheck virtual"

Decisiones: el inscrito entra al portal con Google **o con un código de 6 dígitos que llega a su
correo** (también si su cuenta está vinculada a Google); el código siempre abre una sesión de
participante (12 h), nunca de staff. El perfil permite editar el celular y subir una **foto
opcional** (con consentimiento) que sale en el fotocheck y en el escáner. El QR de la credencial
deja de ser el id del participante y pasa a un código aleatorio de 10 caracteres
(`codigo_credencial`); el QR anterior se acepta con aviso hasta el fin del evento. Una
reinscripción con otro correo **no** cambia el correo registrado sin verificarlo con Google. Los
certificados del portal son de la spec 015. El VIII CIISIC es del 26 al 30-oct-2026: todo es
aditivo y el panel y la landing actuales siguen funcionando. Diseño y revisión adversarial:
[research.md](research.md) (su cabecera de reconciliación manda sobre el cuerpo).

## User Scenarios & Testing

### User Story 1 - Entrar al portal con un código por correo (Priority: P1)

**Acceptance Scenarios**:

1. **Given** que me inscribí con `ana@gmail.com`, **When** pido un código, **Then** recibo en
   ese correo un código de 6 dígitos que vence en 10 min, y con él entro a mi portal por 12 h.
2. La respuesta es la misma (`202`) exista o no el correo y tenga o no Google: nadie descubre si
   un correo está inscrito.
3. Si pido dos códigos seguidos, cualquiera de los 2 últimos sirve. Pedir otro antes de 60 s, más
   de 5 por hora o más de 10 por día → `429 CODE_COOLDOWN` con el tiempo de espera.
4. Un código equivocado → `401 INVALID_CODE` con los intentos que quedan (5 por código); 10
   fallos en una hora con el mismo correo → `429 CODE_LOCKED`; muchos fallos en todo el sistema
   pausan el acceso por código 1 h (`503 CODE_LOGIN_PAUSED`). Google sigue disponible.
5. Sin una credencial de correo utilizable el panel no ofrece el código
   (`accesoCodigo.disponible: false`) y pedirlo responde `503 CODE_LOGIN_UNAVAILABLE`.

### User Story 2 - Mi fotocheck virtual (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una inscripción aprobada, **When** abro mi fotocheck, **Then** veo el QR con mi
   código de credencial, el código en texto, el evento, mi nombre, mi documento enmascarado
   (`****1234`), el tipo de inscripción y mi foto si la subí.
2. Una inscripción no aprobada → `409 NOT_APPROVED`; una ajena o inexistente → `404`.
3. El PDF de la credencial lleva el mismo QR, el código impreso y la foto.

### User Story 3 - La Comisión marca asistencia con el QR del fotocheck (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una cuenta con `asistencia.marcar` en el VIII, **When** escanea el QR del fotocheck
   (o del PDF), **Then** la asistencia queda con método `QR` y la respuesta trae nombre, documento,
   tipo de inscripción y si tiene foto (`GET /v1/inscriptions/:id/photo`).
2. Un código de otro evento → `409 CODE_OTHER_EVENT` (sin datos de la persona); inexistente →
   `404 CODE_NOT_FOUND`.
3. Se puede marcar desde 30 min antes de `horaInicio` hasta `horaFin`; fuera de eso
   `409 OUTSIDE_WINDOW`, salvo con `asistencia.fuera_horario`.
4. Con `asistencia.fuera_horario` se puede registrar como `MANUAL` (persona identificada por el
   operador); sin él → `403 MANUAL_NOT_ALLOWED`.

### User Story 4 - El QR anterior sigue sirviendo hasta el fin del evento (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una credencial enviada antes de esta spec (QR = id del participante), **When** se
   escanea, **Then** se registra como `QR_LEGADO` con `alerta: 'QR_LEGADO'` (el escáner pide
   verificar el DNI y la foto).
2. Después de `fechaFin` del evento, o si la inscripción ya tiene código propio y no estaba
   marcada como QR anterior → `422 LEGACY_QR_NOT_ALLOWED`.

### User Story 5 - Mi perfil y mi foto (Priority: P2)

**Acceptance Scenarios**:

1. Puedo cambiar mi celular; nombres, documento y correo no se editan desde el portal.
2. Subo una foto JPG o PNG de hasta 2 MB aceptando su uso en el fotocheck; el servidor revisa el
   tipo real, quita los metadatos (EXIF, GPS) y borra la foto anterior. Sin consentimiento →
   `422 CONSENT_REQUIRED`; un archivo que no es imagen → `422 INVALID_FILE_CONTENT`; más de 2 MB →
   `413`.
3. Puedo ver y quitar mi foto.

### User Story 6 - Mi asistencia (Priority: P2)

**Acceptance Scenarios**:

1. Veo, por cada evento en el que estoy aprobado, todas sus actividades y en cuáles asistí (las
   marcas anuladas no cuentan).

### User Story 7 - El staff pasa a su portal (Priority: P2)

**Acceptance Scenarios**:

1. **Given** una cuenta de staff que entró con Google y está inscrita con el mismo correo, **When**
   elige "Mi portal de participante", **Then** entra al portal sin otro paso.
2. Si entró con contraseña → `409 CODE_REQUIRED` (pide el código a su correo); sin inscripción →
   `404 PARTICIPANT_NOT_FOUND`; inscripción vinculada a otra cuenta Google →
   `403 GOOGLE_ACCOUNT_MISMATCH`. Nada lleva del portal al panel.

### User Story 8 - Nadie se apropia de un registro al reinscribirse (Priority: P1)

**Acceptance Scenarios**:

1. **Given** un documento registrado con `ana@gmail.com`, **When** alguien se inscribe a otro
   evento con ese documento y `otro@gmail.com`, **Then** la inscripción se hace con `ana@gmail.com`,
   la respuesta trae `correoConservado: true` y `correoEnmascarado: "a***@g***.com"` (celular
   oculto), y se avisa a `ana@gmail.com`. No hay 409.
2. Lo mismo aunque `otro@gmail.com` venga verificado con Google para ese evento (revisión de
   seguridad: verificar prueba el correo nuevo, no que sea el dueño del documento; antes eso
   permitía tomar la cuenta de cualquiera con solo su DNI). Tampoco se toca su vínculo con Google.
   El precio por dominio institucional sale del correo registrado.
3. Si el staff cambia el correo de un participante (`PUT /v1/participants/:id`), se avisa al
   correo anterior y queda en el log quién lo cambió (solo ids).

### User Story 9 - Alta de participantes y cortesías (Priority: P2)

**Acceptance Scenarios**:

1. Con `participantes.gestionar` registro a una persona sin inscripción (ponente, organizador o
   quien se inscribe en persona) con documento y correo; con DNI, los nombres salen de RENIEC.
2. Con `inscripciones.cortesia` le creo una inscripción aprobada sin pago, opcionalmente con su
   credencial enviada.

## Requirements

- **FR-001**: Código de acceso por correo (`src/api/participant-auth`): 6 dígitos de un
  generador criptográfico; en la BD solo `HMAC-SHA256(correo:código)` con una clave derivada de
  `JWT_SECRET` (`codigos_acceso`). Vida 10 min, 5 intentos por código (reservados antes de
  comparar), 2 códigos vigentes, espera de 60 s, 5 por hora y 10 por día por correo, 200 por hora
  por IP (en la BD), presupuesto global de 400 envíos por hora y 2000 por día (en la BD), bloqueo
  de 1 h tras 10 fallos por correo, 50 fallos por hora por IP y disyuntor global de 150 fallos por
  hora contra participantes existentes (pausa de 1 h; ambos en memoria). El correo se envía en
  diferido, solo si existe el participante, también si está vinculado a Google, con la credencial
  de correo predeterminada activa (`credencialUtilizable`: no la usa durante 15 min tras un error de
  un envío de aprobación o una prueba; los fallos del envío del código no cuentan). Los registros no
  llevan correo ni código. Los códigos de más de 7 días se borran.
- **FR-002**: La sesión del participante dura 12 h (Google y código) y lleva
  `metodo: 'GOOGLE' | 'CODIGO'`; no se renueva. La del staff sigue en 1 h con renovación.
- **FR-003**: `POST /v1/auth/participant/switch` (`requireActor`): sesión de staff con método
  `GOOGLE` y participante con el mismo correo → sesión de participante (`metodo: 'GOOGLE'`),
  vinculando su cuenta Google si el participante no tenía. Un solo sentido.
- **FR-004**: `GET /v1/auth/config` agrega `accesoCodigo: { disponible }`; `GET /v1/site/config`
  (landing) no cambia.
- **FR-005**: Cada inscripción tiene `codigo_credencial` (10 caracteres `[0-9A-Z]`, único): se
  asigna al crear (con hasta 3 intentos ante una colisión) y, si falta (filas de la imagen
  anterior; la migración solo lo da a las aprobadas o con credencial enviada), al aprobar o leerla
  (`asegurarCodigoCredencial`). `es_qr_legado` marca a quien pudo recibir la credencial con el QR
  anterior. El código va en el detalle de la inscripción, nunca en listados, búsquedas ni el CSV.
- **FR-006**: Credencial PDF con el QR del código, el código impreso y la foto; el archivo se
  nombra con una huella de sus datos (`<id>-<huella>.pdf`) y se regenera solo cuando cambian.
  Puppeteer corre con un semáforo de 2 y una cola de 30 (cada paso con un tope de 30 s): si se
  llena, `503 PDF_BUSY` con `Retry-After` en las descargas y `credencialEnviada: false` al aprobar o
  reenviar (la aprobación se mantiene). `credenciales:pregenerar` las genera de una en una.
- **FR-007**: Portal (`/v1/me/*`, `requireParticipante`, `Cache-Control: private, no-store`):
  perfil ampliado (celular, foto, Google), `PATCH /v1/me/profile` (solo celular), fotocheck
  (`/badge`), asistencia por evento, `fotocheck.disponible` en las inscripciones y foto
  (`PUT|GET|DELETE /v1/me/photo`).
- **FR-008**: Foto: JPG o PNG de hasta 2 MB y 4096 px por lado (`422 IMAGE_TOO_LARGE`), tipo real
  por la firma de bytes y estructura validada, solo con lo necesario para decodificarla (JPEG sin
  ningún APPn, COM ni marcadores desconocidos; PNG con CRC válido y solo chunks críticos y de
  color), consentimiento
  obligatorio (Ley 29733), nombre generado por el servidor (`foto-<uuid>.png|jpg` en
  `uploads/fotos`), 10 cambios por hora. Cambiarla o quitarla borra la anterior y los PDF guardados
  del participante. El escáner la lee con `GET /v1/inscriptions/:id/photo`
  (`asistencia.marcar` o `inscripciones.ver`, alcance por evento).
- **FR-009**: `POST /v1/activities/:id/attendances` acepta exactamente uno de `codigo` (método
  `QR`), `numeroDocumento` (+`tipoDocumento`, método `DOCUMENTO`) o `participanteId` (QR anterior,
  método `QR_LEGADO`, solo con `es_qr_legado` o sin código, y hasta `fechaFin`). `metodo: 'MANUAL'`
  exige `asistencia.fuera_horario` y salta la regla del QR anterior. Ventana: de 30 min antes de
  `horaInicio` a `horaFin`. La respuesta agrega `alerta`, `participante.foto` e `inscripcion`. Las
  rutas legacy aplican la misma regla del QR anterior.
- **FR-010**: Reinscripción (`POST /v1/site/inscriptions` y legacy `POST /v1/inscription`): un
  correo distinto del registrado **nunca** lo reemplaza, ni verificado con Google. Se usa el
  participante tal cual (correo, celular y Google), el precio por dominio sale del correo
  registrado, la respuesta agrega `correoConservado` y `correoEnmascarado` (correo enmascarado y
  celular oculto) y se avisa al correo registrado. Un número de operación con el prefijo
  `CORTESIA-` se rechaza en los formularios.
- **FR-011**: `PUT /v1/participants/:id` que cambia el correo avisa al correo anterior (con el
  nuevo enmascarado) y registra `[participantes] La cuenta <actorId> cambió el correo del
  participante <id>`; dos ediciones simultáneas al mismo correo → `409 EMAIL_IN_USE`.
- **FR-012**: `POST /v1/participants` (`participantes.gestionar`): documento y correo únicos
  (`409 PARTICIPANT_EXISTS` con el id, `409 EMAIL_IN_USE`); con DNI los nombres salen de la consulta
  DNI del panel y, si falla, se exigen (`422 NAMES_REQUIRED`).
- **FR-013**: `POST /v1/events/:eventId/courtesy-inscriptions` (`inscripciones.cortesia`):
  inscripción `APROBADO`, monto 0, modalidad `cortesia`, número de operación
  `CORTESIA-<12 hex aleatorios>` (independiente del código del QR), revisada por quien la crea;
  tipo del mismo evento (también inactivo); credencial opcional.
- **FR-014**: Límites nuevos: Google 120 por IP cada 15 min (antes compartía el de contraseña de
  10), solicitud de código 60 y verificación 120 por IP cada 15 min, foto 10 por hora por
  participante, cambio al portal 20 cada 15 min por cuenta.
- **FR-015**: Migración aditiva `20261001120000_portal_fotocheck` (la auditoría de asistencias
  ya está en la spec 013) con verificación, completado, reversión y marcado del QR anterior tras
  una vuelta atrás (`prisma/preflight/*-014.sql`).

## Success Criteria

- **SC-001**: Sin variables de entorno nuevas; la clave del HMAC se deriva de `JWT_SECRET`.
- **SC-002**: Ni la BD ni los registros guardan un código de acceso en claro; los avisos y fallos
  de envío no registran correos ni códigos.
- **SC-003**: El panel de la spec 013 y la landing actual siguen funcionando con el backend nuevo
  (todo lo nuevo son claves agregadas); el QR anterior marca asistencia hasta el fin del evento.
- **SC-004**: Toda ruta nueva tiene su prueba de acceso denegado (401 sin token y 403 con el
  perfil equivocado).
- **SC-005**: Ensayo de la migración con el respaldo: las 307 inscripciones aprobadas o con
  credencial enviada con código distinto, de formato válido y marcadas como QR anterior (la
  pendiente, sin código hasta aprobarse), 585 asistencias sin cambios y `prisma migrate diff`
  vacío.

## Limitaciones

- **El panel 009 se despliega antes (o a la vez) que el backend 014**: las credenciales que este
  emite llevan el QR nuevo, que el escáner del panel anterior no entiende (solo lee el id del QR
  anterior). Tras una vuelta atrás a la imagen anterior: `marcar-qr-legado-014.sql`.
- El QR anterior es un id secuencial: hasta `fechaFin` se puede falsificar. Se mitiga con la
  alerta ámbar, el DNI completo y la foto en el escáner, y caduca solo.
- `codigo_credencial` admite NULL para convivir con la imagen anterior; `NOT NULL` va en una
  migración posterior al 31-oct-2026, junto con retirar `participanteId` y `regenerate-code`.
- El disyuntor, el tope de fallos por IP y la ráfaga por correo viven en la memoria del proceso
  (una réplica).
- Quien conoce el correo de alguien puede pedirle códigos y gastar sus intentos (bloqueo de ese
  correo hasta 1 h, renovable); la persona sigue pudiendo entrar con Google.
- El código por correo también sirve para cuentas vinculadas a Google (decisión de diseño): si la
  universidad reasigna un buzón institucional, el nuevo titular entra al portal del anterior.
- El formulario de inscripción responde `409 EMAIL_IN_USE` a una persona nueva con un correo ya
  registrado (comportamiento de la spec 002 del que depende la landing): revela que ese correo
  existe, aunque `POST /v1/auth/participant/code` responda igual.
- `fields.restantes` y `fields.reintentarEnSegundos` van como texto (`HttpError.fields`); el
  tiempo de espera también va en `Retry-After`.
- Quitar los metadatos también quita la orientación EXIF: el panel recodifica la foto con canvas.
- `participante.foto.tiene` en la respuesta de asistencia no comprueba que el archivo exista.
- `GET /v1/auth/config` se cachea 60 s: `accesoCodigo.disponible` puede tardar hasta 1 min en
  reflejar un cambio.
- Certificados en el portal: spec 015.
