# Implementation Plan: Configuración del sistema en la BD

**Spec**: [spec.md](spec.md) | **Contrato**: [contracts/api-configuracion.md](contracts/api-configuracion.md)

## Archivos

| Archivo | Rol |
|---|---|
| `prisma/migrations/20260930120000_configuracion_sistema` | Tabla de fila única + `CHECK` + fila 1 |
| `src/core/configuracion-sistema.ts` | `obtenerConfiguracion` (caché 30 s), `configuracionUndc`, `configuracionPublica`, `establecerConfiguracion` |
| `src/core/url-saliente.ts` | `validarUrlSaliente`, `asegurarDestinoPublico` (DNS + `net.BlockList`) |
| `src/core/almacenamiento.ts` | Carpeta `uploads` y límite de vouchers |
| `src/api/system-settings/*` | GET/PUT `/v1/settings`, prueba de API_UNDC, configuración pública |
| `src/api/student-verification/services/undc-client.ts` | Usa la configuración de la BD, `redirect: 'error'` |
| `src/middlewares/legacy.ts` | Interruptor desde la configuración |
| `src/database/importarSecretosLegados.ts` | Importación única desde el entorno y avisos |
| `src/database/bootstrapAdmin.ts` | Argumentos de línea de comandos |
| `config/env.ts` | Solo `DATABASE_URL`, `JWT_SECRET`, `PORT`; la clave de los secretos se deriva de `JWT_SECRET` (enmienda 2026-09-30) |

## Pruebas

`tests/system-settings/configuracion.test.ts` (acceso SuperAdmin, cifrado y máscara, key
write-only, validaciones, caché, prueba de API_UNDC con `fetch` simulado, configuración
pública), `tests/core/seguridad.test.ts` (URLs internas, DNS), `tests/database/importar-secretos.test.ts`
(importación de `UNDC_API_*`, Google y legacy) y `tests/student-verification/verification.test.ts`
(configuración desde la BD, sin configuración no llama).
