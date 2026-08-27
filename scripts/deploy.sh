#!/usr/bin/env bash
#
# Publica as alterações no site (axonapp.tech) e/ou no backend do VPS.
#
#   ./scripts/deploy.sh            # site + backend
#   ./scripts/deploy.sh site       # só o site (mudou só o frontend)
#   ./scripts/deploy.sh backend    # só o backend (mudou só o Python)
#
# Pede a senha do root do VPS 1 a 2 vezes (é o ssh/scp).
# NÃO gera o APK — para isso use ./scripts/build-apk.sh

set -euo pipefail

VPS="root@2.24.104.203"
API="https://api.axonapp.tech"
SITE="https://axonapp.tech"

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ALVO="${1:-tudo}"

# Avisa sobre trabalho não commitado: o VPS puxa do GitHub, então o que não foi
# enviado não chega lá — e o site sairia diferente do backend.
if [[ -n "$(git -C "$RAIZ" status --porcelain)" ]]; then
  echo "⚠️  Há alterações não commitadas:"
  git -C "$RAIZ" status --short | head -10
  echo
  echo "   O site usa o código LOCAL, mas o backend do VPS puxa do GitHub."
  echo "   Sem commit+push, os dois podem ficar em versões diferentes."
  read -rp "   Continuar mesmo assim? [s/N] " ok
  [[ "$ok" == "s" || "$ok" == "S" ]] || exit 1
fi

if [[ "$ALVO" == "tudo" || "$ALVO" == "backend" ]]; then
  echo "==> Backend: atualizando o VPS"
  ssh "$VPS" '
    set -e
    sudo -u axon git -C /opt/axon-app pull
    systemctl restart axon-api
    sleep 3
    systemctl is-active axon-api
  '
  echo "    backend reiniciado"
fi

if [[ "$ALVO" == "tudo" || "$ALVO" == "site" ]]; then
  echo "==> Site: build de produção"
  cd "$RAIZ/axonweb"
  unset CAP_SERVER_URL
  VITE_API_URL="$API" npm run build

  # Rede de segurança: o build nunca pode sair apontando para o Codespace.
  if grep -rq "github.dev" dist/assets/*.js 2>/dev/null; then
    echo "ERRO: o build contém URL do Codespace. Abortando."
    exit 1
  fi

  echo "==> Enviando para o VPS"
  scp -r dist/* "$VPS:/var/www/axon/"
  echo "    site publicado"
fi

echo
echo "==> Verificando"
curl -s -m 10 -o /dev/null -w "    site   %{http_code}  $SITE\n" "$SITE" || true
curl -s -m 10 -o /dev/null -w "    api    %{http_code}  $API\n" "$API" || true
echo
echo "Pronto. O APP MOBILE não foi atualizado — ele só muda ao gerar e"
echo "reinstalar um APK novo: ./scripts/build-apk.sh"
