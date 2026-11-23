#!/bin/sh
# Arranque en Railway: el volumen (/data) se monta como root solo en runtime.
# Como root se prepara únicamente el subdirectorio de la DB y se bajan
# privilegios al usuario node antes de migrar e iniciar la API.
set -eu

DATA_DIR="$(dirname "$DATABASE_PATH")"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown node:node "$DATA_DIR"
  for f in "$DATABASE_PATH" "$DATABASE_PATH-journal"; do
    if [ -e "$f" ]; then chown node:node "$f"; fi
  done
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

cd /app/apps/api
echo "[entrypoint] aplicando migraciones en $DATABASE_PATH"
node src/db.js
exec node src/server.js
