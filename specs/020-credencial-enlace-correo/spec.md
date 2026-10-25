# Feature Specification: Credencial en el correo con enlace a la landing

**Created**: 2026-10-25 · **Status**: Implementado

**Input**: el correo de aprobación adjuntaba la credencial PDF personalizada y la landing servía
`/credencial` como demostración (datos de prueba y selector). Se quiere el enfoque contrario: el
correo adjunta un **PDF genérico del evento** (información del congreso, sin datos personales) y
trae un **enlace especial** a la credencial 3D con datos reales; la página demo de `/credencial`
deja de existir y el inscrito puede editar el aspecto de su credencial.

## User Scenarios & Testing

### User Story 1 - Aprobada, recibo el enlace y veo mi credencial (Priority: P1)

1. **Given** mi inscripción pasa a `APROBADO`, **When** llega el correo de aprobación, **Then**
   trae el informe del evento adjunto y un botón con el enlace
   `<landing>/credencial/<codigoCredencial>`.
2. **Given** abro ese enlace, **Then** la landing consulta el backend con su token y muestra la
   credencial 3D con mi nombre, mi clasificación o tipo y el QR de mi código —los mismos datos
   que se imprimen en el PDF—, sin modo demo ni selector.
3. **Given** abro la página `/credencial` sin código, **Then** no hay datos de prueba: la landing
   ofrece solo el punto de entrada esperado (la ruta con el código).
4. **Given** veo mi credencial, **When** abro el menú (3 puntos) y elijo «Editar», **Then** puedo
   agregar o quitar tecnologías y ajustar el aspecto, y lo que elijo queda guardado en mi
   dispositivo para la próxima visita.

### User Story 2 - La organización configura la URL de la landing (Priority: P2)

1. **Given** soy Owner, **When** guardo la URL de la landing en Sistema (o la envío a
   `PUT /v1/settings`), **Then** se guarda como origen (`https://dominio`, sin ruta), se lee al
   instante en el correo y no aparece en la configuración pública.

### User Story 3 - Privacidad y robustez (Priority: P1)

1. **Given** alguien adivina o prueba códigos contra el endpoint, **Then** solo responde datos de
   inscripciones `APROBADAS` **del evento de su token**; el código mal formado responde
   `422 INVALID_CODE` y el inexistente o de otro evento `404 CREDENTIAL_NOT_FOUND`.
2. **Given** la respuesta, **Then** no incluye documento, correo, celular, montos ni operación, y
   viene con `Cache-Control: no-store`.
3. **Given** el informe se genera una vez por evento, **Then** no vuelve a imprimirse mientras no
   cambie lo impreso; un fallo al generar el informe no impide que el correo salga (sin adjunto,
   con el enlace).

## Requirements

- **FR-001**: `configuracion_sistema` gana `url_landing` (columna nullable, migración aditiva).
  Se guarda normalizada a **origen** y se sirve con la misma caché de 30 s que el resto
  (`obtenerConfiguracion()`); **no** es pública: `configuracionPublica()` (panel sin sesión y
  `GET /v1/site/config`) no la incluye.
- **FR-002**: `enviarCorreoAprobacion(inscripcion)` (firma nueva, sin `pdfPath`) adjunta el
  informe del evento en lugar de la credencial personalizada y añade el botón
  `<a href="<urlLanding>/credencial/<codigo>">` (HTML crudo vía `{{ACCION}}`). Sin `urlLanding`
  el correo sale igual, sin botón; si el informe no se genera, sale sin adjunto
  (mejor esfuerzo, con `console.error`). El asunto, el remitente y la plantilla no cambian.
- **FR-003**: el informe genérico es un PDF A4 **retrato** por evento en
  `uploads/credenciales/<evento>/informe-<huella>.pdf`: solo datos del evento (nombre, fechas,
  sede, contacto, logo, año), con huella sobre lo impreso (versión de plantilla incluida),
  reutilizado mientras no cambie y con los archivos de otra huella borrados. Comparte la cola de
  puppeteer (2 navegadores, 30 en espera) y su `enCurso` deduplica pedidos simultáneos.
  `borrarCredenciales` no lo toca (patrón `<id>[-huella].pdf`).
- **FR-004**: `GET /api/v1/site/credential/:codigo` con `requireTokenEvento` +
  `limiteLecturaPublica` + `limiteTokenLectura`: valida el formato (`[0-9A-Z]{10}`) y busca
  `codigoCredencial` **+ `eventoId` del token** + estado `APROBADO`. Respuesta `200` con
  `{ nombres, apellidos, codigo, clasificacion, tipo: { nombre, etiqueta } | null, evento: {
  nombre, nombreCorto } }` y `Cache-Control: no-store`; `422 INVALID_CODE`,
  `404 CREDENTIAL_NOT_FOUND`.
- **FR-005**: aprobar y reenviar siguen generando la credencial personalizada (la descarga del
  panel y el portal del participante la usan): solo cambia **qué se adjunta al correo**.
- **FR-006**: el lado de la landing (BFF `GET /api/publico/credencial/:codigo`, página
  `/credencial/:codigo` con edición local en localStorage, retiro del demo, copy del correo) se
  implementa en `ciisic-undc-web` contra `contracts/api-credencial.md`.

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde (sin regresiones).
- **SC-002**: la respuesta pública no contiene campos sensibles y es `no-store`; el endpoint solo
  responde inscripciones aprobadas del evento del token.
- **SC-003**: el correo de aprobación no incluye la credencial personalizada; el botón apunta al
  código correcto y el informe adjunto no lleva datos de personas.
- **SC-004**: contrato en `contracts/api-credencial.md`, ruta agregada al contrato de la API del
  sitio (spec 007) y a `docs/arquitectura-ecosistema.md` (contrato 3); `url_landing` documentada
  en `docs/configuracion.md`.
