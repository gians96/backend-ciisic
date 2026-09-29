# Implementation Plan: Tokens de acceso por evento

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-sitio.md](contracts/api-sitio.md)

## Archivos

| Archivo | Rol |
|---|---|
| `prisma/migrations/20260929120600_tokens_acceso` | Tabla `tokens_acceso` |
| `src/core/tokens-acceso.ts` | Generación, formato y hash HMAC |
| `src/middlewares/sitio.ts` | `requireTokenEvento` (evento, IP del visitante, último uso) y `eventoDelSitio(req)` |
| `src/middlewares/rate-limit.ts` | Clave del límite = IP del visitante (`X-Client-Ip` con token válido) |
| `src/middlewares/legacy.ts` | `rutaLegacy` (410 con `LEGACY_ROUTES_ENABLED=false`) |
| `src/api/access-token/*` | Gestión SuperAdmin |
| `src/api/*/routes/*` | Rutas `/v1/site/*` en cada módulo |
| `src/core/cors.ts` | Orígenes de navegador con comodín de subdominio |

## Flujo

```
Navegador ──► landing (Nitro) ──X-Api-Key + X-Client-Ip──► backend /api/v1/site/*
                                   (token solo en el servidor)
```

El token vive únicamente en el runtime privado de la landing (`NUXT_BACKEND_EVENT_TOKEN`).
Cambiar de edición = generar el token del evento nuevo y cambiar esa variable.

## Pruebas

`tests/site/token-acceso.test.ts`: formato/hash, cabecera faltante, formato inválido (sin
consulta a BD), inexistente/revocado/expirado, evento del token, IP del visitante, CORS sin
`X-Api-Key`, creación (hash guardado, valor una vez, `no-store`), revocación idempotente,
comodines CORS y rutas legacy desactivadas. Rutas del sitio en `tests/event`, `tests/papers`
y `tests/security`.
