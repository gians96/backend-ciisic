# Tasks: Registro de delegaciones con representante y pago conjunto

- [x] T001 Esquema: `delegaciones` gana los datos del pago conjunto (modalidad, medio, número de
      operación, fecha, voucher, monto total pagado) y el índice único
      `(evento_id, numero_operacion)`; `eventos` gana la tarifa por defecto
      (`delegacionesMinIntegrantes`, `delegacionesPrecioEstandar`, `delegacionesPrecioPromocional`)
- [x] T002 Migración `20261020140000_delegaciones_pago` (aditiva) y `prisma migrate diff` vacío
- [x] T003 `registroDelegacionSchema`: delegación, representante, participantes, pago y voucher
- [x] T004 Servicio `registrarDelegacion`: crea la delegación, coloca al representante primero,
      calcula la tarifa con el total final y guarda el pago conjunto
- [x] T005 Rutas de la API del sitio: `GET /v1/site/delegations/tarifa`,
      `GET /v1/site/delegations/link/:codigoLink` y `POST /v1/site/delegations` (con voucher)
- [x] T006 El link de una delegación exige el token del evento (se retira la ruta pública)
- [x] T007 `GET /v1/delegations/:id/voucher` para el staff
- [x] T008 Pruebas (registro público, tarifa, pago conjunto, operación duplicada, link por evento)
- [x] T009 Matriz de rutas: 3 rutas del sitio, 1 de administración, 1 pública menos (`TOTAL_RUTAS` 137)
- [x] T010 Contrato: `specs/018-delegaciones/contracts/api-delegaciones.md` y
      `docs/arquitectura-ecosistema.md` (contrato 3)
- [x] T011 Documentación: `docs/api.md` y `docs/configuracion.md`
- [ ] T012 Landing: BFF (`/api/publico/delegaciones`), formulario con la sección del representante,
      carga masiva y pago conjunto
- [ ] T013 Panel: mostrar el pago del grupo, el botón de ver el voucher y el enlace corregido
      (`/delegaciones?delegacion=<código>`)
