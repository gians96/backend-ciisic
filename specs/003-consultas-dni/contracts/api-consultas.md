# Contrato — Consultas de DNI

## Público

`GET /api/v1/public/document-lookup/dni/:numero` (10/min por IP)

```json
{ "success": true, "data": { "numero": "12345678", "nombres": "JUAN CARLOS", "apellidoPaterno": "PEREZ", "apellidoMaterno": "GARCIA", "apellidos": "PEREZ GARCIA" } }
```

Errores: `422 INVALID_DNI`, `404 DOCUMENT_NOT_FOUND`, `503 LOOKUP_UNAVAILABLE`, `429 RATE_LIMITED`.

Legacy: `GET /api/v1/reniec/dni?number=12345678` → `{ "numero", "idTipoDocumento": "dni", "nombres", "apellidos" }`.

## Administración (Bearer admin)

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| GET | `/api/v1/document-lookup/dni/:numero` | Igual que el público + `fuente` (`CACHE`\|`PROVEEDOR`) y `proveedor`. Origen `PANEL`. |
| GET | `/api/v1/lookup-tokens` | Lista de tokens (ver forma abajo), por prioridad. |
| POST | `/api/v1/lookup-tokens` | `{ proveedor: "DECOLECTA"\|"APIPERU", nombre, token, limiteConsultas?, consultasUsadas?, periodoRenovacion?: "DIARIO"\|"MENSUAL"\|"ANUAL"\|"NINGUNO", fechaRenovacion?: ISO, prioridad?: 0–10000, activo? }` |
| PUT | `/api/v1/lookup-tokens/:id` | Parcial. Enviar `token` lo reemplaza y reactiva. |
| DELETE | `/api/v1/lookup-tokens/:id` | |
| POST | `/api/v1/lookup-tokens/:id/reset` | Contador a 0, estado `ACTIVO`. |
| POST | `/api/v1/lookup-tokens/:id/test` | `{ numero }` → `{ ok, persona? , falla?: { tipo, mensaje, codigoHttp }, token }` (consume 1 consulta). |
| GET | `/api/v1/lookup-tokens/usage?dias=30` | `{ desde, porDia: [{ fecha, EXITO?, CACHE?, … }], porToken: [{ tokenConsultaId, nombre, proveedor, resultados }] }` |
| GET | `/api/v1/lookup-tokens/logs?page=` | Bitácora paginada (50): `{ id, creadoEn, numero (enmascarado), proveedor, token, resultado, codigoHttp, duracionMs, origen, detalle }` |

Token:

```json
{
  "id": 1, "proveedor": "APIPERU", "nombre": "apiperu cuenta 1", "tokenEnmascarado": "••••9876",
  "limiteConsultas": 100, "consultasUsadas": 12, "consultasRestantes": 88, "porcentajeUso": 12,
  "periodoRenovacion": "MENSUAL", "fechaRenovacion": "2026-10-15T05:00:00.000Z", "prioridad": 10,
  "estado": "ACTIVO", "activo": true, "disponible": true, "ultimoError": null,
  "ultimoUsoEn": "…", "agotadoEn": null, "creadoEn": "…", "actualizadoEn": "…"
}
```
