from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional
from datetime import date, time
# Alias: o campo `date` de DailyLogCreate sombreia o nome dentro do corpo da
# classe — usar _date nos validators evita qualquer ambiguidade.
from datetime import date as _date


# --- Auth ---

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_id: str
    email: str
    name: Optional[str] = None
    has_chronotype: bool = False


# --- Classify ---

class ClassifyRequest(BaseModel):
    respostas: dict[str, str]
    qualidade_sono: str
    schedule_type: Optional[str] = None  # 'flexible' | 'fixed'


class ClassifyResponse(BaseModel):
    cronotipo: str
    pontos: dict[str, int]


# --- Profile ---

class ProfileResponse(BaseModel):
    name: Optional[str] = None
    email: str
    chronotype: Optional[str] = None
    chronotype_label: Optional[str] = None
    energy_peak: Optional[str] = None
    focus_window: Optional[str] = None
    schedule_type: Optional[str] = None
    avatar_url: Optional[str] = None
    has_chronotype: bool = False


class ProfileUpdate(BaseModel):
    name: Optional[str] = None


# --- Tag preferences ---

class TagItem(BaseModel):
    slug: str
    label: str


class TagPreferences(BaseModel):
    sleep: list[TagItem]
    mood: list[TagItem]
    productivity: list[TagItem]


# --- Planning Preferences ---

class PlanningPreferences(BaseModel):
    daily_planning_enabled:  bool          = True
    daily_planning_time:     Optional[str] = None   # "HH:MM"
    daily_use_chronotype:    bool          = True
    weekly_planning_enabled: bool          = True
    weekly_planning_day:     Optional[int] = None   # 0=Seg…6=Dom
    weekly_use_chronotype:   bool          = True


# --- Tasks ---

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: str = "task"          # 'task' | 'event' | 'routine'
    priority: Optional[str] = "medium"  # 'low' | 'medium' | 'high'
    scheduled_date: Optional[date] = None
    end_date: Optional[date] = None
    start_time: Optional[str] = None   # "HH:MM"
    end_time: Optional[str] = None     # "HH:MM"
    recurrence: Optional[str] = None   # 'daily' | 'weekly' | 'monthly'
    location: Optional[str] = None
    parent_task_id: Optional[str] = None
    group_name: Optional[str] = None
    deadline: Optional[date] = None
    created_by: str = "user"           # 'user' | 'agent'
    is_key_task: bool = False
    axon_pick_time: bool = False        # true = Axon escolhe o melhor horário pelo cronotipo
    duration_minutes: Optional[int] = None  # necessário quando axon_pick_time=True
    objective_id: Optional[str] = None  # UUID do objetivo ao qual esta tarefa pertence


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    status: Optional[str] = None       # 'todo' | 'progress' | 'done' | 'scheduled'
    priority: Optional[str] = None
    scheduled_date: Optional[date] = None
    end_date: Optional[date] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    progress: Optional[int] = None
    recurrence: Optional[str] = None
    location: Optional[str] = None
    group_name: Optional[str] = None
    deadline: Optional[date] = None
    is_key_task: Optional[bool] = None
    objective_id: Optional[str] = None


class TaskResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    task_type: str
    status: str
    priority: Optional[str] = None
    scheduled_date: Optional[str] = None
    end_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    progress: int = 0
    recurrence: Optional[str] = None
    location: Optional[str] = None
    parent_task_id: Optional[str] = None
    routine_item_id: Optional[str] = None
    objective_id: Optional[str] = None
    objective_title: Optional[str] = None
    group_name: Optional[str] = None
    deadline: Optional[str] = None
    created_by: str
    created_at: str
    completed_at: Optional[str] = None
    is_key_task: bool = False
    carry_count: int = 0


# --- Conversations ---

class ConversationCreate(BaseModel):
    title: str
    type: str = "general"  # general | planning | focus | project
    project_id: Optional[str] = None


class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    archived: Optional[bool] = None
    type: Optional[str] = None
    project_id: Optional[str] = None


class ConversationResponse(BaseModel):
    id: str
    title: str
    type: str
    archived: bool
    project_id: Optional[str] = None
    created_at: str
    last_message: Optional[str] = None
    message_count: int = 0
    conversation_type: str = "regular"  # regular | axon_direct


# --- Chat Projects ---

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    conversation_count: int = 0
    created_at: str
    updated_at: str


# --- Chat ---

class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str


# --- Notifications ---

class NotificationAction(BaseModel):
    task_id: str
    new_date: Optional[str] = None
    new_start_time: Optional[str] = None
    new_end_time: Optional[str] = None
    reason: Optional[str] = None


class NotificationResponse(BaseModel):
    id: str
    type: str       # 'simple' | 'improvement' | 'change'
    title: str
    body: str
    status: str     # 'unread' | 'read' | 'accepted' | 'rejected'
    action: Optional[dict] = None
    created_at: str


class NotificationCountResponse(BaseModel):
    unread: int


class NotificationAnalyzeResponse(BaseModel):
    analyzed: bool
    notification: Optional[NotificationResponse] = None


# --- Google Calendar ---

class GoogleConnectResponse(BaseModel):
    auth_url: str


# --- Daily Log ---

# Marcador de dia livre: viaja junto dos períodos porque o usuário o marca na
# mesma seção da tela, mas NÃO é um período (sem faixa de horário, sem posição
# no ranking). Ver services/daily_rest.DAY_OFF_TAG — os dois têm de concordar.
_DAY_OFF_MARKER = "dia_livre"

_VALID_PEAK_PERIODS = {
    "madrugada", "cedo_manha", "manha",
    "inicio_tarde", "fim_tarde", "inicio_noite", "noite",
}


class DailyLogCreate(BaseModel):
    # "YYYY-MM-DD" — apenas ontem é aceito; None = hoje.
    # A checagem de "é realmente ontem?" NÃO pode ficar aqui: depende do fuso do
    # usuário (X-Timezone), que o Pydantic não enxerga — usar date.today() do
    # servidor rejeitaria registros legítimos de quem está em fuso diferente do
    # UTC. Aqui validamos só o formato; o endpoint valida a data no fuso certo.
    date:                Optional[str] = None
    sleep_time:          Optional[str] = None   # "23:30"
    wake_time:           Optional[str] = None   # "07:00"
    sleep_rating:        Optional[int] = None   # 1–5
    sleep_tags:          list[str]     = []     # ["agitado", "interrompido"]
    mood_rating:         Optional[int] = None   # 1–5
    mood_tags:           list[str]     = []     # ["ansioso", "tranquilo"]
    productivity_rating: Optional[int] = None   # 1–5
    productivity_tags:   list[str]     = []     # ["em_flow"]
    peak_periods:        list[str]     = []     # até 3 slugs, ORDENADOS (0 = mais produtivo)
    exercised:           Optional[bool] = None
    is_day_off:          bool           = False   # dia de descanso deliberado
    notes:               Optional[str]  = None

    @model_validator(mode="before")
    @classmethod
    def _extrair_dia_livre(cls, data):
        """
        Tira o marcador de dia livre de `peak_periods` e liga `is_day_off`.

        O frontend mostra "Dia livre" na mesma seção dos períodos porque é ali
        que a pergunta faz sentido para quem responde ("e se não teve pico
        nenhum?"), mas ele não é um período: não tem faixa de horário nem
        posição no ranking. Se ficasse na lista, o validador o rejeitaria como
        período inválido e o registro inteiro falharia.

        Roda em mode="before" para acontecer ANTES da validação dos períodos.
        Os dois convivem: marcar dia livre e ainda apontar que rendeu bem de
        manhã é informação legítima, e os períodos seguem calibrando normal.
        """
        if not isinstance(data, dict):
            return data
        periodos = data.get("peak_periods")
        if isinstance(periodos, list) and _DAY_OFF_MARKER in periodos:
            data = {**data, "peak_periods": [], "is_day_off": True}
        elif data.get("is_day_off") and isinstance(periodos, list) and periodos:
            # Dia livre e períodos de pico são respostas que se excluem: ou o
            # dia foi de descanso, ou houve um momento mais produtivo. A tela já
            # impede a combinação, mas o schema é a última porta — sem isto, um
            # cliente antigo (ou o app offline reenviando um rascunho gravado
            # antes desta regra) gravaria os dois e a calibração aprenderia
            # horários de um dia que o usuário disse não ter trabalhado.
            data = {**data, "peak_periods": []}
        return data

    @field_validator("date")
    @classmethod
    def _date_formato_iso(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            _date.fromisoformat(v)
        except ValueError:
            raise ValueError("date deve estar no formato YYYY-MM-DD")
        return v

    @field_validator("sleep_rating", "mood_rating", "productivity_rating")
    @classmethod
    def _rating_entre_1_e_5(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and not (1 <= v <= 5):
            raise ValueError("rating deve estar entre 1 e 5")
        return v


    @field_validator("sleep_tags", "mood_tags", "productivity_tags")
    @classmethod
    def _no_maximo_3_tags(cls, v: list[str]) -> list[str]:
        if len(v) > 3:
            raise ValueError("máximo de 3 tags por campo")
        return v

    @field_validator("peak_periods")
    @classmethod
    def _validate_peak_periods(cls, v: list[str]) -> list[str]:
        """
        Até 3 períodos, em ORDEM de produtividade percebida (posição 0 = o mais
        produtivo do dia). A ordem é dado, não apresentação: a calibração pesa
        cada posição de forma diferente.

        Repetição é rejeitada porque a lista é um ranking — o mesmo período não
        pode ser 1º e 2º ao mesmo tempo. Sem esta checagem, ["manha", "manha"]
        contaria a manhã duas vezes na calibração.

        O marcador de dia livre é removido antes daqui por
        `_extrair_dia_livre` (model_validator), que também liga `is_day_off` —
        um field_validator não conseguiria escrever em outro campo, e sem isso
        marcar dia livre no frontend seria descartado em silêncio.
        """
        if len(v) > 3:
            raise ValueError("máximo de 3 períodos de pico")
        if len(set(v)) != len(v):
            raise ValueError("períodos de pico não podem se repetir")
        for slug in v:
            if slug not in _VALID_PEAK_PERIODS:
                raise ValueError(f"período inválido: {slug}")
        return v


class DailyLogDraft(BaseModel):
    """
    Rascunho do registro diário. `data` é o formulário parcial como o frontend
    o mantém — guardado como jsonb opaco de propósito: o rascunho não é dado
    analisado, e validar campo a campo aqui só impediria de salvar justamente
    o estado incompleto que queremos preservar.
    """
    date: Optional[str] = None  # "YYYY-MM-DD" — hoje ou ontem; None = hoje
    data: dict = {}

    @field_validator("date")
    @classmethod
    def _date_formato_iso(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        try:
            _date.fromisoformat(v)
        except ValueError:
            raise ValueError("date deve estar no formato YYYY-MM-DD")
        return v


class DailyLogResponse(BaseModel):
    id:                  str
    date:                str
    sleep_time:          Optional[str]  = None
    wake_time:           Optional[str]  = None
    hours_slept:         Optional[float] = None
    sleep_rating:        Optional[int]  = None
    sleep_tags:          list[str]      = []
    mood_rating:         Optional[int]  = None
    mood_tags:           list[str]      = []
    productivity_rating: Optional[int]  = None
    productivity_tags:   list[str]      = []
    peak_periods:        list[str]      = []
    exercised:           Optional[bool] = None
    is_day_off:          bool           = False
    notes:               Optional[str]  = None
    created_at:          str
    updated_at:          str


# --- Routines ---
#
# days_of_week: 0=Seg, 1=Ter, ..., 6=Dom (convenção Python date.weekday()).
# Um item tem horário fixo (start_time + end_time) OU duração flexível
# (duration_minutes, e o Axon escolhe o slot na Fase 3). Nunca os dois.

def _validate_dias(v: list[int]) -> list[int]:
    if not v:
        raise ValueError("days_of_week não pode ser vazio")
    if any(d < 0 or d > 6 for d in v):
        raise ValueError("days_of_week aceita apenas valores de 0 (Seg) a 6 (Dom)")
    return sorted(set(v))


class RoutineItemCreate(BaseModel):
    title:            str
    days_of_week:     list[int]
    start_time:       Optional[str] = None   # "HH:MM"
    end_time:         Optional[str] = None    # "HH:MM"
    duration_minutes: Optional[int] = None

    @field_validator("days_of_week")
    @classmethod
    def _dias(cls, v: list[int]) -> list[int]:
        return _validate_dias(v)

    @model_validator(mode="after")
    def _fixo_ou_flexivel(self):
        tem_horario = self.start_time is not None and self.end_time is not None
        tem_duracao = self.duration_minutes is not None
        if not tem_horario and not tem_duracao:
            raise ValueError(
                "Informe start_time + end_time (horário fixo) ou duration_minutes (flexível)"
            )
        if tem_horario and tem_duracao:
            raise ValueError(
                "Um item é de horário fixo OU de duração flexível, não os dois"
            )
        if self.duration_minutes is not None and self.duration_minutes <= 0:
            raise ValueError("duration_minutes deve ser maior que zero")
        return self


class RoutineItemUpdate(BaseModel):
    title:            Optional[str]       = None
    days_of_week:     Optional[list[int]] = None
    start_time:       Optional[str]       = None
    end_time:         Optional[str]       = None
    duration_minutes: Optional[int]       = None

    @field_validator("days_of_week")
    @classmethod
    def _dias(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        return _validate_dias(v) if v is not None else v

    @model_validator(mode="after")
    def _nao_ambos(self):
        tem_horario = self.start_time is not None or self.end_time is not None
        tem_duracao = self.duration_minutes is not None
        if tem_horario and tem_duracao:
            raise ValueError(
                "Um item é de horário fixo OU de duração flexível, não os dois"
            )
        return self


class RoutineItemResponse(BaseModel):
    id:               str
    routine_id:       str
    title:            str
    days_of_week:     list[int]
    start_time:       Optional[str] = None
    end_time:         Optional[str] = None
    duration_minutes: Optional[int] = None
    created_at:       str
    updated_at:       str


class RoutineCreate(BaseModel):
    name:       str
    start_date: Optional[date] = None   # default: hoje (definido no service)
    end_date:   Optional[date] = None   # null = rotina sem término
    # Itens inline: o backend cria a rotina + os itens e já gera as tarefas no
    # calendário numa única chamada. Vazio = cria só o container.
    items:      list[RoutineItemCreate] = []


class RoutineUpdate(BaseModel):
    name:     Optional[str]  = None
    end_date: Optional[date] = None
    status:   Optional[str]  = None     # 'active' | 'paused'

    @field_validator("status")
    @classmethod
    def _status_valido(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in ("active", "paused"):
            raise ValueError("status deve ser 'active' ou 'paused'")
        return v


class RoutinePause(BaseModel):
    paused_until: Optional[date] = None  # null = pausado indefinidamente


class RoutineResponse(BaseModel):
    id:              str
    name:            str
    status:          str
    start_date:      str
    end_date:        Optional[str] = None
    paused_until:    Optional[str] = None
    generated_until: str
    created_at:      str
    updated_at:      str
    streak:          int = 0
    streak_unit:     str = "dias"
    items:           list[RoutineItemResponse] = []


class RoutineListItem(BaseModel):
    id:              str
    name:            str
    status:          str
    start_date:      str
    end_date:        Optional[str] = None
    paused_until:    Optional[str] = None
    generated_until: str
    created_at:      str
    updated_at:      str
    streak:          int = 0
    streak_unit:     str = "dias"
    item_count:      int = 0


# --- Subtasks ---

class SubtaskCreate(BaseModel):
    title: str


class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    done: Optional[bool] = None


class SubtaskResponse(BaseModel):
    id: str
    task_id: str
    title: str
    done: bool
    position: int
    created_at: str


# --- Objectives ---

class ObjectiveCreate(BaseModel):
    title: str
    description: Optional[str] = None
    deadline: Optional[date] = None
    priority: Optional[str] = None


class ObjectiveUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    deadline: Optional[date] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class ObjectiveResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    deadline: Optional[str] = None
    status: str
    priority: Optional[str] = None
    progress: int
    subtask_count: int = 0
    done_count: int = 0
    created_at: str
    updated_at: str


class DeviceTokenRegister(BaseModel):
    """Token FCM de um aparelho, enviado pelo app após obter permissão."""
    token: str
    platform: str = "android"


class TtsRequest(BaseModel):
    """Uma frase para o Axon falar. `voice_id` no formato 'provedor:voz'."""
    text: str
    voice_id: Optional[str] = None
    speed: float = 1.0


class TranscribeResponse(BaseModel):
    """Resultado de `POST /voice/transcribe`."""
    text: str
    confidence: float
    duration_seconds: float
