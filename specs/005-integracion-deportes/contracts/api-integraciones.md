# Contrato — Integraciones por evento (API administrativa)

Proveedor remoto: deportes-fi, contrato 2 de `docs/arquitectura-ecosistema.md`.

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| GET | `/api/v1/events/:eventId/integrations` | `[{ id, eventoId, tipo: "DEPORTES_FI", nombre, urlBase, tokenEnmascarado, activo, ultimoEstado, ultimoError, ultimaSincronizacionEn }]` |
| POST | `/api/v1/events/:eventId/integrations` | `{ tipo?: "DEPORTES_FI", nombre, urlBase, token, activo? }` |
| PUT | `/api/v1/integrations/:id` | Parcial; `token` lo reemplaza. |
| DELETE | `/api/v1/integrations/:id` | |
| POST | `/api/v1/integrations/:id/test` | `{ ok, eventoRemoto?: { id, name, startDate, endDate, isOpen }, error?, integracion }` |
| GET | `/api/v1/events/:eventId/integrations/sports-summary` | Ver abajo |

`sports-summary`:

```json
{
  "evento": { "id": 1, "codigo": "ciisic-viii-2026", "nombreCorto": "VIII CIISIC 2026" },
  "congreso": { "inscripcionesTotales": 28, "inscripcionesAprobadas": 15, "montoAprobado": 1460, "montoPendiente": 400 },
  "deportes": [
    { "integracionId": 1, "nombre": "Juegos Semana Sistémica", "ok": true, "resumen": { "…": "contrato 2" }, "error": null }
  ],
  "totales": { "recaudadoCongreso": 1460, "recaudadoDeportes": 1500, "recaudadoTotal": 2960, "pendienteDeportes": 200 }
}
```

`urlBase` ejemplo: `https://api.deportes-fi.undc.edu.pe/api/v1` (el backend agrega
`/integrations/event/summary`).
