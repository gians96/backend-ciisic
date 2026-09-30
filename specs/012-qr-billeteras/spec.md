# Feature Specification: Imagen del QR de las billeteras de pago

**Feature Branch**: `feat/multi-evento-sdd` · **Created**: 2026-09-30 · **Status**: Implementado

**Input**: "¿Por qué no puedo subir el QR? o la imagen, guardarlo en uploads, también que permita
que sea arrastrable" (panel → Eventos → VIII → Datos de pago: el QR solo aceptaba una URL).

## User Scenarios & Testing

### User Story 1 - Subir el QR desde el panel (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una billetera en Datos de pago, **When** arrastro una imagen PNG, JPG o WebP (o hago
   clic para elegirla), **Then** se sube, veo la vista previa y, al guardar los datos de pago,
   queda publicada.
2. Un PDF, un SVG o un archivo cuyo contenido no es la imagen declarada → `422`; más de 2 MB → `413`.
3. Al reemplazar o quitar el QR y guardar, la imagen anterior se borra de `uploads/qr` (salvo que
   otro evento la siga usando).

### User Story 2 - La landing muestra el QR subido (Priority: P1)

**Acceptance Scenarios**:

1. **Given** una billetera con `qrArchivo`, **When** el visitante abre el QR en el paso de pago,
   **Then** la landing lo pide a su BFF (`/api/publico/qr/:archivo`) y este al backend con el
   token del evento.
2. La API del sitio solo entrega los QR que usa el evento del token.

## Requirements

- **FR-001**: `POST /api/v1/payment-qr` (Admin): multipart `file`; PNG, JPG o WebP de hasta 2 MB,
  validados por su firma (primeros bytes); se guarda como `uploads/qr/qr-<uuid>.<ext>` y responde
  `{ archivo }`.
- **FR-002**: `datosPago.billeteras[].qrArchivo` tiene prioridad sobre `qrUrl` (que se conserva
  para URLs externas o de la landing). Al guardar, cada `qrArchivo` debe existir: si no,
  `422 QR_NOT_FOUND`.
- **FR-003**: Tras guardar los datos de pago o eliminar un evento se borran los QR que dejó de
  usar, salvo que otro evento los use (al copiar un evento se comparten).
- **FR-004**: `GET /api/v1/payment-qr/:archivo` (Admin, vista previa del panel) y
  `GET /api/v1/site/payment-qr/:archivo` (token del evento; solo los QR de su evento). Caché
  `immutable`: un nombre nunca se reutiliza.
- **FR-005**: Los nombres los genera el servidor (`qr-<uuid>.<png|jpg|webp>`); cualquier otro
  nombre → `404` sin tocar el disco.

## Success Criteria

- **SC-001**: Sin variables de entorno nuevas; los archivos viven en el volumen `/app/uploads`.
- **SC-002**: El token del evento nunca llega al navegador: la landing sirve la imagen desde su BFF.
