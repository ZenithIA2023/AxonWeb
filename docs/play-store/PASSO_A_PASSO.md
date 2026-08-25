# Passo a passo até a Play Store

Tudo que falta, em ordem. Cada passo diz **onde** fazer e **quanto tempo** leva.

Dados do projeto, para consulta rápida:

| | |
|---|---|
| App ID | `com.axon.app` |
| Site | https://axonapp.tech |
| API | https://api.axonapp.tech |
| Política | https://axonapp.tech/legal/privacidade.html |
| Exclusão de conta | https://axonapp.tech/legal/excluir-conta.html |
| SHA-1 debug | `DE:F1:C5:E1:72:A0:04:B9:92:71:7E:31:E9:F0:20:86:92:50:15:B3` |
| SHA-1 release | `AE:A6:A5:08:49:7A:AF:AF:69:8C:34:BB:F0:AB:34:F0:60:2B:57:B5` |

---

# PASSO 1 — Redirect de produção no Google
**Onde:** Google Cloud Console · **Tempo:** 5 min · **Sem isso o login com Google não funciona em produção**

1. [console.cloud.google.com](https://console.cloud.google.com) → projeto do Axon
2. **APIs e serviços → Credenciais**
3. Clique no **ID do cliente OAuth 2.0** do tipo *Aplicativo da Web*
4. Em **URIs de redirecionamento autorizados**, clique em `+ ADICIONAR URI`:
   ```
   https://api.axonapp.tech/auth/google/callback
   ```
5. Em **Origens JavaScript autorizadas**, adicione:
   ```
   https://axonapp.tech
   ```
6. **NÃO REMOVA** as URLs do Codespace ainda — o Google aceita várias, e elas
   ainda servem para desenvolvimento. Removemos no passo 9.
7. **Salvar**

> Pode levar alguns minutos para valer.

---

# PASSO 2 — SHA-1 de release no cliente Android
**Onde:** Google Cloud Console · **Tempo:** 3 min

1. Mesma tela de **Credenciais**
2. Clique no **ID do cliente OAuth** do tipo *Android* (o que você criou na fase 2)
3. Em **Impressões digitais do certificado SHA-1**, adicione a de release:
   ```
   AE:A6:A5:08:49:7A:AF:AF:69:8C:34:BB:F0:AB:34:F0:60:2B:57:B5
   ```
4. Mantenha também a de debug, que já está lá
5. **Salvar**

---

# PASSO 3 — Verificação do OAuth ⚠️ COMECE HOJE
**Onde:** Google Cloud Console · **Tempo:** 30 min para enviar · **Espera: dias a semanas**

Este é o **caminho crítico**. Enquanto não for aprovado, o app fica limitado a
100 contas de teste e mostra aviso de "app não verificado" no login.

## 3.1 Preencher a tela de consentimento

**APIs e serviços → Tela de permissão OAuth**

| Campo | Valor |
|---|---|
| Nome do app | `Axon` |
| E-mail de suporte | `equipe.zenith2023@gmail.com` |
| Logotipo | envie `docs/play-store/icone-512.png` |
| Página inicial | `https://axonapp.tech` |
| Política de privacidade | `https://axonapp.tech/legal/privacidade.html` |
| Termos de serviço | (opcional, deixe vazio) |
| Domínios autorizados | `axonapp.tech` |
| Contato do desenvolvedor | `equipe.zenith2023@gmail.com` |

## 3.2 Verificar a propriedade do domínio

O Google exige provar que `axonapp.tech` é seu:

1. Acesse [search.google.com/search-console](https://search.google.com/search-console)
2. Adicionar propriedade → **Prefixo do URL** → `https://axonapp.tech`
3. Escolha verificação por **tag HTML** — ele dá uma meta tag
4. **Me mande essa tag** que eu coloco no site e você reenvia por `scp`
   (alternativa: verificação por registro DNS TXT no painel da Hostinger)

## 3.3 Gravar o vídeo de demonstração

O Google exige um vídeo **não listado no YouTube** mostrando o uso do escopo
sensível. Grave a tela do celular (ou do site) mostrando, nesta ordem:

1. A tela de login do Axon
2. Clicar em "Entrar com Google" e a tela de consentimento **aparecendo por
   completo** (o Google quer ver os escopos pedidos)
3. Já dentro do app, ir em Planejamento → conectar Google Agenda
4. Mostrar um evento da agenda aparecendo dentro do Axon
5. Criar uma tarefa no Axon e mostrar que ela virou evento no Google Agenda

Duração típica: 2 a 4 minutos. Fale ou escreva na tela o que está fazendo.
Publique como **"Não listado"** e guarde o link.

## 3.4 Enviar para verificação

Na tela de permissão OAuth → **Publicar aplicativo** → **Preparar para
verificação**. Justificativa sugerida para o escopo `calendar.events`:

```
O Axon é um assistente de produtividade que ajuda o usuário a organizar suas
tarefas respeitando sua rotina e seus compromissos já existentes.

O escopo calendar.events é usado para:
1. Ler os eventos do usuário, para que o planejamento diário não sugira tarefas
   em horários já ocupados por compromissos reais.
2. Criar e atualizar eventos quando o próprio usuário agenda uma tarefa pelo
   Axon, mantendo sua agenda como fonte única de verdade.

O acesso é sempre iniciado pelo usuário, que conecta a agenda voluntariamente
nas configurações e pode desconectar a qualquer momento. Nenhum dado da agenda
é vendido, usado para publicidade ou compartilhado com terceiros além do
processamento necessário para as funcionalidades descritas.
```

---

# PASSO 4 — Conta de desenvolvedor Play Store
**Onde:** Play Console · **Tempo:** 20 min · **Custo: US$ 25 (uma vez)** · **Aprovação: até 48h**

1. [play.google.com/console](https://play.google.com/console)
2. Criar conta de desenvolvedor — escolha **Pessoal** ou **Organização**
   (Organização exige documentos da empresa e demora mais)
3. Pagar os US$ 25
4. O Google pede **verificação de identidade** (documento com foto)

> Comece cedo: a aprovação pode levar até 48h e trava tudo depois dela.

---

# PASSO 5 — Conta de teste para o revisor
**Onde:** no próprio Axon · **Tempo:** 10 min · **Sem isso a rejeição é quase certa**

1. Acesse https://axonapp.tech e **crie uma conta nova** com um e-mail dedicado
   (ex.: `revisor.axon@gmail.com`)
2. **Responda o questionário de cronotipo até o fim** — sem isso o revisor cai
   numa tela de onboarding e pode não conseguir avaliar o app
3. Crie 3 ou 4 tarefas de exemplo, para o app não parecer vazio
4. Guarde e-mail e senha — vão no formulário da Play Console

---

# PASSO 6 — Screenshots e feature graphic
**Onde:** seu celular + editor de imagem · **Tempo:** 1h

## Screenshots (mínimo 2, ideal 5)

No celular com o Axon instalado, tire prints de:
1. Dashboard com tarefas
2. Chat com o Axon
3. Planejamento / agenda
4. Insights ou relatório
5. Rotinas

Requisitos: PNG ou JPG, proporção 9:16, lado maior entre 320px e 3840px.
Print de celular já sai no formato certo.

> Use a **conta de teste** (passo 5) para os prints, não a sua conta pessoal —
> evita expor dados reais na loja.

## Feature graphic — 1024×500

Banner que aparece no topo da ficha. Sugestão simples: fundo `#141220`, o logo
do Axon centralizado e a frase "Seu assistente de produtividade".
Dá para fazer no Canva. **Sem texto pequeno** — ele aparece reduzido.

---

# PASSO 7 — Criar o app na Play Console
**Onde:** Play Console · **Tempo:** 1h

1. **Criar app** → nome `Axon`, português (Brasil), App, Gratuito
2. **Ficha da loja principal**: copie os textos de `FICHA_LOJA.md`
   (descrição curta, descrição completa), envie ícone, screenshots e
   feature graphic
3. **Classificação de conteúdo**: responda o questionário. Para o Axon são
   "não" para violência, sexo, drogas e jogos. **Declare que o app tem
   interação com IA generativa.**
4. **Público-alvo**: 18+ (evita as exigências extras de apps para crianças)
5. **Segurança dos dados**: use as respostas de `DATA_SAFETY.md`
6. **Acesso ao app**: marque "Todas as funcionalidades exigem login" e informe
   a conta de teste do passo 5, com estas instruções:

```
O app exige login. Use a conta de teste informada acima.

O questionário de cronotipo já foi respondido nesta conta, então após entrar
o app abre direto no Dashboard.

O login pelo Google também funciona, mas requer uma conta Google real. Para a
revisão, recomendamos o login por e-mail e senha.
```

7. **URL de exclusão de conta**: `https://axonapp.tech/legal/excluir-conta.html`
8. **Política de privacidade**: `https://axonapp.tech/legal/privacidade.html`

---

# PASSO 8 — Gerar e enviar o AAB
**Onde:** Codespace + Play Console · **Tempo:** 20 min

No Codespace:

```bash
cd /workspaces/AxonWeb
unset CAP_SERVER_URL
export VITE_API_URL=https://api.axonapp.tech
./scripts/build-release.sh
```

O AAB sai em `axonweb/android/app/build/outputs/bundle/release/app-release.aab`.
Baixe pelo VS Code (botão direito → Download).

Na Play Console: **Teste → Teste interno → Criar versão** → envie o AAB.

**Aceite o Play App Signing** quando oferecido — o Google passa a guardar uma
cópia da chave, o que protege contra perder a keystore.

⚠️ **Depois de aceitar**, a Play Console mostra um **novo SHA-1** (Configuração
→ Integridade do app). Esse é o certificado com que o app publicado será
assinado. **Adicione-o também no cliente Android do Google Cloud Console** —
senão o login com Google não funciona na versão da loja.

---

# PASSO 9 — Testar e publicar
**Tempo:** teste interno aprova em horas; produção leva de horas a 3 dias

1. No teste interno, adicione seu e-mail como testador
2. Instale pelo link que a Play Console gera
3. Teste: login e-mail, login Google, push, agenda, criar tarefa
4. Se tudo funcionar → **Produção → Criar versão** → enviar para revisão
5. Só depois de publicado, **remova as URLs do Codespace** do Google Console

---

# Ordem recomendada

Comece pelo que tem espera longa e vá fazendo o resto em paralelo:

| Prioridade | Passo | Por quê |
|---|---|---|
| 🔴 Hoje | 3 (verificação OAuth) | semanas de espera, fora do seu controle |
| 🔴 Hoje | 4 (conta de dev) | até 48h de aprovação |
| 🟡 Depois | 1 e 2 (redirects e SHA-1) | rápidos, mas destravam o teste real |
| 🟡 Depois | 5 (conta de teste) | precisa existir antes do passo 7 |
| 🟢 Quando der | 6 (imagens), 7 (ficha) | trabalho seu, sem espera externa |
| ⚪ Por último | 8 e 9 | dependem de tudo acima |

## Se a verificação do OAuth travar

Existe plano B: lançar **sem a integração de agenda**. O botão de conectar fica
escondido, o backend deixa de pedir `calendar.events`, e **nenhuma verificação é
necessária** — os escopos `email` e `profile` são básicos. O login com Google
continua funcionando, e a agenda volta num update depois da aprovação.

É mudança pequena e reversível. Me avise se quiser seguir por aí.
