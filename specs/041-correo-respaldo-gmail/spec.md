# Feature Specification: Respaldo entre credenciales de correo y envío por el SMTP de Gmail

**Created**: 2026-10-26 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: el plan gratuito de Brevo da 300 envíos al día y, tras los envíos masivos (spec 039), el congreso se quedó sin poder enviar. El usuario quiere
(1) varias credenciales **por prioridad**, de modo que cuando una se agote se use la siguiente, y (2) poder enviar **directo por el SMTP de Gmail**, por SSL y con
una contraseña de aplicación.

> Amplía la spec 006 (credenciales de correo). No cambia los correos ni las plantillas: solo **con qué cuenta** salen.

## Decisiones

- **Dos proveedores** (`proveedor`): `BREVO` (API, como hasta ahora) y `GMAIL_SMTP` (nuevo). Una credencial de Gmail guarda en `api_key_cifrada` la **contraseña de aplicación** de
  Google (16 letras, cifrada igual que la API key) y su **remitente es la cuenta de Gmail**: es el usuario del SMTP y Gmail no deja firmar con otra dirección. Sirve también para
  una cuenta de Google Workspace (`@undc.edu.pe`).
- **Servidor fijo**: `smtp.gmail.com`, puerto 465, SSL. No hay host configurable (sería una salida de red abierta) ni variables de entorno nuevas.
- **Prioridad**: `credenciales_correo.prioridad` (menor = antes; `PUT /v1/email-credentials/order` la renumera 1, 2, 3…). **La predeterminada es siempre la primera, sin importar su valor,** y las demás van por `prioridad` y antigüedad
  (`esPredeterminada` desc, `prioridad` asc, `id` asc). Una credencial nueva de respaldo va al final de la fila. El orden se cambia con `PUT /v1/email-credentials/order`.
- **Respaldo automático**: `enviarConCredencial` (que usan todos los envíos: aprobación, avisos, envíos masivos, código de acceso) prueba la credencial elegida y, si falla,
  las demás activas en orden, **hasta 3 por correo**. En cada intento el remitente pasa a ser el de la credencial que envía (Brevo exige un remitente verificado; Gmail solo firma con su cuenta).
  Devuelve `null` si alguna envió; si todas fallan, el error de la elegida. Cada credencial registra su propio resultado (`ultimoEstado`, `ultimoError`, `ultimoEnvioEn`).
- **Cuenta agotada = en espera**: si el fallo es **de la cuenta** (Brevo 401/402/403/429 o `not_enough_credits`/`permission_denied`; Gmail contraseña rechazada o límite diario
  `5.4.5`) la credencial queda **15 min en espera** (en memoria) y no se intenta mientras haya otra; así un envío masivo no golpea cientos de veces una cuenta sin créditos. Un error
  del mensaje (destinatario inválido) también prueba la siguiente pero **no** deja a la anterior en espera. Si todas están en espera se intenta igual. Una prueba o un envío exitosos,
  cambiar la clave o activar/desactivar la credencial la sacan de la espera.
- **Elección**: la credencial del evento (si está activa) y, si no, la primera activa por prioridad. El **código de acceso** (spec 014) usa la primera activa cuyo último envío o prueba
  no falló hace menos de 15 min (antes, solo la predeterminada): si la predeterminada cae, sigue la siguiente.
- **«Probar» y «Enviar prueba» no usan respaldo**: prueban esa credencial. En Gmail, «Probar» inicia sesión en el SMTP (`verify`) sin enviar y devuelve la cuenta (sin planes).
- **Contraseña de aplicación**: se normaliza (sin espacios, en minúsculas: Google la muestra en 4 grupos) y debe ser de 16 letras (`422 VALIDATION_ERROR`, `fields.apiKey`). Cambiar
  el remitente de una credencial de Gmail exige pegar también la contraseña de esa cuenta.
- **Límites de Gmail** (los pone Google, no la API): ~500 envíos al día en una cuenta personal y ~2000 en Workspace. Pasado el límite, Gmail responde `5.4.5` y la credencial queda en espera.

## Requisitos

- **FR-001**: `POST /v1/email-credentials` acepta `proveedor` (`BREVO` por defecto o `GMAIL_SMTP`); `proveedor` no se cambia después.
- **FR-002**: `GET /v1/email-credentials` devuelve las credenciales en orden de prioridad y cada una con `proveedor` y `prioridad`.
- **FR-003**: `PUT /v1/email-credentials/order` recibe todos los ids en el orden deseado, guarda `prioridad = posición` y deja como predeterminada a la primera (que debe estar activa).
- **FR-004**: si el envío con una credencial falla, se prueban las demás activas por prioridad (máx. 3), con el remitente de cada una.
- **FR-005**: una credencial cuya cuenta falló queda 15 min en espera salvo que todas lo estén.
- **FR-006**: el secreto nunca vuelve al cliente (`apiKeyEnmascarada` = `••••` + últimos 4) ni se escribe en el log; el log de un respaldo lleva solo ids.

## Fuera de alcance

- Un servidor SMTP distinto de Gmail (Outlook, Amazon SES…) o un host configurable.
- Reparto de carga entre credenciales (round-robin) o cuotas por día administrables: la prioridad solo decide el orden de respaldo.
- OAuth2 de Google (se usa contraseña de aplicación).
- Avisar al Owner cuando una credencial se agota (el panel muestra el último error en cada una).

## Despliegue

Backend primero (migración aditiva `20261029120000_correo_respaldo_gmail`: enum, columna `prioridad` y orden inicial = el actual); luego el panel. Con el panel anterior todo sigue igual
(credenciales de Brevo; el orden por defecto es el de antes). **En Google**: la cuenta necesita la verificación en 2 pasos; la contraseña se crea en `myaccount.google.com/apppasswords`
y, en Google Workspace, el administrador debe permitir el acceso SMTP/contraseñas de aplicación.
