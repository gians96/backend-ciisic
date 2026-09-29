# Feature Specification: Configuración del sistema en la BD

**Feature Branch**: `feat/multi-evento-sdd`
**Created**: 2026-09-30
**Status**: Implementado
**Input**: "UNDC_API_URL, UNDC_API_KEY, UNDC_API_TIMEOUT_MS: esto debo ponerlo en el sistema de manera dinámica, no deseo ponerlo en el .env […] DNI_CACHE_TTL_DAYS, DNI_LOOKUP_TIMEOUT_MS: no lo veo necesario […] INTEGRATIONS_ALLOWED_HOSTS […] CORS_ORIGINS también lo veo innecesario […] tengo el bootstrap, eso no es necesario."

## User Scenarios & Testing

### User Story 1 - Configurar API_UNDC desde el panel (Priority: P1)

Como SuperAdmin quiero registrar la URL y la API key de API_UNDC (verificación de
estudiantes), probar la conexión y cambiarlas sin redeplegar.

**Acceptance Scenarios**:

1. **Given** URL y key válidas, **When** pruebo, **Then** veo "Conexión correcta", el código
   HTTP y la latencia; el estado queda `OK`.
2. **Given** una key sin el permiso `estudiantes:verificar`, **When** pruebo, **Then** el mensaje
   lo dice y el estado queda `ERROR`.
3. La API key nunca vuelve al navegador (solo `••••` + 4 caracteres).
4. **Given** que no hay configuración, **Then** la verificación de estudiantes responde
   "no disponible" y la inscripción sigue a precio regular (como antes).

### User Story 2 - Menos variables de entorno (Priority: P1)

Como responsable del despliegue quiero configurar solo `DATABASE_URL`, `JWT_SECRET` y
`SECRETS_ENCRYPTION_KEY`; lo demás se configura en el panel o es constante.

**Acceptance Scenarios**:

1. El backend arranca solo con esas tres variables.
2. Si el entorno aún trae `UNDC_API_*`, `GOOGLE_CLIENT_ID` o `LEGACY_ROUTES_ENABLED`, se
   importan una vez a la configuración (si nunca se editó en el panel) y el log indica que
   ya se pueden quitar; las demás variables antiguas solo generan el aviso.

### User Story 3 - Retirar la landing anterior sin desplegar (Priority: P2)

Como SuperAdmin quiero desactivar las rutas legacy con un interruptor.

**Acceptance Scenarios**:

1. **When** desactivo "Landing anterior", **Then** en menos de 30 s las rutas legacy responden
   `410 LEGACY_ROUTE_DISABLED`.

## Requirements

- **FR-001**: Tabla de fila única `configuracion_sistema` (id = 1, `CHECK`), con API_UNDC (URL,
  key cifrada, sufijo, timeout, último estado), `google_client_id`, `url_panel` y
  `rutas_legacy_activas`; guarda quién la editó.
- **FR-002**: Caché en memoria de 30 s, actualizada al guardar; si la BD falla se usa el último
  valor o los valores por defecto.
- **FR-003**: URLs salientes validadas contra SSRF sin lista de hosts: https (http solo a
  localhost fuera de producción) y, en producción, sin destinos internos (literales o por DNS).
- **FR-004**: Constantes: caché DNI 30 días, timeout DNI 8 s, integraciones 10 s, Brevo 15 s,
  verificación 24 h, uploads en `<cwd>/uploads` y 5 MB por voucher.
- **FR-005**: `bootstrapAdmin` recibe `--correo --nombres --apellidos` y genera una contraseña
  temporal que muestra una sola vez.
- **FR-006**: La imagen siempre ejecuta `prisma migrate deploy` al arrancar.

## Success Criteria

- **SC-001**: `.env.example` con 3 variables.
- **SC-002**: Cambiar la configuración de API_UNDC no requiere redeplegar.
