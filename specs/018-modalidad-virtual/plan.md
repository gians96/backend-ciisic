# Implementation Plan: Modalidad de asistencia virtual

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-modalidad.md](contracts/api-modalidad.md)

## Decisión de diseño

- La modalidad es un atributo del **tipo** de inscripción (`TipoInscripcion.modalidad`), no una
  categoría nueva ni un valor de `disponiblePara`: «a quién se ofrece» y «cómo se asiste» son ejes
  distintos. Así los virtuales reutilizan el ciclo, la verificación SIVIRENO, la marca «validar» y las
  páginas `/estudiantes` y `/general`.
- El precio no se toca: los tipos virtuales llevan `precio == precioInstitucional` (30/30 y 50/50) y
  `disponiblePara = TODOS`; `calcularPrecio` da el mismo monto con cualquier correo y descuento 0.
- La clave JSON `modalidad` vive **solo dentro del objeto del tipo**, para no chocar con
  `pago.modalidad` / `modalidadPago` (banco, billetera, cortesía).
- Lectura tolerante: `modalidadDe(valor)` (en `catalogos.ts`) devuelve `VIRTUAL` solo si el valor es
  exactamente `VIRTUAL`; ausente, `null` o desconocido es `PRESENCIAL`.

## Archivos

- `prisma/schema.prisma`: enum `ModalidadAsistencia` y `TipoInscripcion.modalidad`
  (`@default(PRESENCIAL)`, `@map("modalidad")`); migración aditiva
  `20261019120000_modalidad_virtual` (un `ADD COLUMN` con valor por defecto).
- `src/core/catalogos.ts`: `MODALIDADES_ASISTENCIA`, `ModalidadAsistencia` y `modalidadDe`.
- `src/api/registration-type`: `modalidad` en la validación (`yup.mixed().oneOf`), `aTipo`,
  `tiposPublicos`, `crearTipo` (`?? 'PRESENCIAL'`) y `actualizarTipo` (solo si llega). No se toca
  `aTipoLegacy`.
- `src/api/event/services/event.ts`: copiar la modalidad al duplicar un evento; `porTipo[].modalidad` y
  `totales.porModalidad` en `resumenEvento` (montos con `importe`, que respeta `pagos.ver`).
- `src/api/inscription`:
  - `mappers.ts`: `tipoInscripcion.modalidad` en `aDetalle`, `aFilaLista` y `aCreada` (no en `aLegacy`).
  - `services/inscription.ts`: `FiltrosInscripcion.modalidad`; `construirFiltro` arma **una sola** clave
    `tipoInscripcion` con `categoria` y `modalidad` (dos spreads con la misma clave se pisarían);
    columna «Modalidad de asistencia» del CSV, sin `pago: true`.
  - `controllers/inscription.ts`: lee `?modalidad=` (valor desconocido → `422`).
  - `utils/generatePdf.ts` y `templates/inscription.html`: rótulo «Modalidad: VIRTUAL» (bloque compuesto
    por el servidor, escapado, en el arreglo `raw`), modalidad en la huella y `VERSION_PLANTILLA = 3`.
  - `utils/sendEmail.ts` y `templates/approval.html`: párrafo solo para virtuales (`renderTemplate` no
    tiene condicionales: el bloque se compone en el servidor y se pasa como `raw`).
- `src/api/participant-portal/services/participant-portal.ts`: `modalidad` en `tipoInscripcion` de la
  lista y del fotocheck (el `select` de `miFotocheck` pide solo lo que muestra).
- `src/api/activity/services/activity.ts`: `modalidad` en el `select` y en la respuesta de
  `registrarAsistencia`. No bloquea nada.
- `src/database/seed.ts`: tipos virtuales de demostración (`--demo`).
- `prisma/preflight/configurar-virtual.sql` y `verificar-virtual.sql`: datos de producción con un script
  idempotente y no destructivo (los ejecuta el dueño del proyecto, nunca el código).
- Documentación: `docs/data-model.md`, `docs/operacion.md` (sección «Migración 018»),
  `docs/arquitectura-ecosistema.md` (contratos 3 y 4), `docs/api.md`, contratos de las specs 002, 007 y
  014, `README.md` y `AGENTS.md`.
- Consumidores (otros repositorios, en paralelo): panel (selector de modalidad en el tipo, filtro,
  columna y KPI) y landing (separar presencial de virtual, textos neutros).

## Orden de despliegue (cada repositorio se despliega solo con el push a `main`)

1. Respaldo `mysqldump`. 2. Backend (la imagen aplica `prisma migrate deploy`). 3. Crear los tipos
   virtuales (script o panel). 4. Panel y landing. 5. Verificar. Cualquier orden entre backend y
   frontends es seguro: el campo es aditivo y su ausencia significa `PRESENCIAL`.

## Pruebas

- `tests/registration-type/modalidad.test.ts`: crear con `VIRTUAL`, sin enviarla `PRESENCIAL`, valor
  desconocido y `null` → `422` con `fields.modalidad`, actualizar solo la modalidad, listado del panel con
  y sin `pagos.ver` y `GET /site/registration-types`; la forma LEGACY no la lleva.
- `tests/inscription/create.test.ts`: tipo virtual 30/30 y 50/50 con correo del dominio y externo (mismo
  monto, descuento 0, `tieneDescuento` falso, también en la categoría estudiantil sin token).
- `tests/inscription/pricing.test.ts`: fila con precio igual al institucional.
- `tests/inscription/admin.test.ts`: filtro `?modalidad=` solo y combinado con `?categoria=`, desconocido
  → `422`, CSV (columna nueva con y sin `pagos.ver`, la de pago intacta), lista y detalle.
- `tests/event/event.test.ts`: `porTipo[].modalidad`, `totales.porModalidad` (con y sin `pagos.ver`) y la
  copia de un evento con `copiarDeEventoId`.
- `tests/participant-portal` y `tests/activity`: `modalidad` en lista, fotocheck y escáner (los `toEqual`
  estrictos se actualizan; el escáner sigue marcando a un virtual).
- `tests/inscription/credencial.test.ts` y `tests/email`: rótulo y huella; párrafo del correo solo para
  virtuales y con el texto escapado.
