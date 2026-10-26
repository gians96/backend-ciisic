# Feature Specification: Código del QR y enlace de la credencial 3D en el CSV de inscripciones

**Created**: 2026-10-26 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: el usuario quiere que el CSV de `admin-ciisic.episundc.pe/inscripciones` traiga el **QR que se genera al inscribirse**, para trabajar con él fuera
del panel (fotochecks, combinación de correspondencia, controles en la puerta).

> **Cambia una regla de la spec 014**: el código de la credencial ya **no** queda fuera del CSV. Sigue fuera de los listados y las búsquedas.

## Decisiones

- **Qué va**: dos columnas al final del CSV (no se mueve ninguna de las existentes):
  - **«Código QR»**: `codigo_credencial` (10 caracteres `[0-9A-Z]`), que es **exactamente** lo que codifica el QR del fotocheck y del PDF. Con él, cualquier
    herramienta genera el mismo QR. Vacío si la inscripción todavía no tiene código (las antiguas sin aprobar; la app lo completa al aprobar).
  - **«Credencial 3D»**: `<landing>/credencial/<código>` (spec 038, `urlCredencial`) **solo en las inscripciones `APROBADO`**, porque la landing no abre las demás
    (`404 CREDENTIAL_NOT_FOUND`). Vacío sin `url_landing` en Sistema.
- **Quién**: todo el que exporta (`inscripciones.exportar`), **también sin `pagos.ver`** (Tesorero y Comisión). Las columnas no son de pago. Decisión del usuario,
  consciente del riesgo de abajo.
- **Siempre presentes**: no hay casilla ni parámetro para pedirlas.
- El QR anterior (id del participante, `es_qr_legado`) no se exporta: la columna trae siempre el código vigente.

## Riesgo aceptado

Con el código cualquiera puede rehacer el QR de otra persona y presentarlo en el escáner (asistencia, entrega del kit) o abrir y editar las tecnologías de su
credencial 3D. Desde esta spec el código lo tiene **quien tenga el CSV**: hay que tratar el archivo como una credencial (no reenviarlo ni dejarlo en carpetas
compartidas). Si un CSV se filtra, la solución es regenerar los códigos de las inscripciones afectadas (no hay una ruta para eso todavía).

## Requisitos

- **FR-001**: `GET /v1/events/:eventId/inscriptions/export` agrega al final las columnas «Código QR» y «Credencial 3D», con y sin `pagos.ver`.
- **FR-002**: «Credencial 3D» solo lleva el enlace si la inscripción está `APROBADO`, tiene código válido y hay `url_landing`; si no, la celda va vacía.
- **FR-003**: los listados (`GET …/inscriptions`) y la búsqueda siguen **sin** el código.

## Fuera de alcance

- La imagen del QR dentro del archivo (un CSV no lleva imágenes).
- Un permiso aparte o una casilla «Incluir QR» en el panel.
- Regenerar el código de una inscripción.
