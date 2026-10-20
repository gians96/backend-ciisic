# Plan futuro: cobro de ponencias especializadas

**Estado**: no implementado. Este documento es el punto de partida si alguna ponencia pasa a tener precio.

## Situación actual

- Todas las ponencias de 2026 son **gratuitas**. `PonenciaEspecializada.precio` ya existe (0 = gratuita) y el
  panel y la landing lo muestran.
- La landing **rechaza** inscribirse a una ponencia con `precio > 0` (`422 PAID_TALK_UNAVAILABLE`).
- El staff **sí** puede inscribir (alta manual y puerta) a una ponencia de pago, pero el sistema **no registra
  el cobro**: no hay monto, estado de pago ni comprobante. Es responsabilidad del operador.

## Qué hay que decidir antes de construir

1. **¿Cómo paga la gente?** (a) el mismo flujo del congreso: depósito/billetera con voucher y número de
   operación; (b) pago en puerta o con la organización, sin voucher; (c) una pasarela (Culqi, Niubiz, etc.).
2. **¿El precio es por ponencia o por paquete?** (p. ej. «3 ponencias por S/ 20»). El modelo actual es por ponencia.
3. **¿Hay precio distinto para internos y externos?** Hoy la procedencia es un dato opcional y declarado, no verificado.
4. **Reembolsos y cancelaciones**: ¿se devuelve si el staff cancela o si la ponencia no se dicta?
5. **¿Quién valida los pagos?** El Tesorero ya valida los del congreso (`pagos.ver`, `inscripciones.validar`).

## Diseño propuesto (opción a: voucher, reutilizando lo del congreso)

### Datos

`InscripcionPonencia` agrega (migración aditiva, todo nullable o con valor por defecto):

| Columna | Tipo | Notas |
|---|---|---|
| `monto` | Decimal(10,2) | `precio` de la ponencia **calculado por el servidor** al inscribir; 0 en gratuitas |
| `estadoPago` | enum `NO_APLICA` \| `PENDIENTE` \| `EN_REVISION` \| `PAGADO` \| `RECHAZADO` \| `EXONERADO` | `NO_APLICA` en gratuitas |
| `modalidadPago`, `banco`, `billeteraDigital`, `tipoOperacion`, `numeroOperacion`, `fechaPago` | como `Inscripcion` | la landing los envía |
| `voucherArchivo` | String? | archivo en `uploads/` con las reglas de `Inscripcion` (PDF/JPG/PNG/WebP ≤ 5 MB) |
| `motivoRechazoPago`, `pagoRevisadoPorId`, `pagoRevisadoEn` | | auditoría de la validación |

Las inscripciones existentes quedan en `NO_APLICA` con `monto = 0`.

### Reglas

- Una inscripción **ocupa cupo** desde que está `PENDIENTE` o `EN_REVISION` (evita sobreventa) y lo **libera**
  si el pago se rechaza o vence un plazo (p. ej. 24 h, a decidir) sin comprobante.
- El servidor ignora `monto` y `estadoPago` enviados por el cliente (como en `Inscripcion`).
- Asistencia en puerta: una ponencia de pago solo marca asistencia con `PAGADO` o `EXONERADO`; si no, responde
  `402/409 PAYMENT_PENDING` con el estado y el operador puede cobrar en el acto (marcando `PAGADO` con permiso).
- El «cambio en puerta» (spec 018) **no transfiere** pagos: al cambiar de ponencia con precio distinto, se pide al
  operador resolverlo (cobro de la diferencia o conservar la otra inscripción).

### API

- Sitio: `POST /v1/site/specialized-talk-registrations` pasa a multipart (`datos` JSON + `voucher`), un voucher
  por inscripción de pago; deja de devolver `PAID_TALK_UNAVAILABLE`. `GET /v1/site/specialized-talks` agrega los
  medios de pago del evento (los de `Evento.datosPago`).
- Panel: `PATCH /v1/specialized-talk-registrations/:id/payment` (`{ estadoPago, motivo? }`) y
  `GET /v1/specialized-talk-registrations/:id/voucher`.

### Permisos

- `especializadas.pagos` (por evento): ver montos, estados de pago y vouchers de ponencias; implica `especializadas.ver`.
- `especializadas.validar_pagos` (por evento): aprobar o rechazar; implica `.pagos`. Tesorero los tiene; la
  Comisión no (igual que `pagos.ver` e `inscripciones.validar`).
- Sin `.pagos`, montos y datos de pago salen en `null` (patrón de `pagos.ver`).

### Panel

- Programa: columna de recaudación (pagado / por validar) por ponencia.
- Inscripciones: columnas «Monto» y «Pago» y filtro `estadoPago`; acción «Revisar pago» con el voucher.
- Puerta: aviso ámbar «Pago pendiente» con botón «Marcar pagado» (con permiso).

### Landing

- Formulario con medios de pago y voucher cuando se elige una ponencia de pago; resumen del total; textos de
  «pago en revisión». Reutiliza `medios-pago.ts` y el componente de voucher de `/estudiantes`.

### Migración y despliegue

Migración aditiva; backend primero, luego panel y landing. Las ponencias de pago se publican **después** de
desplegar todo (mientras tanto la landing las rechaza).

## Pruebas necesarias

Cupo con pagos pendientes y vencimiento, rechazo que libera cupo, `monto` calculado por el servidor, permisos
de pagos (el Tesorero ve y valida; la Comisión no), puerta con pago pendiente y el cambio de ponencia con precios distintos.

## Alternativa mínima (opción b)

Solo `estadoPago` (`PENDIENTE`/`PAGADO`/`EXONERADO`) y `monto`, sin voucher: el staff marca «pagado» en el panel o en
puerta. Es la mitad del trabajo y suficiente si se cobra siempre en persona.
