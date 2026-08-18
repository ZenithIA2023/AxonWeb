# Plano: publicar o Axon na Google Play Store

> Prompt de execução para transformar o AxonWeb em app Android via Capacitor.
> Alvo desta fase: **apenas Android/Play Store**. O iOS reaproveita ~90% deste
> trabalho e entra numa fase posterior (exige build em macOS via CI).

---

## Contexto do projeto (levantado do código em 2026-08-18)

| Item | Estado atual |
|---|---|
| Frontend | React 19 + Vite 8 + Tailwind 4 + React Router 7, SPA em `axonweb/` |
| Backend | FastAPI + Supabase em `backend/`, consumido **só por HTTP** — não muda |
| Auth | E-mail/senha + Google OAuth por redirect de browser |
| OAuth | Backend devolve `session_code` temporário → frontend troca por tokens |
| Sessão | `localStorage` / `sessionStorage` (`axon_token`, `axon_refresh_token`) |
| Notificações | **Somente in-app** — não há push, FCM nem tokens de device |
| PWA | Não existe manifest nem service worker |
| Sidebar | Já tem drawer mobile (`w-[84vw]`, `max-w-[340px]`) |

**Decisões já tomadas (confirmadas pelo time em 2026-08-18):**
- Stack: **Capacitor** (não React Native / Expo) — o React atual roda dentro de WebView
- Repositório: **este mesmo**, monorepo. `ios/` e `android/` ficam em `axonweb/`
- Ordem: **Android primeiro**, publicar, e só depois ligar o CI de iOS
- **Application ID: `com.axon`** — ver ressalva na fase 1.1 antes de rodar `cap init`
- **Roteamento: `HashRouter` apenas no mobile.** A web permanece com
  `BrowserRouter` e URLs limpas, exatamente como está hoje (ver fase 1.3)
- **Teste: aparelho Android real com live reload** (o dono do projeto tem Android).
  Emulador não é o caminho — o Codespace tem só 2 CPUs / 7GB (ver fase 1.7)

---

## Regras de execução

1. **Não quebrar a web.** O mesmo build serve web e Android. Toda mudança deve
   funcionar nos dois. Rodar `npm run build` e conferir a web depois de cada fase.
2. **Backend só onde for necessário.** As fases 1, 2 e 4 são frontend puro.
   Só a fase 3 (push) mexe em `backend/`.
3. **Commits por fase**, na branch `back/geral` ou numa `feat/android`.
4. **Não commitar segredos.** `google-services.json` e keystore ficam fora do
   Git (ver fase 6).
5. Ao terminar cada fase, **relatar o que foi feito e o que ficou pendente**
   antes de seguir para a próxima.

---

## FASE 1 — Instalar o Capacitor e gerar o projeto Android

**Objetivo:** o app atual abrindo dentro de um emulador Android.

### 1.1 Instalar dependências

```bash
cd axonweb
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Axon" "com.axon" --web-dir=dist
```

> ⚠️ **Antes de rodar este comando, verificar a disponibilidade de `com.axon`
> na Play Console.** O application ID é **imutável depois da primeira
> publicação** — mudá-lo cria um app novo e perde instalações e avaliações.
>
> `com.axon` foi a decisão do time, mas foge da convenção de domínio invertido
> (afirma propriedade sobre `axon.com`) e, por ser curto e genérico, tem risco
> real de já estar registrado por outro app. **Se a Play Console recusar ou
> acusar conflito, os substitutos recomendados são `com.zenithia.axon` ou
> `com.axon.app`.** Confirmar com o dono do projeto antes de trocar.

### 1.2 Configurar `axonweb/capacitor.config.ts`

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.zenithia.axon",
  appName: "Axon",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
```

### 1.3 Router condicional: `HashRouter` no mobile, `BrowserRouter` na web

**Decisão do time:** a web fica **exatamente como está hoje**, com
`BrowserRouter` e URLs limpas. O `HashRouter` entra **apenas no app**.

**Por quê:** `axonweb/src/app/App.tsx:37` usa `BrowserRouter`, que depende da
History API servida por um servidor HTTP. No Capacitor não há servidor — os
arquivos vêm do sistema de arquivos do aparelho — então `/dashboard` é lido
como "abra o arquivo dashboard", que não existe, e a tela fica branca.

**Implementação — usar detecção em runtime, não variável de build:**

```tsx
import { BrowserRouter, HashRouter } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

const Router = Capacitor.isNativePlatform() ? HashRouter : BrowserRouter;

// ...e usar <Router> no lugar de <BrowserRouter> no JSX
```

`Capacitor.isNativePlatform()` retorna `false` no navegador, então **um único
build serve as duas plataformas** — não é preciso manter dois pipelines nem uma
`VITE_PLATFORM`. Isso importa porque o `npm run build` é o mesmo para web e para
o `cap sync`.

**Consequências que o executor precisa ter em mente:**

- Existem agora **dois comportamentos de rota**. Todo bug de navegação precisa
  ser testado nas duas plataformas — é o custo aceito desta decisão.
- Qualquer código que leia ou monte URL diretamente (`window.location`,
  `location.search`, links absolutos) pode se comportar diferente com `#`.
  **Ponto de atenção principal: `axonweb/src/pages/AuthCallback.tsx`**, que lê
  `location.search` — no `HashRouter` os parâmetros ficam depois do `#`.
  Usar o hook `useSearchParams` do React Router em vez de `URLSearchParams`
  sobre `location.search` resolve nas duas plataformas.
- O deep link da fase 2 precisa apontar para o formato correto com `#`.

### 1.4 Corrigir o caminho do favicon

`axonweb/index.html` referencia `src/assets/favicon.svg` — caminho relativo ao
source, que não existe no `dist/`. Mover o favicon para `public/` e apontar
para `/favicon.svg`.

### 1.5 Gerar e rodar

```bash
npm run build
npx cap add android
npx cap sync android
```

Para rodar: Android Studio, ou `npx cap run android`. **O emulador Android roda
neste Codespace/Linux normalmente** — não precisa de Mac.

### 1.6 Apontar para o backend de produção

O app empacotado não tem `localhost`. Definir `VITE_API_URL` apontando para o
backend em produção (Railway) antes do `npm run build`, e adicionar essa URL
em `axonweb/.env.example` como comentário.

### 1.7 Live reload no aparelho real — **prioridade alta**

O dono do projeto tem um Android e é assim que ele vai acompanhar o trabalho.
**Deixar isso funcionando antes de seguir para a fase 2** — sem retorno visual
rápido, todas as fases seguintes ficam às cegas.

**Não usar emulador:** este Codespace tem 2 CPUs e 7GB de RAM; o emulador
sozinho quer 2 núcleos e ~4GB. Se alguém tiver Android Studio numa máquina
local, o emulador serve lá — aqui, não.

Configuração: apontar `server.url` do `capacitor.config.ts` para o servidor de
dev do Vite, gerar um build de debug e instalar no aparelho uma única vez.
Depois disso, salvar um arquivo atualiza a tela do celular em ~1s.

```ts
// capacitor.config.ts — APENAS em desenvolvimento
server: {
  url: "http://<ip-da-maquina>:5173",
  cleartext: true,
}
```

⚠️ **Este bloco nunca pode ir para o build de release.** Um app publicado
apontando para um servidor de dev é falha de segurança grave. Isolar por env
var e conferir na fase 6 antes de gerar o AAB.

Notas: `vite.config.js` já tem `host: true`, então o Vite aceita conexões
externas. O `VITE_API_URL` durante o live reload deve apontar para um backend
alcançável pelo celular — o de produção, ou a porta pública do Codespace.
Aparelho e servidor precisam se enxergar na rede.

### ✅ Critério de conclusão da Fase 1
App abre **no aparelho real do dono do projeto**, mostra a landing page, navega
entre rotas, live reload funcionando, e o build web continua funcionando com
URLs limpas (sem `#`).

---

## FASE 2 — Autenticação no WebView

**Objetivo:** login por e-mail e por Google funcionando dentro do app.

### 2.1 O problema

`axonweb/src/components/auth/GoogleAuthButton.tsx:19` faz:

```ts
window.location.href = `${API_URL}/auth/google`;
```

Dentro de um WebView isso **quebra**: o Google bloqueia OAuth em WebViews
embutidos (política de segurança, erro `disallowed_useragent`). E mesmo que
passasse, o usuário sairia do app sem caminho de volta.

### 2.2 A solução

Abrir o OAuth no **navegador do sistema** e voltar por **deep link**.

```bash
npm install @capacitor/browser @capacitor/app
```

Fluxo alvo:

1. App detecta plataforma nativa (`Capacitor.isNativePlatform()`)
2. Abre `${API_URL}/auth/google` via `Browser.open()` (Custom Tab do Android)
3. Usuário autentica no Chrome, fora do WebView
4. Backend redireciona para `com.axon://auth/callback?session_code=...`
5. App captura via listener `appUrlOpen` de `@capacitor/app`
6. Fecha o browser, extrai o `session_code`, chama `api.exchangeGoogleSession()`

⚠️ **Interação com a decisão do `HashRouter` (fase 1.3):** no app as rotas vivem
depois do `#`. Ao converter o deep link em navegação interna, o destino é
`/#/auth/callback`, não `/auth/callback`. E como `AuthCallback.tsx` lê
`location.search`, ele precisa migrar para `useSearchParams` para funcionar nas
duas plataformas. **Testar o login por Google na web depois de mexer aqui** —
é o ponto onde uma regressão silenciosa é mais provável.

**Ponto favorável:** o backend já usa `session_code` em vez de mandar token na
URL (`backend/routers/google_auth.py`). Isso é exatamente o padrão seguro para
deep link — nenhum token trafega na URL. **Não mudar esse desenho.**

### 2.3 Mudanças no backend

Em `backend/routers/google_auth.py`, o redirect final usa
`os.getenv("FRONTEND_URL")`. Precisa passar a distinguir origem web de mobile:

- Propagar um marcador de plataforma pelo parâmetro `state` do OAuth
  (que já existe no fluxo), **não** por um parâmetro solto e confiável.
- Se `state` indicar mobile → redirecionar para o esquema
  `com.zenithia.axon://auth/callback?session_code=...`
- Se web → manter o comportamento atual, sem regressão.
- Fazer o mesmo para o fluxo "conectar agenda" (`/planning?google=...`).

### 2.4 Registrar o deep link no Android

Adicionar o `intent-filter` do esquema `com.zenithia.axon` em
`axonweb/android/app/src/main/AndroidManifest.xml`.

### 2.5 Google Cloud Console

Cadastrar o novo redirect URI no client OAuth. Android costuma exigir um
**client ID separado** do web, com package name e fingerprint SHA-1 da chave
de assinatura (a mesma da fase 6 — fazer as duas juntas evita retrabalho).

### 2.6 Sessão persistente

`localStorage` **funciona** no WebView do Capacitor, então
`axonweb/src/lib/api.ts` não precisa mudar agora. Porém o WebView pode limpar
storage sob pressão de memória. Após o lançamento, avaliar migrar
`axon_token` / `axon_refresh_token` para `@capacitor/preferences`, que grava em
storage nativo. **Não fazer agora** — mudaria 55 pontos de uso e não bloqueia
o lançamento.

### ✅ Critério de conclusão da Fase 2
Login por e-mail e por Google funcionam no emulador; a sessão sobrevive a
fechar e reabrir o app; a web continua logando normalmente.

---

## FASE 3 — Push notifications (a fase mais pesada)

**Objetivo:** as notificações do Axon chegarem na tela de bloqueio.

### 3.1 Por que isso importa

Hoje `backend/services/notification_service.py` cria notificações que só
aparecem quando o usuário abre o app. Num app de loja isso frustra a
expectativa — sugestões de melhoria, lembretes de planejamento e relatórios
perdem a função se ninguém os vê na hora certa.

**Toda a lógica de _quando_ e _o quê_ notificar já existe.** Falta só a camada
de _entrega_.

### 3.2 Frontend

```bash
npm install @capacitor/push-notifications
```

- Pedir permissão **no momento certo** — não na primeira abertura. Sugestão:
  depois do onboarding, quando o Axon gerar a primeira sugestão. Android 13+
  exige permissão explícita (`POST_NOTIFICATIONS`) e uma recusa é difícil de reverter.
- Registrar e enviar o token FCM ao backend.
- Tratar o tap na notificação → navegar para a tela correspondente
  (usar o `action` que as notificações já carregam).

### 3.3 Backend

1. **Migração** (seguir o padrão de `backend/migrations.sql`): tabela
   `device_tokens` com `user_id`, `token`, `platform`, `created_at`,
   `last_seen_at`. Único por `(user_id, token)`.
2. **Endpoints**: `POST /notifications/device-token` (registrar) e
   `DELETE` (no logout).
3. **Serviço de envio**: novo `backend/services/push_service.py` usando FCM
   HTTP v1. Adicionar dependência ao `backend/requirements.txt`.
4. **Integração**: chamar o envio dentro de `create_notification()` e
   `create_improvement_guarded()`, para que **todo** caminho que já cria
   notificação dispare push sem precisar caçar chamadas espalhadas.
5. **Fuso horário**: reaproveitar `backend/services/user_tz.py` — o push tem
   que respeitar o horário local do usuário, e o projeto já tem suporte
   multi-fuso.
6. **Limpeza**: token que o FCM devolver como inválido deve ser removido.

### 3.4 Cuidados

- **Não duplicar notificação**: o usuário não pode receber push *e* ver toast
  in-app da mesma coisa quando está com o app aberto.
- **Respeitar o guard de melhorias**: a Migration 14 garante 1 melhoria aberta
  por vez. O push não pode furar essa regra.
- FCM é **gratuito** em qualquer volume.

### ✅ Critério de conclusão da Fase 3
Push chega em aparelho real com o app fechado; o tap abre a tela certa; não há
duplicação com o app aberto.

---

## FASE 4 — Ajustes de UI para Android

**Objetivo:** parecer app, não site dentro de uma janela.

- **Safe areas**: usar `env(safe-area-inset-*)` para não colidir com a barra de
  status e a barra de gestos. Afeta `PageHeader.tsx` e os backgrounds em
  `components/layout/`.
- **Botão físico de voltar**: hoje ele fecha o app em qualquer tela. Tratar via
  `@capacitor/app` (`backButton`) — deve navegar para trás, e só sair do app na
  raiz, com confirmação.
- **Teclado**: instalar `@capacitor/keyboard`. Conferir os campos de entrada do
  Chat e do questionário, que são os mais afetados.
- **Splash e ícone**: usar `@capacitor/assets` para gerar todas as densidades a
  partir de um PNG 1024×1024. Reaproveitar a identidade de `src/assets/`.
- **Status bar**: `@capacitor/status-bar`, respeitando o tema claro/escuro que
  o app já tem.
- **Scroll/bounce**: desativar o overscroll do WebView, que denuncia o site.
- **Sidebar**: já tem drawer mobile — apenas validar no emulador.
- **Landing page**: decidir se ela aparece no app. Provavelmente **não** — um
  app instalado deve abrir direto no login ou no dashboard. Ajustar a rota raiz
  quando `isNativePlatform()`.

### ✅ Critério de conclusão da Fase 4
Nenhum elemento sob a barra de status; botão voltar previsível; teclado não
cobre campos; app abre em tela apropriada.

---

## FASE 5 — Preparar a ficha da Play Store

Trabalho não-técnico, mas **bloqueia o lançamento** — começar cedo, em paralelo.

- **Política de privacidade** hospedada em URL pública (obrigatória). O app usa
  dados do Google Calendar e envia dados a uma API de IA — isso precisa estar
  declarado.
- **Data Safety form**: declarar coleta de dados, uso do Claude, integração
  com Google. Declaração incorreta é motivo de rejeição.
- **Screenshots**: mínimo 2, no formato exigido para telefone.
- **Ícone** 512×512, **feature graphic** 1024×500.
- **Descrição** curta e longa, em português.
- **Classificação de conteúdo** (questionário).
- **Conta de teste** para o revisor, se o app exige login — **o Axon exige**.
  Sem isso a rejeição é quase certa.
- **Política de dados do Google OAuth**: apps que usam escopos sensíveis do
  Calendar podem precisar de verificação da Google. **Checar cedo — esse
  processo pode levar semanas.**

---

## FASE 6 — Assinatura e build de release

- Gerar **keystore de release**. Guardar num cofre de senhas.
  **Perder a keystore significa não conseguir mais atualizar o app.**
- **Nunca commitar** a keystore nem `google-services.json`. Adicionar ao
  `.gitignore`.
- Configurar assinatura via variáveis de ambiente / `keystore.properties`
  ignorado pelo Git.
- Gerar **AAB** (`.aab`), não APK — é o formato exigido pela Play Store.
- Usar **Play App Signing** (recomendado pela Google).
- Registrar o SHA-1 da chave no Google Cloud Console (junto com a fase 2.5).

---

## FASE 7 — Publicação

1. Criar conta de desenvolvedor Google Play — **US$ 25, taxa única**.
2. Subir em **teste interno** primeiro (aprovação em horas, até 100 testadores).
3. Testar em aparelho real: login Google, push, calendário, offline.
4. Promover para produção.
5. Revisão da Google: de horas a ~3 dias.

---

## Resumo de esforço

| Fase | Escopo | Estimativa |
|---|---|---|
| 1. Capacitor + Android | Frontend | 2–3 dias |
| 2. Auth no WebView | Front + back | 3–5 dias |
| 3. Push notifications | Front + **back** | 5–8 dias |
| 4. UI Android | Frontend | 4–6 dias |
| 5. Ficha da loja | Não-técnico | 2–3 dias (paralelo) |
| 6. Assinatura/build | DevOps | 1–2 dias |
| 7. Publicação + revisão | — | 2–5 dias |

**Total: 3 a 5 semanas até estar na Play Store.**

Custo: **US$ 25**, taxa única. Nenhum Mac necessário nesta fase.

---

## Divisão de trabalho

Seguindo o fluxo do projeto (backend com Bernardo, frontend com a colega):

- **Bernardo (backend):** fase 2.3 (redirect mobile no OAuth) e **fase 3 inteira
  no backend** — migração, endpoints, `push_service.py`, integração com
  `notification_service.py`. É o volume maior e o caminho crítico.
- **Frontend:** fases 1, 2 (cliente), 3.2, 4.
- **Ambos:** fases 5, 6, 7.

**Ordem recomendada:** fase 1 primeiro e junta — sem o app rodando no emulador
ninguém consegue testar nada do resto.

---

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Verificação do Google OAuth (escopos do Calendar) pode levar semanas | Checar exigência **na fase 1**, não na 7 |
| **`com.axon` indisponível ou recusado na Play Console** | Verificar **antes** do `cap init` (fase 1.1); alternativas já definidas |
| Router condicional cria bugs que só aparecem numa plataforma | Testar navegação e login Google **nas duas** após fases 1 e 2 |
| `server.url` de dev vazar para o build de release | Isolar por env var; conferir explicitamente na fase 6 |
| Rejeição por Data Safety mal declarado | Preencher com cuidado; declarar uso do Claude |
| Revisor sem conta de teste rejeita o app | Criar conta de teste dedicada na fase 5 |
| Perda da keystore | Cofre de senhas + backup, na fase 6 |
