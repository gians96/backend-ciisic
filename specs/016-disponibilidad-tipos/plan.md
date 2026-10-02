# Implementation Plan: Disponibilidad de los tipos de inscripción

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-tipos.md](contracts/api-tipos.md)

- `prisma/schema.prisma`: enum `DisponibilidadTipo` y `TipoInscripcion.disponiblePara`
  (`@default(TODOS)`, `@map("disponible_para")`); migración
  `20261002120000_disponibilidad_tipos` (un `ADD COLUMN` con valor por defecto).
- `src/core/catalogos.ts`: `DISPONIBILIDADES_TIPO` y su tipo.
- `src/api/inscription/services/pricing.ts`: `tipoDisponible` (función pura) y
  `mensajeTipoNoDisponible`.
- `src/api/inscription/services/inscription.ts`: tras `precioPara(correoFinal)` (dentro de la
  transacción), `422 REGISTRATION_TYPE_NOT_AVAILABLE`; la transacción revierte el alta del participante
  y el `errorHandler` borra el voucher.
- `src/api/registration-type`: `disponiblePara` en la validación (`yup.mixed().oneOf`), en `aTipo`,
  `tiposPublicos`, `crearTipo` (`?? 'TODOS'`) y `actualizarTipo` (solo si llega).
- `src/api/event/services/event.ts`: copiar el campo al duplicar un evento.
- Consumidores: panel (spec 010 del panel, selector «Disponible para») y landing (spec 003 de la
  landing, oculta el tipo y traduce el error nuevo).

## Pruebas

- `tests/inscription/pricing.test.ts`: tabla de `tipoDisponible` y mensajes.
- `tests/inscription/create.test.ts`: externos con correo del dominio (422, sin crear), externos con
  otro correo (precio regular), institucional con externo (422), estudiantil con verificación (422) y
  sin ella (precio regular), correo conservado del dominio (422) y ruta legacy.
- `tests/registration-type/disponibilidad.test.ts`: crear y actualizar (valor válido, ausente e
  inválido), listado del panel con y sin `pagos.ver` y `GET /site/registration-types`.
