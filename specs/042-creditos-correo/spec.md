# Feature Specification: Créditos de cada credencial de correo y confirmación del envío

**Created**: 2026-10-26 · **Status**: Implementado en el backend (pendiente de desplegar)

**Input**: con 4 credenciales de Brevo en producción, una de ellas («Gianmarcos») figuraba «Activa» y «Último estado: OK» pero con **0 envíos disponibles**; el respaldo de la spec 041
la habría intentado y fallado. El usuario pidió: «comprobar y ver quién tiene [créditos] y no pasar por los que ya no se usan, y siempre comprobar si el mensaje se envió o no».

> Amplía la spec 041. No cambia los correos ni las plantillas: solo **con qué cuenta** salen y **cuándo se da un envío por hecho**.

## Decisiones

- **Créditos por credencial**: `credenciales_correo.creditos` y `creditos_verificados_en` (API: `creditosDisponibles`, `creditosVerificadosEn`). Son los envíos que Brevo informa en `/account` (suma de los planes
  de correo; los de SMS no cuentan: `creditosDeEnvio`). `NULL` = no se sabe (nunca se revisó, o es Gmail, que no informa créditos). Preguntar a Brevo **no gasta créditos**.
- **Cuándo se revisan**: al **Probar**, con **«Revisar créditos»** (`POST /v1/email-credentials/check`: todas las de Brevo activas, en paralelo) y **antes de enviar** si la última revisión tiene más de 5 min o no existe.
  Cada envío exitoso descuenta 1 del último dato conocido (sin dato, no se inventa uno). Una revisión de 0 créditos vale 5 min; pasado ese tiempo se vuelve a preguntar (así una cuenta se recupera sola cuando Brevo
  renueva su cupo diario).
- **Solo se elige con créditos**: `enviarConCredencial` arma la lista de intentos con la elegida y las demás activas por prioridad, **salta las que no tienen envíos** y las que están en espera, y toma hasta 3. Si al
  revisar una cuenta Brevo responde clave inválida o sin permisos, queda 15 min en espera; si no responde, se intenta el envío igual. Sin ninguna con créditos no se hace ninguna llamada y el error es
  «Ninguna credencial activa tiene envíos disponibles». Gmail siempre es elegible (el límite lo pone Google y se detecta al enviar).
- **Código de acceso** (`credencialUtilizable`): también salta las credenciales con 0 créditos vigentes.
- **Confirmación del envío**: un envío solo cuenta como hecho si el proveedor **confirma que aceptó el correo**. Brevo: la respuesta trae `messageId` (o `messageIds`); una respuesta exitosa sin él es un error
  («Brevo no confirmó el envío») y el correo se prueba con la siguiente credencial. Gmail: `accepted` incluye al destinatario y `rejected` está vacío («Gmail no aceptó al destinatario»). «Enviar prueba» devuelve el
  `messageId` con el que se confirmó.
- **Qué no es**: no consulta si el mensaje se **entregó** al buzón (rebotes, spam): eso lo informa Brevo después (eventos) y no se guarda aquí.

## Requisitos

- **FR-001**: `CredencialCorreo` trae `creditosDisponibles` (`number | null`) y `creditosVerificadosEn` (`string | null`).
- **FR-002**: `POST /v1/email-credentials/check` (`correo.configurar`) revisa las de Brevo activas y devuelve la lista (`CredencialCorreo[]`); una que falla no impide revisar las demás.
- **FR-003**: una credencial con `creditosDisponibles = 0` revisada hace menos de 5 min no se usa para enviar (correos de eventos, avisos, envíos masivos ni código de acceso).
- **FR-004**: un envío sin confirmación del proveedor no se da por hecho: se registra el error en la credencial y se prueba la siguiente.

## Fuera de alcance

- Estado de entrega del correo (entregado, rebotó, spam) desde los eventos de Brevo.
- Contar los envíos de Gmail contra su límite diario (se detecta cuando Google lo rechaza: spec 041).
- Avisar al Owner cuando todas se quedan sin créditos (el panel lo muestra en Correo).

## Despliegue

Backend primero (migración aditiva `20261029180000_creditos_correo`, sin tocar datos); luego el panel. Con el panel anterior todo sigue igual y los créditos se mantienen solos.
