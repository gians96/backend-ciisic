# Tasks: Acceso con Google

- [x] T001 Migración `20260930120100_acceso_google`
- [x] T002 Sesiones con emisor y audiencia; guardas por perfil
- [x] T003 Verificación del ID token (cliente único, audiencia de la BD, nonce, autoritativo)
- [x] T004 `POST /v1/auth/google` (admin → participante) con vínculo por `sub`
- [x] T005 `POST /v1/site/google-verification` y evidencia en la inscripción (sin cambiar precios)
- [x] T006 Desvincular Google (administradores y participantes); limpiar al cambiar el correo
- [x] T007 Pruebas
- [ ] T008 Crear el client ID en Google Cloud (orígenes del panel y de cada landing) y guardarlo en Sistema
- [ ] T009 Prueba integrada con una cuenta real de estudiante y otra de personal UNDC (claim `hd`)
- [x] T010 Administradores solo con Google: migración `20260930140000_administradores_solo_google`
      (`contrasena_hash` opcional), alta sin contraseña, `quitarContrasena`, `tieneContrasena`,
      login que rechaza cuentas sin contraseña y pruebas (`tests/admin/administradores.test.ts`)
