# Tasks: Tokens de acceso por evento

- [x] T001 Migración `20260929120600_tokens_acceso` y modelo `TokenAcceso`
- [x] T002 Generación/hash de tokens y middleware `requireTokenEvento`
- [x] T003 Rutas `/v1/site/*` (evento, tipos, catálogos, inscripciones, verificación, DNI, ponencias, contacto); retirar `/v1/public/*` y `/v1/reniec/dni`
- [x] T004 Límites por visitante con `X-Client-Ip` (solo con token válido)
- [x] T005 Gestión SuperAdmin (crear con valor único, listar sin hash, revocar)
- [x] T006 `LEGACY_ROUTES_ENABLED` para retirar las rutas de la landing anterior sin desplegar código
- [x] T007 CORS con comodines de subdominio (landing anterior en `https://ciisic-viii.episundc.pe`)
- [x] T008 Pruebas
- [ ] T009 Producción: generar el token del VIII en el panel y configurarlo en la landing nueva
- [ ] T010 Tras publicar la landing nueva: `LEGACY_ROUTES_ENABLED=false` y quitar `CORS_ORIGINS`
