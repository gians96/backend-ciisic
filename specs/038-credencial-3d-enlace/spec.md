# Feature Specification: Credencial 3D con enlace y tecnologías editables

**Created**: 2026-10-25 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: Jeff dejó en las ramas `Jeff` (backend) y `Requisitos_Jeff` (landing) una credencial vertical 3D, al estilo del ticket de la
miduConf, que cada inscrito abre con un enlace y en la que **elige las tecnologías** que usa. El usuario pidió probarla, que se pueda
**enviar por correo a los inscritos presenciales** (spec 039) y que se vea minimalista pero moderna.

> **Numeración**: es la spec **038** del backend. Landing = spec 013 (la página `/credencial/:codigo`); panel = spec 029 (campo «URL de la landing»
> y envío masivo). El spec que Jeff numeró 020 choca con la 020 de main (`virtual-sin-estudiantes-undc`), por eso se renumera. Su rama traía además
> el «informe genérico» en PDF, una copia vieja de delegaciones y los auspiciadores: **no se incorporan** (ver Decisiones).

## Decisiones

- **El enlace es `<landing>/credencial/<codigoCredencial>`**: el código (10 caracteres `[0-9A-Z]`, el mismo del QR impreso) es la llave. Solo responde
  inscripciones **APROBADAS del evento del token** (`GET /v1/site/credential/:codigo`); el resto es `404 CREDENTIAL_NOT_FOUND` y un código mal formado,
  `422 INVALID_CODE` sin consultar la BD.
- **Qué devuelve**: lo que se imprime (nombres, apellidos, clasificación o tipo, evento) y `tecnologias`. **Nunca** documento, correo, celular, montos ni
  número de operación; siempre `Cache-Control: no-store`.
- **Las tecnologías se guardan en el servidor** (decisión del usuario; Jeff las guardaba solo en el navegador): columna JSON
  `inscripciones.tecnologias_credencial` (lista de ids, en orden; la primera define el color de la credencial). `POST /v1/site/credential/:codigo/technologies`
  `{ tecnologias }`: hasta **8**, únicas, cada id con la forma `^[a-z0-9][a-z0-9-]{0,29}$`. El **catálogo** de tecnologías vive en la landing: el backend solo
  valida la forma, y un id que la landing ya no conozca se ignora al mostrarlo. La landing usa POST porque su BFF solo reenvía GET y POST.
- **Límites**: `limiteEdicionCredencial` (120 cada 15 min por visitante) y `limiteTokenEdicionCredencial` (1500 cada 15 min por token); la lectura usa los de
  lectura pública. El código solo se adivina con ~2^51 intentos y la respuesta es de baja sensibilidad; quien vea el QR impreso de otra persona puede abrir
  su credencial y cambiar sus tecnologías (riesgo aceptado).
- **La URL de la landing** se configura en Sistema (`configuracion_sistema.url_landing`, solo el origen, igual que `url_panel`; **no** sale en la configuración
  pública). De ella salen los enlaces del correo y del envío masivo. Sin URL, nada se envía con enlace (el correo de aprobación sale como siempre).
- **Correo de aprobación** (decisión del usuario): **conserva** el PDF de la credencial personal adjunto y el distintivo «Credencial adjunta», y **suma** un
  botón «Ver mi credencial 3D» con el enlace (fila `{{FILA_CREDENCIAL_3D}}` de `approval.html`, vacía si no hay landing o código). No se adopta el «informe genérico»
  de Jeff (otro PDF con Puppeteer en cada aprobación).

## Requisitos

- **FR-001**: `GET /v1/site/credential/:codigo` con `requireTokenEvento`, `limiteLecturaPublica` y `limiteTokenLectura`.
- **FR-002**: `POST /v1/site/credential/:codigo/technologies` con `requireTokenEvento`, `limiteEdicionCredencial`, `limiteTokenEdicionCredencial` y `validateBody`.
- **FR-003**: migración aditiva `20261028120000_credencial_3d_y_envios` (columnas NULL: `url_landing` y `tecnologias_credencial`, más las dos marcas de la spec 039).
- **FR-004**: `urlLanding` en Sistema (`GET|PUT /v1/settings`): se guarda normalizada a origen (https; http solo en localhost) y se lee con la misma caché de 30 s.
- **FR-005**: `enviarCorreoAprobacion(inscripcion, pdfPath)` mantiene su firma y el PDF; agrega la fila del enlace con `urlCredencial()` (`core/enlaces-landing.ts`).

## Fuera de alcance

- El informe genérico en PDF de Jeff, el cambio de los textos de la landing sobre el correo de aprobación y los auspiciadores.
- Editar el nombre, el rol u otros datos personales desde la credencial; descargar la credencial como imagen.
- El portal del participante y su fotocheck (spec 014), que siguen igual.
