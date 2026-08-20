# Data Safety — respostas para o formulário da Play Console

> Levantado do código em 2026-08-20. Declaração incorreta é motivo de rejeição
> e de suspensão posterior, então cada linha aqui tem origem verificável.

## Resumo

| Pergunta da Play Console | Resposta |
|---|---|
| O app coleta ou compartilha dados? | **Sim** |
| Dados são criptografados em trânsito? | **Sim** (HTTPS em todas as chamadas) |
| Usuário pode pedir exclusão dos dados? | **Sim** (`DELETE /account`, dentro do app) |

## Dados coletados

### Informações pessoais
| Tipo | Coletado | Compartilhado | Obrigatório | Finalidade |
|---|---|---|---|---|
| Nome | Sim | Não | Sim | Funcionalidade do app (personalização) |
| E-mail | Sim | Não | Sim | Funcionalidade do app, gerenciamento de conta |

### Fotos
| Tipo | Coletado | Compartilhado | Obrigatório | Finalidade |
|---|---|---|---|---|
| Foto de perfil | Sim | Não | Não | Funcionalidade do app |

Origem: bucket `avatars` no Supabase Storage.

### Informações do app / conteúdo do usuário
| Tipo | Coletado | Compartilhado | Obrigatório | Finalidade |
|---|---|---|---|---|
| Outro conteúdo gerado pelo usuário | Sim | **Sim** | Sim | Funcionalidade do app, personalização |

Cobre tarefas, rotinas, objetivos, registros diários, conversas com o assistente
e eventos de agenda. **Compartilhado** porque parte desse conteúdo é enviada à
API da Anthropic (Claude) para gerar respostas, sugestões e relatórios.

### Identificadores do dispositivo
| Tipo | Coletado | Compartilhado | Obrigatório | Finalidade |
|---|---|---|---|---|
| Token de push (FCM) | Sim | Não | Não | Envio de notificações |

Tabela `device_tokens`. Só existe se o usuário aceitar as notificações.

## O que NÃO é coletado

Declarar de menos é tão problemático quanto declarar de mais. O Axon **não**
coleta: localização, contatos, SMS, chamadas, arquivos do aparelho, dados
financeiros, saúde, histórico de navegação, nem qualquer identificador de
publicidade. **Não há analytics** — o `firebase-analytics` foi deliberadamente
mantido fora do projeto.

## Terceiros que recebem dados

| Serviço | O que recebe | Por quê |
|---|---|---|
| **Anthropic (Claude)** | conteúdo das tarefas, rotinas, registros e conversas | gerar respostas e sugestões |
| **Supabase** | todos os dados da conta | banco de dados e autenticação |
| **Google (OAuth + Calendar)** | e-mail, nome, eventos de agenda | login e sincronização da agenda |
| **Google (FCM)** | token do aparelho e texto da notificação | entregar push |

## Exclusão de dados

`DELETE /account` (`backend/services/account_service.py`) remove o usuário do
Supabase Auth; o CASCADE das foreign keys apaga os dados de todas as tabelas.

**Um ponto a declarar com honestidade:** o e-mail é retido em `deleted_accounts`
por 60 dias, para bloquear recadastro imediato. É o único dado que sobrevive à
exclusão, e a política de privacidade precisa dizer isso.

A Play Console pede uma **URL de exclusão de conta** acessível sem instalar o
app. Como hoje a exclusão só existe dentro do app, é preciso uma página web
explicando o procedimento — ou um formulário. **Item em aberto.**
