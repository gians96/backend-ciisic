# Spec 046 · Puerto SMTP de Gmail (465 o 587) y aviso de IP bloqueada en Brevo

## Problema

Brevo dejó de enviar con todas las API keys a la vez. La causa típica es su bloqueo de **IPs no autorizadas**: el
servidor cambió de IP y Brevo responde 401 «unrecognised IP address». El panel lo mostraba como «API key inválida».

Se pasa a enviar por Gmail/Google Workspace, que ya existe (spec 041). Pero el puerto estaba fijo en 465, y las
configuraciones de la organización usan 465 (SSL) y 587 (STARTTLS); algunas redes bloquean uno de los dos.

## Cambios

- `credenciales_correo.smtp_puerto` (`INT NULL`; NULL = 465). Solo Gmail; Brevo la deja en NULL.
- `smtpPuerto` en el alta y la edición (465 o 587; otro valor es 422) y en las respuestas (`null` en Brevo).
- `gmail-client.ts`: transporte por puerto. 465 usa `secure: true`; 587 usa `secure: false` con `requireTLS: true`. El host sigue fijo en `smtp.gmail.com`.
- **Respaldo de puerto**: si el puerto elegido **no conecta** (`ETIMEDOUT`, `ECONNREFUSED`, `ESOCKET`, `ECONNECTION`, `ECONNRESET` con `command: 'CONN'`, o `ECONNREFUSED`), se prueba el otro.
  - Un error de autenticación, de límite o un corte a mitad del envío no cambia de puerto: reintentar podría duplicar el correo.
  - Si ninguno conecta: «No se pudo conectar con smtp.gmail.com por el puerto 465 ni por el 587…».
- «Probar» devuelve `cuenta.puerto` (por dónde conectó). Si no es el guardado, guarda ese puerto para los envíos.
- Brevo: un 401 cuyo mensaje habla de la IP responde «Brevo bloqueó la IP del servidor: autorízala en Brevo → Configuración de seguridad → IPs autorizadas».

## Contrato

- `POST /v1/email-credentials` y `PUT /v1/email-credentials/:id`: aceptan `smtpPuerto?: 465 | 587 | null`.
- Las credenciales traen `smtpPuerto: 465 | 587 | null`.
- `POST /v1/email-credentials/:id/test`: `data.cuenta.puerto?: number` en Gmail.

Compatible hacia atrás: un panel anterior no envía `smtpPuerto` y todo queda en 465 como antes.
