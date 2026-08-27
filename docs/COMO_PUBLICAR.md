# Como publicar alterações

Três destinos independentes. Depois de commitar, atualize os que mudaram.

| Onde | Como | Quem vê |
|---|---|---|
| **Site** axonapp.tech | `./scripts/deploy.sh site` | quem acessa pelo navegador |
| **Backend** api.axonapp.tech | `./scripts/deploy.sh backend` | site e app (é a mesma API) |
| **App mobile** | `./scripts/build-apk.sh` + reinstalar | quem tem o APK instalado |

## O fluxo normal

```bash
# 1. commitar e enviar (o VPS puxa do GitHub)
git add -A
git commit -m "descrição da mudança"
git push

# 2. publicar site + backend de uma vez
./scripts/deploy.sh

# 3. só se o app precisa da mudança
./scripts/build-apk.sh
```

O `deploy.sh` pede a senha do root do VPS uma ou duas vezes.

## O que atualizar em cada caso

**Mexeu só no frontend** (`axonweb/src/`)
```bash
./scripts/deploy.sh site
```
E, se o app precisa da mudança, `./scripts/build-apk.sh`.

**Mexeu só no backend** (`backend/`)
```bash
git push && ./scripts/deploy.sh backend
```
Site e app pegam automaticamente — os dois chamam a mesma API.

**Mexeu nos dois**
```bash
git push && ./scripts/deploy.sh
```

**Criou uma migration**
Aplique o SQL no Supabase **antes** de reiniciar o backend, senão ele salva
campos que a tabela não tem.

## Por que o app é diferente

O site é servido pelo VPS: trocar os arquivos atualiza todo mundo na hora.

O app tem a interface **empacotada dentro do APK**. Não existe atualização
automática num APK instalado à mão — é exatamente isso que a Play Store passa a
resolver quando o app for publicado.

Enquanto isso, cada mudança de frontend que precise chegar ao celular exige
gerar e reinstalar o APK.

> **Se mudou algum plugin nativo** (`@capacitor/...`), **desinstale o app antes
> de instalar**. Código nativo novo não sobrescreve o antigo de forma
> confiável, e o plugin falha em silêncio — foi o que aconteceu na fase 3 do
> push.

## Testar antes de gerar o APK

O site e o app rodam o mesmo código. Publique no site primeiro e teste em
axonapp.tech — se funcionar lá, funciona no app. Economiza um ciclo de
compilar + baixar + instalar.

## Verificar se deu certo

```bash
curl https://axonapp.tech            # site no ar
curl https://api.axonapp.tech        # {"status":"ok"}
```

No VPS:
```bash
systemctl status axon-api --no-pager   # active (running)
journalctl -u axon-api -n 50           # últimos logs
git -C /opt/axon-app log --oneline -1  # qual commit está lá
```

O último comando é o mais útil quando algo "não atualizou": se o commit for
antigo, o `git pull` não pegou.

## Quando algo dá errado

**Site atualizado mas app não** — normal. O app só muda ao reinstalar o APK.

**"Não atualizou nada"** — confira se o `git push` foi feito. O VPS puxa do
GitHub; o que ficou só no Codespace não chega lá.

**Backend com erro depois do deploy** — veja `journalctl -u axon-api -n 50`.
Causa comum: migration não aplicada no Supabase.

**APK baixa como página HTML** — a porta 8080 está privada. No painel PORTS,
botão direito na 8080 → Port Visibility → Public.
