#!/usr/bin/env bash
#
# Gera o APK de teste apontando para o backend de produção e o deixa
# disponível para download.
#
#   ./scripts/build-apk.sh
#
# Este é um APK de DEBUG, para instalar à mão no celular.
# O AAB da Play Store é outro: ./scripts/build-release.sh

set -euo pipefail

API="https://api.axonapp.tech"
PORTA=8080
SERVE="$HOME/apk-serve"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONT="$RAIZ/axonweb"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
# O Gradle 8.14 não suporta o JDK 25 que vem por padrão no Codespace.
export JAVA_HOME="${JAVA_HOME:-/usr/local/sdkman/candidates/java/21.0.10-ms}"

echo "==> Build do frontend (backend: $API)"
cd "$FRONT"
unset CAP_SERVER_URL      # sem isto o APK carregaria do servidor de dev
VITE_API_URL="$API" npm run build

echo "==> Sincronizando com o Android"
npx cap sync android

if grep -q '"url"' android/app/src/main/assets/capacitor.config.json; then
  echo "ERRO: server.url presente — o APK dependeria do Codespace. Abortando."
  exit 1
fi

echo "==> Compilando o APK"
cd "$FRONT/android"
./gradlew assembleDebug --no-daemon

mkdir -p "$SERVE"
cp app/build/outputs/apk/debug/app-debug.apk "$SERVE/axon-producao.apk"

if ! lsof -ti:$PORTA >/dev/null 2>&1; then
  (cd "$SERVE" && setsid python3 -m http.server $PORTA --bind 0.0.0.0 >/dev/null 2>&1 </dev/null &)
  sleep 2
fi

NOME="${CODESPACE_NAME:-}"
echo
echo "==> APK pronto"
ls -lh "$SERVE/axon-producao.apk"
echo
if [[ -n "$NOME" ]]; then
  echo "Baixe em: https://${NOME}-${PORTA}.app.github.dev"
  echo
  echo "Se der erro ou baixar uma página HTML, a porta $PORTA está privada:"
  echo "  painel PORTS -> botão direito na $PORTA -> Port Visibility -> Public"
fi
echo
echo "Instale por cima do anterior. Se algum PLUGIN nativo mudou"
echo "(@capacitor/*), desinstale antes — plugin novo não sobrescreve."
