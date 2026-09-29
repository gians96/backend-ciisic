# Implementation Plan: API abierta protegida por tokens

**Spec**: [spec.md](spec.md) | **Contrato**: [../007-tokens-acceso-evento/contracts/api-sitio.md](../007-tokens-acceso-evento/contracts/api-sitio.md)

- `src/app.ts`: CORS abierto; se elimina `src/core/cors.ts`.
- `src/middlewares/rate-limit.ts`: `limitador(windowMs, limit, message, { clave: 'ip' | 'token' | 'participante' })`;
  limitadores `limiteToken*` que se ejecutan después del límite por visitante; aviso en el log
  cuando un token llega a su tope.
- Rutas `/v1/site/*` de cada módulo con su limitador por token.
- Recomendación vigente: la landing usa el token solo en su servidor (BFF); un token usado en
  un navegador es público y se revoca en el panel si hay abuso.

## Pruebas

`tests/site/token-acceso.test.ts` (preflight desde cualquier origen con `x-api-key`) y
`tests/core/seguridad.test.ts` (límite por token con `X-Client-Ip` distintos).
