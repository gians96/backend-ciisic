# Feature Specification: Disponibilidad de los tipos de inscripción

**Feature Branch**: `feat/disponibilidad-tipos` · **Created**: 2026-10-02 · **Status**: Implementado

**Input**: precios del VIII CIISIC: estudiantes UNDC sin kit 40 / con kit 100; estudiantes y público
general externos 80 / 140; **profesionales y docentes UNDC solo con kit a 120**. En `/general`, un
correo `@undc.edu.pe` veía los dos planes aunque el «Precio UNDC» del plan sin kit se dejara vacío o en
0: el panel enviaba 0, la API no ocultaba ningún tipo y 0 se cobraba como precio (inscripción gratis).

## User Scenarios & Testing

### User Story 1 - Un tipo que no se ofrece a la comunidad UNDC (Priority: P1)

**Acceptance Scenarios**:

1. **Given** «Profesionales y público general sin kit» con `disponiblePara = EXTERNOS`, **When** una
   persona escribe un correo `@undc.edu.pe` en `/general`, **Then** solo ve el plan con kit, a su
   precio institucional (S/ 120).
2. **Given** el mismo tipo, **When** la persona usa otro correo, **Then** ve ambos planes a su precio
   regular (140 y 80).
3. **Given** alguien envía a mano ese tipo con un correo del dominio, **Then** `POST /inscriptions`
   responde `422 REGISTRATION_TYPE_NOT_AVAILABLE` y no se crea nada (ni el participante).
4. **Given** el documento ya está registrado con un correo del dominio (correo conservado), **When**
   se reinscribe con otro correo y elige el tipo para externos, **Then** también `422`: decide el correo
   con que queda la inscripción, igual que el precio.

### User Story 2 - Un tipo solo para la comunidad UNDC (Priority: P2)

1. **Given** un tipo `INSTITUCIONAL`, **Then** solo lo ve y lo puede tomar quien recibe el precio
   institucional; a los demás se les oculta y la API responde `422` si lo envían.
2. En la categoría estudiantil decide la verificación de estudiante (SIVIRENO), no el dominio.

### Edge Cases

- Tipos existentes y tipos nuevos sin el campo: `TODOS` (comportamiento anterior).
- Cortesías (staff): no aplican la regla; el staff elige cualquier tipo del evento.
- Copiar un evento copia la disponibilidad de cada tipo.

## Requirements

- **FR-001**: `tipos_inscripcion.disponible_para` `ENUM('TODOS','INSTITUCIONAL','EXTERNOS')` `NOT NULL
  DEFAULT 'TODOS'` (migración aditiva `20261002120000_disponibilidad_tipos`).
- **FR-002**: «Institucional» es el `aplicaInstitucional` de `calcularPrecio`: estudiante verificado en
  la categoría estudiantil; correo del dominio del evento en las demás y en la ruta legacy.
  `tipoDisponible(disponiblePara, aplicaInstitucional)` decide; así un tipo nunca queda disponible con
  un precio que no le corresponde.
- **FR-003**: `crearInscripcion` (sitio y legacy) valida dentro de la transacción, después de calcular el
  precio con el correo final: `422 REGISTRATION_TYPE_NOT_AVAILABLE` con un mensaje en español que dice
  a quién se ofrece el tipo.
- **FR-004**: `disponiblePara` en `GET /site/registration-types` (landing), en el listado del panel
  (también sin `pagos.ver`) y en las respuestas de crear y actualizar tipos.
- **FR-005**: `POST /registration-categories/:id/types` y `PUT /registration-types/:id` aceptan
  `disponiblePara` opcional (otro valor → `422 VALIDATION_ERROR`); al crear sin él, `TODOS`; al
  actualizar sin él, se conserva.

## Limitación conocida

La regla depende del correo, como el precio de la categoría general (spec 002): un docente que se
inscribe con un correo que no es del dominio es «externo» para el sistema y puede tomar el plan para
externos (pagando el precio regular). La organización lo revisa con el filtro de correo institucional.

## Success Criteria

- **SC-001**: Con `general_sin_kit = EXTERNOS`, ningún correo del dominio puede inscribirse en él ni
  verlo en la landing; los externos no notan cambios.
- **SC-002**: Sin variables de entorno nuevas; la migración es aditiva y la imagen anterior sigue
  funcionando con el esquema nuevo.
