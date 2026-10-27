# Tasks: Enlace de acceso al congreso para los inscritos virtuales

- [x] T001 Marca `enlace_virtual_enviado_en` en `inscripciones` (migración `20261030120000_acceso_virtual`, aditiva; `prisma migrate diff` vacío)
- [x] T002 `broadcast/services/destinatarios.ts`: canal `virtual` (`aprobadasVirtuales`, `baseDelCanal`, `marcaDe`), con los totales de los virtuales del evento
- [x] T003 `broadcast/services/enviar.ts`: `enviarAccesoVirtual` y `probarAccesoVirtual` (reserva atómica, reversión si falla, mensaje escapado con el botón «Ingresar al congreso»)
- [x] T004 Validación del enlace (`esEnlaceDeAcceso`: solo `https`, sin credenciales ni espacios, máx. 500) y esquemas de envío y prueba
- [x] T005 Rutas `virtual-access` (lista, ids, send, test), controlador, límites `limiteEnviosMasivos` / `limiteLecturaEnvios` y matriz de rutas (209)
- [x] T006 Pruebas en `tests/broadcast/envios.test.ts`
- [x] T007 Contrato `contracts/api-acceso-virtual.md`, `docs/`, AGENTS.md y README
- [ ] T008 Probado de punta a punta en local (panel + backend) con un virtual aprobado
- [ ] T009 Producción: tras desplegar, revisar los créditos de Brevo (Correo → Revisar créditos), enviarse una prueba y enviar por tandas
