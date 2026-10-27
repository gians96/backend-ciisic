# Tasks: Créditos de cada credencial de correo y confirmación del envío

- [x] T001 Migración `20261029180000_creditos_correo` (`creditos`, `creditos_verificados_en`) y `schema.prisma`
- [x] T002 `brevo-client.ts`: `creditosDeEnvio` y confirmación del envío (sin `messageId` es un error); `gmail-client.ts`: confirma `accepted` y `rejected`
- [x] T003 `email-credential.ts`: créditos al día (`conCreditosAlDia`), solo se elige con créditos, descuento por envío, `credencialUtilizable`, `revisarCredenciales` y `messageId` en «Enviar prueba»
- [x] T004 `POST /v1/email-credentials/check` (controlador, ruta, matriz de rutas)
- [x] T005 Pruebas (`tests/email/creditos-correo.test.ts`) y ajuste de los fixtures de `credenciales`, `enlace-credencial`, `respaldo-gmail`, `codigo`
- [x] T006 Contrato `contracts/api-credenciales-correo.md`, AGENTS.md, `docs/` y README
- [ ] T007 Producción: tras desplegar, **Revisar créditos** en Correo y comprobar que la que tiene 0 se salta y que «Enviar prueba» devuelve el identificador del mensaje
