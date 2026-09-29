# Implementation Plan: Plataforma multi-evento

**Branch**: `feat/multi-evento-sdd` | **Spec**: [spec.md](spec.md) | **Contratos**: [api-publica](contracts/api-publica.md), [api-admin](contracts/api-admin.md)

## Summary

Se introduce `Evento` (edición) como raíz de los datos de negocio, se reescriben los módulos
para trabajar por evento, se separa la API pública (`/api/v1/public/*`, por código de evento)
de la administrativa, y se mantienen alias legacy contra el evento principal para desplegar
el backend antes que la nueva landing. Se corrigen las fallas de seguridad detectadas.

## Migración `20260929120100_multi_evento`

- Crea `eventos` e inserta **VIII CIISIC 2026** (id 1, `es_principal = true`, datos de pago
  de la landing actual).
- Backfill `evento_id = 1` en `categorias_inscripcion`, `inscripciones`, `actividades`,
  `ponencias` y `mensajes_contacto`; agrega `codigo`/`es_estudiantil`/`orden` a categorías,
  `orden` y `codigo` obligatorio a tipos, columnas de revisión a inscripciones, `leido` a
  mensajes y `activo` a administradores.
- `UNIQUE(evento_id, participante_id)` en inscripciones y `UNIQUE(evento_id, codigo)` en categorías.

## Módulos (`src/api/*`)

| Módulo | Responsabilidad |
|---|---|
| `event` | CRUD de eventos, copia de configuración, resumen (KPIs), lectura pública por código |
| `registration-type` | Categorías y tipos por evento (admin), lista pública, alias legacy |
| `inscription` | Creación pública/legacy, listado paginado, detalle, cambio de estado, credencial, voucher, CSV |
| `activity` | Actividades (ex `Evento`) y asistencia por evento; alias legacy `/attendances` |
| `participant` | Consulta y corrección de participantes |
| `papers`, `contact` | Por evento + alias legacy |
| `admin` | Login (roles por código, admins inactivos), CRUD de administradores sin valores por defecto |
| `catalog` | Clasificaciones, tipos de documento, estados, roles; stubs legacy vacíos |

Infraestructura nueva en `src/core`: `HttpError`, paginación, fechas en hora de Lima,
`renderTemplate` con escape, códigos de catálogos. `errorHandler` normaliza `HttpError`,
errores de yup, multer y Prisma (P2002/P2003/P2025). Express 5 propaga errores async.

## Decisiones

- **Precio**: función pura `calcularPrecio` (`services/pricing.ts`) con pruebas.
- **Identidad**: participante único por `(tipo_documento_id, numero_documento)`; el correo
  sigue siendo único (409 si pertenece a otra persona).
- **Nombres**: si el DNI está en `personas_consultadas` (spec 003) se usan esos nombres.
- **Fecha de pago**: se guarda como fecha (medianoche UTC) y se muestra como `YYYY-MM-DD`.
- **Credenciales**: `uploads/credenciales/<codigo-evento>/<id>.pdf`; Puppeteer sin acceso
  de red (solo `data:`); QR = id del participante (compatible con asistencia).
- **Legacy**: `POST /v1/inscription` conserva la regla de precio por dominio (la landing
  anterior ya mostró ese precio) e ignora `estadoId`, `pago`, `descuento` y `file` en JSON.

## Verificación

- 90 pruebas Jest (núcleo, precios, inscripción, seguridad de rutas y uploads, eventos,
  ponencias…), `tsc` y ESLint en verde.
- Prueba de humo contra la BD sintética migrada: evento público, tipos, login, resumen,
  inscripción pública y legacy (`estadoId=2` → `PENDIENTE`), duplicado (409), fecha futura
  (422), rechazo sin motivo (422), voucher, CSV y actividades.
