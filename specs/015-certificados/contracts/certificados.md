# Contrato · Certificados (spec 015, fase 1)

Todas bajo `/api`. Éxito `{ success, data, meta? }`; error `{ success: false, code, message, fields? }`.

## Staff

| Método | Ruta | Permiso | Cuerpo / query | Respuesta |
|---|---|---|---|---|
| GET | `/v1/events/:eventId/certificates` | `certificados.ver` (E) | `situacion=FALTA_PDF\|POR_ENTREGAR\|ENTREGADO\|ANULADO`, `q`, `sinInscripcion=true`, `page`, `pageSize` | filas `{id,codigo,tipo,estado,situacion,nombre,documento,correo,celular,participanteId,conInscripcion,observacion,tieneArchivo,firmasDetectadas,bytesArchivo,subidoEn,enviadoEn,envioError,anuladoEn,motivoAnulacion,creadoEn}`; `meta.resumen {total,faltaPdf,porEntregar,entregados,anulados,sinInscripcion,pagadosSinCertificado}` (del evento entero). Filtro inválido → 422 |
| GET | `/v1/events/:eventId/certificates/ids` | `certificados.ver` | mismos filtros | `data: number[]` (≤ 5000) |
| GET | `/v1/events/:eventId/certificates/pending-inscriptions` | `certificados.ver` | `q`, `page` | `{inscripcionId,participanteId,nombre,documento,correo,tipoInscripcion}` |
| POST | `/v1/events/:eventId/certificates/import?simular=true` | `certificados.gestionar` (G) | multipart `file` (.xlsx ≤ 5 MB) | `{simulado, resumen{total,crear,actualizar,sinCambios,errores,sinInscripcion,personasNuevas}, filas[{fila,documento,nombre,codigo,tipo,resultado: CREAR\|CREADO\|ACTUALIZAR\|ACTUALIZADO\|SIN_CAMBIOS\|ERROR,conInscripcion,personaNueva,mensaje}]}`. 422 `CERTIFICATE_COLUMNS_MISSING`, `IMPORT_EMPTY`, `IMPORT_TOO_LARGE`, `INVALID_FILE_CONTENT` |
| POST | `/v1/events/:eventId/certificates/files` | `certificados.operar` (E) | multipart `files[]` (≤ 10 PDF, ≤ 10 MB c/u), `reemplazar=true` | `{resumen, detalle[{archivo,codigo,resultado,certificadoId,nombre,firmas}]}` |
| GET | `/v1/events/:eventId/certificates/:id` | `certificados.ver` | | una fila |
| GET · PUT | `/v1/events/:eventId/certificates/:id/file` | ver · operar | PUT: multipart `file` | GET: `application/pdf` inline (404 `CERTIFICATE_FILE_NOT_FOUND`); PUT: la fila (409 `CERTIFICATE_ANNULLED`, `CERTIFICATE_CHANGED`) |
| POST | `/v1/events/:eventId/certificates/send` | `certificados.operar` | `{ids[≤100], reenviar}` | `{enviados,yaEnviados,noElegibles,fallidos,porCredencial?,agotado?}`. 409 `PANEL_URL_MISSING`, `EMAIL_CREDENTIAL_UNAVAILABLE`, `EMAIL_CREDITS_EXHAUSTED` |
| POST | `/v1/events/:eventId/certificates/:id/test` | `certificados.operar` | `{correo}` | `{enviado:true}`. 409 `CERTIFICATE_NOT_READY`; 502 `EMAIL_SEND_FAILED` |
| POST | `/v1/events/:eventId/certificates/:id/annul` | `certificados.gestionar` | `{motivo}` (5–500) | la fila. 409 `CERTIFICATE_ALREADY_ANNULLED` |

## Públicas (sin sesión)

| Método | Ruta | Límite | Respuesta |
|---|---|---|---|
| POST | `/v1/public/certificates/lookup` | `limiteIntentosDni` (fallos) + 30/min por IP | `{documento}` → `{titular, certificados[{codigo,tipo,titular,evento{nombre,nombreCorto,fechaInicio,fechaFin},emitidoEn}]}` de todos los eventos; 404 `CERTIFICATE_NOT_FOUND` |
| GET | `/v1/public/certificates/:codigo` | 30/min por IP | un certificado (misma forma) |
| GET | `/v1/public/certificates/:codigo/file?descargar=true` | 30/min por IP | `application/pdf` (inline o adjunto) |

## Portal

| Método | Ruta | Respuesta |
|---|---|---|
| GET | `/v1/me/certificates` | `[{id,codigoImpreso,evento{nombre,nombreCorto},tipo,estado:'FIRMADO',fechaEmision,horas:null,descargable:true}]` |
| GET | `/v1/me/certificates/:id/file` | `application/pdf` adjunto |

## Panel (BFF, sin sesión)

- `POST /api/publico/certificados/consulta` `{documento}` → lookup (IP en `x-forwarded-for`).
- `GET /api/publico/certificados/:codigo` y `/:codigo/archivo?descargar=true`.
- Páginas `/consulta-certificados` y `/certificado/<código>`; enlaces del correo: `<url_panel>/certificado/<código>` y `<url_panel>/consulta-certificados`.
