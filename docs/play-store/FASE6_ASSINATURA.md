# Fase 6 — Keystore e build de release

Estado: configuração pronta. **Falta você gerar a keystore** (passo 1).

## 1. Gerar a keystore — só você faz isto

A keystore assina o app para sempre. **Perdê-la, ou perder a senha, significa
nunca mais conseguir atualizar o Axon publicado** — restaria publicar como app
novo, com outro ID, perdendo instalações e avaliações.

```bash
keytool -genkeypair -v \
  -keystore /home/codespace/axon-release.jks \
  -alias axon \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype JKS
```

O comando pergunta:
- **Senha da keystore** — escolha uma forte e guarde no cofre AGORA
- Nome, organização, cidade, estado, país — podem ser seus dados; aparecem só
  no certificado, não na loja
- **Senha da chave** — pode ser a mesma da keystore

Guarde no cofre de senhas, imediatamente:
1. O arquivo `axon-release.jks` (o arquivo em si, não só o caminho)
2. A senha da keystore
3. A senha da chave
4. O alias (`axon`)

> `-validity 10000` são ~27 anos. A Play Store exige validade até pelo menos
> 2033; use um número alto e não pense mais nisso.

## 2. Preencher o keystore.properties

```bash
cd axonweb/android
cp keystore.properties.example keystore.properties
# edite e preencha as senhas
```

O arquivo e a keystore já estão no `.gitignore` — verificado.

## 3. Gerar o AAB

```bash
export VITE_API_URL="https://SEU-BACKEND-DE-PRODUCAO"
unset CAP_SERVER_URL
./scripts/build-release.sh
```

O script recusa a build se detectar configuração de desenvolvimento. As quatro
proteções foram testadas:

| Situação | Resultado |
|---|---|
| `CAP_SERVER_URL` definida | ❌ recusa — evitaria app publicado apontando para dev |
| `VITE_API_URL` de dev (localhost/github.dev) | ❌ recusa |
| `VITE_API_URL` ausente | ❌ recusa |
| `keystore.properties` ausente | ❌ recusa |
| `server.url` no config nativo | ❌ recusa (conferência final) |

O AAB sai em `axonweb/android/app/build/outputs/bundle/release/app-release.aab`.

## 4. Registrar o SHA-1 de release no Google Console

Depois de gerar a keystore:

```bash
keytool -list -v -keystore /home/codespace/axon-release.jks -alias axon | grep SHA1
```

Adicione esse SHA-1 no client OAuth Android do Google Cloud Console, **junto com
o de debug** que já está lá (`DE:F1:C5:...:15:B3`). Os dois convivem: o de debug
para testar, o de release para o app publicado.

⚠️ **Se usar Play App Signing** (recomendado pelo Google), a Play Store
re-assina o app com uma chave própria. Nesse caso, o SHA-1 que vale para o
OAuth é o **da Play Console** (Configuração → Integridade do app → certificado
de assinatura), não o da sua keystore. Registre os dois para não quebrar o
login com Google em produção — este é um erro comum e difícil de diagnosticar.

## 5. Play App Signing

Ao subir o primeiro AAB, a Play Console oferece o Play App Signing. **Aceite** —
o Google guarda uma cópia segura da chave de assinatura, o que protege contra a
perda da keystore. Você continua precisando da sua (é ela que autoriza os
uploads), mas deixa de ser um ponto único de falha total.
