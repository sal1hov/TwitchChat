#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
LABEL="${VERSION%.0}"
PUBLISH="$ROOT/dist/win-publish"
OUT="$ROOT/dist/ChatServer-${LABEL}-x64-setup.exe"

if ! command -v makensis >/dev/null 2>&1; then
  echo "Нет makensis. Поставь: brew install makensis"
  exit 1
fi

dotnet publish "$ROOT/windows/ChatServer.csproj" \
  -c Release \
  -r win-x64 \
  --self-contained true \
  -p:Version="$VERSION" \
  -o "$PUBLISH"

makensis -NOCD \
  -DVERSION="$LABEL" \
  -DPUBLISHDIR="$PUBLISH" \
  -DOUTFILE="$OUT" \
  "$ROOT/windows/chatserver.nsi"

echo "Готово: $OUT"
