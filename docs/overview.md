# Visión general

backend-ciisic es la API del Congreso Internacional de Ingeniería de Sistemas e Investigación
Científica (CIISIC) de la UNDC. Gestiona **varios eventos** (ediciones del congreso u otros
eventos de la Facultad) con sus inscripciones, credenciales, asistencia, ponencias y mensajes.

- **Stack**: Node 22 · Express 5 · TypeScript · Prisma 6 · MySQL 8 · yup · Jest · Puppeteer (PDF).
- **Consumidores**: el panel (`administrator-ciisic-frontend`, administradores e inscritos) y la
  landing de cada evento (`ciisic-undc-web`).
- **Dependencias externas**: API_UNDC (verificación de estudiantes), deportes-fi (Semana
  Sistémica), Decolecta/apiperu (consultas DNI), Brevo (correo), Google (inicio de sesión).

## Módulos (`src/api/<módulo>`)

| Módulo | Qué hace | Spec |
|---|---|---|
| `event` | Eventos (ediciones), estado, evento principal, resumen | 002 |
| `registration-type` | Categorías y tipos de inscripción por evento | 002 |
| `inscription` | Inscripciones: creación (sitio y legacy), revisión, credencial PDF, correo, CSV | 002 |
| `activity` | Actividades y asistencia (hora de Lima) | 002 |
| `participant` | Participantes (identidad por tipo y número de documento) | 002 |
| `papers`, `contact` | Ponencias y mensajes de contacto por evento | 002 |
| `document-lookup` | Consulta DNI con pool de tokens rotativo, caché y bitácora | 003 |
| `student-verification` | Verificación de estudiantes UNDC contra API_UNDC; token firmado | 004 |
| `integration` | Integraciones por evento (deportes-fi) y resumen Semana Sistémica | 005 |
| `email-credential` | Credenciales de correo (Brevo) cifradas, por evento | 006 |
| `access-token` | Tokens de acceso del sitio de cada evento | 007 |
| `system-settings` | Configuración del sistema (API_UNDC, Google, URL del panel, rutas legacy) | 008 |
| `google-auth` | Acceso con Google (panel) y verificación de correo (landing) | 010 |
| `participant-portal` | Portal del inscrito: sus inscripciones y su credencial | 011 |
| `admin`, `catalog` | Administradores, sesión, catálogos | 001–002 |

## Flujos principales

1. **Inscripción** (landing → `POST /api/v1/site/inscriptions`): el evento sale del token de
   acceso; el servidor valida el tipo, reutiliza al participante por documento, calcula el
   precio (precio UNDC solo con un token de verificación de estudiante válido) y crea la
   inscripción en `PENDIENTE` con el voucher. Si llega un `verificacionCorreoToken` (Google),
   guarda la evidencia sin cambiar el precio.
2. **Revisión** (panel): un administrador aprueba o rechaza (motivo obligatorio). Al aprobar se
   genera la credencial PDF (`uploads/credenciales/<evento>/<id>-<huella>.pdf`, con el código de
   credencial en el QR; spec 014) y se envía el correo con
   la credencial de correo del evento (o la predeterminada); si falla, la aprobación se mantiene
   y el panel permite reenviar.
3. **Consulta DNI**: caché de 30 días; si no hay, recorre los tokens por prioridad (Decolecta,
   apiperu), marca agotados/inválidos y pasa al siguiente; sin tokens → 503 y la landing permite
   escribir los nombres.
4. **Verificación de estudiante**: con el correo `<código>@undc.edu.pe` y los nombres oficiales
   (RENIEC), API_UNDC confirma si es estudiante activo y si la identidad coincide; el backend
   firma un token de 24 h que la inscripción exige para aplicar el precio UNDC.
5. **Google**: el panel canjea el ID token en `POST /api/v1/auth/google` (admin activo o
   inscrito); la landing lo usa opcionalmente para verificar el correo.
6. **Portal del inscrito**: con sesión de participante ve sus inscripciones y descarga su
   credencial aprobada.

## Datos históricos

La migración multi-evento asignó los datos existentes al **VII CIISIC 2025** (FINALIZADO) y creó
el **VIII CIISIC 2026** como evento principal con copia de categorías y tipos (spec 002).
