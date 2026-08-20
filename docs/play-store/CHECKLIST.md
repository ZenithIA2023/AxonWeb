# Fase 5 — o que falta, e quem faz

Estado em 2026-08-20. Fases 1–4 (técnicas) concluídas.

## 🔴 Verificar HOJE — pode travar semanas

### Verificação do Google OAuth

O Axon pede `https://www.googleapis.com/auth/calendar.events`, que o Google
classifica como **escopo sensível**. Apps que os usam em produção passam por um
processo de verificação que **leva de dias a várias semanas**. O plano manda
checar isso na fase 1; ainda não foi feito.

**Como verificar:** Google Cloud Console → APIs e serviços → Tela de permissão
OAuth. Olhar dois campos:

- **Status de publicação**: "Em teste" ou "Em produção"?
- **Status de verificação**: se aparecer "Verificação necessária", começar já.

**Se estiver "Em teste":** o app funciona, mas só para até 100 contas
adicionadas manualmente como testadoras, e a tela de login mostra um aviso de
"app não verificado". **Isso não é aceitável para produção** — qualquer usuário
da Play Store bateria no limite.

**Se precisar de verificação**, prepare-se para: vídeo demonstrando o uso do
escopo, política de privacidade publicada (já rascunhada), domínio verificado, e
justificativa do uso. É o caminho crítico da publicação.

**Alternativa, se a verificação travar:** lançar a primeira versão **sem a
integração de agenda**, escondendo o botão de conectar no app, e adicionar
depois. O login com Google continua funcionando — ele usa só escopos básicos
(`email`, `profile`), que não exigem verificação.

## 🟡 Bloqueiam o envio

| Item | Quem | Estado |
|---|---|---|
| Política de privacidade em URL pública | Bernardo | rascunho pronto (`POLITICA_PRIVACIDADE.md`), falta preencher `[...]` e hospedar |
| URL de exclusão de conta | Bernardo | **não existe** — a Play Console exige uma página acessível sem instalar o app |
| Conta de teste para o revisor | Bernardo | criar, com o questionário já respondido |
| Screenshots (mín. 2) | Bernardo | pendente — sugestões na `FICHA_LOJA.md` |
| Feature graphic 1024×500 | Bernardo | pendente |
| Ícone 512×512 | — | ✅ `icone-512.png` |
| Data Safety | Bernardo | respostas prontas em `DATA_SAFETY.md` |
| Descrições | Bernardo revisa | ✅ textos em `FICHA_LOJA.md` |
| Classificação de conteúdo | Bernardo | questionário na Console |
| Conta de desenvolvedor (US$ 25) | Bernardo | pendente |

## 🟢 Pré-requisitos técnicos que a fase 5 revela

Não são da fase 5 no papel, mas **impedem uma publicação real**:

1. **O backend precisa sair do Codespace.** Hoje o APK aponta para um túnel que
   morre quando o Codespace hiberna. Sem backend estável, o app publicado não
   funciona. → Railway.
2. **Variáveis no Railway**: `CORS_ORIGINS=https://localhost` (fase 1) e
   `FIREBASE_CREDENTIALS_JSON` (fase 3, conteúdo colado — não há disco lá).
3. **`GOOGLE_REDIRECT_URI` e `FRONTEND_URL`** apontam para o Codespace; precisam
   apontar para produção.
4. **SHA-1 da chave de release** no Google Console, junto com o de debug
   (fase 6).

## Ordem sugerida

1. Verificar o status do OAuth **agora** — é o único item com prazo fora do seu controle.
2. Criar a conta de desenvolvedor (US$ 25) — leva até 48h para aprovar.
3. Publicar a política de privacidade e a página de exclusão de conta.
4. Subir o backend para o Railway.
5. Screenshots e feature graphic.
6. Fase 6 (keystore e AAB) — essa é comigo.
