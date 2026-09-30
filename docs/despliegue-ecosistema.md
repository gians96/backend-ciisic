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
- [ ] Client ID de Google (paso 4.2) si se usará el acceso con Google.

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
app**, para conservar el volumen de `/app/uploads` (vouchers, credenciales, ponencias y QR de pago).

1. Respaldo: `mysqldump` de `ciisic_vii` (ver runbook).
2. Variables de entorno de la app (spec 008: **solo dos**):

   | Variable | Acción | Valor |
   |---|---|---|
   | `DATABASE_URL` | se mantiene | |
   | `JWT_SECRET` | se mantiene; **mejor rotarlo antes del primer arranque** (el actual se compartió por chat) | ≥ 32 caracteres aleatorios (con menos arranca con aviso). De él se deriva la clave que cifra las credenciales: si se rota después, hay que volver a guardarlas en el panel |
   | `PORT` | opcional | 3000 |
   | `BREVO_API_KEY`, `BREVO_SENDER`, `BREVO_SENDER_NAME`, `DECOLECTA_TOKEN` | solo el primer arranque | se importan a la BD (Correo, Consultas DNI) si las tablas están vacías; después se quitan |
   | todo lo demás (`NUBETEC_TOKEN`, `API_RENIEC_DNI`, `API_URL`, `BREVO_SENDER_SUBJECT`, `SHADOW_DATABASE_URL`, `CORS_ORIGINS`, …) | **se elimina** | el log avisa de cada variable que sobre |

   `NODE_ENV=production` lo fija la imagen. CORS está abierto (spec 009): ya no hay lista de orígenes.
3. Desplegar. El contenedor valida la configuración, aplica `prisma migrate deploy`
   (10 migraciones: `paper_submissions` y las 9 nuevas) e inicia. En el log: las migraciones,
   los avisos de importación ("se importó…", "ya no se usa: quítala") y `🚀 Server corriendo`.
4. Probar: `GET /health`, `GET /api/v1/registration-types` (legacy: 4 tipos del VIII) y
   `prisma/preflight/conteos-despues.sql` (11 administradores, 308 inscripciones, 585 asistencias,
   2 eventos).
5. Quitar del entorno las variables importadas y las obsoletas; redeplegar.
6. Los administradores existentes conservan su contraseña; deben volver a iniciar sesión.
7. La landing **actual** sigue funcionando con las rutas legacy (evento principal = VIII) hasta
   que se publique la nueva; entonces se desactivan en el panel → Sistema → Landing anterior.

## 4. administrator-ciisic-frontend (ramas `main` + `feat/panel-admin`)

1. Nueva app en Dokploy con el `Dockerfile` del repo, detrás de HTTPS (la cookie es `Secure`),
   p. ej. `admin-ciisic.episundc.pe`. Variable única: `NUXT_BACKEND_BASE_URL` (URL del backend
   sin `/api/v1`; preferible la interna de Docker para que los límites de login usen la IP real).
2. Google Cloud (una vez, spec 010): pantalla de consentimiento *External* en estado
   *In production* (scopes `openid email profile`) y credencial "ID de cliente de OAuth" tipo
   **Aplicación web** con **orígenes JavaScript autorizados**: el panel, cada landing y, para
   desarrollo, `http://localhost`, `http://localhost:3000` y `http://localhost:3001`. No se
   necesitan URIs de redirección ni secreto.
3. En el panel (SuperAdmin):
   - **Sistema** → API UNDC (URL `https://api-jp.episundc.pe`, API key del paso 1.3, **Probar**),
     Google (client ID del paso 2), URL del panel y, cuando la landing nueva esté publicada,
     desactivar **Landing anterior**.
   - **Correo** → revisar la credencial importada; **reemplazar la API key** por una vigente,
     **Probar** (cuenta y créditos) y **Enviar prueba**.
   - **Consultas DNI** → reemplazar el token de Decolecta o agregar uno de apiperu y **Probar**.
   - **Eventos → VIII CIISIC 2026 → Acceso** → **Generar token** para la landing (se muestra una vez).
   - **Eventos → VIII CIISIC 2026 → Integraciones** → URL de la API de deportes-fi y token del
     paso 2.2; **Probar**.
   - Revisar **Datos de pago** y **Categorías y tipos** del VIII.
4. Los inscritos entran con la cuenta Google de su correo de inscripción y ven "Mis inscripciones".

## 5. ciisic-undc-web (rama `feat/multi-evento-sdd`)

1. Variables: `NUXT_BACKEND_BASE_URL` (backend, solo servidor) y `NUXT_BACKEND_EVENT_TOKEN`
   (token de acceso del paso 4.3, **solo servidor**). El client ID de Google y la URL del panel
   se leen del backend (Sistema). Se eliminan `NUXT_X_API_TOKEN`, `NUXT_X_API_URL`,
   `NUXT_PUBLIC_API_BASE_URL` y `NUXT_PUBLIC_ADMIN_URL`.
2. Agregar el dominio de la landing a los orígenes autorizados del client ID de Google.
3. Desplegar y hacer una inscripción de prueba completa (DNI, Google opcional, verificación,
   voucher), aprobarla en el panel y verla desde "Mis inscripciones".
4. Panel → Sistema → desactivar **Landing anterior**.
5. La rama de producción documentada era `rama-beni`: su commit `1297af2 update hero` no
   está en `main` y choca en `Landing2026.vue`; decidir qué versión del hero se publica.

## 6. Después del lanzamiento

- Retirar las rutas legacy del backend (spec 002, T021) cuando no haya tráfico hacia ellas.
- Rotar las credenciales compartidas por chat: contraseña de la BD, `JWT_SECRET` (si no se
  rotó antes del primer arranque: después hay que volver a guardar las credenciales), Brevo y
  Decolecta; el token de NubeTec ya no se usa (su endpoint responde 404).
