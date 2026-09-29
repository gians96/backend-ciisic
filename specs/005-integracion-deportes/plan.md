# Implementation Plan: Integración con deportes-fi

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-integraciones.md](contracts/api-integraciones.md)

## Archivos

| Archivo | Rol |
|---|---|
| `prisma/migrations/20260929120400_integraciones_evento` | Tabla `integraciones_evento` (FK a eventos, CASCADE) |
| `src/api/integration/services/sports-client.ts` | Cliente deportes-fi, validación anti-SSRF de URL |
| `src/api/integration/services/integration.ts` | CRUD, prueba, resumen con caché 60 s |
| `src/api/integration/routes/integration.ts` | Rutas admin |

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| `INTEGRATIONS_ALLOWED_HOSTS` | (vacío = cualquiera https) | p. ej. `api.deportes-fi.undc.edu.pe` |
| `INTEGRATIONS_TIMEOUT_MS` | 10000 | |

## Pruebas

`tests/integration/sports.test.ts`: validación de URL, suma congreso + deportes y tolerancia
a fallas (401 → estado ERROR, resumen sigue respondiendo).
