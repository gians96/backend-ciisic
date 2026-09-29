# Contrato — API pública

> **Reemplazado.** La API pública por código de evento (`/api/v1/public/events/:codigo/*`) no
> llegó a producción: la landing consume la **API del sitio** con el token de acceso de su evento.
> Ver [`specs/007-tokens-acceso-evento/contracts/api-sitio.md`](../../007-tokens-acceso-evento/contracts/api-sitio.md).

## Rutas legacy (evento principal)

Se mantienen para la landing anterior (`https://ciisic-viii.episundc.pe`) mientras la nueva no esté
publicada. Con `LEGACY_ROUTES_ENABLED=false` responden `410 LEGACY_ROUTE_DISABLED`.
`GET /api/v1/reniec/dni` se retiró: exponía el pool de consultas DNI sin token.

| Ruta | Comportamiento |
|---|---|
| `POST /api/v1/inscription` | Igual que antes (`usuario` JSON, `file` opcional); responde la forma anterior (`usuario`, `pago`, `estado`…). Ignora `estadoId`. |
| `GET /api/v1/registration-types[/:id]` | Tipos del evento principal con la forma anterior (`badge`, `value`, `institutionalPrice`, `tipoPlanId`). |
| `POST /api/v1/papers` | Igual que antes, asociado al evento principal. |
| `POST /api/v1/contact` | `{ firstName, lastName, email, subject, message }`, asociado al evento principal. |
| `GET /api/v1/classification`, `/document-type`, `/inscription-state`, `/deposit-method`, `/payment-type` | Catálogos públicos (los dos últimos responden `[]`). |
