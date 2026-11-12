# Spec 015 · Certificados — fase 1: certificados firmados fuera del sistema

> El diseño completo (plantillas PDF, estampado con pdf-lib, ciclo EN_FIRMA, verificación por hash) está en
> [`research.md`](research.md) y queda para una **fase 2**. Esta fase cubre lo que necesita el VIII CIISIC 2026:
> los certificados ya se generaron y firmaron fuera del sistema.

## Problema

La organización tiene:

1. Un Excel: `N° | DNI | Nombres | Apellidos | Tipo | Correo | Telefono | Codigo | Obs | Obs`. El `Codigo` (p. ej.
   `WBVTYDJEKq`) es alfanumérico y **distingue mayúsculas**.
2. Los PDF firmados digitalmente, nombrados `<Codigo>[R][R][R].pdf` (cada firma agrega `[R]`).

Necesita cargarlos, saber en qué está cada certificado, enviarlos por correo y que cada persona los consulte con su
DNI (de todos los eventos) o con un enlace directo.

## Historias

- **Importar** (`certificados.gestionar`, global): sube el Excel, ve una simulación y confirma. Cada fila se empareja
  por DNI (con y sin el cero que Excel se come). Quien no existe se crea con los datos del Excel; queda «sin
  inscripción pagada» si no tiene una inscripción `APROBADO` en el evento. Nunca se modifican datos de una persona
  existente; un correo que ya usa otra persona deja la fila con error. Reimportar es idempotente.
- **Subir PDF** (`certificados.operar`, por evento): elige muchos PDF; cada uno se asocia por el código de su nombre.
  Resultado por archivo: `ASOCIADO`, `REEMPLAZADO`, `YA_TENIA`, `TIENE_OTRO` (sin `reemplazar`), `NO_ENCONTRADO`,
  `ANULADO`, `NOMBRE_INVALIDO`, `NO_ES_PDF`, `DUPLICADO`. También se puede subir uno a mano.
- **Ver el estado** (`certificados.ver`): Falta PDF firmado · Listo para entregar · Entregado (con fecha) · Anulado,
  insignia «Sin inscripción pagada» y la lista de inscritos aprobados que no vinieron en el Excel.
- **Enviar por correo** (`certificados.operar`): a los elegidos (o a todos los listos), en tandas de 25 desde el panel.
  Correo con el PDF adjunto, el enlace al certificado y el de la consulta por DNI. Reserva de la marca `enviado_en`
  con `UPDATE` condicionado; si falla se revierte y se guarda el motivo. «Enviarme una prueba» no marca nada.
- **Anular** (`certificados.gestionar`): con motivo; deja de salir en lo público y en el portal.
- **Consulta pública por DNI** (`/consulta-certificados` del panel): lista + ver + descargar de **todos los eventos**.
- **Enlace directo** (`/certificado/<código>` del panel): datos sin documento + visor del PDF + descargar.
- **Portal del inscrito**: `GET /v1/me/certificates` y `/:id/file` con sus certificados listos.

## Reglas

- Solo los certificados `LISTO` (con PDF) salen en lo público y en el portal. Lo demás responde el mismo
  `404 CERTIFICATE_NOT_FOUND`; un código mal formado no consulta la BD.
- Las respuestas públicas **no** incluyen documento, correo ni celular; son `no-store` y `noindex`.
- La consulta por DNI va en el cuerpo (nunca en la URL) y topa los intentos fallidos por IP (`limiteIntentosDni`).
- El código distingue mayúsculas: la columna `certificados.codigo` usa `utf8mb4_bin`.
- Los PDF se guardan en `uploads/certificados/<eventoId>/cert-<uuid>.pdf` (nombre del servidor, escritura atómica).
- Los enlaces del correo salen de `configuracion_sistema.url_panel` (Sistema); sin ella, `409 PANEL_URL_MISSING`.
- Un certificado vigente por persona, tipo y evento (`clave_vigente`).

## Contrato

Ver [`contracts/certificados.md`](contracts/certificados.md).
