-- =============================================
-- AXON — MIGRAÇÕES INCREMENTAIS
-- Execute no Supabase SQL Editor em ordem.
-- =============================================


-- =============================================
-- MIGRAÇÃO 1: Corrigir e expandir tabela profiles
-- =============================================

-- Remover constraint antiga de chronotype (valores em inglês)
alter table public.profiles
  drop constraint if exists profiles_chronotype_check;

-- Adicionar nova constraint com valores em português + inglês (retrocompatibilidade)
alter table public.profiles
  add constraint profiles_chronotype_check
  check (chronotype in (
    'morning', 'intermediate', 'evening', 'night',
    'Matutino', 'Vespertino', 'Noturno', 'Misto', 'Bimodal'
  ));

-- Adicionar qualidade_sono — guarda a LETRA da pergunta P9 (A–F).
-- A tradução para texto significativo é feita no backend (services/prompts.py).
alter table public.profiles
  add column if not exists qualidade_sono text;

-- Adicionar schedule_type: controla qual agente será usado
alter table public.profiles
  add column if not exists schedule_type text
  check (schedule_type in ('flexible', 'fixed'))
  default null;

-- Adicionar onboarding_completed: sinaliza que o usuário terminou o questionário
alter table public.profiles
  add column if not exists onboarding_completed boolean default false;


-- =============================================
-- MIGRAÇÃO 2: Criar tabela respostas (já usada no código)
-- =============================================

create table if not exists public.respostas (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  pergunta    text not null,
  alternativa text not null,
  created_at  timestamp with time zone default now()
);

create index if not exists respostas_user_id_idx on public.respostas(user_id);

alter table public.respostas enable row level security;

create policy "Usuários veem apenas suas próprias respostas"
  on public.respostas for select
  using (auth.uid() = user_id);

create policy "Usuários inserem apenas suas próprias respostas"
  on public.respostas for insert
  with check (auth.uid() = user_id);

create policy "Usuários deletam apenas suas próprias respostas"
  on public.respostas for delete
  using (auth.uid() = user_id);


-- =============================================
-- MIGRAÇÃO 3: Criar tabela tasks
-- =============================================

create table if not exists public.tasks (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references auth.users(id) on delete cascade not null,

  -- Conteúdo
  title           text not null,
  description     text,

  -- Tipo e status
  task_type       text check (task_type in ('task', 'event', 'routine')) not null default 'task',
  status          text check (status in ('todo', 'progress', 'done', 'scheduled')) not null default 'todo',
  priority        text check (priority in ('low', 'medium', 'high')) default 'medium',

  -- Agendamento
  scheduled_date  date,
  start_time      time,
  end_time        time,

  -- Progresso (0–100)
  progress        integer default 0 check (progress >= 0 and progress <= 100),

  -- Recorrência (apenas para task_type = 'routine')
  recurrence      text check (recurrence in ('daily', 'weekly', 'monthly')),

  -- Local ou link (apenas para task_type = 'event')
  location        text,

  -- Hierarquia: subtarefas de um projeto maior
  parent_task_id  uuid references public.tasks(id) on delete cascade,

  -- Agrupamento: conjunto de tarefas similares criado pelo sub-agente agrupador
  group_name      text,

  -- Prazo final: usado pelo sub-agente quebrador de tarefas
  deadline        date,

  -- Origem: indica se foi criada pelo agente ou pelo usuário
  created_by      text check (created_by in ('user', 'agent')) default 'user',

  created_at      timestamp with time zone default now(),
  updated_at      timestamp with time zone default now()
);

-- Índices para queries frequentes
create index if not exists tasks_user_id_idx       on public.tasks(user_id);
create index if not exists tasks_scheduled_date_idx on public.tasks(scheduled_date);
create index if not exists tasks_parent_task_id_idx on public.tasks(parent_task_id);
create index if not exists tasks_status_idx         on public.tasks(status);

-- Trigger updated_at
drop trigger if exists tasks_updated_at on public.tasks;
create trigger tasks_updated_at
  before update on public.tasks
  for each row execute procedure public.handle_updated_at();

-- RLS
alter table public.tasks enable row level security;

-- =============================================
-- MIGRAÇÃO 4: Adicionar end_date à tabela tasks
-- =============================================

alter table public.tasks
  add column if not exists end_date date null;

create policy "Usuários veem apenas suas próprias tarefas"
  on public.tasks for select
  using (auth.uid() = user_id);

create policy "Usuários inserem apenas suas próprias tarefas"
  on public.tasks for insert
  with check (auth.uid() = user_id);

create policy "Usuários editam apenas suas próprias tarefas"
  on public.tasks for update
  using (auth.uid() = user_id);

create policy "Usuários excluem apenas suas próprias tarefas"
  on public.tasks for delete
  using (auth.uid() = user_id);


-- =============================================
-- MIGRAÇÃO 5: Colunas adicionadas diretamente no Supabase (documentação)
-- Estas colunas já existem no banco — este bloco serve apenas como registro.
-- =============================================

-- Tarefa chave: máximo 1 por dia por usuário (unicidade garantida no backend).
alter table public.tasks
  add column if not exists is_key_task boolean default false;

-- Contador de carries: quantas vezes uma tarefa foi postergada para o dia seguinte.
alter table public.tasks
  add column if not exists carry_count integer default 0;

-- Timestamp de conclusão: preenchido automaticamente ao marcar status = 'done'.
alter table public.tasks
  add column if not exists completed_at timestamp with time zone;

-- ID do evento espelhado no Google Agenda (integração Google Calendar).
alter table public.tasks
  add column if not exists google_event_id text;

-- Vínculo com item de rotina que gerou esta tarefa (ON DELETE SET NULL).
alter table public.tasks
  add column if not exists routine_item_id uuid
  references public.routine_items(id) on delete set null;


-- =============================================
-- MIGRAÇÃO 6: Janela de horário em routine_items (not_before / not_after)
-- Permite que itens flexíveis respeitem uma preferência de janela informada
-- pelo usuário no chat (ex: "leitura depois do almoço" → not_before = '13:00').
-- O Axon ainda escolhe o melhor bloco de energia DENTRO dessa janela.
-- =============================================

alter table public.routine_items
  add column if not exists not_before time null,
  add column if not exists not_after  time null;


-- =============================================
-- MIGRAÇÃO 7: Objetivos (tarefa mãe com subtarefas)
-- Um objetivo é um container de tarefas relacionadas com prazo e progresso
-- automático. As subtarefas são tarefas normais vinculadas via objective_id.
-- Cascade: ao deletar um objetivo, todas as suas subtarefas são deletadas.
-- =============================================

create table if not exists public.objectives (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade not null,
  title       text not null,
  description text,
  deadline    date,
  status      text check (status in ('active', 'done')) default 'active',
  progress    integer default 0 check (progress >= 0 and progress <= 100),
  created_at  timestamp with time zone default now(),
  updated_at  timestamp with time zone default now()
);

create index if not exists objectives_user_id_idx on public.objectives(user_id);

drop trigger if exists objectives_updated_at on public.objectives;
create trigger objectives_updated_at
  before update on public.objectives
  for each row execute procedure public.handle_updated_at();

alter table public.objectives enable row level security;

create policy "Usuários veem apenas seus próprios objetivos"
  on public.objectives for select using (auth.uid() = user_id);

create policy "Usuários inserem apenas seus próprios objetivos"
  on public.objectives for insert with check (auth.uid() = user_id);

create policy "Usuários editam apenas seus próprios objetivos"
  on public.objectives for update using (auth.uid() = user_id);

create policy "Usuários excluem apenas seus próprios objetivos"
  on public.objectives for delete using (auth.uid() = user_id);

-- Vínculo tarefa → objetivo (cascade: tarefa deletada junto com o objetivo)
alter table public.tasks
  add column if not exists objective_id uuid
  references public.objectives(id) on delete cascade;

create index if not exists tasks_objective_id_idx on public.tasks(objective_id);

-- =============================================
-- Migration 8: prioridade dos objetivos
-- ---------------------------------------------
-- Cada objetivo passa a ter um nível de prioridade (low/medium/high).
-- A listagem ordena por prioridade: alta → média → baixa.
-- =============================================

alter table public.objectives
  add column if not exists priority text
  check (priority in ('low', 'medium', 'high')) default 'medium';

-- =============================================
-- Migration 9: subtarefas (checklist dentro de uma tarefa)
-- ---------------------------------------------
-- Cada tarefa pode ter N subtarefas simples (título + feita/não feita).
-- Ao marcar/desmarcar uma subtarefa o progresso da tarefa mãe é recalculado.
-- Cascade: ao deletar a tarefa mãe, todas as subtarefas somem junto.
-- =============================================

create table if not exists public.subtasks (
  id         uuid default gen_random_uuid() primary key,
  task_id    uuid references public.tasks(id) on delete cascade not null,
  user_id    uuid references auth.users(id) on delete cascade not null,
  title      text not null,
  done       boolean default false not null,
  position   integer default 0 not null,
  created_at timestamp with time zone default now()
);

create index if not exists subtasks_task_id_idx on public.subtasks(task_id);
create index if not exists subtasks_user_id_idx on public.subtasks(user_id);

alter table public.subtasks enable row level security;

create policy "subtasks_select" on public.subtasks for select using (auth.uid() = user_id);
create policy "subtasks_insert" on public.subtasks for insert with check (auth.uid() = user_id);
create policy "subtasks_update" on public.subtasks for update using (auth.uid() = user_id);
create policy "subtasks_delete" on public.subtasks for delete using (auth.uid() = user_id);

-- =============================================
-- Migration 10: exclusão de contas e bloqueio de e-mail por 60 dias
-- ---------------------------------------------
-- Quando um usuário exclui a conta, gravamos o e-mail aqui.
-- O endpoint de registro verifica se o e-mail está dentro do período de bloqueio.
-- Sem RLS: acessada apenas pelo backend (service_role).
-- =============================================

create table if not exists public.deleted_accounts (
  id         uuid default gen_random_uuid() primary key,
  email      text not null,
  deleted_at timestamp with time zone default now() not null
);

create index if not exists deleted_accounts_email_idx on public.deleted_accounts(email);

-- =============================================
-- Migration 11: período de pico de produtividade no registro diário
-- ---------------------------------------------
-- Permite que o usuário informe em qual(is) período(s) do dia se sentiu
-- mais produtivo. Usado pelo serviço de calibração para personalizar os
-- blocos de foco. Array de até 2 slugs.
-- =============================================

alter table public.daily_logs
  add column if not exists peak_periods text[] default '{}';

-- =============================================
-- Migration 12: perfil de energia personalizado por usuário
-- ---------------------------------------------
-- Armazena os 16 scores de foco (blocos de 90 min) calibrados
-- a partir do comportamento real do usuário. Inicializado com os
-- valores do cronotipo base e ajustado a cada registro diário.
-- Sem RLS: acesso exclusivo via service_role no backend.
-- =============================================

create table if not exists public.user_energy_profiles (
  user_id         uuid references auth.users(id) on delete cascade primary key,
  block_scores    jsonb not null,           -- array de 16 floats (0–100)
  data_points     integer default 0 not null,
  last_calibrated timestamp with time zone,
  created_at      timestamp with time zone default now()
);

-- =============================================
-- Migration 13: snapshot diário congelado de conclusão de tarefas
-- ---------------------------------------------
-- Congela, no fim de cada dia local do usuário, os números REAIS daquele dia
-- (incluindo as pendentes que estão prestes a ser carregadas). Sem isso, o
-- carry-forward reescrevia o scheduled_date das pendentes e todo dia passado
-- exibia falso 100% de conclusão no Planning e no Insights.
-- Escrita/leitura exclusivamente pelo backend (service_role) — sem RLS.
--   completed_score  = pontuação proporcional (subtarefas contam fração)
--   completed_items  = itens 100% concluídos, INCLUI eventos (texto "X de Y" + anel)
--   completed_tasks  = tarefas concluídas por esforço (status 'done'), SEM eventos
--                      auto-concluídos → métrica de produtividade do Insights
--   completion_rate  = round(completed_score / total * 100)
-- =============================================

create table if not exists public.daily_task_stats (
  user_id         uuid references auth.users(id) on delete cascade not null,
  date            date not null,
  total           integer default 0 not null,
  completed_items integer default 0 not null,
  completed_tasks integer default 0 not null,
  completed_score numeric default 0 not null,
  completion_rate integer default 0 not null,
  carried_forward integer default 0 not null,
  created_at      timestamp with time zone default now(),
  primary key (user_id, date)
);

create index if not exists daily_task_stats_user_date_idx
  on public.daily_task_stats(user_id, date desc);

-- Para quem já rodou a versão anterior desta migration (sem completed_tasks):
-- o create table if not exists acima não altera a tabela existente, então
-- garantimos a coluna à parte. Idempotente.
alter table public.daily_task_stats
  add column if not exists completed_tasks integer default 0 not null;

-- =============================================
-- Migration 14: no máximo uma melhoria (improvement) ABERTA por usuário
-- ---------------------------------------------
-- Bug: duas análises concorrentes (POST /notifications/analyze é disparado
-- pelo frontend ao abrir/voltar à tela) passavam ambas pela checagem "há
-- melhoria pendente?" antes de qualquer uma inserir → o Axon criava 2
-- sugestões, ambas apontando para o MESMO horário livre.
-- "Aberta" = status unread/read E não expirada. A melhoria expira quando o
-- horário sugerido passa (expired_at preenchido pelo backend), para uma
-- sugestão esquecida não silenciar o Axon para sempre. O índice único parcial
-- impõe a invariante de forma ATÔMICA no banco, fechando a corrida.
-- =============================================

alter table public.notifications
  add column if not exists expired_at timestamp with time zone;

create unique index if not exists notifications_one_open_improvement
  on public.notifications(user_id)
  where type = 'improvement' and status in ('unread', 'read') and expired_at is null;

-- =============================================
-- Migration 15: cache de "Descobertas do Axon" (correlações reais)
-- ---------------------------------------------
-- Card novo na aba Insights, separado do /insights/patterns existente.
-- O BACKEND calcula as correlações (services/correlations_service.py —
-- varredura genérica condição × métrica, mesmo dia e dia seguinte, com
-- mínimo de 5 dias por grupo); o Claude só traduz os números já corretos em
-- frases. Cache de 7 dias (correlação não muda de um dia para o outro) — TTL
-- maior que o de axon_insights (24h). Mesmo padrão de axon_insights: só o
-- backend (service_role) acessa, sem RLS.
-- =============================================

create table if not exists public.axon_discoveries (
  user_id      uuid references auth.users(id) on delete cascade primary key,
  findings     jsonb not null,
  data_points  integer default 0 not null,
  generated_at timestamp with time zone not null,
  created_at   timestamp with time zone default now()
);

-- =============================================
-- Migration 16: colunas de preferências de planejamento em profiles
-- ---------------------------------------------
-- Bug (2026-07-02): planning_scheduler.py e routers/profile.py já liam/gravavam
-- estas 6 colunas (ver models/schemas.py:PlanningPreferences), mas a migration
-- que as criava nunca foi escrita — a tabela profiles nunca teve essas colunas.
-- Efeito: o scheduler (roda a cada minuto) falhava a query para TODOS os
-- usuários de uma vez ("column profiles.daily_use_chronotype does not exist"),
-- e GET/PATCH /profile/planning-preferences também deveria estar quebrado.
-- Defaults idênticos aos do Pydantic (PlanningPreferences) para não mudar o
-- comportamento de quem nunca configurou nada.
-- =============================================

alter table public.profiles
  add column if not exists daily_planning_enabled  boolean not null default true,
  add column if not exists daily_planning_time     text,
  add column if not exists daily_use_chronotype    boolean not null default true,
  add column if not exists weekly_planning_enabled boolean not null default true,
  add column if not exists weekly_planning_day     integer,
  add column if not exists weekly_use_chronotype    boolean not null default true;

-- =============================================
-- Migration 17: Canal do Axon (conversa permanente + onboarding conversacional)
-- ---------------------------------------------
-- Nova feature: uma conversa fixa por usuário (conversation_type='axon_direct'),
-- criada automaticamente no primeiro GET /chat/conversations, com uma mensagem
-- de abertura fixa (não gerada por LLM) e um onboarding conversacional guiado
-- pelo system prompt até o usuário concluir (tool concluir_onboarding).
-- Nota: a tabela real de conversas neste projeto é "conversations" (não
-- "chat_conversations" como em versões antigas do plano) — mesma tabela usada
-- por routers/conversations.py.
-- =============================================

alter table public.conversations
  add column if not exists conversation_type varchar not null default 'regular';

alter table public.profiles
  add column if not exists axon_direct_onboarding_completed boolean not null default false;

-- =============================================
-- Migration 18: marcador explícito de "primeira execução do reconcile"
-- ---------------------------------------------
-- Bug (2026-07-02): daily_task_stats ficava permanentemente vazia para
-- usuários cujos primeiros dias de uso não tinham tarefas (fim de semana,
-- início de conta etc). reconcile() decidia "já rodei antes?" checando se
-- existe QUALQUER linha em daily_task_stats para o usuário — mas
-- snapshot_days() pula dias com total=0 (nada a congelar), então esses dias
-- nunca deixavam rastro. Sem rastro, reconcile ficava PRESO no ramo de
-- "primeira execução" para sempre, nunca avançando para congelar dias
-- passados de verdade — resultado: um dia com tarefas REALMENTE concluídas
-- (ex.: 2026-07-01) não tinha snapshot, e o Planning mostrava 0% (fallback
-- "?? 0" do frontend) em vez da % real.
-- Correção: coluna explícita em profiles, gravada na PRIMEIRA vez que
-- reconcile roda para o usuário, independente de haver linha em
-- daily_task_stats ou não.
-- =============================================

alter table public.profiles
  add column if not exists daily_stats_reconcile_started_at timestamp with time zone;

-- =============================================
-- Migration 19: relatórios narrativos semanal/mensal (weekly_reports)
-- ---------------------------------------------
-- Nova feature: services/report_service.py monta um resumo do período
-- ENCERRADO (semana anterior / mês anterior) a partir de dados já
-- calculados (daily_task_stats, consistência de rotinas, tarefas chave) e
-- pede ao Claude só a narrativa em texto — mesma filosofia do
-- correlations_service (backend calcula, Claude escreve).
-- Disparado pelo planning_scheduler: toda segunda 08h local (semanal) e
-- todo dia 1º do mês 08h local (mensal). Índice único garante no máximo um
-- relatório por usuário/tipo/período — upsert idempotente se o job rodar
-- de novo no mesmo minuto/janela.
-- =============================================

create table if not exists public.weekly_reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  period_type text check (period_type in ('weekly', 'monthly')) not null,
  period_start date not null,
  period_end date not null,
  data jsonb not null,
  narrative text not null,
  created_at timestamptz default now()
);

create unique index if not exists weekly_reports_user_period_idx
  on public.weekly_reports(user_id, period_type, period_start);

-- =============================================
-- Migration 20: rascunho do registro diário (daily_log_drafts)
-- ---------------------------------------------
-- Feature: o usuário abre o registro, preenche parte e fecha — ao reabrir
-- (em qualquer aparelho) os campos voltam preenchidos.
-- Tabela SEPARADA de daily_logs de propósito. Gravar rascunho na tabela real
-- quebraria três coisas que dependem de "linha em daily_logs = dia registrado":
--   1. insights.py conta len(logs) para destravar padrões (7) e descobertas
--      (10) — rascunhos vazios destravariam os insights sem dado real;
--   2. calibration_service.calibrate_from_log ajusta o perfil de energia a
--      cada save — calibrar com registro pela metade distorce os blocos;
--   3. memory_service.sync_dated_memory criaria memória de nota incompleta.
-- Um rascunho por usuário/dia (PK composta): reabrir sobrescreve o anterior.
-- O rascunho é apagado quando o registro é salvo de verdade (POST /daily-log/).
-- Sem RLS: só o backend (service_role) acessa, mesmo padrão de axon_insights.
-- =============================================

create table if not exists public.daily_log_drafts (
  user_id    uuid references auth.users(id) on delete cascade not null,
  date       date not null,
  data       jsonb not null,
  updated_at timestamptz default now() not null,
  primary key (user_id, date)
);

-- =============================================
-- Migration 21: relatórios — marcação de "visto" + histórico permanente
-- ---------------------------------------------
-- Mudança de comportamento (2026-08-03): antes o relatório só aparecia numa
-- janela fixa de 16h (20h do último dia do período até meio-dia do dia
-- seguinte) e depois ficava INACESSÍVEL para sempre, mesmo existindo no
-- banco — narrativa paga ao Claude que o usuário podia nunca ver.
-- Agora: o card fica no Dashboard desde a geração ATÉ O USUÁRIO VER, e
-- depois disso o relatório continua acessível para sempre no histórico
-- (Perfil), permitindo comparar semanas e meses.
-- `seen_at` nulo = ainda não visto (aparece no Dashboard).
-- =============================================

alter table public.weekly_reports
  add column if not exists seen_at timestamptz;

-- Busca do card do Dashboard: "meus relatórios ainda não vistos".
create index if not exists weekly_reports_user_unseen_idx
  on public.weekly_reports(user_id, period_type, period_start desc)
  where seen_at is null;

-- =============================================
-- Migration 22: device_tokens — entrega de push (FCM)
-- ---------------------------------------------
-- Fase 3 do plano da Play Store. Até aqui as notificações do Axon só existiam
-- dentro do app: quem não abrisse, não via. Esta tabela guarda o endereço de
-- cada aparelho (o registration token do FCM) para que o backend consiga
-- entregar a notificação na tela de bloqueio.
--
-- Um usuário pode ter vários aparelhos, e o MESMO aparelho pode ser usado por
-- contas diferentes (celular emprestado, conta de teste). Por isso a unicidade
-- é do token sozinho, não do par (user_id, token): o FCM emite um token por
-- instalação do app, e ele precisa pertencer a um único usuário por vez — senão
-- o dono anterior continuaria recebendo os push do novo.
--
-- `last_seen_at` permite limpar tokens de aparelhos que sumiram há meses.
-- =============================================

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null default 'android',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Envio: "todos os aparelhos deste usuário".
create index if not exists device_tokens_user_idx
  on public.device_tokens(user_id);

-- =============================================
-- Migration 23: dia livre + até 3 períodos de pico ORDENADOS
-- ---------------------------------------------
-- Duas mudanças no registro diário (DayReview).
--
-- 1) `peak_periods` passa de no máximo 2 para no máximo 3 períodos, e a ORDEM
--    do array passa a ser significativa: posição 0 = período mais produtivo,
--    1 = segundo, 2 = terceiro. Não há mudança de tipo — text[] já preserva a
--    ordem de inserção — então os registros antigos continuam válidos: um
--    array de 1 ou 2 itens simplesmente não usa as posições seguintes. O que
--    muda é quem LÊ: a calibração agora pondera por posição (ver
--    calibration_service.PEAK_RANK_WEIGHT) em vez de tratar todos como iguais.
--    Por isso não existe migração de dados aqui — só de interpretação.
--
-- 2) `is_day_off`: o usuário marca que aquele dia foi de descanso deliberado.
--    Sem isso, um domingo de folga é indistinguível de um dia perdido: ambos
--    aparecem como produtividade 1 e zero tarefas. Os insights já vinham
--    lendo esses dias como "seu ponto mais baixo da semana", quando na
--    verdade eram descanso planejado.
--
--    NOT NULL DEFAULT false: registro antigo não vira "dia livre" por omissão,
--    e o backend nunca precisa tratar NULL como um terceiro estado.
-- =============================================

alter table public.daily_logs
  add column if not exists is_day_off boolean not null default false;

comment on column public.daily_logs.is_day_off is
  'Dia de descanso deliberado. Distingue folga planejada de dia improdutivo — a análise de produtividade deve excluir estes dias em vez de contá-los como baixo desempenho.';

comment on column public.daily_logs.peak_periods is
  'Até 3 slugs de período, ORDENADOS por produtividade percebida: posição 0 = mais produtivo. Arrays de tamanho 1-2 (registros anteriores à Migration 23) permanecem válidos.';

-- =============================================
-- Migration 24: dias em que o usuário abriu mão da ofensiva
-- ---------------------------------------------
-- A ofensiva do registro diário (foguinho) não admite buracos: um dia sem
-- registro a encerra. O app dá uma folga real ao aceitar registro retroativo
-- de ontem — quem passou o dia longe do app ainda salva a sequência no dia
-- seguinte.
--
-- Quando a ofensiva está em risco e o usuário fecha o pop-up do registro, ele
-- vê um aviso e pode confirmar que NÃO vai registrar. Esta tabela guarda essa
-- desistência: o dia deixa de contar mesmo que ele mude de ideia e registre
-- dentro do prazo.
--
-- Por que uma tabela e não uma coluna em daily_logs: o dia desistido é
-- justamente aquele que NÃO tem registro — não existe linha em daily_logs para
-- receber a marca.
--
-- Por que no banco e não em localStorage: reinstalar o app ou trocar de
-- aparelho apagaria a marcação, e ela não valeria entre web e mobile.
--
-- A PK composta (user_id, date) torna a operação idempotente: confirmar duas
-- vezes o mesmo dia não cria linha duplicada.
-- =============================================

create table if not exists public.streak_forfeits (
  user_id    uuid not null references auth.users(id) on delete cascade,
  date       date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Leitura sempre por usuário + janela de datas (cálculo da ofensiva).
create index if not exists streak_forfeits_user_date_idx
  on public.streak_forfeits(user_id, date desc);
