# Tasks: Los envíos masivos pasan solos de una credencial a la siguiente, con tope seguro

- [x] T001 `correo.ts` y `brevo-client.ts`: `CorreoFallido.sinCreditos` y su detección (402, `not_enough_credits`, mensaje de créditos; el 429 no)
- [x] T002 `email-credential.ts`: zona de revisión (1–25 envíos), error de créditos que deja `creditos = 0`, política de `ERROR` y aviso de respaldo solo cuando un intento falló
- [x] T003 `email-credential.ts`: `prepararEnvioMasivo` (revisión forzada y `409 EMAIL_CREDITS_EXHAUSTED` antes de reservar marcas)
- [x] T004 `recuento-envios.ts` (`AsyncLocalStorage`: `conRecuento`, `anotarEnvio`, `anotarAgotado`) y su uso en `enviarConCredencial`
- [x] T005 `broadcast/services/enviar.ts`: `recorrer` con recuento y corte, `ResultadoEnvio.porCredencial` y `agotado`, `prepararEnvioMasivo` en cada envío masivo
- [x] T006 Pruebas: `tests/email/reparto-envios.test.ts` (320 correos con BD y Brevo simulados con estado) y `tests/broadcast/envios.test.ts`
- [x] T007 Contrato, AGENTS.md, README y `docs/operacion.md`
- [ ] T008 Producción: tras desplegar, **Revisar créditos** en Correo y un envío masivo pequeño; comprobar `porCredencial` en la respuesta
