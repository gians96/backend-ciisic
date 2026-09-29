# Tasks: Credenciales de correo en BD

- [x] T001 Migración `20260929120500_credenciales_correo` y modelo `CredencialCorreo`
- [x] T002 Cliente Brevo con `fetch` (envío y cuenta), errores legibles; retirar los SDK de Brevo
- [x] T003 CRUD SuperAdmin con predeterminada única, prueba de cuenta y correo de prueba
- [x] T004 Credencial por evento (`credencialCorreoId`) y resolución al enviar la aprobación
- [x] T005 Importación única de `BREVO_*` y `DECOLECTA_TOKEN` al arrancar (tablas vacías) y avisos de variables obsoletas
- [x] T006 Pruebas (cifrado, máscara, predeterminada, errores, resolución, adjunto, importación)
- [x] T007 Ensayo con la copia real de producción: importación desde el entorno en el primer arranque del contenedor. Resultado: la API key de Brevo responde "API Key is not enabled" y el token de Decolecta "Apikey Required / Limit Exceeded" → hay que cargar credenciales nuevas desde el panel
- [ ] T008 Producción: primer arranque con `BREVO_*`/`DECOLECTA_TOKEN`, verificar en el panel y luego quitar las variables
- [ ] T009 Rotar la API key de Brevo y el token de Decolecta (se compartieron por chat) y actualizarlos desde el panel
