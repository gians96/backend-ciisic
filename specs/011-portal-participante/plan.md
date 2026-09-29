# Implementation Plan: Portal del inscrito

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-portal.md](contracts/api-portal.md)

- `src/api/participant-portal/*`: perfil, inscripciones (más recientes primero) y credencial
  (reutiliza `archivoCredencial` de `src/api/inscription/services/inscription.ts`; comprueba
  primero que la inscripción sea del participante).
- `src/middlewares/auth.ts` `requireParticipante`: audiencia `ciisic-participante` y correo vigente.
- Panel: layout propio, página `/mis-inscripciones` y BFF `/api/portal/**` (spec 007 del panel).

## Pruebas

`tests/participant-portal/portal.test.ts`: solo lo propio, sin datos internos, motivo solo si
fue rechazada, credencial ajena 404, no aprobada 409, aprobada descargable, correo cambiado
401, token de admin 403.
