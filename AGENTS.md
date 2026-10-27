# AGENTS.md — backend-ciisic

Guía para agentes de IA y desarrolladores que trabajen en este repositorio.

## Qué es

API del congreso CIISIC (UNDC), **multi-evento**: eventos, inscripciones, credenciales PDF y
correo, asistencia (escáner con el QR de la credencial), ponencias, consultas DNI, verificación de
estudiantes, integraciones, acceso con Google o con código por correo y portal del inscrito
(fotocheck virtual, asistencia y perfil con foto). Es el **centro del ecosistema del congreso**: la
consumen el panel y la landing, y ella consume API_UNDC, deportes-fi, Decolecta/apiperu, Brevo
y Google. Documentación: [`docs/`](docs/README.md).

## Entorno y comandos

- Node 22 + npm. En Windows se puede usar Git Bash o PowerShell (en PowerShell 5.1 encadena con `;`).
- `.env` local (ver [`.env.example`](.env.example)): solo `DATABASE_URL` y `JWT_SECRET`
  (+ `SHADOW_DATABASE_URL` y `PUPPETEER_EXECUTABLE_PATH` en desarrollo).
- Comandos:

  | Tarea | Comando |
  |---|---|
  | Instalar | `npm ci` |
  | Desarrollo (puerto de `.env`, local 3010) | `npm run dev` |
  | Lint · tipos · pruebas | `npm run lint` · `npx tsc --noEmit` · `npm test` |
  | Build · producción | `npm run build` · `npm start` |
  | Migraciones (dev / deploy) | `npx prisma migrate dev` · `npx prisma migrate deploy` |
  | Verificar que no hay drift | `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url <shadow> --exit-code` |
  | Catálogos (idempotente) | `npm run seed` (`-- --demo` agrega tipos de ejemplo) |
  | Primer Owner | `npm run bootstrap:admin:dev -- --correo tu@undc.edu.pe` |
  | Pregenerar las credenciales PDF de un evento (tras desplegar la 014) | `npm run credenciales:pregenerar:dev -- --evento <código>` |

- BD local: MySQL 8.4 en Docker (`ciisic-mysql`, puerto 3310). **Nunca** apuntes a producción
  desde desarrollo.

## Arquitectura

- `config/env.ts`: variables validadas (solo 2 obligatorias; la clave de los secretos se deriva
  de `JWT_SECRET`).
- `src/core/`: errores (`HttpError`), fechas de Lima, cifrado (`crypto.ts`), sesiones JWT con
  audiencia (`sesiones.ts`), configuración del sistema con caché (`configuracion-sistema.ts`),
  URLs salientes anti-SSRF (`url-saliente.ts`), reglas del correo institucional; roles y permisos
  del staff (`catalogos.ts`, `permisos.ts`), la cuenta leída de la BD (`actor.ts`) y los
  resolutores del evento de cada recurso (`resolutores-evento.ts`); códigos de acceso y de
  credencial (`codigos.ts`), semáforo de PDF (`concurrencia.ts`), tipo real y limpieza de
  imágenes (`imagenes.ts`) y rutas de archivos (`almacenamiento.ts`).
- `src/middlewares/`: `auth.ts` (`requirePermiso`, `requireActor`, `requireParticipante`,
  `requireSesion`), `sitio.ts` (`requireTokenEvento`), `rate-limit.ts` (por IP, token,
  participante o cuenta de staff), `legacy.ts`, `upload.ts`, `validate.ts`.
- `src/api/<módulo>/{controllers,routes,services}` + `validation.ts`; las rutas se autocargan
  (`src/loaders/routesLoader.ts`) con `buildRouter(AppRoute[])`.
- Prisma 6 (`prisma/schema.prisma`, modelos en español con `@@map`); migraciones en
  `prisma/migrations/` (las de datos, escritas a mano).
- Imagen Docker: `docker-entrypoint.sh` valida el entorno, aplica `prisma migrate deploy` e inicia.

## Convenciones de código

- TypeScript estricto, CommonJS, comillas simples, sin punto y coma, sin `any`.
- Nombres de dominio en español (`inscripcion`, `evento`); módulos y rutas HTTP en inglés
  (`/v1/events`), como el resto del proyecto.
- Validación con `validateBody(schema yup)` en la ruta (422 `VALIDATION_ERROR`); errores de
  negocio con `HttpError(status, code, mensaje)`; mensajes para usuarios en español.
- Respuestas nuevas `{ success, data, meta? }`.
- Pruebas con Jest + supertest; Prisma se simula por archivo (`jest.mock('../../src/database/prisma')`);
  proveedores externos con `fetch` o bibliotecas simuladas, nunca credenciales reales.

## Reglas de negocio clave (no romper)

- Todo dato pertenece a un **evento**; la API del sitio toma el evento **solo del token**.
- El servidor calcula precios, estados y montos; ignora `estadoId`, `pago`, `descuento` y rutas
  de archivo enviadas por el cliente. Precio UNDC en la categoría estudiantil solo con un token
  de verificación de estudiante válido y coincidente.
- Un tipo con `disponiblePara` `INSTITUCIONAL` o `EXTERNOS` solo se ofrece a quien recibe (o no) el
  precio institucional, decidido con el mismo `aplicaInstitucional` y el correo final de la
  inscripción (spec 016): `422 REGISTRATION_TYPE_NOT_AVAILABLE`. Las cortesías no lo aplican.
- Modalidad de asistencia (spec 018): cada tipo es `PRESENCIAL` (por defecto, todo lo existente) o
  `VIRTUAL`, y no cambia el precio: los tipos virtuales llevan `precio == precioInstitucional` y
  `disponiblePara = TODOS` (30 y 50), así el monto es el mismo con cualquier correo y **no** se usa
  `disponiblePara` para esto. Viven dentro de las categorías `ESTUDIANTES` y `PUBLICO_GENERAL`. La clave
  `modalidad` va siempre **dentro del objeto del tipo** (`tipo.modalidad`, `tipoInscripcion.modalidad`),
  nunca en la raíz de una inscripción: no es `modalidadPago` / `pago.modalidad` (`banco`, `billetera`,
  `cortesia`), ni el «fotocheck virtual» del portal. Ausente, `null` o desconocida = `PRESENCIAL`
  (`modalidadDe`, también el tipo `null` de una cortesía). Nada se bloquea por ser virtual: el escáner solo
  avisa. No se agrega a la forma LEGACY congelada. Se lee del tipo en tiempo real: cambiarla en un tipo con
  inscripciones es válido pero retroactivo (CSV, resumen, escáner, PDF y correo). Despliegue: backend
  primero (el anterior descarta la `modalidad` del panel en silencio) y los tipos virtuales al final.
- Tipos que no admiten estudiantes UNDC (spec 020): `tipo.excluyeEstudiantesUndc` (columna aparte, no un valor
  de `disponiblePara`; `false` por defecto) se enciende en los planes virtuales. Es estudiante UNDC quien tiene
  una verificación de SIVIRENO positiva **o** queda inscrito con `<8–12 dígitos>@<dominio del evento>`
  (`esCorreoDeEstudiante`, con el correo final como la spec 016); docentes, administrativos y externos no.
  `crearInscripcion` responde `422 REGISTRATION_TYPE_NOT_AVAILABLE` (`estudianteUndcExcluido`, dentro de la
  transacción; sitio y legacy, no cortesías) y solo frena inscripciones nuevas. Un estudiante con correo no
  institucional no se detecta. No cambia el precio. Despliegue: backend primero y el interruptor al final
  (panel o `prisma/preflight/excluir-estudiantes-undc-virtual.sql`).
- Aprobar genera la credencial y envía el correo; si el correo falla, la aprobación se mantiene.
- Google en la landing es **opcional** y no cambia precios; en el panel entra una cuenta de staff
  activa (cualquier dominio) o un participante inscrito (portal), este con Google **o con un código
  de 6 dígitos por correo** (spec 014).
- Código por correo: siempre abre una sesión de **participante** (12 h), nunca de staff; se envía
  también a cuentas vinculadas a Google; la respuesta de la solicitud es idéntica exista o no el
  correo. El staff pasa a su portal solo con `POST /v1/auth/participant/switch` (sesión de Google;
  con contraseña, el código); no hay camino del portal al panel.
- Una reinscripción con otro correo **nunca** cambia el correo registrado desde un formulario
  público, ni aunque el nuevo venga verificado con Google (eso prueba el correo, no que sea el dueño
  del documento: sería una toma de cuenta): se conserva, se avisa a ese correo, la respuesta lleva
  `correoConservado` y el precio por dominio sale del correo registrado. Solo el staff lo cambia
  (`PUT /v1/participants/:id`): se avisa al correo anterior y se registra con ids.
- Cada inscripción tiene `codigo_credencial` (10 caracteres `[0-9A-Z]`, único): es lo único que va
  en el QR del fotocheck y del PDF. Se crea con `conReintentoDeCodigo(nuevoCodigoCredencial)` y, si
  falta, `asegurarCodigoCredencial`. Va en el detalle y en el CSV (spec 040: columnas «Código QR» y
  «Credencial 3D», esta solo en las aprobadas; para todo el que exporta, también sin `pagos.ver`),
  **nunca** en listados, búsquedas ni en un dato que salga en ellos (el `numeroOperacion` de una
  cortesía es aleatorio e independiente). El CSV es, por eso, una credencial: con el código se rehace
  el QR. El QR anterior (id del participante) solo vale con `es_qr_legado` y hasta el `fechaFin` del evento.
- Staff (spec 013): Owner (`SUPERADMIN`) y Administrador del sistema (`ADMIN`) son globales;
  Tesorero y Comisión solo operan en sus eventos. Solo el Owner configura Sistema, elimina
  inscripciones, cambia su tipo, administra el enlace del aforo (`PERMISOS_SOLO_OWNER`) y gestiona Owners y Administradores. Sin `pagos.ver` no
  salen montos ni datos de pago (van en `null`).
- Una persona tiene una sola inscripción por evento (índice único evento-participante). Si está
  `RECHAZADO` o `CANCELADO` y vuelve a inscribirse, se **reutiliza la fila** (spec 017): vuelve a
  `PENDIENTE` con los datos nuevos, fecha de hoy y código de credencial nuevo, y se borran su voucher
  y su credencial anteriores; la actualización solo cambia la fila si sigue en uno de esos estados.
- Ponencias especializadas (spec 019; **no** son los papers `Ponencia`): `PonenciaEspecializada`,
  `AsistentePonencia` (persona por documento, correo y celular opcionales, independiente de
  `Participante`) e `InscripcionPonencia` (la asistencia vive en su fila). El cupo cuenta los `INSCRITO` y
  se valida en una transacción con `SELECT … FOR UPDATE` de la ponencia (`bloquearPonencias` +
  `exigirCupo`). La landing rechaza cruces de horario (`SCHEDULE_CONFLICT`), ponencias de pago y llenas, es
  idempotente y **nunca modifica** a una persona existente; el staff y la puerta sí pueden inscribir en
  ponencias que se cruzan (respetan el cupo). La asistencia en puerta inscribe en el acto (origen
  `PUERTA`), no bloquea fuera de horario (solo lo marca) y cancela por `CAMBIO_EN_PUERTA` las inscripciones
  cruzadas a las que la persona no asistió. Gratuitas por ahora: cobro en `specs/019-…/plan-futuro-cobro.md`.
- Ponencias especializadas solo para congresistas (spec 030): con `eventos.ponencias_acceso_libre` **apagado** (por defecto) solo
  se inscribe quien tiene una `Inscripcion` `APROBADO` del evento (mismo tipo y número de documento; en la landing además el
  correo registrado, sin distinguir mayúsculas). `resolverAcceso` (`services/congresista.ts`) es el único punto de decisión
  (landing, alta manual, puerta y reactivación; staff y puerta solo con el documento). El **modo** (`InscripcionPonencia.modoAsistencia`)
  sale de `tipoInscripcion.modalidad` (sin tipo = presencial) y **solo el presencial ocupa el `cupo`** (`exigirCupo(tx, ponencia, modo)`;
  `cuposDisponibles` y `llena` son del aforo presencial); `inscripcionCongresoId` NULL = «sin validar» (acceso libre o inscripción
  anterior). Con el interruptor encendido todo funciona solo con el documento. Con el correo en la petición, documento desconocido, otro
  evento y correo distinto dan el mismo `422 CONGRESS_REGISTRATION_NOT_FOUND`; el motivo específico (`CONGRESS_PAYMENT_PENDING`,
  `CONGRESS_REGISTRATION_REJECTED`) solo se dice a quien acertó o al staff. Repetir en la landing sella lo anterior sin validar;
  `npm run ponencias-especializadas:validar-existentes` (simula por defecto) empareja lo existente por documento. Nada se cancela solo.
- Resumen por persona de las ponencias (spec 031, `services/resumen.ts`, `avisos.ts`, `exportar-resumen.ts`): `GET …/specialized-talk-attendees` da **una fila por
  persona** (no por ponencia) con su situación **actual** frente al congreso (`APROBADO`, `PAGO_PENDIENTE`, `RECHAZADO`, `NO_INSCRITO`), calculada en cada consulta con el
  documento (también sin ceros a la izquierda: `variantesDocumento`); `puede` = acceso libre o `APROBADO`; `meta.resumen` son los totales de todo el evento, no de los
  filtros. `POST …/cancel` cancela (`SIN_CONGRESO`) todas las inscripciones vigentes **sin asistencia** de quien **hoy** no puede asistir (el servidor lo vuelve a comprobar:
  nunca cancela ni avisa a quien sí puede; con el acceso libre `409 FREE_ACCESS_ENABLED`) y, con `notificar`, envía el comunicado por correo con la credencial del evento;
  la cancelación se guarda primero y un correo que falla no la revierte. `POST …/notify` solo avisa. El mensaje se escapa (nada de HTML) y `{nombre}` es el primer nombre;
  `inscripciones_ponencia.aviso_enviado_en` marca a quien ya se avisó. `especializadas.ver` ve y descarga el Excel; `especializadas.inscribir` cancela y avisa; ambos con
  límite por cuenta. En el log solo ids, nunca correos ni mensajes. Pruebas con el envío simulado: nunca se manda un correo real.
- Temas con varios ponentes (spec 032): un tema que dictan varias personas a la misma hora y en el mismo ambiente es **una** `PonenciaEspecializada` (un cupo, un ambiente, un horario;
  nunca una fila por ponente). `ponente*` sigue siendo el principal y los demás van en la columna JSON `coponentes` (`[{ nombre, bio, foto, externo }]`, hasta `MAXIMO_COPONENTES` = 3, `NULL` =
  ninguno), que `coponentesDe` lee con tolerancia. La respuesta siempre trae `coponentes` (`[]` si no hay); al editar, ausente conserva, un arreglo reemplaza y `[]` quita. Aditivo: lo anterior solo ve al principal.
- Cambiar el tipo de una inscripción (spec 035, `inscription/services/cambio-tipo.ts`): `PATCH /v1/inscriptions/:id/type` es **solo del Owner** (`inscripciones.cambiar_tipo`: global y
  en `PERMISOS_SOLO_OWNER`, nunca elegible para la Comisión). Corrige la **clasificación**, no el pago: el monto no cambia y el `descuento` se recalcula contra el precio de lista
  del tipo nuevo (`descuentoSobreLista`; una cortesía, 0). No aplica `disponiblePara` ni `excluyeEstudiantesUndc` (frenan altas; esto es una corrección deliberada y admite tipos inactivos), pero exige
  un tipo del **mismo evento** y de una categoría que no sea de una delegación. Un integrante de una delegación (`delegacion_id`) no se mueve aquí (`409 INSCRIPTION_IN_DELEGATION`): su plan lo cambia
  y recalcula Delegaciones. Todo va en **una transacción** y condicionado al tipo leído (`409 INSCRIPTION_CHANGED`): el cambio, una fila de `cambios_tipo_inscripcion` (el **texto** de los dos tipos,
  motivo y autor; sale en `cambiosTipo` del **detalle**, no en listados ni en el CSV) y, si cambia la modalidad de asistencia, el `modo_asistencia` de sus ponencias especializadas pendientes (vigentes, sin
  asistencia y sin terminar; pasar a presencial exige cupo en cada una: `409 TALK_FULL_ON_TYPE_CHANGE`; las que ya asistieron conservan su modo). Se borran los PDF de credencial guardados (llevan el tipo) y **no se envía ningún correo**.
- Entrega del kit y asistencia solo presencial (spec 037, `src/core/kit.ts`, `src/api/kit`): **el kit es de la inscripción, no de la actividad** (`inscripciones.kit_entregado_en` y `kit_entregado_por_id`;
  `NULL` = pendiente y deshacer las limpia) y qué tipo lo lleva lo dice `tipos_inscripcion.incluye_kit` (no el texto de la etiqueta; la migración lo rellenó con `codigo LIKE '%\_con\_kit'`; los planes de delegación lo
  llevan solo en `CON_KIT`; un tipo virtual se guarda siempre sin kit; se clona con el evento). `tipoIncluyeKit` = `incluye_kit` **y** presencial. `PUT|DELETE /v1/inscriptions/:id/kit` entregan y deshacen con
  `asistencia.marcar` (sin permiso nuevo) y son atómicos (`updateMany` condicionado: `409 KIT_ALREADY_DELIVERED` con la hora, `KIT_NOT_DELIVERED`); entregar exige `APROBADO` y un tipo con kit (`409 KIT_NOT_INCLUDED`),
  deshacer no (se corrige aunque el tipo cambie). `GET …/kits/summary` (`asistencia.ver`) cuenta aprobados con kit, entregados y pendientes. **Los virtuales no marcan asistencia**: `registrarAsistencia` responde `403
  VIRTUAL_REGISTRATION` tras `NOT_APPROVED`, sin excepción (ni «fuera de horario» ni la marca manual; también las rutas legacy); las ponencias especializadas no cambian. La marca, el listado de la actividad y el
  detalle traen `tipoInscripcion.incluyeKit` y `kit`; `ATTENDANCE_ALREADY_REGISTERED` trae `data { participante, inscripcion }` (`HttpError.datos`) para poder entregar un kit pendiente al volver a escanear. El correo con el
  enlace de la transmisión a los virtuales se envía desde el panel (spec 043). Despliegue: backend primero (migración aditiva) y revisar con `prisma/preflight/verificar-kit.sql`.
- Delegaciones (specs 021–024 y 029): un grupo con delegado (`Delegacion`) cuyos integrantes tienen cada uno su inscripción
  (`delegacion_id`). **Cada delegación tiene sus propios planes** `CON_KIT`, `SIN_KIT` y `VIRTUAL`: tres tipos reales (`delegacion_con_kit`,
  `delegacion_sin_kit`, `delegacion_virtual`; `precio == precioInstitucional`) de su **categoría oculta** `DELEGACION_<id>`
  (`categorias_inscripcion.delegacion_id`), cada uno con su precio, su estado y, opcional, `precio_promocional` que cobra desde `min_integrantes`
  (cuentan todos los integrantes activos). No hay tarifa global ni categoría `DELEGACIONES`. **El servidor decide el tipo y el precio** (el cliente solo
  envía el `plan`): cada integrante lleva el tipo de su plan y cada alta, baja, cambio de plan o de precio recalcula el monto de **todos** los de ese plan
  (`recalcularGrupo`, transacción con `SELECT … FOR UPDATE` de la delegación); `RECHAZADO` y `CANCELADO` no cuentan. Con varios planes activos hay que elegir
  (`PLAN_REQUIRED`); un plan apagado rechaza altas nuevas pero conserva a sus integrantes. Esas categorías no salen en Categorías y tipos, la landing ni el
  clonado de eventos (`delegacionId: null`) y no se editan ahí (`409 DELEGATION_CATEGORY_MANAGED`). El pago son **vouchers** (`DelegacionPago`) **del grupo**: varios,
  cada uno con su número de operación (único por evento) y el monto que declara; se verifican o rechazan con `inscripciones.validar` y el resumen
  (`totalAPagar`, `declarado`, `saldo`) solo informa. **Dos links**: `codigoLink` (el delegado agrega integrantes y vouchers y ve el link individual) y
  `codigoInscripcion` (individual: cada integrante se inscribe solo con `/site/delegations/join/:codigo`; `NULL` = apagado; ambos se regeneran). `dominio_correo`
  (sin arroba) filtra los correos de los flujos **públicos** (`422 EMAIL_DOMAIN_NOT_ALLOWED`; vale el correo efectivo: el ya registrado si la persona existe): en el individual
  basta el prefijo (`correoPrefijo`) y **no hay Google**; el staff queda exento. **Solo el staff crea delegaciones** (no hay registro público ni `…/tarifa`). Permisos:
  `delegaciones.gestionar` (global: planes, precios, mínimo, dominio, links, borrar voucher), `delegaciones.ver` y `delegaciones.inscribir` (por evento: Tesorero ve; Comisión
  elegible inscribe) y `inscripciones.validar` (aprobar al grupo y vouchers; también borra un voucher **no verificado**: el verificado primero vuelve a `PENDIENTE`); una Comisión que crea una delegación la deja con los planes **apagados y a S/ 0** y si manda planes,
  mínimo, dominio o link responde `403`. Sin `pagos.ver` los importes, `pago` y los vouchers van en `null`/`[]`; los links solo los ve quien inscribe o gestiona.
  Despliegue: backend primero (su migración convierte las delegaciones existentes y borra `DELEGACIONES`); verificación en `prisma/preflight/verificar-delegaciones-planes.sql`.
- Seguimiento por asesor (spec 025, `src/api/advisory`): el padrón de estudiantes de la facultad (`padron_estudiantes`) y sus
  asesores (`asesores`, `asesores_secciones`) se cargan con el Excel de la facultad (`POST /v1/events/:eventId/advisory/import`, reemplaza todo;
  `?simular=true` solo valida) y **el pago no se guarda**: cada consulta lo cruza con las inscripciones por documento, luego código de
  estudiante y luego correo (`services/seguimiento.ts`, puro). **Pagó = inscripción `APROBADO`**; `PENDIENTE`/`EN_REVISION` son «en revisión»,
  `RECHAZADO`/`CANCELADO` «rechazado» y no cuentan; no pagaron = todo lo que no es `PAGADO`. Sin `pagos.ver` montos, fechas y recaudado van en
  `null`. Un filtro inválido es `422`, nunca se ignora. `exceljs` se carga solo al importar o descargar (`await import`); el PDF es `pdfkit`
  (sin Chromium). Permisos: `reportes.ver`/`reportes.exportar` por evento (Tesorero y Comisión elegible), `reportes.gestionar` global.
- Enlace público por docente (spec 026): `asesores.enlace_token` (256 bits, en claro a propósito para poder mostrarlo) abre `GET /v1/public/advisor`
  (+ `/export`) **sin sesión** con `X-Link-Token`: el token **nunca va en una URL** (ni en logs de `morgan`; en el navegador va tras el `#`). La vista pública
  da solo nombre, código, ciclo, sección, turno, celular y situación: **jamás** DNI, correo, montos, fechas de pago ni otros asesores (hay una prueba que lo
  comprueba). Token faltante, mal formado, desconocido o desactivado = el mismo `404 LINK_NOT_FOUND`. Ver, crear, renovar y desactivar enlaces es
  `reportes.gestionar` (global): es una credencial. Recargar el padrón conserva los enlaces por nombre del asesor. Respuestas `no-store` y `noindex`.
- Enlace público del aforo de las ponencias especializadas (spec 036, `specialized-talk/services/enlace-aforo.ts`): **uno por evento** en `enlaces_aforo_ponencias` (token de 256 bits en claro,
  como los de docentes y ciclos). Lo ven, crean, renuevan y desactivan **solo el Owner** (`especializadas.enlace_aforo`, global y en `PERMISOS_SOLO_OWNER`) con
  `GET|POST|DELETE …/specialized-talks/occupancy-link`. La landing lo abre con `GET /v1/site/specialized-talk-occupancy`: token del sitio **y** el del enlace en `X-Link-Token`
  (nunca en una URL); el enlace debe ser del mismo evento que el token del sitio. Da por ponencia publicada `cupo`, `inscritos` (**solo presenciales** vigentes), `cuposDisponibles`,
  `llena`, `asistentes` y `personas` (`aPonenciaAforo`): de cada inscrito vigente **solo** nombre, modo y `asistioEn`, por apellido; **nunca** documento, correo, celular, procedencia,
  biografías ni precios (hay una prueba que lo comprueba). Cualquier token inválido o de otro evento =
  el mismo `404 LINK_NOT_FOUND`. Respuestas `no-store` y `noindex`.
- Credencial 3D con enlace (spec 038, `inscription/services/credencial-publica.ts`): `GET /v1/site/credential/:codigo` (sitio) da lo que se imprime (nombres, clasificación o tipo, evento) y
  `tecnologias`, **solo** de una inscripción `APROBADO` del evento del token con ese `codigo_credencial` (`404 CREDENTIAL_NOT_FOUND` para inexistente, de otro evento o sin aprobar; `422 INVALID_CODE` sin
  consultar la BD); **nunca** documento, correo, celular ni montos, y `no-store`. `POST …/technologies` guarda hasta 8 ids (`^[a-z0-9][a-z0-9-]{0,29}$`, únicos, en orden) en `inscripciones.tecnologias_credencial`
  (JSON): el catálogo vive en la landing, el backend solo valida la forma. `configuracion_sistema.url_landing` (Sistema, solo el origen, **no** público) arma los enlaces (`core/enlaces-landing.ts`); el correo de
  aprobación **conserva el PDF** y agrega la fila «Ver mi credencial 3D» solo si hay landing y código.
- Envíos masivos a los presenciales (spec 039, `src/api/broadcast`): destinatarios = `APROBADO` con tipo presencial o sin tipo (`aprobadasPresenciales`, que el servidor vuelve a comprobar). Dos canales con su
  marca en `inscripciones`: `enlace_credencial_enviado_en` (cada persona recibe **su** enlace, `credential-links`) y `enlace_ponencias_enviado_en` (**un mismo mensaje** escapado con botón a
  `<landing>/inscripcion-ponencias`, `specialized-talk-invitations`). Un correo por persona; antes de enviar se **reserva** la marca con un `UPDATE` condicionado a lo leído y si el correo falla se
  devuelve; sin `reenviar` se omite a quien ya la tiene. Hasta 100 por petición (el panel envía de 25 en 25). Permisos existentes: `inscripciones.ver`/`credenciales.reenviar` y
  `especializadas.ver`/`especializadas.inscribir`. Sin `url_landing` o sin credencial de correo = `409`. En el log solo ids y totales, nunca correos ni mensajes.
- Acceso de los inscritos virtuales (spec 043, mismo módulo `src/api/broadcast`): tercer canal `virtual` con su marca `enlace_virtual_enviado_en`. Destinatarios = `APROBADO` con un tipo **virtual** (`aprobadasVirtuales`;
  una cortesía sin tipo es presencial y no entra; el servidor lo vuelve a comprobar). **Un mismo mensaje escapado y un mismo enlace** para todas, con el botón «Ingresar al congreso»
  (`htmlComunicado` con `accion`): el `enlace` lo escribe quien envía en cada petición (`https`, sin credenciales ni espacios, máx. 500: `esEnlaceDeAcceso`), no se guarda ni necesita `url_landing`. Rutas `…/virtual-access`
  (+ `/ids`, `/send`, `/test`) con los permisos existentes: ver = `inscripciones.ver`, enviar y probar = `credenciales.reenviar`. Reserva de la marca, reversión y tandas como la spec 039. El enlace da acceso a la
  transmisión: **no va al log** (solo ids y totales) ni a la BD.
- Correo con respaldo (spec 041, `src/api/email-credential`): una credencial es `BREVO` (API) o `GMAIL_SMTP` (`smtp.gmail.com:465`, SSL, **host fijo**; la contraseña de aplicación va cifrada en `api_key_cifrada`
  y el remitente es la cuenta de Gmail). La **predeterminada es siempre la primera** y las demás van por `prioridad` (`PUT /v1/email-credentials/order` con todos los ids). **Todo envío pasa por
  `enviarConCredencial`**, que prueba la credencial elegida y, si falla, las demás activas por prioridad (máx. 3) **con el remitente de la que envía**; una cuenta que falla por sí misma (sin créditos,
  límite diario, clave inválida: `CorreoFallido.deLaCuenta`) queda 15 min en espera en memoria. No envíes con `enviarConBrevo`/`enviarConGmail` directamente salvo en «Probar» y «Enviar prueba»
  (que no tienen respaldo). `credencialUtilizable` (código de acceso) devuelve la primera activa sin un fallo de hace menos de 15 min. El log de un respaldo lleva solo ids de credencial.
- Créditos y confirmación del envío (spec 042, `email-credential.ts`): cada credencial guarda los envíos que le quedan en Brevo (`creditos`, `creditos_verificados_en`; `creditosDisponibles`/`creditosVerificadosEn` en la API;
  `NULL` = no se sabe, y Gmail no los informa). Se revisan al **Probar**, con `POST /v1/email-credentials/check` y **antes de enviar** si la revisión tiene más de 5 min (`conCreditosAlDia`; preguntar a Brevo no gasta
  créditos); cada envío exitoso descuenta 1 (`descontarEnvio`). `enviarConCredencial` **salta las credenciales con 0 envíos vigentes** (`sinCreditos`) y, sin ninguna con envíos, no intenta nada; `credencialUtilizable`
  también. **Un envío solo se da por hecho si el proveedor lo confirma**: Brevo con `messageId`/`messageIds` (si no, `CorreoFallido`) y Gmail con el destinatario en `accepted` y `rejected` vacío; no confirmar
  prueba la siguiente credencial. Esto no sabe si el mensaje llegó al buzón (rebotes y spam).
- Reparto de los envíos masivos entre credenciales (spec 044, `email-credential.ts`, `recuento-envios.ts`, `broadcast/services/enviar.ts`): **el control es el conteo de créditos, no un error** (el plan gratuito de Brevo puede
  *aceptar* pasado el tope y dejar los correos en cola). Con 1 a 25 envíos guardados (`ZONA_DE_REVISION`) se pregunta a Brevo antes de **cada** envío; antes de cada envío masivo `prepararEnvioMasivo` revisa al día todas las que podrían
  enviar y responde `409 EMAIL_CREDITS_EXHAUSTED` **antes de reservar ninguna marca**. Un error de créditos (`CorreoFallido.sinCreditos`: 402, `not_enough_credits` o mensaje de créditos; no el 429) deja `creditos = 0`. Si todas las
  credenciales rechazan un correo solo queda con error la primera (una dirección mala no apaga el código de acceso); si otra lo envía, quedan con error las que fallaron antes. `conRecuento` (`AsyncLocalStorage`) anota los
  envíos por credencial sin cambiar la firma de `enviarConCredencial`; `recorrer` lo devuelve en `ResultadoEnvio.porCredencial` y **corta** con `agotado: true` si no queda ninguna con envíos. Las claves nuevas del resultado
  solo aparecen cuando aplican (las pruebas comparan con `toEqual`).
- Enlace público por ciclo (spec 027): igual que el del docente pero por ciclo completo, en su propia tabla `enlaces_ciclo` (el padrón se reemplaza en cada
  carga, así que el enlace no puede vivir en él; recargarlo no lo toca). `GET /v1/public/cycle` (+ `/export`) con `X-Link-Token`: nombre, código, ciclo, sección,
  turno y situación de los estudiantes y el asesor de cada sección, pero **sin celular** (llega a más gente que el docente), DNI, correo ni montos (prueba que lo
  comprueba). Un token de docente no abre un ciclo ni al revés; mismo `404 LINK_NOT_FOUND` único. Administrarlos es `reportes.gestionar`. Los reportes públicos
  usan `DatosReporte.publico: 'DOCENTE' | 'CICLO'` y `columnasOcultas` decide qué columnas no salen.
- Docentes y DNI (spec 028): `asesores.documento` (8 dígitos, único por evento, `NULL` = sin DNI; `normalizarDni`) se edita con `GET|POST …/advisory/advisors` y `PUT|DELETE …/advisors/:asesorId`
  (`reportes.gestionar`; el DNI **solo** sale ahí). La página común usa `POST /v1/public/advisor/lookup` (+ `/export`) con `{ documento }` en el **cuerpo** (nunca en la URL): misma vista que el enlace personal, **sin devolver
  el DNI**, mismo `404 ADVISOR_DOCUMENT_NOT_FOUND` ante cualquier DNI inválido y tope de intentos fallidos por IP (`limiteIntentosDni`, `soloFallos`). El DNI es adivinable: no lo registres en logs ni lo agregues a una URL. Recargar el padrón
  conserva los docentes (`asesores=conservar`, por defecto si ya hay); `reemplazar` los vuelve a leer del Excel conservando enlace y DNI por nombre.
- Secciones por curso (spec 033): `padron_secciones` guarda una fila por alumno y **sección** (ciclo + sección, con cuántos cursos lleva ahí); `padron_estudiantes.ciclo/turno/seccion` son solo la
  **principal**. `FilaSeguimiento.secciones` trae cada una con sus asesores y `asesores` es la unión. El alumno cuenta **una vez** en los totales y una vez en cada ciclo y sección en que cursa; ciclo, sección, turno y asesor de un
  filtro deben cumplirse en la misma sección. `filtrarAlcance` **proyecta** al alumno a lo que queda en el alcance: las vistas públicas (docente, DNI y ciclo) y sus descargas solo muestran etiquetas de su alcance, nunca otras
  secciones ni otros asesores. Los estudiantes son los del padrón (no los de SIVIRENO). La designación por grupos de la foto de la facultad (spec 033 original) quedó **retirada** por la spec 034.
- Cursos y docentes de SIVIRENO (spec 034, `services/cursos-jp.ts`, `padron_cursos`, `padron_matriculas`, `asesores.jp_docente_id`): un **curso** es una carga lectiva de la programación académica de SIVIRENO (asignatura +
  ciclo + sección + turno + docente) y sus alumnos son los matriculados; un alumno puede estar en varios y repetir. **El docente de cada curso es el asesor de sus matriculados**: `FilaSeguimiento.cursos` (con el docente de cada uno)
  manda; `secciones` y `asesores` salen de los cursos y quien no tiene curso queda **sin docente** (no se le asigna el de su sección). `filtrarAlcance` gana `cursoId` y, con cursos, filtra y **proyecta por curso** (ciclo, sección,
  turno, docente y curso deben cumplirse en el mismo curso); `resumir` agrega `porCurso`; `GET …/advisory/students|export?cursoId=` (`404 COURSE_NOT_FOUND` al descargar un curso inexistente). El Excel agrega la tabla «Por curso» y la
  hoja «Listado completo» (una fila por alumno y curso). Las vistas públicas traen `cursos` (los del docente, o los del ciclo con su docente: dato institucional) y **nunca** los cursos ni el docente de otro. Un docente con
  `jp_docente_id` solo cambia de nombre y DNI (sus secciones salen de sus cursos). Los datos se cargan con `npm run padron:desde-jp` (simula por defecto, `--aplicar`): lee SIVIRENO en JP **solo con `SELECT`** (`JP_DATABASE_URL`
  es de la consola, **no** del API: el API no se conecta a JP), toma los DNI de los docentes de un JSON **fuera del repo** (`--docentes`), enlaza a cada docente por su id de SIVIRENO, su DNI o su nombre (y crea los que faltan, sin tocar
  nombre, DNI ni enlace de los que existen) y conserva el DNI del padrón porque SIVIRENO no trae el de los alumnos. Cargar después el Excel **borra** los cursos. Ver `specs/034-padron-cursos-sivireno` y `docs/operacion.md`.
- Reglas del dominio institucional fijas en `src/core/correo-institucional.ts` (`undc.edu.pe`,
  parte local numérica = estudiante).
- Las rutas legacy existen para la landing anterior y se apagan desde el panel (Sistema).

## Seguridad

- El entorno solo lleva `DATABASE_URL` y `JWT_SECRET`. Toda otra configuración va a la BD
  (panel) o es constante: **no agregues variables de entorno nuevas**.
- Secretos en BD cifrados con `cifrar`/`descifrar` (AES-256-GCM, clave derivada de `JWT_SECRET`:
  rotarlo obliga a volver a guardarlos); la API devuelve solo el sufijo. Tokens entrantes (acceso
  del sitio) solo como hash SHA-256, que no depende de `JWT_SECRET`.
- Guardas obligatorias en toda ruta no pública; un token de un perfil nunca abre rutas de otro.
  Staff: `requirePermiso(permiso, { evento })` con un permiso de `src/core/permisos.ts` (los
  permisos por evento necesitan un resolutor de `resolutores-evento.ts`) o `requireActor`; la guarda
  va primera (tras `rutaLegacy`), antes de `upload` y `validateBody`. Los roles se nombran con
  `ROL.OWNER`/`ROL.ADMINISTRADOR`, nunca con los literales `'SUPERADMIN'`/`'ADMIN'` (el
  `tipo: 'ADMIN'` de las respuestas de sesión es otra cosa y se mantiene).
- Sesiones del staff: el JWT lleva la huella de las credenciales (`huellaCredenciales`: correo,
  contraseña y cuenta Google) y el inicio de la sesión. Cambiar esas credenciales cierra las sesiones
  abiertas; `POST /v1/auth/refresh` conserva el inicio y se corta a las 12 h.
- CORS abierto (`*`, sin cookies): la seguridad es el token. Toda ruta del sitio lleva límite por
  visitante **y** por token.
- URLs salientes configurables: `validarUrlSaliente` + `asegurarDestinoPublico`.
- Escapar texto de usuario en HTML (PDF, correos). No registrar secretos ni tokens, ni correos ni
  códigos de acceso (en la BD solo su HMAC, `codigos_acceso`).
- Fotos del participante: solo PNG o JPEG por la firma de bytes (`tipoDeImagen`), `limpiarMetadatos`
  (deja solo lo necesario para decodificar, valida la estructura y rechaza más de 4096 px por lado:
  `422 IMAGE_TOO_LARGE`), nombre generado (`nuevoNombreFoto`, escritura con `flag: 'wx'`) y lectura
  solo por `rutaFoto` (nunca un nombre que llegue del cliente); consentimiento obligatorio. El staff
  las lee con `GET /v1/inscriptions/:id/photo` (alcance por evento). Los archivos que otra petición
  puede borrar (fotos, PDF de credencial) se sirven con `leerArchivoServido`, no con `res.sendFile`.
- Los envíos de correo que no deben retrasar la respuesta van en diferido y con su `.catch`
  (`enDiferido` de `src/api/inscription/utils/sendEmail.ts`, que registra la causa y los ids, nunca
  el mensaje): no hay manejador global de promesas rechazadas y una sin manejar tumba el proceso.
  Puppeteer solo dentro de `limitarConcurrencia` (`503 PDF_BUSY` con `Retry-After`).
- Errores temporales: `HttpError(…, fields, reintentarEnSegundos)` y el `errorHandler` pone
  `Retry-After`; un 503 de negocio se registra con `console.warn` (código), no como error interno.
- Los envíos que provoca un anónimo (código de acceso) usan `enviarConCredencial(…, { registrar: false })`:
  su fallo no cambia el estado de la credencial (sería un oráculo de qué correos existen).
- Toda carpeta `templates` de `src` necesita su `COPY` en el `Dockerfile` (lo comprueba
  `tests/core/plantillas-docker.test.ts`).

## Ecosistema y comunicación entre sistemas

La fuente de verdad de los contratos es [`docs/arquitectura-ecosistema.md`](docs/arquitectura-ecosistema.md)
(contratos 1–5). Este repositorio **expone** la API de administración (panel), la API del sitio
`/api/v1/site/*` (landings y otras plataformas, con token de acceso del evento), el portal
`/api/v1/me/*` y `/api/v1/auth/*` (incluido el código por correo, `/api/v1/auth/participant/*`);
**consume** API_UNDC (`POST /externo/estudiantes/verificar`), deportes-fi
(`/api/v1/integrations/event/*`), Decolecta/apiperu, Brevo y Google.

| Sistema | Repositorio | Relación con este repo |
|---|---|---|
| Panel del congreso | `gians96/administrator-ciisic-frontend` | Consumidor (BFF con Bearer desde cookie httpOnly) |
| Landing del evento | `gians96/ciisic-undc-web` | Consumidor de `/api/v1/site/*` (token del evento, desde su servidor) |
| API UNDC | `API_UNDC` (+ UI `app-web-sigenet` para crear la API key) | Proveedor (verificación de estudiantes) |
| Deportes FI | `deportes-fi/backend` (+ `frontend` para crear el token por evento) | Proveedor (resumen Semana Sistémica) |

Puertos locales: landing 3000 · panel 3001 · backend-ciisic 3010 · API_UNDC 3020 · deportes-fi 3030.

**Protocolo de cambio de contrato**: 1) spec en el repo proveedor con `contracts/`; 2) actualizar
`docs/arquitectura-ecosistema.md`; 3) cambio compatible hacia atrás o alias temporal (como las
rutas legacy); 4) el consumidor se actualiza en su propio repo y rama; 5) prueba integrada local
con ambos sistemas levantados.

**Trabajo con agentes (varias sesiones en paralelo)**:
- Un agente por repositorio a la vez. Al empezar: `git status` y `git log --oneline -10`; si hay
  cambios sin comitear que no son tuyos, detente y coordina.
- No modifiques otros repositorios: documenta el contrato y pide el cambio a quien trabaje allí.
- Git: ramas `feat/*`; `git add <rutas explícitas>` (nunca `-A` ni `.`); commits convencionales en
  español; sin push, merge ni despliegues sin confirmación humana.
- Producción solo con permiso explícito y empezando por un respaldo de solo lectura (`mysqldump`).
- Al terminar, reporta commits, pruebas y pendientes.

## SDD con Spec Kit

Constitución: [`.specify/memory/constitution.md`](.specify/memory/constitution.md). Cada cambio
empieza en `specs/NNN-nombre/` (spec → plan → tasks → contracts) y se marcan las tasks al
implementar. Specs actuales: 001–014, 016–029 y 030–044 (ver [README](README.md)); la 015 (certificados) tiene
solo su diseño (`research.md`).

## Antes de dar por terminado

1. `npm run lint`, `npx tsc --noEmit` y `npm test` en verde.
2. Si cambiaste el esquema: migración nueva (a mano si toca datos) y `prisma migrate diff` vacío.
3. Contrato actualizado en `specs/*/contracts/` y, si afecta a otro sistema, en `docs/arquitectura-ecosistema.md`.
4. Si agregaste configuración: en la BD (panel) o como constante, no como variable de entorno.
5. Documentación de `docs/` al día (configuración, operación).
