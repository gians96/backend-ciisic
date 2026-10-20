# Contrato — Tipos que no admiten estudiantes UNDC

Todo es **aditivo**: ningún campo existente cambia ni se quita. `excluyeEstudiantesUndc` ausente, `null` o
distinto de `true` significa «admite estudiantes» (comportamiento anterior). Los consumidores deben ignorar
los campos que no conozcan.

## Quién es «estudiante UNDC» para esta regla

Quien cumple **una** de estas condiciones, evaluadas con el correo con que queda la inscripción (el
registrado si se conserva, como en la spec 016):

1. Tiene un `verificacionToken` de estudiante válido y positivo (SIVIRENO, spec 004), solo en la categoría
   estudiantil (y en la ruta legacy, que verifica en el momento).
2. Su correo es `<código>@<dominioInstitucional del evento>` con el código de **8 a 12 dígitos**.

Docentes y administrativos (`garias@undc.edu.pe`) y externos no son estudiantes. Un estudiante que usa un
correo no institucional no se detecta (limitación conocida de la spec 016).

## API del sitio (token del evento)

### GET `/api/v1/site/registration-types`

Cada tipo agrega `excluyeEstudiantesUndc` (booleano):

```json
{
  "id": 16, "codigo": "general_virtual", "etiqueta": "VIRTUAL", "precio": 50, "precioInstitucional": 50,
  "disponiblePara": "TODOS", "modalidad": "VIRTUAL", "excluyeEstudiantesUndc": true
}
```

La landing oculta el tipo a quien es estudiante UNDC (verificado o con correo de estudiante); si falta el
campo, no oculta nada.

### POST `/api/v1/site/inscriptions` (y legacy `POST /api/v1/inscription`)

Mismo error que la spec 016, con otro mensaje: `422 REGISTRATION_TYPE_NOT_AVAILABLE`

> «Este tipo de inscripción no está disponible para estudiantes de la UNDC. Elige un plan presencial.»

No se crea el participante ni la inscripción; el voucher subido se borra. Aplica también a quien se
reinscribe tras un rechazo o una cancelación (spec 017). Las cortesías (staff) no lo aplican.

## API administrativa (`eventos.configurar`)

- `POST /api/v1/registration-categories/:id/types`: `excluyeEstudiantesUndc?` (sin él, `false`).
- `PUT /api/v1/registration-types/:id`: `excluyeEstudiantesUndc?` (sin él, se conserva).
- Un valor no booleano (o `null`) → `422 VALIDATION_ERROR` con `fields.excluyeEstudiantesUndc`.
- `GET /api/v1/events/:eventId/registration-categories`: cada tipo trae `excluyeEstudiantesUndc`, también
  para cuentas sin `pagos.ver` (no es un precio).
- Crear un evento copiando otro (`copiarDeEventoId`) copia el interruptor de cada tipo.
- `GET /api/v1/registration-types` (legacy) no cambia.

## Datos en producción

Los enciende el dueño del proyecto (panel o `prisma/preflight/excluir-estudiantes-undc-virtual.sql`), no el
código. En el evento `ciisic-viii-2026`: `estudiantes_virtual` y `general_virtual` → `true`. Las
inscripciones ya hechas no cambian.

## Compatibilidad

- Backend nuevo + frontends viejos: el campo extra se ignora; el plan virtual sigue visible y el backend
  rechaza al estudiante con el `422`.
- Frontends nuevos + backend viejo: sin errores, pero el backend anterior descarta en silencio el campo que
  envía el panel y no aplica la regla; por eso el backend se despliega primero.
