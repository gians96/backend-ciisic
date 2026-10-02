# Tasks: Reinscripción tras un rechazo o una cancelación

- [x] T001 `crearInscripcion`: reutilizar la inscripción `RECHAZADO` o `CANCELADO` con `updateMany` condicionado al estado
- [x] T002 Borrar el voucher y la credencial anteriores tras la transacción
- [x] T003 Listado del panel ordenado por `creadoEn` descendente
- [x] T004 `PERMISOS_SOLO_OWNER`: `inscripciones.eliminar` solo para el Owner
- [x] T005 Pruebas (reinscripción, envíos simultáneos, duplicado de operación, permisos y ruta DELETE)
- [x] T006 Contratos: spec 007 (sitio), spec 013 (permisos) y `docs/arquitectura-ecosistema.md`
- [x] T007 Panel: botón «Eliminar» para rechazadas o canceladas, solo con `inscripciones.eliminar`
