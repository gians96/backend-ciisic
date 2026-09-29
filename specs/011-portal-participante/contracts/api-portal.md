# Contrato — Portal del inscrito (JWT de participante)

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/api/v1/me` | `{ id, nombres, apellidos, correo, tipoDocumento, numeroDocumento }` |
| GET | `/api/v1/me/inscriptions` | Lista (abajo), más recientes primero |
| GET | `/api/v1/me/inscriptions/:id/credential` | PDF (`attachment; filename="credencial-<evento>-<id>.pdf"`) |

```json
{
  "id": 29,
  "evento": { "codigo": "ciisic-viii-2026", "nombre": "…", "nombreCorto": "VIII CIISIC 2026", "fechaInicio": "2026-10-26", "fechaFin": "2026-10-30", "sede": "…" },
  "tipoInscripcion": { "nombre": "ESTUDIANTES", "etiqueta": "CON KIT", "categoria": "ESTUDIANTES" },
  "clasificacion": { "nombre": "ESTUDIANTE - VI CICLO" },
  "monto": 100, "precioRegular": 120, "descuento": 20,
  "pago": { "modalidad": "billetera", "banco": null, "tipoOperacion": null, "billeteraDigital": "yape", "numeroOperacion": "…", "fechaPago": "2026-09-29" },
  "estado": { "codigo": "PENDIENTE", "nombre": "Pendiente" },
  "motivoRechazo": null,
  "revisadoEn": null,
  "credencial": { "disponible": false, "enviadaEn": null },
  "creadoEn": "…"
}
```

Errores: `401 MISSING_TOKEN|INVALID_TOKEN|SESSION_INVALIDATED`, `403 FORBIDDEN` (token de
administrador), `404 INSCRIPTION_NOT_FOUND` (no es suya), `409 NOT_APPROVED`, `429 RATE_LIMITED`.
