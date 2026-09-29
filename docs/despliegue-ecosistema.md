# Despliegue del ecosistema CIISIC (orden recomendado)

Guía para llevar a producción los cambios de las ramas `feat/*` de los seis repositorios.
Cada repositorio tiene su runbook detallado; aquí se fija el **orden** y las **variables**.
Todo despliegue va precedido de un respaldo de su base de datos.

## 0. Antes de empezar

- [ ] Ensayar la migración del congreso con el **dump real** de `ciisic_vii` en un MySQL 8
      local (`specs/001-esquema-bd-espanol/plan.md`, pasos 2–5).
- [ ] En API_UNDC, revisar `_prisma_migrations`: el respaldo del 27-ago tenía
      `20260827170000_sivireno_api_cache_integrations` como **fallida**; si sigue así,
      `prisma migrate deploy` se detendrá al iniciar el contenedor.
- [ ] Acordar una ventana corta para el backend del congreso (≈10 min).

## 1. API_UNDC (rama `feat/clientes-api`)

1. Desplegar la imagen: el contenedor ejecuta `prisma migrate deploy` al iniciar y crea
   `api_cliente` (migración `20260929161358_clientes_api`).
2. Sin variables nuevas (`INTEGRATION_SECRET_KEY` se usa como pepper de las API keys).
3. Crear el cliente del congreso: app-web-sigenet → Configuraciones → Integraciones →
   **Clientes API** → "Backend CIISIC", scope `estudiantes:verificar`. Copiar la key
   (se muestra una sola vez).
4. Desplegar **app-web-sigenet** (`feat/clientes-api`) para tener la pestaña anterior.

> Nota: `/usuario` ahora exige sesión (y rol admin para crear/editar/borrar).

## 2. deportes-fi (ramas `feat/tokens-evento`)

1. Backend: definir `API_TOKEN_PEPPER` (32 bytes aleatorios) y aplicar la migración
   `20260929150000_event_api_tokens` según `docs/runbook-tokens-evento.md` (opción A
   `migrate deploy` u opción B `db push`, por el drift existente). Luego desplegar la imagen.
2. Frontend: desplegar; en Admin → Eventos → **Tokens API** generar un token para el
   evento deportivo de la Semana Sistémica. Copiarlo (se muestra una sola vez).

## 3. backend-ciisic (rama `feat/multi-evento-sdd`)

Runbook completo: `specs/001-esquema-bd-espanol/plan.md`.

1. Detener el backend, `mysqldump` de `ciisic_vii`, ejecutar
   `prisma/preflight/verificar-esquema.sql` (bloqueantes en 0).
2. `npx prisma migrate deploy` (aplica `paper_submissions` si faltaba y las 5 migraciones
   nuevas), luego `prisma/preflight/conteos-despues.sql`.
3. Variables nuevas:

   | Variable | Valor |
   |---|---|
   | `SECRETS_ENCRYPTION_KEY` | **obligatoria**: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `UNDC_API_URL` | `https://api-jp.episundc.pe` |
   | `UNDC_API_KEY` | key del paso 1.3 |
   | `INTEGRATIONS_ALLOWED_HOSTS` | host de la API de deportes-fi (p. ej. `api.deportes-fi.undc.edu.pe`) |
   | `CORS_ORIGINS` | incluir el dominio de la landing (p. ej. `https://ciisic-viii.episundc.pe`) |
   | `BREVO_SENDER_NAME` | opcional: ahora se toma del evento (`remitente_nombre`) |

   Se eliminan: `RENIEC_PROVIDER`, `RENIEC_TOKEN`, `API_RENIEC_DNI`, `NUBETEC_TOKEN`,
   `DECOLECTA_TOKEN`, `API_URL`.
4. Iniciar la nueva imagen y probar: `GET /health`,
   `GET /api/v1/public/events/ciisic-viii-2026`, `GET /api/v1/registration-types` (legacy).
5. Los administradores existentes conservan su contraseña; deben volver a iniciar sesión
   (el JWT ahora lleva el código de rol).
6. La landing **actual** sigue funcionando: las rutas legacy apuntan al evento principal.

## 4. administrator-ciisic-frontend (ramas `main` + `feat/panel-admin`)

1. Nueva app en Dokploy con el `Dockerfile` del repo, detrás de HTTPS (la cookie es `Secure`),
   p. ej. `admin-ciisic.episundc.pe`.
2. Variables: `NUXT_BACKEND_BASE_URL` (URL interna o pública del backend, sin `/api/v1`),
   `NUXT_SESSION_MAX_AGE=3600`, `NUXT_PUBLIC_LANDING_URL`.
3. En el panel:
   - **Consultas DNI** → registrar los tokens de Decolecta y apiperu (límite, renovación, prioridad).
   - **Eventos → VIII CIISIC 2026 → Integraciones** → pegar la URL de la API de deportes-fi
     y el token del paso 2.2; **Probar**.
   - Revisar **Datos de pago** y **Categorías y tipos**.

## 5. ciisic-undc-web (rama `feat/multi-evento-sdd`)

1. Variables: `NUXT_PUBLIC_EVENTO_CODIGO=ciisic-viii-2026`, `NUXT_PUBLIC_API_BASE_URL`,
   `NUXT_BACKEND_BASE_URL` (lecturas SSR cacheadas), `NUXT_PUBLIC_ADMIN_URL`.
   Se eliminan `NUXT_X_API_TOKEN` y `NUXT_X_API_URL`.
2. Desplegar y hacer una inscripción de prueba completa (DNI, verificación, voucher) y
   aprobarla en el panel.
3. La rama de producción documentada era `rama-beni`: su commit `1297af2 update hero` no
   está en `main` y choca en `Landing2026.vue`; decidir qué versión del hero se publica.

## 6. Después del lanzamiento

- Retirar las rutas legacy del backend (spec 002, T021) cuando no haya tráfico hacia ellas.
- Rotar/retirar el token de NubeTec que usaba la landing anterior.
