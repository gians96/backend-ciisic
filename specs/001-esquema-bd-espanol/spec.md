# Feature Specification: Esquema de base de datos legible en español

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-29
**Status**: Implementado
**Input**: "Renombra las tablas de la base de datos para que sean legibles; las tablas estarán en español; usa la mejor convención de buenas prácticas."

## User Scenarios & Testing

### User Story 1 - Esquema legible sin perder datos (Priority: P1)

Como responsable técnico del congreso quiero que las tablas y columnas de `ciisic_vii`
tengan nombres en español, consistentes y autoexplicativos, para mantener el sistema y
escribir consultas sin adivinar qué significa cada campo — **sin perder ninguna
inscripción existente**.

**Why this priority**: todas las features siguientes (multi-evento, consultas, panel) se
construyen sobre este esquema.

**Independent Test**: restaurar un respaldo de producción en MySQL 8, ejecutar
`prisma migrate deploy` y comparar conteos y muestras de filas antes/después.

**Acceptance Scenarios**:

1. **Given** la BD con el esquema actual y datos, **When** se aplica la migración,
   **Then** todas las tablas quedan con los nombres del mapa de `data-model.md` y los conteos
   por tabla son idénticos.
2. **Given** la BD migrada, **When** se ejecuta `prisma migrate diff` entre las
   migraciones y `schema.prisma`, **Then** no hay diferencias.
3. **Given** un participante con `dni` y `numero`, **When** se migra, **Then** queda un
   único `numero_documento` igual al `dni` original y `tipo_documento_id` no nulo.

### User Story 2 - Catálogos referenciados por código (Priority: P2)

Como desarrollador quiero referirme a estados de inscripción y roles por un `codigo`
estable (`APROBADO`, `SUPERADMIN`) en lugar de ids mágicos (`2`, `1`).

**Acceptance Scenarios**:

1. **Given** los estados 1–5 existentes, **When** se migra, **Then** tienen los códigos
   `PENDIENTE`, `APROBADO`, `RECHAZADO`, `EN_REVISION`, `CANCELADO`.
2. **Given** el código de la aplicación, **When** busca "aprobado", **Then** lo hace por
   `codigo`, no por id.

### Edge Cases

- `dni` distinto de `numero` en alguna fila (edición manual): gana `dni`, que es el dato
  mostrado en credenciales y asistencia; la verificación previa lo reporta.
- `idTipoDocumentoId` nulo en registros antiguos: se completa con `dni`.
- Tablas con nombres que solo cambian de mayúsculas (`Roles` → `roles`): se renombran en
  dos pasos para funcionar también con `lower_case_table_names=1`.
- Migración de `PaperSubmission` aún pendiente en producción: se aplica antes, en orden.
- Falla a mitad de migración (DDL de MySQL no es transaccional): se restaura el respaldo
  (runbook en `plan.md`).

## Requirements

### Functional Requirements

- **FR-001**: Las tablas MUST llamarse en español, `snake_case`, plural (mapa en `data-model.md`).
- **FR-002**: Las columnas MUST seguir `snake_case`, FK `<entidad>_id`, `creado_en`/`actualizado_en`.
- **FR-003**: La migración MUST ser in-place (RENAME/ALTER), sin DROP de tablas ni de datos,
  salvo la columna redundante `Usuario.dni` tras copiarla a `numero_documento`.
- **FR-004**: Montos MUST migrar a `DECIMAL(10,2)`; `mensajes_contacto.mensaje` a `TEXT`;
  `numero_documento` a `VARCHAR(20)` (admite CE de 9 dígitos).
- **FR-005**: Restricciones MUST renombrarse a `fk_*`, `uq_*`, `idx_*`; se eliminan índices redundantes.
- **FR-006**: `roles` y `estados_inscripcion` MUST tener `codigo` único.
- **FR-007**: Los modelos Prisma MUST ser singulares en PascalCase con `@@map`/`@map`.
- **FR-008**: Los seeds MUST ser idempotentes (upsert por código), sin `deleteMany` ni
  reinicio de AUTO_INCREMENT.
- **FR-009**: Debe existir un script de verificación previa que detecte datos que harían
  fallar la migración.

### Key Entities

Ver `data-model.md`.

## Success Criteria

- **SC-001**: 0 filas perdidas: conteo por tabla idéntico antes/después en el ensayo.
- **SC-002**: `prisma migrate diff --from-migrations … --to-schema-datamodel …` vacío.
- **SC-003**: `npm run lint`, `tsc` y `npm test` en verde tras el refactor.

## Assumptions

- Producción corre MySQL 8 (soporta `RENAME COLUMN` / `RENAME INDEX`).
- Los nombres de FKs en producción son los que generó Prisma (se verifican en el preflight).
