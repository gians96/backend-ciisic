# Feature Specification: Tipos de inscripción que no admiten estudiantes UNDC

**Feature Branch**: `feat/virtual-sin-estudiantes-undc` · **Created**: 2026-10-20 · **Status**: Implementado en el
backend (el panel y la landing lo consumen desde sus repositorios; encender el interruptor en producción
es un paso aparte, ver T010)

**Input**: la organización pide que los **estudiantes de la UNDC no puedan inscribirse en la modalidad
virtual** (asisten de forma presencial) y que exista una forma de gestionarlo. Docentes, administrativos y
externos sí pueden ser virtuales (decisión del usuario: solo estudiantes, no toda la comunidad UNDC).

## Por qué `disponiblePara` (spec 016) no alcanza

- En la categoría estudiantil, «Solo externos» oculta el tipo únicamente a quien pasó la verificación de
  SIVIRENO: un estudiante UNDC puede tomar `general_virtual` (S/ 50) con su correo institucional.
- En `PUBLICO_GENERAL`, «Solo externos» se decide por el dominio del correo: bloquearía también a docentes y
  administrativos `@undc.edu.pe`, que sí deben poder ser virtuales.
- Hace falta una regla propia, por tipo, que se enciende y se apaga sin tocar el precio ni `disponiblePara`.

## Terminología

- **Estudiante UNDC** (esta spec): quien tiene una verificación de SIVIRENO positiva (token de la spec 004)
  **o** queda inscrito con un correo `<código>@<dominioInstitucional del evento>`, donde el código son 8 a 12
  dígitos (la regla fija «parte local numérica = estudiante» de `src/core/correo-institucional.ts`).
  Docentes y administrativos (`garias@undc.edu.pe`) y externos **no** lo son.
- No es «comunidad UNDC» de la spec 016 (`INSTITUCIONAL`/`EXTERNOS`), que incluye a todo el dominio.

## User Scenarios & Testing

### User Story 1 - Un plan virtual que no se ofrece a estudiantes UNDC (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `estudiantes_virtual` con `excluyeEstudiantesUndc = true`, **When** un estudiante verificado
   con SIVIRENO se inscribe, **Then** `422 REGISTRATION_TYPE_NOT_AVAILABLE` y no se crea nada.
2. **Given** `general_virtual` con el interruptor encendido, **When** alguien con el correo
   `2020123456@undc.edu.pe` se inscribe, **Then** el mismo `422` (aunque no se haya verificado).
3. **Given** el mismo tipo, **When** se inscribe un docente (`garias@undc.edu.pe`) o un externo,
   **Then** se inscribe y paga 50.
4. **Given** una persona ya registrada con un correo de estudiante, **When** se reinscribe escribiendo otro
   correo, **Then** también `422`: decide el correo con que queda la inscripción (como en la spec 016).
5. **Given** el interruptor apagado (o un tipo anterior sin la columna), **Then** el comportamiento es el de
   siempre.

### User Story 2 - La landing lo oculta (Priority: P1)

1. **Given** `GET /site/registration-types`, **Then** cada tipo trae `excluyeEstudiantesUndc`.
2. **Given** un visitante estudiante UNDC (verificado o con correo de estudiante), **When** ve los planes,
   **Then** la landing oculta los que lo excluyen y explica por qué; el backend igual los rechaza.

### User Story 3 - El staff lo gestiona (Priority: P1)

1. **Given** el panel, **When** el staff crea o edita un tipo con `excluyeEstudiantesUndc`, **Then** se
   guarda; sin enviarlo, un tipo nuevo nace en `false` y al actualizar se conserva.
2. **Given** crear un evento copiando otro, **Then** cada tipo copia el interruptor.
3. **Given** una cortesía (staff), **Then** no se aplica la regla: es la vía manual de excepción.

### Edge Cases

- Los tipos existentes quedan en `false`: nada cambia hasta que se encienda el interruptor.
- La regla solo frena inscripciones **nuevas** (incluida la reinscripción tras un rechazo o cancelación,
  spec 017). Quien ya está inscrito en un tipo que luego se marca no se toca: la organización decide si
  rechaza o cancela desde el panel (filtro `modalidad=VIRTUAL` + categoría `ESTUDIANTES`).
- **Limitación conocida** (igual a la de la spec 016): un estudiante que se inscribe con un correo no
  institucional no se puede detectar; el revisor lo ve en el panel y puede rechazar o cancelar.
- Un valor no booleano al crear o actualizar un tipo: `422 VALIDATION_ERROR` con
  `fields.excluyeEstudiantesUndc` (incluido `null`).
- La forma LEGACY congelada (`GET /v1/registration-types`) **no** lleva el campo; la regla sí se aplica en
  `POST /v1/inscription` (misma función `crearInscripcion`).

## Requirements

- **FR-001**: `tipos_inscripcion.excluye_estudiantes_undc BOOLEAN NOT NULL DEFAULT false` (migración aditiva
  `20261021120000_excluye_estudiantes_undc`); columna aparte y no un cuarto valor de `disponible_para`: una
  imagen anterior no la lee y un valor de enum desconocido le haría fallar la lectura del tipo.
- **FR-002**: `crearInscripcion` (sitio y legacy) rechaza con `422 REGISTRATION_TYPE_NOT_AVAILABLE` cuando el
  tipo excluye y la persona es estudiante UNDC (`estudianteUndcExcluido`), dentro de la transacción y con el
  correo final. Las cortesías no lo aplican.
- **FR-003**: `excluyeEstudiantesUndc` en `GET /site/registration-types`, en el listado del panel (también sin
  `pagos.ver`: no es un precio) y en las respuestas de crear y actualizar tipos.
- **FR-004**: `POST /registration-categories/:id/types` y `PUT /registration-types/:id` aceptan
  `excluyeEstudiantesUndc` opcional (booleano).
- **FR-005**: copiar un evento copia el interruptor; `seed.ts --demo` lo enciende en los dos tipos virtuales.
- **FR-006**: sin variables de entorno nuevas; no cambia `pricing.ts` (el precio) ni `tipoDisponible`.

## Success Criteria

- **SC-001**: con el interruptor encendido en `estudiantes_virtual` y `general_virtual`, ningún estudiante
  UNDC (verificado o con correo de estudiante) puede inscribirse en ellos; docentes y externos sí.
- **SC-002**: el staff enciende o apaga la regla desde el panel, por tipo, sin tocar precios.
- **SC-003**: los tipos e inscripciones anteriores no cambian de comportamiento; las imágenes y clientes
  anteriores siguen funcionando.
