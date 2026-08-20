#!/usr/bin/env bash
#
# Gera o AAB de release para a Play Store.
#
#   ./scripts/build-release.sh
#
# Exige:
#   - axonweb/android/keystore.properties preenchido (ver .example)
#   - VITE_API_URL apontando para o backend de PRODUÇÃO
#
# O script recusa a build se detectar configuração de desenvolvimento — um app
# publicado apontando para servidor de dev é falha de segurança grave.

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONT="$RAIZ/axonweb"
ANDROID="$FRONT/android"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export JAVA_HOME="${JAVA_HOME:-/usr/local/sdkman/candidates/java/21.0.10-ms}"

echo "==> Verificações de segurança"

# 1. Nada de live reload no release.
if [[ -n "${CAP_SERVER_URL:-}" ]]; then
  echo "ERRO: CAP_SERVER_URL está definida ($CAP_SERVER_URL)."
  echo "      Isso apontaria o app publicado para um servidor de desenvolvimento."
  echo "      Rode: unset CAP_SERVER_URL"
  exit 1
fi

# 2. O backend precisa ser o de produção.
API="${VITE_API_URL:-}"
if [[ -z "$API" ]]; then
  echo "ERRO: VITE_API_URL não definida — o app não saberia com qual backend falar."
  exit 1
fi
if [[ "$API" == *localhost* || "$API" == *127.0.0.1* || "$API" == *github.dev* ]]; then
  echo "ERRO: VITE_API_URL aponta para desenvolvimento: $API"
  echo "      Use a URL do backend de produção."
  exit 1
fi
echo "    backend de produção: $API"

# 3. Sem keystore não há release assinado.
if [[ ! -f "$ANDROID/keystore.properties" ]]; then
  echo "ERRO: $ANDROID/keystore.properties não existe."
  echo "      Copie de keystore.properties.example e preencha."
  exit 1
fi
echo "    keystore.properties encontrado"

echo "==> Build do frontend"
cd "$FRONT"
npm run build

echo "==> Sincronizando com o Android"
npx cap sync android

# 4. Conferência final no artefato que realmente vai ser empacotado.
if grep -q '"url"' "$ANDROID/app/src/main/assets/capacitor.config.json"; then
  echo "ERRO: server.url presente no config nativo. Abortando."
  exit 1
fi
echo "    config nativo limpo (sem server.url)"

echo "==> Gerando AAB assinado"
cd "$ANDROID"
./gradlew bundleRelease --no-daemon

AAB="$ANDROID/app/build/outputs/bundle/release/app-release.aab"
echo
echo "==> Pronto: $AAB"
ls -lh "$AAB"
echo
echo "Envie este arquivo na Play Console (teste interno primeiro)."
