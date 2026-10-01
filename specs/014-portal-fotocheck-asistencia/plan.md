# Implementation Plan: Portal del participante, fotocheck virtual y asistencia por QR

**Spec**: [spec.md](spec.md) | **Contratos**: [acceso con código](contracts/api-acceso-codigo.md) · [portal v2](contracts/api-portal.md) · [asistencia, credencial y staff](contracts/api-asistencia.md) | **Diseño**: [research.md](research.md)

- Núcleo:
  - `src/core/codigos.ts`: código de acceso (`REGEX_CODIGO_ACCESO`, `nuevoCodigoAcceso`,
    `hashCodigoAcceso` HMAC con clave `sha256('codigos-acceso:' + JWT_SECRET)`, `compararHash`,
    `normalizarCorreo`), código de la credencial (`REGEX_CODIGO_CREDENCIAL`,
    `nuevoCodigoCredencial`, `conReintentoDeCodigo` (3 intentos ante el P2002 del índice),
    `asegurarCodigoCredencial`) y `enmascararCorreo`.
  - `src/core/concurrencia.ts`: `limitarConcurrencia(max = 2, cola = 30)` → `503 PDF_BUSY`.
  - `src/core/imagenes.ts`: `tipoDeImagen` y mapas MIME (salen de `payment-qr`) y
    `limpiarMetadatos`.
  - `src/core/almacenamiento.ts`: `DIRECTORIO_FOTOS`, `MAX_BYTES_FOTO`, `REGEX_ARCHIVO_FOTO`,
    `nuevoNombreFoto`, `rutaFoto`.
  - `src/core/sesiones.ts`: `SESION_PARTICIPANTE_SEGUNDOS` (12 h), `MetodoSesion` con `CODIGO`,
    `firmarSesionParticipante(p, metodo = 'GOOGLE')`.
  - `src/core/configuracion-sistema.ts`: `configuracionPanel` (pública + `accesoCodigo`).
- `src/middlewares/rate-limit.ts`: `limiteLoginGoogle`, `limiteSolicitudCodigo`,
  `limiteVerificacionCodigo`, `limiteFotoPortal` (por participante) y `limiteSwitch` (por cuenta).
- Esquema y migración `20261001120000_portal_fotocheck`: `codigos_acceso`; `participantes`
  (`foto_archivo`, `foto_actualizada_en`); `inscripciones` (`codigo_credencial` con relleno
  `RANDOM_BYTES`, regeneración de repetidos, `es_qr_legado` e índice único al final).
  `prisma/preflight/verificar-014.sql`, `completar-014.sql` y `revertir-014.sql`.
- `src/api/participant-auth/` (nuevo): `code`, `code/verify`, `switch`; plantilla
  `templates/codigo-acceso.html` (el `Dockerfile` debe copiarla).
- `src/api/email-credential`: `credencialUtilizable` (predeterminada activa, con 15 min de espera
  tras un error).
- `src/api/system-settings`: `/v1/auth/config` con `accesoCodigo`; `/v1/site/config` igual.
- `src/api/google-auth/routes`: `limiteLoginGoogle`.
- `src/api/participant-portal`: perfil ampliado, `PATCH /me/profile`, foto (`upload.ts` en memoria,
  `files: 1`, `fields: 1`, `parts: 2`), `/badge`, `/attendances`, `fotocheck.disponible`.
- `src/api/inscription`:
  - Creación (sitio y legacy) con `codigoCredencial` y `conReintentoDeCodigo`; correo conservado y
    aviso (`correo-conservado.html`); `aCreada` / `aLegacyCreada` con `correoConservado`.
  - `archivoCredencial`, reenvío y aprobación aseguran el código (antes de aprobar, para no marcar
    la aprobación nueva como QR anterior); `PDF_BUSY` no tumba la aprobación; borrar una
    inscripción borra todas sus versiones de PDF.
  - `generatePdf.ts`: `VERSION_PLANTILLA = 2`, `huellaCredencial`, `rutaCredencial`
    (`uploads/credenciales/<evento>/<id>-<huella>.pdf`), `borrarCredenciales`, QR del código,
    foto, escritura atómica y semáforo. Plantilla `inscription.html` con código y foto.
  - `GET /v1/inscriptions/:id/photo`, cortesía (`crearInscripcionCortesia`) y prefijo
    `CORTESIA-` reservado. `aDetalle` con `codigoCredencial` y `esQrLegado`.
  - `sendEmail.ts`: `enDiferido` (nunca deja una promesa rechazada sin manejar), avisos de correo
    conservado y de correo cambiado (`correo-actualizado.html`).
- `src/api/participant`: `POST /v1/participants` (consulta DNI `PANEL`) y aviso y registro al
  cambiar el correo.
- `src/api/activity`: identificador único (`codigo` | `numeroDocumento` | `participanteId`),
  métodos `QR`/`QR_LEGADO`/`DOCUMENTO`/`MANUAL`, regla del QR anterior (también en las legacy),
  `MANUAL_NOT_ALLOWED`, `TOLERANCIA_ANTES_MINUTOS = 30`, respuesta con `alerta`, foto e inscripción.
- Panel (spec 009 del panel): login con código, portal (fotocheck, asistencia, perfil con foto),
  escáner con cámara, lector USB y DNI, cambio al portal. Landing: aviso de `correoConservado`.

## Pruebas

- `tests/core/{codigos,concurrencia,imagenes,sesiones}.test.ts`: formato y HMAC, reintento ante
  colisión, semáforo y cola, firmas y limpieza de metadatos, sesión de 12 h.
- `tests/participant-auth/codigo.test.ts`: 202 idéntico (existe, no existe, con Google), solo el
  hash, envío diferido sin datos personales en el registro, espera y topes, 503 sin credencial y
  recuperación, 12 h y `metodo: 'CODIGO'`, penúltimo código, 5.º fallo, `CODE_LOCKED`, disyuntor,
  código usado, correo solo de staff, `/v1/auth/config` frente a `/v1/site/config`.
- `tests/participant-auth/cambio-perfil.test.ts`: Google → portal, contraseña → 409, cuenta
  inactiva, `GOOGLE_ACCOUNT_MISMATCH`, token de participante → 403.
- `tests/participant-portal/{portal,perfil-foto,fotocheck-asistencia}.test.ts`: perfil, celular,
  foto PNG/JPEG sin metadatos, texto disfrazado, tipo cruzado, 2 MB, consentimiento, conflicto y
  reintento, borrado de la foto y de los PDF, `/badge` ajeno 404 y no aprobado 409, código y QR,
  documento enmascarado, código asignado con la marca del QR anterior, asistencia agrupada sin
  anuladas, token de staff 403.
- `tests/inscription/{credencial,correo-conservado,avisos-correo,cortesia,foto}.test.ts`: QR del
  código, huella, borrado de versiones, `PDF_BUSY`, reintento; correo conservado (sitio y legacy),
  verificación válida, avisos; cortesía; foto del escáner por alcance.
- `tests/participant/alta-y-correo.test.ts`: alta con DNI simulado, nombres de respaldo,
  `PARTICIPANT_EXISTS`, `EMAIL_IN_USE`, aviso y registro del cambio de correo.
- `tests/activity/asistencia.test.ts`: código (minúsculas y salto de línea del lector), otro
  evento, inexistente, mal formado, identificador único, método declarado ignorado, QR anterior
  aceptado y rechazado (también legacy), `MANUAL` con y sin permiso, tolerancia de 30 min.
- Pendiente (archivos de seguridad transversal): `tests/security/matriz-rutas.test.ts` con las 12
  rutas nuevas (129 en total) y `tests/system-settings/configuracion.test.ts` con `accesoCodigo`.
