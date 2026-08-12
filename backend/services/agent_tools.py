"""
Ferramentas (function calling) do agente Axon.

Define as tools no formato do Anthropic SDK e um dispatcher `execute_tool` que
executa a ação de verdade via tasks_service, sempre respeitando o user_id do
usuário logado.

Datas devem ser passadas pelo modelo no formato YYYY-MM-DD e horários como HH:MM.
"""

from datetime import date, datetime, timedelta

from database import supabase
from services import (
    tasks_service,
    memory_service,
    notification_service,
    objectives_service,
    routines_service,
    subtasks_service,
    user_tz,
)

# --- Resolução determinística de datas relativas ---------------------------
# O modelo erra ao TRANSCREVER datas absolutas (ex.: escreve 2026-06-17 quando
# hoje é 2026-06-18), mas acerta o SENTIDO relativo ("hoje", "amanhã", "sexta").
# Por isso aceitamos a palavra-chave e calculamos a data exata aqui, no fuso do
# usuário — eliminando a aritmética de data do modelo de vez.
_REL_DATES = {
    "hoje": 0,
    "amanhã": 1, "amanha": 1,
    "depois de amanhã": 2, "depois de amanha": 2,
    "ontem": -1,
}
_WEEKDAYS = {
    "segunda": 0, "segunda-feira": 0,
    "terça": 1, "terca": 1, "terça-feira": 1, "terca-feira": 1,
    "quarta": 2, "quarta-feira": 2,
    "quinta": 3, "quinta-feira": 3,
    "sexta": 4, "sexta-feira": 4,
    "sábado": 5, "sabado": 5,
    "domingo": 6,
}

# Campos cujo valor pode chegar como palavra-chave relativa e precisa virar data.
_RESOLVABLE_DATE_FIELDS = ("scheduled_date", "end_date", "deadline")


def _resolve_date(value, today):
    """
    Converte 'hoje'/'amanhã'/'sexta'/... para AAAA-MM-DD usando `today` (já no
    fuso do usuário). Se já vier uma data AAAA-MM-DD (ou qualquer outra coisa),
    devolve sem alterar — o banco valida o formato final.
    """
    if not isinstance(value, str):
        return value
    key = value.strip().lower()
    if key in _REL_DATES:
        return (today + timedelta(days=_REL_DATES[key])).isoformat()
    if key in _WEEKDAYS:
        delta = (_WEEKDAYS[key] - today.weekday()) % 7  # próxima ocorrência (0 = hoje)
        return (today + timedelta(days=delta)).isoformat()
    return value


def _resolve_date_fields(tool_input: dict, tz_name: str | None) -> dict:
    """Devolve uma cópia de tool_input com os campos de data resolvidos."""
    today = datetime.now(user_tz.zone(tz_name)).date()
    resolved = dict(tool_input)
    for field in _RESOLVABLE_DATE_FIELDS:
        if field in resolved:
            resolved[field] = _resolve_date(resolved[field], today)
    return resolved


def _resolve_to_date(value, today: date) -> date | None:
    """Resolve uma palavra-chave/ISO para um objeto date (ou None se vazio)."""
    if not value:
        return None
    iso = _resolve_date(value, today)
    try:
        return date.fromisoformat(iso)
    except (ValueError, TypeError):
        return None

# Rótulos e formas para as notificações de alteração geradas por templates.
_TYPE_LABEL = {"task": "Tarefa", "event": "Evento", "routine": "Rotina"}
_TYPE_ADJ = {  # (criada, atualizada, removida) — concordância de gênero
    "task": ("criada", "atualizada", "removida"),
    "event": ("criado", "atualizado", "removido"),
    "routine": ("criada", "atualizada", "removida"),
}
_VERB = ("criou", "atualizou", "removeu")  # invariável


def _notify_routine_change(user_id: str, action: str, routine: dict) -> None:
    """
    Envia notificação após o agente criar/pausar/retomar/deletar uma rotina.
    action: 'criar' | 'pausar' | 'retomar' | 'deletar'
    Nunca quebra a operação principal.
    """
    try:
        name = routine.get("name") or "rotina"
        item_count = routine.get("item_count", 0)

        if action == "criar":
            title = "Rotina criada"
            body = f'O Axon criou a rotina "{name}"'
            if item_count:
                body += f" com {item_count} {'item' if item_count == 1 else 'itens'}"
            body += "."
        elif action == "pausar":
            title = "Rotina pausada"
            paused_until = routine.get("paused_until")
            body = f'O Axon pausou a rotina "{name}"'
            body += f" até {paused_until}." if paused_until else "."
        elif action == "retomar":
            title = "Rotina retomada"
            body = f'O Axon retomou a rotina "{name}".'
        else:  # deletar
            title = "Rotina removida"
            body = f'O Axon removeu a rotina "{name}".'

        notification_service.create_notification(user_id, "change", title, body)
    except Exception:
        pass  # notificação é secundária — nunca falha a ação do agente


def _notify_task_change(user_id: str, idx: int, task: dict) -> None:
    """
    Cria uma notificação de alteração (template) após o agente mexer numa tarefa.
    idx: 0=criar, 1=atualizar, 2=deletar. Nunca quebra a operação principal.
    """
    try:
        ttype = task.get("task_type", "task")
        label = _TYPE_LABEL.get(ttype, "Tarefa")
        adj = _TYPE_ADJ.get(ttype, _TYPE_ADJ["task"])[idx]
        title = f"{label} {adj}"

        body = f'O Axon {_VERB[idx]} "{task.get("title", "")}"'
        if idx != 2:  # criar/atualizar incluem quando
            if task.get("scheduled_date"):
                body += f" para {task['scheduled_date']}"
            if task.get("start_time"):
                body += f" às {task['start_time'][:5]}"
        body += "."

        notification_service.create_notification(user_id, "change", title, body)
    except Exception:
        pass  # notificação é secundária — nunca falha a ação do agente

# Nomes das tools que ALTERAM o estado das tarefas (usado pelo chat para sinalizar
# ao frontend que o Planejamento precisa ser recarregado).
MUTATING_TOOLS = {
    "criar_tarefa", "atualizar_tarefa", "deletar_tarefa",
    "criar_rotina", "pausar_rotina", "retomar_rotina", "deletar_rotina",
    "criar_objetivo", "atualizar_objetivo", "deletar_objetivo",
    "criar_subtarefa", "atualizar_subtarefa", "deletar_subtarefa",
}

# Rótulos legíveis em PT-BR para o indicador de ação no chat.
TOOL_LABELS = {
    "criar_tarefa": "Criando tarefa",
    "listar_tarefas": "Consultando tarefas",
    "atualizar_tarefa": "Atualizando tarefa",
    "deletar_tarefa": "Removendo tarefa",
    "salvar_memoria": "Registrando aprendizado",
    "listar_memorias": "Consultando aprendizados",
    "atualizar_memoria": "Atualizando aprendizado",
    "criar_rotina": "Criando rotina",
    "listar_rotinas": "Consultando rotinas",
    "pausar_rotina": "Pausando rotina",
    "retomar_rotina": "Retomando rotina",
    "deletar_rotina": "Removendo rotina",
    "criar_objetivo": "Criando objetivo",
    "listar_objetivos": "Consultando objetivos",
    "atualizar_objetivo": "Atualizando objetivo",
    "listar_etapas": "Consultando etapas",
    "deletar_objetivo": "Removendo objetivo",
    "criar_subtarefa": "Adicionando subtarefa",
    "listar_subtarefas": "Consultando subtarefas",
    "atualizar_subtarefa": "Atualizando subtarefa",
    "deletar_subtarefa": "Removendo subtarefa",
    "concluir_onboarding": "Concluindo onboarding",
}

_TASK_TYPE = {"type": "string", "enum": ["task", "event", "routine"]}
_PRIORITY = {"type": "string", "enum": ["low", "medium", "high"]}
_STATUS = {"type": "string", "enum": ["todo", "progress", "done", "scheduled"]}
_DATE = {"type": "string", "description": "Data no formato YYYY-MM-DD"}
_TIME = {"type": "string", "description": "Horário no formato HH:MM"}

TOOLS = [
    {
        "name": "criar_tarefa",
        "description": (
            "Cria uma tarefa ou evento PONTUAL (que acontece uma vez) para o usuário. "
            "Use quando o usuário pedir para adicionar/agendar algo avulso. Se for algo "
            "recorrente em dias da semana (hábito ou rotina), use criar_rotina em vez "
            "desta. Confirme título e horário antes de criar se houver ambiguidade."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título curto da tarefa"},
                "description": {"type": "string"},
                "task_type": {**_TASK_TYPE, "description": "Padrão: task"},
                "priority": {**_PRIORITY, "description": "Padrão: medium"},
                "scheduled_date": _DATE,
                "end_date": {**_DATE, "description": "Data final para eventos de múltiplos dias (YYYY-MM-DD). Omitir se não for evento multi-dia."},
                "start_time": _TIME,
                "end_time": _TIME,
                "location": {"type": "string", "description": "Local ou link (eventos)"},
                "deadline": _DATE,
                "is_key_task": {
                    "type": "boolean",
                    "description": (
                        "Marca esta tarefa como a tarefa chave do dia — a única que, "
                        "se feita, torna o dia bem-sucedido. Só pode existir uma por dia; "
                        "marcar uma nova desmarca a anterior automaticamente. Use quando o "
                        "usuário indicar claramente qual é a prioridade máxima do dia."
                    ),
                },
                "objective_id": {
                    "type": "string",
                    "description": (
                        "UUID do objetivo ao qual esta tarefa pertence. Use quando o usuário "
                        "estiver adicionando uma etapa a um objetivo existente. "
                        "Descubra o id correto com listar_objetivos antes."
                    ),
                },
            },
            "required": ["title"],
        },
    },
    {
        "name": "listar_tarefas",
        "description": (
            "Lista as tarefas do usuário, com filtros opcionais. Use para responder "
            "perguntas como 'o que tenho amanhã?' ou antes de atualizar/deletar uma "
            "tarefa específica (para descobrir o id correto)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "scheduled_date": _DATE,
                "status": _STATUS,
                "task_type": _TASK_TYPE,
            },
        },
    },
    {
        "name": "atualizar_tarefa",
        "description": (
            "Atualiza campos de uma tarefa existente (ex.: marcar como concluída, "
            "mudar horário ou prioridade). Use listar_tarefas antes se não souber o id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "id (UUID) da tarefa"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "task_type": _TASK_TYPE,
                "status": _STATUS,
                "priority": _PRIORITY,
                "scheduled_date": _DATE,
                "end_date": {**_DATE, "description": "Data final para eventos de múltiplos dias. Use null para remover."},
                "start_time": _TIME,
                "end_time": _TIME,
                "progress": {"type": "integer", "description": "0 a 100"},
                "location": {"type": "string"},
                "deadline": _DATE,
                "is_key_task": {
                    "type": "boolean",
                    "description": (
                        "True para marcar como tarefa chave do dia; false para desmarcar. "
                        "Marcar uma nova desmarca a anterior do mesmo dia automaticamente."
                    ),
                },
                "objective_id": {
                    "type": "string",
                    "description": "UUID do objetivo ao qual esta tarefa pertence (para mover entre objetivos ou desvincular).",
                },
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "deletar_tarefa",
        "description": "Remove permanentemente uma tarefa do usuário pelo id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "id (UUID) da tarefa"},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "listar_memorias",
        "description": (
            "Lista todas as memórias salvas sobre o usuário, com seus IDs. "
            "Use antes de atualizar_memoria para descobrir o id da memória que precisa ser alterada."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "atualizar_memoria",
        "description": (
            "Atualiza uma memória existente quando uma informação sobre o usuário mudar. "
            "Use listar_memorias antes para descobrir o id correto. "
            "Escreva o novo conteúdo em terceira pessoa, de forma concisa (máx. 120 caracteres)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "memory_id": {
                    "type": "string",
                    "description": "id (UUID) da memória a atualizar",
                },
                "new_content": {
                    "type": "string",
                    "description": "Novo conteúdo corrigido da memória (máx. 120 chars)",
                },
            },
            "required": ["memory_id", "new_content"],
        },
    },
    {
        "name": "salvar_memoria",
        "description": (
            "Salva um aprendizado ou informação relevante sobre o usuário para uso futuro. "
            "Use quando o usuário revelar algo que muda como você deve interagir com ele: "
            "preferências, padrões de comportamento, contexto de vida, metas, dificuldades "
            "recorrentes ou qualquer informação que tornaria futuras respostas mais úteis. "
            "NÃO use para registrar tarefas — use criar_tarefa para isso. "
            "Escreva o conteúdo em terceira pessoa, de forma concisa (máx. 120 caracteres). "
            "Exemplo: 'Tem dificuldade para iniciar tarefas complexas antes das 10h.'"
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Frase concisa em português descrevendo o aprendizado (máx. 120 chars)",
                }
            },
            "required": ["content"],
        },
    },
    {
        "name": "criar_rotina",
        "description": (
            "Cria uma ROTINA recorrente nomeada com um ou mais itens (ex.: 'Estudos' "
            "com 'Matemática seg/qua/sex'). Diferente de criar_tarefa: a rotina gera "
            "automaticamente as tarefas dos próximos dias e o Axon encaixa os itens "
            "flexíveis nos melhores blocos de energia do cronotipo. Use quando o "
            "usuário falar de algo que se repete em dias da semana — sempre isto, e "
            "não criar_tarefa, para qualquer coisa recorrente. "
            "Cada item é FIXO (start_time + end_time) OU FLEXÍVEL (duration_minutes), "
            "nunca os dois. days_of_week usa 0=segunda, 1=terça, 2=quarta, 3=quinta, "
            "4=sexta, 5=sábado, 6=domingo."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nome da rotina (ex.: 'Estudos')"},
                "items": {
                    "type": "array",
                    "description": "Itens da rotina (pelo menos 1).",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Título do item"},
                            "days_of_week": {
                                "type": "array",
                                "items": {"type": "integer", "minimum": 0, "maximum": 6},
                                "description": "Dias da semana (0=seg ... 6=dom)",
                            },
                            "start_time": {**_TIME, "description": "Início (item fixo)"},
                            "end_time": {**_TIME, "description": "Fim (item fixo)"},
                            "duration_minutes": {
                                "type": "integer",
                                "description": "Duração em minutos (item flexível — o Axon escolhe o horário)",
                            },
                            "not_before": {
                                **_TIME,
                                "description": (
                                    "Só para itens flexíveis (duration_minutes). "
                                    "O Axon não agendará este item antes deste horário. "
                                    "Use quando o usuário indicar uma preferência de janela: "
                                    "'depois do almoço' → '13:00', 'à tarde' → '13:00', "
                                    "'à noite' → '19:00', 'depois das 15h' → '15:00'."
                                ),
                            },
                            "not_after": {
                                **_TIME,
                                "description": (
                                    "Só para itens flexíveis (duration_minutes). "
                                    "O Axon não agendará este item depois deste horário. "
                                    "Use quando o usuário quiser um limite superior: "
                                    "'de manhã' → '12:00', 'antes do almoço' → '12:00', "
                                    "'antes das 10h' → '10:00'."
                                ),
                            },
                        },
                        "required": ["title", "days_of_week"],
                    },
                },
                "start_date": {**_DATE, "description": "Data de início. Padrão: hoje. Aceita 'hoje'/'amanhã'/dia da semana."},
                "end_date": {**_DATE, "description": "Data final (opcional). Omitir para rotina sem fim."},
            },
            "required": ["name", "items"],
        },
    },
    {
        "name": "listar_rotinas",
        "description": (
            "Lista as rotinas do usuário (ativas e pausadas) com nome, status, "
            "número de itens e streak. Use antes de pausar/retomar/deletar uma rotina "
            "para descobrir o id correto."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "pausar_rotina",
        "description": (
            "Pausa uma rotina: remove as tarefas futuras que ela geraria. Use "
            "listar_rotinas antes para descobrir o id. paused_until é opcional — "
            "se informado, indica até quando fica pausada."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "routine_id": {"type": "string", "description": "id (UUID) da rotina"},
                "paused_until": {**_DATE, "description": "Pausar até esta data (opcional)"},
            },
            "required": ["routine_id"],
        },
    },
    {
        "name": "retomar_rotina",
        "description": (
            "Retoma uma rotina pausada, regerando as tarefas a partir de hoje. "
            "Use listar_rotinas antes para descobrir o id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "routine_id": {"type": "string", "description": "id (UUID) da rotina"},
            },
            "required": ["routine_id"],
        },
    },
    {
        "name": "deletar_rotina",
        "description": (
            "Remove permanentemente uma rotina e suas tarefas futuras. As tarefas "
            "passadas/concluídas permanecem no histórico. Use listar_rotinas antes "
            "para descobrir o id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "routine_id": {"type": "string", "description": "id (UUID) da rotina"},
            },
            "required": ["routine_id"],
        },
    },

    # --- Objetivos -----------------------------------------------------------
    {
        "name": "criar_objetivo",
        "description": (
            "Cria um objetivo: uma meta maior composta por etapas (subtarefas) que "
            "serão distribuídas ao longo do tempo. Use quando o usuário falar de algo "
            "que levará dias, semanas ou meses e tem um resultado final claro "
            "(ex.: 'fazer o TCC', 'lançar o app', 'aprender inglês'). "
            "Após criar o objetivo, use criar_tarefa com objective_id para adicionar etapas."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Nome do objetivo"},
                "description": {"type": "string", "description": "Contexto ou meta detalhada (opcional)"},
                "deadline": {**_DATE, "description": "Prazo final do objetivo (opcional, mas recomendado para distribuir etapas)"},
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Prioridade do objetivo (low/medium/high). Objetivos de prioridade alta aparecem no topo da lista. Padrão: medium.",
                },
            },
            "required": ["title"],
        },
    },
    {
        "name": "listar_objetivos",
        "description": (
            "Lista todos os objetivos do usuário com progresso, prazo e contagem de etapas. "
            "Use antes de atualizar, deletar ou adicionar etapas a um objetivo específico "
            "para descobrir o id correto."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "atualizar_objetivo",
        "description": "Atualiza título, descrição, prazo ou prioridade de um objetivo existente.",
        "input_schema": {
            "type": "object",
            "properties": {
                "objective_id": {"type": "string", "description": "id (UUID) do objetivo"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "deadline": _DATE,
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "Prioridade do objetivo (low/medium/high).",
                },
            },
            "required": ["objective_id"],
        },
    },
    {
        "name": "listar_etapas",
        "description": (
            "Lista as etapas (subtarefas) de um objetivo específico com status e data agendada. "
            "Use para dar um overview do progresso ou antes de atualizar/deletar uma etapa."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "objective_id": {"type": "string", "description": "id (UUID) do objetivo"},
            },
            "required": ["objective_id"],
        },
    },
    {
        "name": "deletar_objetivo",
        "description": (
            "Remove permanentemente um objetivo E todas as suas etapas (cascade). "
            "Use listar_objetivos antes para identificar o id. Exige confirmação do usuário."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "objective_id": {"type": "string", "description": "id (UUID) do objetivo"},
            },
            "required": ["objective_id"],
        },
    },

    # --- Subtarefas (checklist dentro de uma tarefa) -------------------------
    {
        "name": "criar_subtarefa",
        "description": (
            "Adiciona uma subtarefa (item de checklist) a uma tarefa existente. "
            "Use quando o usuário quiser detalhar os passos de uma tarefa específica. "
            "Descubra o task_id correto com listar_tarefas antes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "id (UUID) da tarefa mãe"},
                "title": {"type": "string", "description": "Título da subtarefa"},
            },
            "required": ["task_id", "title"],
        },
    },
    {
        "name": "listar_subtarefas",
        "description": "Lista as subtarefas de uma tarefa específica com status done/pendente.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "id (UUID) da tarefa mãe"},
            },
            "required": ["task_id"],
        },
    },
    {
        "name": "atualizar_subtarefa",
        "description": "Atualiza o título ou marca uma subtarefa como feita/não feita.",
        "input_schema": {
            "type": "object",
            "properties": {
                "subtask_id": {"type": "string", "description": "id (UUID) da subtarefa"},
                "title": {"type": "string", "description": "Novo título (opcional)"},
                "done": {"type": "boolean", "description": "true = concluída, false = pendente"},
            },
            "required": ["subtask_id"],
        },
    },
    {
        "name": "deletar_subtarefa",
        "description": "Remove uma subtarefa do checklist de uma tarefa.",
        "input_schema": {
            "type": "object",
            "properties": {
                "subtask_id": {"type": "string", "description": "id (UUID) da subtarefa"},
            },
            "required": ["subtask_id"],
        },
    },

    # --- Canal do Axon (onboarding) -------------------------------------------
    {
        "name": "concluir_onboarding",
        "description": (
            "Marca o onboarding do Canal do Axon como concluído. Chame esta "
            "ferramenta somente depois de ter feito a última pergunta da lista "
            "de onboarding e o usuário ter respondido (ou quando ele pedir para "
            "pular o onboarding). Depois disso o canal vira conversa livre."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
]

# Tools que só devem ser oferecidas ao modelo em contextos específicos (fora
# da lista padrão de TOOLS). Hoje só concluir_onboarding, restrita à conversa
# axon_direct — ver claude_service.stream_chat_with_tools.
_AXON_DIRECT_ONLY_TOOLS = {"concluir_onboarding"}


def tools_for_conversation(conversation_type: str) -> list[dict]:
    """Filtra TOOLS conforme o tipo de conversa (ex.: concluir_onboarding só em axon_direct)."""
    if conversation_type == "axon_direct":
        return TOOLS
    return [t for t in TOOLS if t["name"] not in _AXON_DIRECT_ONLY_TOOLS]


def execute_tool(name: str, tool_input: dict, user_id: str, tz_name: str | None = None) -> dict:
    """Executa a tool e devolve um dict serializável para o tool_result."""
    try:
        # Resolve palavras-chave de data ('hoje', 'amanhã', dia da semana) para
        # AAAA-MM-DD no fuso do usuário para QUALQUER tool com campo de data.
        # Antes só criar/atualizar resolviam, então listar_tarefas(scheduled_date='hoje')
        # vazava a palavra crua para o filtro do banco (coluna date) e quebrava com
        # "invalid input syntax for type date". _resolve_date_fields só mexe nos campos
        # de data presentes, então é seguro rodar em todas as tools.
        tool_input = _resolve_date_fields(tool_input, tz_name)

        if name == "criar_tarefa":
            task = tasks_service.create_task(
                user_id, {**tool_input, "created_by": "agent"},
                now=datetime.now(user_tz.zone(tz_name)),
            )
            _notify_task_change(user_id, 0, task)
            return {"ok": True, "task": task}

        if name == "listar_tarefas":
            tasks = tasks_service.list_tasks(
                user_id,
                scheduled_date=tool_input.get("scheduled_date"),
                status=tool_input.get("status"),
                task_type=tool_input.get("task_type"),
            )
            return {"ok": True, "count": len(tasks), "tasks": tasks}

        if name == "atualizar_tarefa":
            data = {k: v for k, v in tool_input.items() if k != "task_id"}
            task = tasks_service.update_task(user_id, tool_input["task_id"], data)
            _notify_task_change(user_id, 1, task)
            return {"ok": True, "task": task}

        if name == "deletar_tarefa":
            # Busca o título antes de remover, para a notificação de alteração
            tasks = tasks_service.list_tasks(user_id)
            task = next((t for t in tasks if t["id"] == tool_input["task_id"]), None)
            tasks_service.delete_task(user_id, tool_input["task_id"])
            if task:
                _notify_task_change(user_id, 2, task)
            return {"ok": True, "deleted": tool_input["task_id"]}

        if name == "listar_memorias":
            memories = memory_service.list_memories_with_ids(user_id)
            return {"ok": True, "count": len(memories), "memories": memories}

        if name == "atualizar_memoria":
            mem = memory_service.update_memory(
                user_id, tool_input["memory_id"], tool_input["new_content"]
            )
            return {"ok": True, "memory": mem}

        if name == "salvar_memoria":
            mem = memory_service.save_memory(user_id, tool_input["content"])
            return {"ok": True, "memory": mem}

        # --- Rotinas -------------------------------------------------------
        if name in ("criar_rotina", "pausar_rotina", "retomar_rotina",
                    "deletar_rotina", "listar_rotinas"):
            now = datetime.now(user_tz.zone(tz_name))
            today = now.date()

            if name == "criar_rotina":
                data = {
                    "name": tool_input["name"],
                    "items": tool_input.get("items") or [],
                    "start_date": _resolve_to_date(tool_input.get("start_date"), today),
                    "end_date": _resolve_to_date(tool_input.get("end_date"), today),
                }
                routine = routines_service.create_routine(user_id, data, today, now=now)
                _notify_routine_change(user_id, "criar", routine)
                return {"ok": True, "routine": routine}

            if name == "listar_rotinas":
                routines = routines_service.list_routines(user_id, today, now=now)
                return {"ok": True, "count": len(routines), "routines": routines}

            if name == "pausar_rotina":
                routine = routines_service.pause_routine(
                    user_id,
                    tool_input["routine_id"],
                    _resolve_to_date(tool_input.get("paused_until"), today),
                    today,
                )
                _notify_routine_change(user_id, "pausar", routine)
                return {"ok": True, "routine": routine}

            if name == "retomar_rotina":
                routine = routines_service.resume_routine(
                    user_id, tool_input["routine_id"], today, now=now
                )
                _notify_routine_change(user_id, "retomar", routine)
                return {"ok": True, "routine": routine}

            if name == "deletar_rotina":
                # Busca o nome antes de remover, para a notificação
                rotinas = routines_service.list_routines(user_id, today)
                rotina_alvo = next(
                    (r for r in rotinas if r["id"] == tool_input["routine_id"]), {}
                )
                routines_service.delete_routine(user_id, tool_input["routine_id"], today)
                _notify_routine_change(user_id, "deletar", rotina_alvo)
                return {"ok": True, "deleted": tool_input["routine_id"]}

        # --- Objetivos --------------------------------------------------------
        if name == "criar_objetivo":
            obj = objectives_service.create_objective(user_id, tool_input)
            return {"ok": True, "objective": obj}

        if name == "listar_objetivos":
            objs = objectives_service.list_objectives(user_id)
            return {"ok": True, "count": len(objs), "objectives": objs}

        if name == "atualizar_objetivo":
            data = {k: v for k, v in tool_input.items() if k != "objective_id"}
            obj = objectives_service.update_objective(user_id, tool_input["objective_id"], data)
            return {"ok": True, "objective": obj}

        if name == "listar_etapas":
            obj = objectives_service.get_objective(user_id, tool_input["objective_id"])
            return {"ok": True, "objective": obj["title"], "subtasks": obj.get("subtasks", [])}

        if name == "deletar_objetivo":
            objs = objectives_service.list_objectives(user_id)
            alvo = next((o for o in objs if o["id"] == tool_input["objective_id"]), {})
            objectives_service.delete_objective(user_id, tool_input["objective_id"])
            return {"ok": True, "deleted": alvo.get("title", tool_input["objective_id"])}

        # --- Subtarefas -------------------------------------------------------
        if name == "criar_subtarefa":
            sub = subtasks_service.create_subtask(
                user_id, tool_input["task_id"], {"title": tool_input["title"]}
            )
            return {"ok": True, "subtask": sub}

        if name == "listar_subtarefas":
            subs = subtasks_service.list_for_task(user_id, tool_input["task_id"])
            return {"ok": True, "count": len(subs), "subtasks": subs}

        if name == "atualizar_subtarefa":
            data = {k: v for k, v in tool_input.items() if k != "subtask_id"}
            sub = subtasks_service.update_subtask(user_id, tool_input["subtask_id"], data)
            return {"ok": True, "subtask": sub}

        if name == "deletar_subtarefa":
            subtasks_service.delete_subtask(user_id, tool_input["subtask_id"])
            return {"ok": True, "deleted": tool_input["subtask_id"]}

        # --- Canal do Axon ------------------------------------------------
        if name == "concluir_onboarding":
            supabase.table("profiles").update(
                {"axon_direct_onboarding_completed": True}
            ).eq("id", user_id).execute()
            return {"ok": True}

        return {"ok": False, "error": f"Ferramenta desconhecida: {name}"}
    except ValueError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:  # noqa: BLE001 — devolve erro ao modelo em vez de quebrar o stream
        return {"ok": False, "error": f"Erro inesperado: {e}"}
