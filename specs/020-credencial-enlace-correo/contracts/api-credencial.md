# Contrato — Credencial por código para la landing (spec 020)

Fuente del enlace del correo de aprobación: **`<urlLanding>/credencial/<codigoCredencial>`**, donde
`urlLanding` es el origen configurado en el panel (Sistema) y `codigoCredencial` son los 10
caracteres `[0-9A-Z]` del QR. La landing resuelve esa ruta con su BFF contra este endpoint.

## Backend — `GET /api/v1/site/credential/:codigo`

Base `/api/v1/site`. Cabeceras igual que el resto de la API del sitio (spec 007):
`X-Api-Key` (token del evento, obligatorio) y `X-Client-Ip` (recomendada desde el BFF).
Límites: lectura por visitante (120/min) y por token (3000/min). La caché va en `no-store`.

### Respuesta `200`

```json
{
  "success": true,
  "data": {
    "nombres": "Ana",
    "apellidos": "Pérez",
    "codigo": "K7Q2M9X4TB",
    "clasificacion": null,
    "tipo": { "nombre": "General", "etiqueta": "CON KIT" },
    "evento": { "nombre": "VIII Congreso …", "nombreCorto": "VIII CIISIC 2026" }
  }
}
```

- Es **exactamente** lo que se imprime en la credencial (nombre, tipo o clasificación, código y
  evento): nada de documento, correo, celular, montos ni operación.
- `clasificacion` es el nombre de la clasificación del estudiante o `null`; `tipo` es el tipo de
  inscripción o `null`. Quien compone la vista (la landing) usa
  `clasificacion || tipo?.nombre || 'Asistente'` para el «rol» de la credencial.

### Selección y errores

El código se busca **solo** entre inscripciones del evento del token con estado `APROBADO`:

| Caso | Status | `code` |
|---|---|---|
| Código con formato inválido (no `[0-9A-Z]{10}`) | 422 | `INVALID_CODE` |
| Inexistente, de otro evento o sin aprobar | 404 | `CREDENTIAL_NOT_FOUND` |
| Sin cabecera `X-Api-Key` | 401 | `EVENT_TOKEN_REQUIRED` |
| Token inválido, revocado o expirado | 401 | `INVALID_EVENT_TOKEN` |
| Límite de visitante o de token | 429 | `RATE_LIMITED` (`Retry-After`) |

## BFF de la landing — `GET /api/publico/credencial/:codigo`

Patrón de `server/api/publico/consulta-dni/[numero].get.ts`: valida
`^[0-9A-Z]{10}$` → `422 INVALID_CODE` (respuesta propia del BFF) y luego llama al endpoint
anterior con `responderSitio` (`Cache-Control: no-store`, `404 CREDENTIAL_NOT_FOUND` si el
backend responde 404). Sin cookies ni sesión: el enlace basta.

## Correo de aprobación

- Adjunto: **informe genérico del evento** `informacion-<evento>.pdf` (A4 retrato, solo datos del
  evento, generado una vez por evento en `uploads/credenciales/<evento>/informe-<huella>.pdf`).
  Si no se puede generar, el correo sale sin adjunto.
- Botón «Ver mi credencial» con el enlace anterior; si el panel no tiene `urlLanding`
  configurada, el correo sale **sin botón** (el resto igual).

## Configuración

`urlLanding` vive en `configuracion_sistema` (fila única), se guarda como origen
(`https://dominio`) con `PUT /api/v1/settings` y no es pública: no aparece en
`GET /api/v1/site/config` ni en la configuración sin sesión del panel.
