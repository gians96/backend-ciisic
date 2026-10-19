# Feature Specification: Modalidad de asistencia virtual

**Feature Branch**: `feat/modalidad-virtual` · **Created**: 2026-10-19 · **Status**: Implementado en el
backend (el panel y la landing lo consumen desde sus repositorios; los datos de producción están
pendientes, ver T014)

**Input**: la organización del CIISIC pide una modalidad de asistencia **virtual** con estas tarifas,
iguales para la comunidad UNDC y para externos: **S/ 30 para estudiantes y S/ 50 para profesionales**.
Hoy todo el congreso es presencial (con kit o sin kit) y el sistema no distingue cómo asiste una
persona: solo hay texto libre en la etiqueta del tipo.

## Terminología (leer antes de tocar el código)

- **Modalidad de asistencia** (esta spec): `PRESENCIAL` | `VIRTUAL`. Es un atributo del **tipo** de
  inscripción. En la BD y en el JSON la clave es `modalidad`, **siempre dentro del objeto del tipo**
  (`tipo.modalidad`, `tipoInscripcion.modalidad`), nunca en la raíz de una inscripción. En el código
  se llama `ModalidadAsistencia`.
- **Modalidad de pago** (`modalidadPago`, `pago.modalidad`, columna «Modalidad» del CSV): `banco` |
  `billetera` | `cortesia`. Es otra cosa y no cambia.
- **Fotocheck virtual** (spec 014) es la credencial digital del portal; no tiene relación con la
  modalidad de asistencia.
- **Modalidad 01/02/03** de las tarjetas de `/planes` de la landing son categorías de precios.

## User Scenarios & Testing

### User Story 1 - Inscribirse a distancia pagando la tarifa virtual (Priority: P1)

**Acceptance Scenarios**:

1. **Given** el tipo `estudiantes_virtual` (S/ 30, `precioInstitucional` 30, `disponiblePara = TODOS`,
   `modalidad = VIRTUAL`) en la categoría `ESTUDIANTES`, **When** una persona con correo
   `@undc.edu.pe` se inscribe, **Then** el monto es 30, el descuento 0 y `tieneDescuento = false`.
2. **Given** el mismo tipo, **When** se inscribe una persona con otro correo, **Then** el monto es
   también 30 y no hay descuento: el precio no depende del dominio.
3. **Given** el tipo `general_virtual` (S/ 50, `precioInstitucional` 50) en `PUBLICO_GENERAL`,
   **When** se inscribe cualquier persona, **Then** paga 50 con descuento 0.
4. **Given** un tipo virtual de la categoría estudiantil y una persona **sin** token de verificación
   de estudiante, **When** se inscribe, **Then** paga 30 igualmente (la verificación solo daba el
   precio institucional, que aquí es el mismo) y el snapshot queda `SIN_VERIFICACION`.
5. **Given** la respuesta `201` de `POST /site/inscriptions`, **Then** `tipoInscripcion.modalidad`
   dice `VIRTUAL`; con un tipo anterior dice `PRESENCIAL`.

### User Story 2 - La landing distingue lo virtual (Priority: P1)

1. **Given** el tipo virtual activo, **When** la landing pide `GET /site/registration-types`,
   **Then** cada tipo trae `modalidad` y la landing puede separar presenciales de virtuales sin
   interpretar etiquetas ni nombres.
2. **Given** una landing anterior que ignora el campo, **Then** el tipo virtual aparece como un plan
   más (con su etiqueta «VIRTUAL») y la inscripción funciona igual.

### User Story 3 - El staff configura y filtra por modalidad (Priority: P1)

1. **Given** el panel, **When** crea o edita un tipo con `modalidad = VIRTUAL`, **Then** se guarda; sin
   enviarla, un tipo nuevo nace `PRESENCIAL` y al actualizar se conserva.
2. **Given** `GET /events/:eventId/inscriptions?modalidad=VIRTUAL`, **Then** solo salen las
   inscripciones cuyo tipo es virtual; combinado con `?categoria=ESTUDIANTES` se cumplen **las dos**
   condiciones. Lo mismo en `/inscriptions/export`.
3. **Given** el CSV, **Then** hay una columna **«Modalidad de asistencia»** (también sin `pagos.ver`:
   no es un dato de pago); la columna «Modalidad» existente sigue siendo la de pago.
4. **Given** `GET /events/:id/summary`, **Then** `porTipo[].modalidad` y
   `totales.porModalidad` separan presenciales y virtuales (`montoAprobado` en `null` sin `pagos.ver`).
5. **Given** crear un evento copiando otro, **Then** cada tipo copia su modalidad (sin esto, un tipo
   virtual volvería a presencial en silencio).

### User Story 4 - El inscrito virtual recibe su credencial y un aviso (Priority: P2)

1. **Given** una inscripción virtual aprobada, **Then** la credencial PDF lleva el rótulo
   «Modalidad: VIRTUAL» (las presenciales no lo llevan) y el correo de aprobación agrega un párrafo
   con las indicaciones por venir.
2. **Given** el portal, **Then** `GET /me/inscriptions` y el fotocheck traen
   `tipoInscripcion.modalidad` para que el portal avise «virtual».
3. **Given** el escáner de asistencia, **Then** la respuesta de `POST /activities/:id/attendances`
   trae `inscripcion.tipoInscripcion.modalidad` y el escáner solo **muestra un aviso**: la marca se
   registra igual.

### Edge Cases

- `modalidad` ausente, `null` o desconocida (de un backend o cliente anterior) = `PRESENCIAL`.
- Una cortesía sin tipo (`tipoInscripcion = null`) se trata como `PRESENCIAL`.
- Los tipos existentes quedan `PRESENCIAL` (valor por defecto de la columna): el comportamiento no cambia
  hasta que se cree un tipo virtual. Lo único visible desde el primer día es el campo nuevo
  `totales.porModalidad` del resumen, que trae siempre las dos filas (`VIRTUAL` en cero): el panel debe
  ocultar ese bloque mientras no haya actividad virtual para que un evento anterior se vea igual.
- Cambiar la modalidad de un tipo que ya tiene inscripciones es válido y **retroactivo**: se lee del tipo
  en tiempo real (a diferencia del precio, que se guarda en cada inscripción). Ver el contrato.
- `modalidad` con un valor distinto de `PRESENCIAL`/`VIRTUAL` (o `null`) al crear o actualizar un tipo:
  `422 VALIDATION_ERROR` con `fields.modalidad`.
- `?modalidad=` con un valor desconocido en el listado o el CSV: `422 VALIDATION_ERROR` con
  `fields.modalidad` (no se ignora en silencio: el CSV saldría sin filtrar).
- La forma LEGACY congelada (`GET /v1/registration-types`, `aLegacy`) **no** lleva `modalidad`; mientras
  las rutas legacy estén encendidas verá los tipos virtuales como planes normales.
- No se puede pasar una inscripción de un tipo a otro: cambiar de modalidad exige rechazar o cancelar y
  reinscribir (spec 017).
- Nada se bloquea por la modalidad: ni la aprobación, ni el fotocheck, ni la marca de asistencia.

## Requirements

- **FR-001**: `tipos_inscripcion.modalidad` `ENUM('PRESENCIAL','VIRTUAL') NOT NULL DEFAULT 'PRESENCIAL'`
  (migración aditiva `20261019120000_modalidad_virtual`); enum Prisma `ModalidadAsistencia`;
  `MODALIDADES_ASISTENCIA` y su tipo en `src/core/catalogos.ts`.
- **FR-002**: `modalidad` en `GET /site/registration-types` y en el listado del panel (también sin
  `pagos.ver`), y en las respuestas de crear y actualizar tipos.
- **FR-003**: `POST /registration-categories/:id/types` y `PUT /registration-types/:id` aceptan
  `modalidad` opcional (otro valor o `null` → `422 VALIDATION_ERROR`); sin ella, `PRESENCIAL` al crear
  y se conserva al actualizar.
- **FR-004**: `modalidad` en `tipoInscripcion` del listado, el detalle y la creación de inscripciones;
  filtro `?modalidad=` (se fusiona con `?categoria=` en una sola condición del tipo) en el listado y en
  el CSV; columna «Modalidad de asistencia» del CSV sin `pago:true`.
- **FR-005**: `porTipo[].modalidad` y `totales.porModalidad` en el resumen del evento; los montos
  respetan `pagos.ver`.
- **FR-006**: `tipoInscripcion.modalidad` en el portal (`/me/inscriptions`, fotocheck) y en la respuesta
  del escáner; el escáner no bloquea ninguna marca.
- **FR-007**: copiar un evento copia la modalidad de cada tipo.
- **FR-008**: la credencial PDF imprime «Modalidad: VIRTUAL» solo para tipos virtuales; la modalidad
  entra en la huella del archivo y sube `VERSION_PLANTILLA`. El correo de aprobación agrega un párrafo
  solo para virtuales, compuesto en el servidor y con el texto escapado.
- **FR-009**: el precio no cambia con la modalidad: los tipos virtuales llevan `precio ==
  precioInstitucional` y `disponiblePara = TODOS`. No se modifica `pricing.ts` ni el significado de
  `disponiblePara`.
- **FR-010**: los tipos virtuales viven **dentro** de las categorías existentes `ESTUDIANTES` y
  `PUBLICO_GENERAL` (no hay categoría nueva): se reutilizan el ciclo, la verificación SIVIRENO y la
  marca «validar» para el revisor.
- **FR-011**: todo es aditivo y tolerante: «backend nuevo + frontends viejos» y «frontends nuevos +
  backend viejo» funcionan sin errores. Con el backend viejo, eso sí, la modalidad que envía el panel se
  descarta en silencio (el tipo queda `PRESENCIAL`): el backend se despliega primero y los tipos virtuales
  se crean al final, con la landing nueva ya publicada. Sin variables de entorno nuevas.
- **FR-012**: textos neutros: no hay enlaces, ni promesas de horas o certificado.

## Preguntas de negocio abiertas

La organización aún no las responde; por eso los textos son neutros y nada se bloquea.

1. ¿Cómo se entrega el acceso a la transmisión (enlace, plataforma, correo aparte)?
2. ¿Los virtuales reciben certificado y se mide su asistencia? ¿Con qué regla (la spec 015 es solo
   diseño)?
3. ¿Se exige constancia de estudiante para el tipo virtual de la categoría estudiantil?

## Success Criteria

- **SC-001**: con los dos tipos virtuales creados, una persona con correo `@undc.edu.pe` y otra externa
  pagan lo mismo (30 o 50) y el descuento es 0.
- **SC-002**: el staff puede filtrar, exportar y resumir por modalidad sin interpretar texto libre.
- **SC-003**: las inscripciones y tipos anteriores no cambian de comportamiento (`PRESENCIAL`); los
  clientes que ignoran el campo siguen funcionando. Un evento sin tipos virtuales se ve igual que antes
  en el panel (el bloque «por modalidad» del resumen se oculta hasta que haya actividad virtual).
- **SC-004**: sin variables de entorno nuevas; la migración es aditiva y la imagen anterior sigue
  funcionando con el esquema nuevo.
