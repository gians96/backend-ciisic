# Contrato — Resumen por persona de las ponencias especializadas (spec 031)

Continúa [`030-ponencias-validacion-congreso`](../../030-ponencias-validacion-congreso/contracts/api-ponencias-validacion-congreso.md).
Todas las rutas son del panel (sesión de staff) y están bajo `/api`. Respuestas `{ success, data, meta? }`; errores `{ success: false, code, message, fields? }`.

## `GET /v1/events/:eventId/specialized-talk-attendees` — `especializadas.ver`

Una fila por persona con inscripciones vigentes. Query: `situacion` (`APROBADO` | `PAGO_PENDIENTE` | `RECHAZADO` | `NO_INSCRITO`), `puede` (`si` | `no`),
`validacion` (`si` | `no`), `modo` (`PRESENCIAL` | `VIRTUAL`, el del congreso), `aviso` (`si` | `no`), `q` (documento, nombre, correo o celular), `page`, `pageSize`
(20 por defecto, máx. 100). Un valor inválido es `400 INVALID_FILTER`.

```json
{
  "success": true,
  "data": [{
    "asistenteId": 12,
    "asistente": { "id": 12, "tipoDocumento": "dni", "numeroDocumento": "12345678", "nombres": "Ana", "apellidos": "Pérez", "correo": "ana@gmail.com", "celular": "987654321", "procedencia": null },
    "ponencias": 2, "asistencias": 0, "validada": false, "avisadoEn": null,
    "situacion": "NO_INSCRITO", "congreso": null, "puede": false
  }],
  "meta": {
    "page": 1, "pageSize": 20, "total": 40, "accesoLibre": false,
    "resumen": { "personas": 40, "inscripciones": 61, "pueden": 20, "noPueden": 20, "porSituacion": { "APROBADO": 20, "PAGO_PENDIENTE": 1, "RECHAZADO": 0, "NO_INSCRITO": 19 }, "sinValidar": 20, "avisadas": 0 }
  }
}
```

- `congreso`: `null` si no tiene inscripción al evento; si no, `{ estado, tipo, categoria, modo }` (`estado`: código de la inscripción al congreso).
- `puede`: acceso libre o `APROBADO`. `validada`: todas sus inscripciones vigentes se validaron al registrarse. `avisadoEn`: último comunicado enviado.
- `meta.resumen` son los totales de **todo** el evento (no dependen de los filtros). Orden: no inscritos, rechazados, pago pendiente y aprobados; luego apellido.

## `GET /v1/events/:eventId/specialized-talk-attendees/export` — `especializadas.ver`

Los mismos filtros; devuelve un `.xlsx` (hojas «Resumen» y «Personas»), `Cache-Control: no-store`. Límite por cuenta: 20 por minuto.

## `POST /v1/events/:eventId/specialized-talk-attendees/cancel` — `especializadas.inscribir`

Cuerpo `{ asistenteIds: number[1..100], notificar?: boolean, asunto?: string(≤150), mensaje?: string(≤3000) }`; con `notificar`, asunto y mensaje son obligatorios.
Cancela todas las inscripciones vigentes **sin asistencia** de cada persona que hoy no puede asistir (motivo `SIN_CONGRESO`).

```json
{ "success": true, "data": {
  "personas": 3, "inscripciones": 4,
  "omitidas": [{ "asistenteId": 8, "motivo": "PUEDE_ASISTIR" }, { "asistenteId": 9, "motivo": "YA_ASISTIO" }, { "asistenteId": 99, "motivo": "NO_ENCONTRADA" }],
  "avisos": { "enviados": 2, "sinCorreo": 1, "fallidos": 0, "sinCredencial": false }
} }
```

`avisos` es `null` sin `notificar`. Errores: `409 FREE_ACCESS_ENABLED` (con el acceso libre todas pueden), `422 VALIDATION_ERROR`. Un correo que falla no revierte la cancelación.
Límite por cuenta: 10 envíos cada 15 minutos (compartido con `notify`).

## `POST /v1/events/:eventId/specialized-talk-attendees/notify` — `especializadas.inscribir`

Cuerpo `{ asistenteIds: number[1..100], asunto: string, mensaje: string }`. Envía el comunicado **sin cancelar** a quien hoy no puede asistir.
Respuesta `{ personas, omitidas, avisos }`. Errores: `409 FREE_ACCESS_ENABLED`, `409 EMAIL_CREDENTIAL_UNAVAILABLE` (no hay credencial de correo activa),
`404 ATTENDEES_NOT_FOUND` (nadie necesita el aviso), `422 VALIDATION_ERROR`.

## Comunicado

El mensaje se escapa como texto (nada de HTML). Las líneas en blanco separan párrafos y `{nombre}` se reemplaza por el primer nombre de cada persona. El correo sale
con la credencial del evento (o la predeterminada) y lleva el nombre del evento y su correo de contacto. Quien lo recibe queda con `avisoEnviadoEn`.

## Compatibilidad

Cambio aditivo: rutas nuevas, un valor nuevo del enum de motivos de cancelación (`SIN_CONGRESO`, que el panel anterior muestra como el motivo desconocido) y una columna
nula. Backend primero.
