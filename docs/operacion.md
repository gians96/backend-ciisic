# Operación

## Respaldo (antes de cada despliegue)

```bash
mysqldump --single-transaction --quick --routines --triggers --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 -h <host> -u <usuario> -p ciisic_vii > ciisic_vii_$(date +%F_%H%M).sql
```

Restaurar: `DROP DATABASE ciisic_vii; CREATE DATABASE ciisic_vii;` e importar el respaldo con
`--default-character-set=utf8mb4`.

## Migraciones

- La imagen aplica `prisma migrate deploy` al arrancar (`docker-entrypoint.sh`), después de
  validar la configuración. No hay un paso manual.
- Antes de una migración con datos: `prisma/preflight/verificar-esquema.sql` (bloqueantes en 0)
  y, después, `prisma/preflight/conteos-despues.sql`.
- Nunca "arreglar a mano" una migración a medias: restaurar el respaldo y volver a la imagen
  anterior.

## Primer administrador

```bash
npm run bootstrap:admin -- --correo tu@undc.edu.pe --nombres "Nombre" --apellidos "Apellidos"
```

Muestra una contraseña temporal una sola vez (en la imagen: `node dist/src/database/bootstrapAdmin.js -- …`).

## Rotación de secretos

| Secreto | Cómo rotar | Efecto |
|---|---|---|
| `JWT_SECRET` | Cambiar la variable y redeplegar | Se cierran todas las sesiones y caducan los tokens de verificación |
| `SECRETS_ENCRYPTION_KEY` | **Evitar.** Si es imprescindible: volver a cargar en el panel todas las API keys y tokens, y regenerar los tokens de acceso | Los secretos cifrados y los tokens de acceso dejan de servir |
| API key de Brevo, tokens DNI, token de deportes-fi, API key de API_UNDC | Editar en el panel (Correo, Consultas DNI, Integraciones, Sistema) | Inmediato |
| Token de acceso de una landing | Panel → Eventos → Acceso → generar uno nuevo, configurarlo en la landing y revocar el anterior | Inmediato |
| Contraseña de la BD | Cambiarla en MySQL y en `DATABASE_URL` | Requiere redeplegar |

## Incidencias frecuentes

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El contenedor no arranca y el log dice "…es obligatoria" | Falta una variable (p. ej. `SECRETS_ENCRYPTION_KEY`) | Agregarla; la BD no se tocó |
| La landing responde `EVENT_TOKEN_REQUIRED` / `INVALID_EVENT_TOKEN` | Token faltante, revocado o expirado | Generar uno nuevo en Eventos → Acceso |
| Consulta DNI siempre 503 | Sin tokens vigentes | Consultas DNI → agregar o reiniciar tokens y **Probar** |
| Verificación de estudiante "no disponible" | API_UNDC sin configurar o caída | Sistema → API UNDC → **Probar** |
| No salen los correos de aprobación | Credencial de Brevo inválida o remitente no verificado | Correo → **Probar** / **Enviar prueba**; luego "Reenviar credencial" |
| Rutas antiguas responden 410 | "Landing anterior" desactivada | Es lo esperado cuando la landing nueva está publicada |
| `429 RATE_LIMITED` en un sitio | Límite por visitante o por token | Revisar el log (`Límite por token alcanzado …`); revocar el token si hay abuso |
| Botón de Google con error de origen | Dominio no autorizado en Google Cloud | Agregar el origen al client ID |

## Registros útiles

- Al arrancar: migraciones aplicadas, avisos `⚠️` de variables sobrantes o importadas, y
  `🚀 Server corriendo`.
- Cambios de configuración: `Configuración del sistema actualizada por el administrador <id>: <campos>`
  (nunca se registran valores).
