# Feature Specification: Enlace público por docente

**Created**: 2026-10-22 · **Status**: Implementado en el backend (panel en su repo, spec 017) · **Contrato**: [`contracts/api-enlaces-docentes.md`](contracts/api-enlaces-docentes.md)

**Input**: con los reportes de la [spec 025](../025-reportes-asesores/spec.md) la organización ve cómo van los estudiantes de cada
asesor, pero los docentes dependían de que alguien les enviara un Excel. Cada docente debe poder **verificar por sí mismo,
cuando quiera, cómo van los pagos de sus estudiantes**, sin crear una cuenta ni pedir un reporte nuevo.

Cada asesor puede tener un **enlace personal**: quien lo abre ve, en tiempo real, solo a los estudiantes de ese docente.
No es una cuenta del panel (los docentes no son staff): el enlace **es** la credencial.

## Decisiones

- **Credencial**: token aleatorio de 256 bits (`crypto.randomBytes(32)`, 43 caracteres base64url) por asesor, en
  `asesores.enlace_token` (único; `NULL` = sin enlace). Se guarda **en claro** a propósito: el panel debe poder mostrar,
  copiar y enviar el enlace cuando se quiera, y la misma base ya contiene los datos que el enlace muestra. Renovarlo lo
  cambia al instante (el anterior deja de valer); desactivarlo lo borra.
- **El token no viaja en ninguna URL**: la landing del docente es `<panel>/seguimiento#<token>`; lo que va tras el `#` no
  se envía a ningún servidor ni a `Referer`. El navegador lo manda por `POST` al BFF del panel y este lo reenvía al
  backend en el encabezado `X-Link-Token`, así que tampoco queda en los registros de acceso (`morgan`) ni en los de Traefik.
- **Mínimo necesario**: la vista pública da, por estudiante, solo nombre, código, ciclo, sección, turno, celular y situación.
  **Nunca** DNI, correo, montos, fechas ni número de operación, id de inscripción ni nombres de otros asesores. Los reportes
  Excel y PDF del enlace tienen las mismas restricciones (`publico: true`: sin DNI, correo ni columna de asesores).
- **Un solo error**: un token faltante, mal formado, desconocido o desactivado responde igual (`404 LINK_NOT_FOUND`); un
  token con mal formato ni siquiera consulta la base.
- **Quién administra**: ver, crear, renovar y desactivar enlaces es `reportes.gestionar` (global: Owner y Administrador). Es
  una credencial: ni el Tesorero ni la Comisión la ven, aunque vean y descarguen reportes.
- **Sobreviven a recargar el padrón**: al reemplazar el padrón, el asesor que ya tenía enlace lo conserva (se reasigna por
  nombre, sin distinguir acentos ni mayúsculas); los nuevos empiezan sin enlace. Si no, cada carga rompería los enlaces ya
  enviados.
- **Último acceso**: `enlace_ultimo_acceso` se anota como máximo cada 5 minutos (y si no se puede anotar, el docente igual ve
  su avance). Sirve para que la organización sepa si un docente ya abrió su enlace.
- **Sin cachés ni buscadores**: respuestas `Cache-Control: no-store` y `X-Robots-Tag: noindex, nofollow`.
- **Límites por visitante** (IP, la que reenvía el BFF): vista 40/min y descargas 10/min. Los de administración, por cuenta.

## User Scenarios & Testing

### User Story 1 - Entrego su enlace a cada docente (Priority: P1)

1. **Given** el padrón está cargado, **When** creo los enlaces, **Then** cada asesor tiene uno y puedo copiarlo o copiar un
   mensaje listo para enviarle.
2. **Given** un enlace se difundió, **When** lo renuevo, **Then** el anterior deja de funcionar y el nuevo es otro token.
3. **When** desactivo un enlace, **Then** el docente ve «El enlace no es válido o fue desactivado».

### User Story 2 - El docente ve cómo van sus estudiantes (Priority: P1)

1. **Given** el docente abre su enlace, **Then** ve cuántos de sus estudiantes pagaron, están en revisión, fueron rechazados o no se
   inscribieron, y la lista con el celular de cada uno, sin iniciar sesión.
2. **When** un voucher se aprueba, **Then** al actualizar (o en el siguiente refresco automático) el estudiante pasa a «Pagó».
3. **When** descarga el reporte, **Then** recibe Excel o PDF sin DNI, correo ni montos.

## Requirements

- **FR-001**: `GET|POST /v1/events/:eventId/advisory/links` y `DELETE …/links/:asesorId` (`reportes.gestionar`) listan, crean
  (los que faltan o, con `regenerar`, todos los indicados) y desactivan enlaces.
- **FR-002**: `GET /v1/public/advisor` y `GET /v1/public/advisor/export?formato=xlsx|pdf`, sin sesión, con `X-Link-Token`.
- **FR-003**: la vista pública no contiene DNI, correo, montos, `recaudado`, fechas de pago ni asesores (prueba automática).
- **FR-004**: tokens inválidos, desactivados o renovados responden igual (`404 LINK_NOT_FOUND`).
- **FR-005**: recargar el padrón conserva los enlaces por nombre del asesor.
- **FR-006**: migración aditiva `20261023130000_enlaces_asesores` (3 columnas y un índice único en `asesores`).

## Success Criteria

- **SC-001**: `npm run lint`, `npx tsc --noEmit` y `npm test` en verde; `prisma migrate diff` sin cambios; matriz de rutas con 167 rutas.
- **SC-002**: con el padrón de octubre se crean 26 enlaces distintos y cada uno abre solo a los estudiantes de su docente.
