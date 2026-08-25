# Deploy no VPS — axonapp.tech

Roteiro para subir backend + site no VPS da Hostinger.
Execute os comandos **no terminal do VPS** (via SSH), não no Codespace.

- **Domínio:** axonapp.tech
- **IP:** 2.24.104.203 *(confirmar no painel — ver nota no fim)*

## Arquitetura final

```
axonapp.tech        → site + app web (arquivos estáticos)
api.axonapp.tech    → backend FastAPI
```

Separar em subdomínio mantém o CORS simples e permite trocar um sem mexer no outro.

## 1. DNS (no painel da Hostinger)

Crie dois registros A:

| Tipo | Nome | Valor |
|---|---|---|
| A | `@` | 2.24.104.203 |
| A | `api` | 2.24.104.203 |

Propagação leva de minutos a algumas horas. Confira com:
```bash
dig +short axonapp.tech
dig +short api.axonapp.tech
```

## 2. Acesso e primeiros passos

```bash
ssh root@2.24.104.203

# Atualizar o sistema
apt update && apt upgrade -y

# Usuário sem privilégios para rodar a aplicação (nunca rode como root)
adduser --system --group --home /opt/axon axon
```

## 3. Dependências

```bash
apt install -y python3 python3-venv python3-pip nginx git ufw
```

## 4. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
ufw status
```

Repare que a porta 8000 **não** é aberta: o backend só é acessível pelo Nginx,
que faz o proxy. Menos superfície exposta.

## 5. Código no servidor

```bash
cd /opt
git clone <URL-DO-REPOSITORIO> axon-app
chown -R axon:axon /opt/axon-app
cd /opt/axon-app/backend

python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install gunicorn
```

## 6. Variáveis de ambiente

```bash
nano /opt/axon-app/backend/.env
```

Conteúdo (adapte as chaves reais):

```env
ANTHROPIC_API_KEY=sk-ant-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...

ENV=production

FRONTEND_URL=https://axonapp.tech

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.axonapp.tech/auth/google/callback

# WebView do app Android
CORS_ORIGINS=https://localhost,https://axonapp.tech

# Push: no VPS pode ser arquivo mesmo
FIREBASE_CREDENTIALS_PATH=/opt/axon-app/backend/firebase-key.json
```

```bash
chmod 600 /opt/axon-app/backend/.env
```

Copie a `firebase-key.json` para o servidor (do seu computador):
```bash
scp /caminho/local/firebase-key.json root@2.24.104.203:/opt/axon-app/backend/
```

## 7. Backend como serviço

```bash
nano /etc/systemd/system/axon-api.service
```

```ini
[Unit]
Description=Axon API (FastAPI)
After=network.target

[Service]
Type=simple
User=axon
Group=axon
WorkingDirectory=/opt/axon-app/backend
EnvironmentFile=/opt/axon-app/backend/.env
ExecStart=/opt/axon-app/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now axon-api
systemctl status axon-api
```

> **Um worker só, de propósito.** O `planning_scheduler` roda a cada minuto;
> com vários workers, cada um teria seu próprio agendador e as notificações
> sairiam duplicadas. Se um dia precisar escalar, o scheduler tem que sair para
> um processo separado antes.

## 8. Frontend

No **Codespace**, gerar o build de produção:
```bash
cd axonweb
VITE_API_URL=https://api.axonapp.tech npm run build
```

Enviar para o servidor:
```bash
scp -r dist/* root@2.24.104.203:/var/www/axon/
```

No **VPS**:
```bash
mkdir -p /var/www/axon
chown -R www-data:www-data /var/www/axon
```

## 9. Nginx

```bash
nano /etc/nginx/sites-available/axon
```

```nginx
# Site + app web
server {
    listen 80;
    server_name axonapp.tech www.axonapp.tech;
    root /var/www/axon;
    index index.html;

    # SPA: qualquer rota cai no index.html, que o React Router resolve.
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}

# API
server {
    listen 80;
    server_name api.axonapp.tech;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/axon /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

## 10. HTTPS

**Só rode depois que o DNS estiver propagado** — o Certbot valida o domínio.

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d axonapp.tech -d www.axonapp.tech -d api.axonapp.tech
```

Escolha redirecionar HTTP para HTTPS. A renovação é automática.

## 11. Atualizar as URLs no Google Cloud Console

- **Authorized redirect URI:** `https://api.axonapp.tech/auth/google/callback`
- Remover as URLs do Codespace
- Adicionar `https://axonapp.tech` em origens autorizadas

## 12. Recompilar o app apontando para produção

No Codespace:
```bash
unset CAP_SERVER_URL
export VITE_API_URL=https://api.axonapp.tech
./scripts/build-release.sh
```

## Verificação final

```bash
curl https://api.axonapp.tech/          # {"status":"ok"}
curl -I https://axonapp.tech/           # 200
systemctl status axon-api               # active (running)
journalctl -u axon-api -f               # logs ao vivo
```

---

## ⚠️ Sobre o IP

`2.24.104.203` pertence a uma faixa registrada para a Vodafone no Reino Unido,
o que é atípico para VPS da Hostinger. **Confirme o IPv4 no painel** antes de
configurar o DNS — se estiver errado, tudo aponta para o lugar errado.
