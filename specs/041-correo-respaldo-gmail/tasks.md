# Tasks: Respaldo entre credenciales de correo y envío por el SMTP de Gmail

- [x] T001 Migración `20261029120000_correo_respaldo_gmail`: enum `GMAIL_SMTP`, columna `prioridad` (orden inicial = el actual) y `schema.prisma`
- [x] T002 `services/correo.ts` (tipos comunes y `CorreoFallido.deLaCuenta`) y `brevo-client.ts` que clasifica los fallos de la cuenta
- [x] T003 `services/gmail-client.ts`: SMTP de Gmail con `nodemailer` (SSL 465, conexiones reutilizadas), errores traducidos y `verificarGmail`
- [x] T004 `email-credential.ts`: despacho por proveedor, prioridad al crear, orden (`ordenarCredenciales`), respaldo y espera en `enviarConCredencial`, `credencialUtilizable` por prioridad
- [x] T005 Validación (`proveedor`, `ordenarCredencialesSchema`), controlador y ruta `PUT /v1/email-credentials/order`; matriz de rutas
- [x] T006 Pruebas (`tests/email/respaldo-gmail.test.ts`) y ajuste de `credenciales.test.ts`, `codigo.test.ts`
- [x] T007 Contrato `contracts/api-credenciales-correo.md`, `docs/`, AGENTS.md y README
- [ ] T008 Probado de punta a punta con una cuenta de Gmail real y una contraseña de aplicación (Probar → Enviar prueba → respaldo con Brevo sin créditos)
- [ ] T009 Producción: tras desplegar, crear la credencial de Gmail (Correo → Agregar credencial), probarla y dejarla de respaldo de Brevo
