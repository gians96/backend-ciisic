# Implementation Plan: Consultas de DNI

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-consultas.md](contracts/api-consultas.md)

## Diseño

```
consultarDni(numero, origen)
 ├─ caché vigente? → CACHE
 ├─ renovarVencidos()            (reset perezoso condicional)
 ├─ tokensDisponibles()          (activo, ACTIVO, bajo límite, por prioridad)
 └─ por cada token (saltando proveedores que ya dijeron NO_ENCONTRADO):
      proveedor.consultarDni → EXITO: contar uso, caché, bitácora, responder
                             → AGOTADO: marcar AGOTADO, siguiente
                             → TOKEN_INVALIDO: marcar INVALIDO, siguiente
                             → NO_DISPONIBLE: anotar error, siguiente
                             → NO_ENCONTRADO: contar uso, probar otro proveedor
```

## Archivos

| Archivo | Rol |
|---|---|
| `prisma/migrations/20260929120200_consultas_dni` | `tokens_consulta`, `consultas_documento`, `personas_consultadas` |
| `src/core/crypto.ts` | AES-256-GCM (`cifrar`, `descifrar`, `sufijo`) |
| `src/api/document-lookup/providers/{types,decolecta,apiperu,index}.ts` | Adaptadores y clasificación de fallas |
| `src/api/document-lookup/services/lookup.ts` | Pool, rotación, bitácora |
| `src/api/document-lookup/services/renewal.ts` | Cálculo de renovación y límite |
| `src/api/document-lookup/services/cache.ts` | Caché y nombres oficiales |
| `src/api/document-lookup/services/tokens.ts` | CRUD, prueba, reinicio, uso, bitácora |
| `src/api/document-lookup/routes/document-lookup.ts` | Rutas públicas, legacy y admin |

## Clasificación de fallas

| Señal | Tipo |
|---|---|
| 401, 403 | TOKEN_INVALIDO |
| 402, 429, `quota_exceeded`, mensaje con "limit/límite/quota/exceed" | AGOTADO |
| 400, 404, 422, `document_not_found` | NO_ENCONTRADO |
| 5xx, timeout, red, 200 sin datos | NO_DISPONIBLE |

Decolecta solo documenta `400 {"error":"Invalid request"}`; como el formato se valida antes,
400 se trata como "no encontrado".

## Variables de entorno

| Variable | Default | Uso |
|---|---|---|
| ~~`SECRETS_ENCRYPTION_KEY`~~ | eliminada (spec 008, enmienda 2026-09-30) | La clave AES se deriva siempre de `JWT_SECRET` |
| `DNI_CACHE_TTL_DAYS` | 30 | Vigencia de la caché |
| `DNI_LOOKUP_TIMEOUT_MS` | 8000 | Timeout por proveedor |

Eliminadas: `RENIEC_PROVIDER`, `RENIEC_TOKEN`, `API_RENIEC_DNI`, `NUBETEC_TOKEN`, `DECOLECTA_TOKEN`
(los tokens ahora se gestionan desde el panel).
