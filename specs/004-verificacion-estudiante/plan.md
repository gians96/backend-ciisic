# Implementation Plan: Verificación de estudiantes

**Spec**: [spec.md](spec.md) | **Contrato con API_UNDC**: `docs/arquitectura-ecosistema.md` (Contrato 1)

## Flujo

```
Landing ──POST student-verification──► backend-ciisic
                                        ├─ correo institucional? (dominio del evento)
                                        ├─ nombres oficiales: personas_consultadas o pool DNI (spec 003)
                                        ├─ API_UNDC POST /externo/estudiantes/verificar (X-API-Key)
                                        └─ firma verificacionToken (24 h) si es positivo
Landing ──POST inscriptions (+verificacionToken)──► backend valida token ⇒ precio UNDC
```

## Archivos

| Archivo | Rol |
|---|---|
| `src/api/student-verification/services/undc-client.ts` | Cliente HTTP con timeout y API key |
| `src/api/student-verification/services/student-verification.ts` | Reglas, motivos, instantánea |
| `src/api/student-verification/services/verification-token.ts` | Firma/lectura del token |
| `src/api/inscription/services/pricing.ts` | Precio según verificación |
| `prisma/migrations/20260929120300_verificacion_estudiante` | Columnas en `inscripciones` |

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `UNDC_API_URL` | — | `https://api-jp.episundc.pe` |
| `UNDC_API_KEY` | — | API key con scope `estudiantes:verificar` (creada en app-web-sigenet) |
| `UNDC_API_TIMEOUT_MS` | 8000 | |
| `VERIFICACION_SECRET` | derivado de JWT_SECRET | Firma de `verificacionToken` |
| `VERIFICACION_TTL_HORAS` | 24 | Vigencia del token |

Sin `UNDC_API_URL`/`UNDC_API_KEY` la verificación responde `SERVICIO_NO_DISPONIBLE` (precio regular).
