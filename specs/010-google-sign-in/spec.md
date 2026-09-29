# Feature Specification: Acceso con Google

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-30
**Status**: Implementado
**Input**: "Quiero poner para acceder con Google; la UNDC usa @undc.edu.pe: un estudiante es 1231231231@undc.edu.pe y un administrativo o docente es garias@undc.edu.pe […] eso es fijo, no ponerlo en las variables de entorno." Decisiones: Google en panel y landing; en el panel entra cualquier cuenta de un administrador activo (también Gmail); en la landing Google es opcional por ahora y no cambia precios; para docentes y administrativos basta la cuenta Google @undc.edu.pe.

## User Scenarios & Testing

### User Story 1 - Administrador entra con Google (Priority: P1)

**Acceptance Scenarios**:

1. **Given** un administrador activo cuyo correo es el de la cuenta Google (Workspace o Gmail),
   **When** pulso "Continuar con Google", **Then** entro al panel; la cuenta queda vinculada.
2. **Given** otra cuenta Google con el mismo correo (correo reasignado), **Then** `403 GOOGLE_ACCOUNT_MISMATCH`.
3. **Given** un correo que no es administrador ni inscrito, **Then** `403 GOOGLE_ACCOUNT_NOT_REGISTERED`.
4. La contraseña sigue funcionando.

### User Story 2 - Correo verificado en la inscripción (Priority: P2)

**Acceptance Scenarios**:

1. **Given** la landing con Google configurado, **When** continúo con Google, **Then** el correo
   queda fijo, los nombres se completan y la inscripción queda como "correo verificado con
   Google" con el tipo de cuenta (estudiante, personal UNDC o externo).
2. Los precios no cambian: los estudiantes siguen verificándose con SIVIRENO (API_UNDC).

## Requirements

- **FR-001**: Flujo de ID token de Google Identity Services; el backend verifica firma, emisor,
  audiencia (client ID guardado en Sistema), vigencia, `email_verified` y que Google sea
  autoritativo para el correo (Gmail o `hd` igual al dominio).
- **FR-002**: El login del panel exige un `nonce` emitido por el servidor del panel.
- **FR-003**: `google_sub` vincula la cuenta en el primer ingreso (admins y participantes); se
  limpia si cambia el correo o si un SuperAdmin la desvincula.
- **FR-004**: Sesiones con audiencia: `ciisic-admin` o `ciisic-participante`.
- **FR-005**: Reglas fijas del dominio (`undc.edu.pe`; parte local numérica = estudiante).
- **FR-006**: La inscripción guarda `es_correo_verificado` y la instantánea `verificacion_correo`.

## Success Criteria

- **SC-001**: Ninguna variable de entorno nueva: el client ID se guarda en Sistema.
