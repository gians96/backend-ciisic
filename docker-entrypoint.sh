#!/bin/sh
# Arranque del contenedor en producción:
#   1) valida la configuración ANTES de tocar la BD (si falta una variable, falla sin migrar);
#   2) aplica las migraciones pendientes (MIGRATE_ON_START=false para omitirlo);
#   3) inicia la API.
set -e

node -e "require('./dist/config/env')"

if [ "${MIGRATE_ON_START:-true}" != "false" ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

exec node dist/src/server.js
