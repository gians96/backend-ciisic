# Contrato — Verificación de estudiante (API pública)

`POST /api/v1/public/events/:codigo/student-verification` (20/min por IP)

Request:

```json
{ "correo": "2020123456@undc.edu.pe", "tipoDocumento": "dni", "numeroDocumento": "12345678" }
```

Response `200`:

```json
{
  "success": true,
  "data": {
    "esEstudianteUndc": true,
    "codigoEstudiante": "2020123456",
    "motivo": null,
    "verificacionToken": "eyJhbGciOiJIUzI1NiIs…"
  }
}
```

`motivo` cuando no se verifica: `CORREO_NO_INSTITUCIONAL`, `DOCUMENTO_NO_SOPORTADO`,
`NO_ES_ESTUDIANTE`, `EGRESADO`, `IDENTIDAD_NO_COINCIDE`, `SIN_DATOS_IDENTIDAD`,
`SERVICIO_NO_DISPONIBLE` (en esos casos `verificacionToken` es `null`).

Uso: enviar `verificacionToken` como campo del `POST …/inscriptions`. Si falta, expiró o no
corresponde al mismo evento, documento y correo, se cobra el precio regular.

Mensajes sugeridos para la landing:

| motivo | Mensaje |
|---|---|
| `null` (verificado) | "Estudiante UNDC verificado ✓ — se aplica el precio UNDC." |
| `CORREO_NO_INSTITUCIONAL` | "Para el precio UNDC usa tu correo institucional @undc.edu.pe." |
| `IDENTIDAD_NO_COINCIDE` | "El correo institucional no corresponde al DNI ingresado." |
| `NO_ES_ESTUDIANTE` / `EGRESADO` | "No encontramos una matrícula UNDC vigente; puedes inscribirte a precio regular." |
| `SERVICIO_NO_DISPONIBLE` / `SIN_DATOS_IDENTIDAD` | "No pudimos verificarte ahora; puedes continuar a precio regular o intentarlo más tarde." |
