# Configuración

Principio (spec 008): el entorno solo lleva lo que no puede vivir en la base de datos. Todo lo
demás se configura en el panel o es una constante del código.

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `DATABASE_URL` | sí | Conexión a MySQL |
| `JWT_SECRET` | sí (≥ 16; se recomiendan ≥ 32) | Firma de sesiones y, derivada de él, la clave que cifra los secretos guardados en la BD. Rotarlo cierra las sesiones y obliga a volver a guardar las credenciales en el panel (los tokens de acceso de las landings siguen sirviendo) |
| `PORT` | no (3000) | Puerto HTTP |
| `SHADOW_DATABASE_URL` | solo desarrollo | BD temporal para `prisma migrate dev` |
| `PUPPETEER_EXECUTABLE_PATH` | solo desarrollo local | Chrome para generar PDF (la imagen Docker trae Chromium) |

`NODE_ENV=production` lo fija la imagen. Al arrancar, el backend avisa en el log de cada
variable antigua que sobre y **importa una sola vez** las que tienen equivalente en la BD
(`DECOLECTA_TOKEN`, `BREVO_*`, `UNDC_API_*`, `GOOGLE_CLIENT_ID`, `LEGACY_ROUTES_ENABLED`).

## Configuración en el panel (SuperAdmin)

| Pantalla | Qué se configura | Tabla |
|---|---|---|
| **Sistema** | API_UNDC (URL, API key, timeout, **Probar**), client ID de Google, URL del panel, interruptor "Landing anterior" (rutas legacy) | `configuracion_sistema` (fila única, caché de 30 s) |
| **Correo** | Credenciales de Brevo (API key cifrada, remitente, predeterminada, prueba de cuenta, correo de prueba) | `credenciales_correo` |
| **Consultas DNI** | Tokens de Decolecta/apiperu (límite, renovación, prioridad, prueba) | `tokens_consulta` |
| **Eventos → Acceso** | Tokens de acceso de la landing del evento (se muestran una vez) | `tokens_acceso` |
| **Eventos → Integraciones** | URL y token de deportes-fi | `integraciones_evento` |
| **Eventos → General** | Datos del evento, remitente/asunto del correo, credencial de correo del evento | `eventos` |

Las API keys y tokens se guardan cifrados (AES-256-GCM) y la API solo devuelve `••••` + 4
caracteres. Las URLs salientes (API_UNDC, deportes-fi) se validan contra SSRF: https y, en
producción, nunca destinos internos.

## Google (una vez)

1. Google Cloud → pantalla de consentimiento OAuth: *External*, estado *In production*, scopes
   `openid email profile`.
2. Credencial "ID de cliente de OAuth" tipo **Aplicación web** con **orígenes JavaScript
   autorizados**: el dominio del panel, el de cada landing y, para desarrollo,
   `http://localhost`, `http://localhost:3000` y `http://localhost:3001`. No hace falta URI de
   redirección ni secreto.
3. Pegar el client ID en el panel → Sistema.

Reglas fijas del dominio institucional (código, no configuración): `undc.edu.pe`; parte local
numérica de 8–12 dígitos = estudiante; otra parte local = personal (docente o administrativo).

## Constantes

| Constante | Valor | Dónde |
|---|---|---|
| Caché de consultas DNI | 30 días | `src/api/document-lookup/services/cache.ts` |
| Timeout de proveedores DNI | 8 s | `src/api/document-lookup/services/lookup.ts` |
| Timeout de deportes-fi | 10 s | `src/api/integration/services/sports-client.ts` |
| API de Brevo / timeout | `https://api.brevo.com/v3` / 15 s | `src/api/email-credential/services/brevo-client.ts` |
| Vigencia de los tokens de verificación | 24 h | `verification-token.ts`, `verificacion-correo.ts` |
| Sesiones | Staff 1 h (renovable hasta 12 h); participante 12 h | `src/core/sesiones.ts` |
| Carpeta de archivos / voucher máximo | `<cwd>/uploads` / 5 MB | `src/core/almacenamiento.ts` |
| QR de las billeteras / máximo | `<cwd>/uploads/qr` / 2 MB (PNG, JPG o WebP) | `src/core/almacenamiento.ts` |
| Fotos del fotocheck / máximo | `<cwd>/uploads/fotos` / 2 MB y 4096 px por lado (PNG o JPG) | `src/core/almacenamiento.ts`, `src/core/imagenes.ts` |
| Credenciales PDF | `<cwd>/uploads/credenciales/<evento>/<id>-<huella>.pdf`; 2 a la vez, 30 en cola, 30 s por paso de puppeteer | `src/api/inscription/utils/generatePdf.ts` |
| Código de acceso por correo | 10 min de vida; topes por correo, IP y globales | `src/api/participant-auth/services/participant-auth.ts` |
| Límites por visitante y por token | ver `src/middlewares/rate-limit.ts` | |
