# Plan: Ponencias especializadas solo para congresistas con pago aprobado

1. **Esquema** (`prisma/schema.prisma`): `Evento.ponenciasAccesoLibre`; `InscripcionPonencia.inscripcionCongresoId` +
   `modoAsistencia` (enum `ModalidadAsistencia` existente) con índices `idx_inscripciones_ponencia_congreso` y
   `idx_inscripciones_ponencia_cupo`. `modoAsistencia` es NOT NULL con valor por defecto: así «no es virtual» incluye a las
   inscripciones anteriores sin trampas con NULL en Prisma.
2. **Regla pura** (`src/core/ponencias-especializadas.ts`): `resolverElegibilidad`, `correosCoinciden`.
3. **Servicio** `services/congresista.ts`: `validarCongresista` (participante + inscripción del evento + tipo), `resolverAcceso`
   (lee el interruptor), `selloDe`, `verificarCongresista`.
4. **Inscripciones** (`registrations.ts`): `exigirCupo` con modo, `sellarInscripcion`, `inscribirDesdeSitio`,
   `inscribirManual`, reactivación en `actualizarInscripcion`, filtros y `aInscripcion` con `validada`, `modoAsistencia`, `congreso`.
5. **Puerta** (`checkin.ts`): valida por documento, sella y respeta el aforo según el modo.
6. **Programa** (`talks.ts`): conteos presencial/virtual; `cuposDisponibles` y `llena` son del aforo presencial.
7. **Interruptor** (`services/acceso.ts`, rutas y controlador) y verificación previa de la landing.
8. **Script** `src/database/validarPonenciasExistentes.ts`.
9. **Pruebas**: `tests/specialized-talk/validacion-congreso.test.ts`; el resto de las pruebas de la spec 019 corren con el acceso
   libre encendido (su comportamiento no cambia); matriz de rutas.

**Despliegue**: backend primero (la migración se aplica sola y es aditiva; la landing actual sigue funcionando porque ya
envía el correo), luego `validar-existentes` en producción (simulación → respaldo `mysqldump` → `--aplicar`), después el
panel y la landing. Decidir si se enciende el acceso libre durante la transición (apagado por defecto).
