# Despliegue del ecosistema CIISIC (orden recomendado)

Guía para llevar a producción los cambios de las ramas `feat/*` de los seis repositorios.
Cada repositorio tiene su runbook detallado; aquí se fija el **orden** y las **variables**.
Todo despliegue va precedido de un respaldo de su base de datos.

## 0. Antes de empezar

- [x] Ensayo de la migración del congreso con el **respaldo real** de `ciisic_vii` (2026-09-29):
      la imagen Docker migró al arrancar, conteos idénticos, `migrate diff` vacío.
- [ ] En API_UNDC, revisar `_prisma_migrations`: el respaldo del 27-ago tenía
      `20260827170000_sivireno_api_cache_integrations` como **fallida**; si sigue así,
      `prisma migrate deploy` se detendrá al iniciar el contenedor.
- [ ] Credenciales externas vigentes: la API key de Brevo actual responde "API Key is not
      enabled" y el token de Decolecta "Apikey Required / Limit Exceeded" (verificado el
      2026-09-29). Generar una API key nueva en Brevo y un token nuevo (Decolecta o apiperu).

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

Runbook: `specs/001-esquema-bd-espanol/plan.md`. Producción corre hoy
`PIEROLS15/inscripcion-congreso-backend` (VII); la app de Dokploy debe pasar a construir
`gians96/backend-ciisic` (rama `feat/multi-evento-sdd` o `main` tras fusionarla) **en la misma
app**, para conservar el volumen de `/app/uploads` (vouchers).

1. Respaldo: `mysqldump` de `ciisic_vii` (ver runbook).
2. Variables de entorno de la app:

   | Variable | Acción | Valor |
   |---|---|---|
   | `PORT`, `DATABASE_URL` | se mantienen | |
   | `JWT_SECRET` | se mantiene (rotar después) | con menos de 32 caracteres arranca con aviso; al rotarlo las sesiones se cierran |
   | `SECRETS_ENCRYPTION_KEY` | **nueva, obligatoria** | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`; no cambiarla después (cifra las credenciales y firma los tokens de acceso) |
   | `CORS_ORIGINS` | **nueva** | `https://ciisic-viii.episundc.pe` (landing actual; admite `https://*.episundc.pe`) |
   | `BREVO_API_KEY`, `BREVO_SENDER`, `BREVO_SENDER_NAME` | solo el primer arranque | se importan a la BD (Correo) si la tabla está vacía; después se quitan |
   | `DECOLECTA_TOKEN` | solo el primer arranque | se importa al pool de consultas DNI; después se quita |
   | `UNDC_API_URL`, `UNDC_API_KEY` | nuevas (cuando API_UNDC esté desplegada) | `https://api-jp.episundc.pe` y la key del paso 1.3 |
   | `INTEGRATIONS_ALLOWED_HOSTS` | opcional | host de la API de deportes-fi |
   | `NUBETEC_TOKEN`, `API_RENIEC_DNI`, `API_URL`, `BREVO_SENDER_SUBJECT`, `SHADOW_DATABASE_URL` | **se eliminan** | el asunto ahora es por evento; la shadow DB solo se usa en desarrollo |

   `NODE_ENV=production` lo fija la imagen.
3. Desplegar. El contenedor valida la configuración, aplica `prisma migrate deploy`
   (8 migraciones: `paper_submissions` y las 7 nuevas) e inicia. En el log: las migraciones,
   los avisos de importación ("se importó…", "ya no se usa: quítala") y `🚀 Server corriendo`.
4. Probar: `GET /health`, `GET /api/v1/registration-types` (legacy: 4 tipos del VIII) y
   `prisma/preflight/conteos-despues.sql` (11 administradores, 308 inscripciones, 585 asistencias,
   2 eventos).
5. Quitar del entorno las variables importadas y las obsoletas; redeplegar (sin migraciones pendientes).
6. Los administradores existentes conservan su contraseña; deben volver a iniciar sesión.
7. La landing **actual** sigue funcionando con las rutas legacy (evento principal = VIII) hasta
   que se publique la nueva; entonces `LEGACY_ROUTES_ENABLED=false` y se quita `CORS_ORIGINS`.

## 4. administrator-ciisic-frontend (ramas `main` + `feat/panel-admin`)

1. Nueva app en Dokploy con el `Dockerfile` del repo, detrás de HTTPS (la cookie es `Secure`),
   p. ej. `admin-ciisic.episundc.pe`.
2. Variables: `NUXT_BACKEND_BASE_URL` (URL interna o pública del backend, sin `/api/v1`),
   `NUXT_SESSION_MAX_AGE=3600`, `NUXT_PUBLIC_LANDING_URL`.
3. En el panel (SuperAdmin):
   - **Correo** → revisar la credencial importada; **reemplazar la API key** por una vigente,
     **Probar** (cuenta y créditos) y **Enviar prueba**.
   - **Consultas DNI** → reemplazar el token de Decolecta o agregar uno de apiperu (límite,
     renovación, prioridad) y **Probar**.
   - **Eventos → VIII CIISIC 2026 → Acceso** → **Generar token** para la landing (se muestra una vez).
   - **Eventos → VIII CIISIC 2026 → Integraciones** → URL de la API de deportes-fi y token del
     paso 2.2; **Probar**.
   - Revisar **Datos de pago** y **Categorías y tipos** del VIII.

## 5. ciisic-undc-web (rama `feat/multi-evento-sdd`)

1. Variables: `NUXT_BACKEND_BASE_URL` (backend, solo servidor), `NUXT_BACKEND_EVENT_TOKEN`
   (token de acceso del paso 4.3, **solo servidor**), `NUXT_PUBLIC_ADMIN_URL`.
   Se eliminan `NUXT_X_API_TOKEN`, `NUXT_X_API_URL` y `NUXT_PUBLIC_API_BASE_URL`.
2. Desplegar y hacer una inscripción de prueba completa (DNI, verificación, voucher) y
   aprobarla en el panel.
3. En el backend: `LEGACY_ROUTES_ENABLED=false` y quitar `CORS_ORIGINS`.
4. La rama de producción documentada era `rama-beni`: su commit `1297af2 update hero` no
   está en `main` y choca en `Landing2026.vue`; decidir qué versión del hero se publica.

## 6. Después del lanzamiento

- Retirar las rutas legacy del backend (spec 002, T021) cuando no haya tráfico hacia ellas.
- Rotar las credenciales compartidas por chat: contraseña de la BD, `JWT_SECRET`, Brevo y
  Decolecta; el token de NubeTec ya no se usa (su endpoint responde 404).
