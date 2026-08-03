const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/* ============================================================================
 * API BASE E HELPERS
 * Centraliza URL, headers, sessão e tratamento padrão de erros.
 * ========================================================================== */

const SESSION_KEYS = ["axon_token", "axon_refresh_token", "axon_user", "axon_last_active"] as const;

// "Manter-me conectado" decide o storage: localStorage sobrevive ao fechar o
// navegador, sessionStorage é apagado junto com a aba/janela.
function isRemembered(): boolean {
  return !!localStorage.getItem("axon_token");
}

function clearSessionItems() {
  for (const key of SESSION_KEYS) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
}

/**
 * Wrapper direto de fetch mantido para compatibilidade com imports existentes.
 * Use `request` abaixo quando precisar do tratamento padrão de erro/sessão.
 */
async function apiFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = getToken();

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
}

export default apiFetch;

function getToken(): string | null {
  return sessionStorage.getItem("axon_token") ?? localStorage.getItem("axon_token");
}

function getRefreshToken(): string | null {
  return sessionStorage.getItem("axon_refresh_token") ?? localStorage.getItem("axon_refresh_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Helper principal das chamadas autenticadas.
 * Antes de desconectar por 401, tenta renovar a sessão com o refresh token
 * (é isso que faz "manter-me conectado" durar além da validade do access
 * token). Também renova o marcador de atividade.
 */
async function request<T>(
  path: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  let res: Response;

  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...authHeaders(),
        ...(options.headers as Record<string, string> | undefined),
      },
    });
  } catch {
    throw new Error(
      "⚠️ DEV: Backend inacessível. Abra a porta 8000 como Pública no painel de Portas do VS Code e certifique-se de que o servidor está rodando (uvicorn main:app --reload)."
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      const refreshToken = getRefreshToken();

      // path check evita recursão infinita se o próprio /auth/refresh cair em 401
      if (!isRetry && path !== "/auth/refresh" && refreshToken) {
        try {
          const renewed = await refreshSession(refreshToken);
          saveSession(renewed, isRemembered());
          return request<T>(path, options, true);
        } catch {
          // Refresh token também expirado/revogado: cai no logout abaixo.
        }
      }

      clearSessionItems();
      window.location.href = "/login";
      throw new Error("Sessão expirada");
    }

    const error = await res.json().catch(() => ({ detail: "Erro desconhecido" }));
    throw new Error(error.detail ?? "Erro na requisição");
  }

  if (getToken()) {
    (isRemembered() ? localStorage : sessionStorage).setItem("axon_last_active", String(Date.now()));
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

/* ============================================================================
 * AUTH E SESSÃO
 * Fluxos de cadastro, login, Google OAuth, refresh e persistência local.
 * ========================================================================== */

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  name?: string;
  has_chronotype: boolean;
}

export function register(name: string, email: string, password: string) {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

// Usado no callback do Google para transformar o code em sessão do AXON.
export function exchangeGoogleSession(code: string) {
  return request<AuthResponse>(`/auth/google/session?code=${encodeURIComponent(code)}`);
}

// Inicia o fluxo para conectar Google Calendar nas integrações.
export function connectGoogleCalendar() {
  return request<{ auth_url: string }>("/auth/google/connect");
}

export function refreshSession(refreshToken: string) {
  return request<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

// Mantém os dados mínimos da sessão usados pelas rotas privadas e headers.
// `remember=true` (padrão) grava em localStorage e sobrevive ao fechar o
// navegador; `remember=false` grava em sessionStorage e some com a aba.
export function saveSession(res: AuthResponse, remember: boolean = true) {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;

  target.setItem("axon_token", res.access_token);
  target.setItem("axon_refresh_token", res.refresh_token);
  target.setItem("axon_user", JSON.stringify({ id: res.user_id, email: res.email, name: res.name }));
  target.setItem("axon_last_active", String(Date.now()));

  for (const key of SESSION_KEYS) other.removeItem(key);
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export function logout() {
  clearSessionItems();
}

/* ============================================================================
 * ACCOUNT
 * Ações sensíveis da conta: exclusão permanente e limpeza de sessão.
 * ========================================================================== */

export function deleteAccount() {
  return request<void>("/account", { method: "DELETE" });
}

/* ============================================================================
 * PROFILE
 * Dados pessoais, avatar, cronotipo salvo e preferências do usuário.
 * ========================================================================== */

export interface ProfileData {
  name?: string;
  email: string;
  chronotype?: string;
  chronotype_label?: string;
  energy_peak?: string;
  focus_window?: string;
  schedule_type?: string;
  avatar_url?: string;
  has_chronotype: boolean;
}

export function getProfile() {
  return request<ProfileData>("/profile");
}

export function updateProfile(payload: { name?: string }) {
  return request<ProfileData>("/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

// Envio de avatar usa FormData; por isso não passa pelo helper JSON `request`.
export async function uploadAvatar(file: File): Promise<ProfileData> {
  const token = getToken();
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/profile/avatar`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: form,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: "Erro ao enviar imagem" }));
    throw new Error(error.detail ?? "Erro ao enviar imagem");
  }

  return res.json();
}

export function deleteAvatar(): Promise<ProfileData> {
  return request<ProfileData>("/profile/avatar", { method: "DELETE" });
}

export interface TagItem {
  slug: string;
  label: string;
}

export interface TagPreferences {
  sleep: TagItem[];
  mood: TagItem[];
  productivity: TagItem[];
}

export function getTagPreferences(): Promise<TagPreferences> {
  return request<TagPreferences>("/profile/tags");
}

export function updateTagPreferences(prefs: TagPreferences): Promise<TagPreferences> {
  return request<TagPreferences>("/profile/tags", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}

/* ============================================================================
 * USERS E CRONOTIPO
 * Dados do usuário atual e salvamento do resultado do questionário.
 * ========================================================================== */

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  chronotype?: string;
  chronotype_scores?: Record<string, number>;
}

export function getMe() {
  return request<UserProfile>("/users/me");
}

// Usado após o questionário para persistir cronotipo, pontuação e respostas.
export function saveChronotype(
  chronotype: string,
  scores: Record<string, number>,
  answers: Record<string, string>
) {
  return request("/users/me/chronotype", {
    method: "PUT",
    body: JSON.stringify({ chronotype, scores, answers }),
  });
}

export interface ClassifyResponse {
  cronotipo: string;
  pontos: Record<string, number>;
}

// Calcula o cronotipo sem necessariamente persistir no perfil do usuário.
export function classify(
  respostas: Record<string, string>,
  qualidade_sono: string,
  schedule_type?: string
) {
  return request<ClassifyResponse>("/classify/", {
    method: "POST",
    body: JSON.stringify({ respostas, qualidade_sono, schedule_type }),
  });
}

// Usado no fluxo final do questionário para classificar e salvar em uma chamada.
export function classifyAndSave(
  respostas: Record<string, string>,
  qualidade_sono: string,
  schedule_type?: string
) {
  return request<ClassifyResponse>("/classify/save", {
    method: "POST",
    body: JSON.stringify({ respostas, qualidade_sono, schedule_type }),
  });
}

/* ============================================================================
 * DASHBOARD
 * Dados agregados da tela inicial: energia, foco, blocos e plano enxuto do dia.
 * ========================================================================== */

export interface NextFocusBlock {
  start: string;
  end: string;
  label: string;
  status: "upcoming" | "active" | "tomorrow";
  hours_until: number;
}

export interface BlockTask {
  id: string;
  title: string;
  status: string;
  task_type: string;
  start_time?: string | null;
  end_time?: string | null;
  is_key_task: boolean;
  priority?: string | null;
  objective_title?: string | null;
}

export interface DayBlock {
  start: string;
  end: string;
  level: string;
  level_label: string;
  tasks: BlockTask[];
}

export interface FocusBlock {
  index: number;
  start: string;
  end: string;
  level:
    | "sono"
    | "recuperacao"
    | "foco_leve"
    | "foco_moderado"
    | "foco_profundo"
    | "pico";
  level_label: string;
  description: string;
  tasks: BlockTask[];
}

export interface RoutineConsistency {
  routine_id: string;
  name: string;
  days_done: number;
  days_total: number;
  percent: number;
}

export interface DashboardData {
  greeting: string;
  chronotype_label: string;
  chronotype_key: string;
  energy_percent: number;
  focus_percent: number;
  energy_peak: string;
  focus_window: string;
  low_energy: string;
  recommendation: string;
  next_focus: NextFocusBlock;
  current_block: FocusBlock;
  next_block: FocusBlock;
  day_blocks: DayBlock[];
  routine_consistency: RoutineConsistency[];
}

// Usado no Dashboard para carregar blocos atuais, próximos e tarefas do dia.
export function getDashboard() {
  return request<DashboardData>("/dashboard/");
}

export interface PeriodReportData {
  period_start: string;
  period_end: string;
  avg_completion_rate: number;
  most_productive_day: { date: string; completion_rate: number } | null;
  routine_consistency: RoutineConsistency[];
  key_tasks: { defined: number; done: number };
}

export interface PeriodReport {
  id: string;
  period_type: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  data: PeriodReportData;
  narrative: string;
  created_at: string;
  seen_at?: string | null;
}

export interface DashboardReports {
  weekly: PeriodReport | null;
  monthly: PeriodReport | null;
}

// Relatórios ainda NÃO VISTOS — alimentam o card do Dashboard. Depois de
// marcados como vistos saem daqui e ficam só no histórico (Perfil).
export function getDashboardReports() {
  return request<DashboardReports>("/dashboard/reports");
}

// Histórico permanente, do mais recente ao mais antigo. Sem filtro devolve
// semanais e mensais juntos.
export function getReportsHistory(periodType?: "weekly" | "monthly") {
  const qs = periodType ? `?period_type=${periodType}` : "";
  return request<PeriodReport[]>(`/dashboard/reports/history${qs}`);
}

// Tira o relatório do Dashboard; ele continua no histórico.
export function markReportSeen(reportId: string) {
  return request<{ status: string }>(`/dashboard/reports/${reportId}/seen`, {
    method: "POST",
  });
}

/* ============================================================================
 * PLANNING / TASKS
 * Tarefas, eventos, rotinas pontuais, estatísticas diárias e fila do calendário.
 * ========================================================================== */

export type TaskType = "task" | "event" | "routine";
export type TaskStatus = "todo" | "progress" | "done" | "scheduled";
export type TaskPriority = "low" | "medium" | "high";

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  task_type: TaskType;
  status: TaskStatus;
  priority?: TaskPriority | null;
  scheduled_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  progress: number;
  recurrence?: "daily" | "weekly" | "monthly" | null;
  location?: string | null;
  parent_task_id?: string | null;
  group_name?: string | null;
  deadline?: string | null;
  is_key_task: boolean;
  carry_count: number;
  objective_id?: string | null;
  objective_title?: string | null;
  created_by: "user" | "agent";
  created_at: string;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  scheduled_date?: string;
  end_date?: string;
  start_time?: string;
  end_time?: string;
  recurrence?: "daily" | "weekly" | "monthly";
  location?: string;
  deadline?: string;
  axon_pick_time?: boolean;
  duration_minutes?: number;
  objective_id?: string;
}

export type TaskUpdateInput = Partial<TaskCreateInput> & {
  status?: TaskStatus;
  progress?: number;
  is_key_task?: boolean;
};

// Usado no Planning, Dashboard e Focus com filtros opcionais de data/status/tipo.
export function getTasks(params?: {
  scheduled_date?: string;
  status?: TaskStatus;
  task_type?: TaskType;
}) {
  const query = new URLSearchParams();
  if (params?.scheduled_date) query.set("scheduled_date", params.scheduled_date);
  if (params?.status) query.set("status", params.status);
  if (params?.task_type) query.set("task_type", params.task_type);

  const qs = query.toString();
  return request<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
}

export function createTask(body: TaskCreateInput) {
  return request<Task>("/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateTask(id: string, body: TaskUpdateInput) {
  return request<Task>(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteTask(id: string) {
  return request<void>(`/tasks/${id}`, { method: "DELETE" });
}

// Move tarefas pendentes para o próximo dia quando o usuário decide reorganizar.
export function carryForwardTasks() {
  return request<Task[]>("/tasks/carry-forward", { method: "POST" });
}

export interface DailyStat {
  date: string;
  total: number;
  completed_items: number;
  completion_rate: number;
  carried_forward: number;
}

// Usado no Planning para congelar/consultar estatísticas de dias anteriores.
export function getDailyStats(start: string, end: string) {
  return request<DailyStat[]>(
    `/tasks/daily-stats?start=${start}&end=${end}`
  );
}

/* ============================================================================
 * SUBTASKS
 * Subtarefas ligadas às tarefas do Planning e ao plano enxuto do Dashboard.
 * ========================================================================== */

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  position: number;
  created_at: string;
}

// Carrega todas as subtarefas quando a tela precisa montar um mapa por task_id.
export function getSubtasks() {
  return request<Subtask[]>("/subtasks");
}

export function getTaskSubtasks(taskId: string) {
  return request<Subtask[]>(`/subtasks/task/${taskId}`);
}

export function createSubtask(
  taskId: string,
  body: {
    title: string;
    position?: number;
  }
) {
  return request<Subtask>(`/subtasks/task/${taskId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSubtask(
  subtaskId: string,
  body: {
    done?: boolean;
    title?: string;
    position?: number;
  }
) {
  return request<Subtask>(`/subtasks/${subtaskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteSubtask(subtaskId: string) {
  return request<void>(`/subtasks/${subtaskId}`, {
    method: "DELETE",
  });
}

/* ============================================================================
 * NOTIFICATIONS
 * Sininho do Dashboard, toast global e sugestões aceitas/rejeitadas pelo usuário.
 * ========================================================================== */

export interface NotificationAction {
  task_id: string;
  new_date?: string | null;
  new_start_time?: string | null;
  new_end_time?: string | null;
  reason?: string | null;
}

export interface NotificationData {
  id: string;
  type: "simple" | "improvement" | "change";
  title: string;
  body: string;
  status: "unread" | "read" | "accepted" | "rejected";
  action?: NotificationAction | null;
  created_at: string;
}

export function getNotifications(limit = 10, offset = 0) {
  return request<NotificationData[]>(
    `/notifications?limit=${limit}&offset=${offset}`
  );
}

export function getUnreadCount() {
  return request<{ unread: number }>("/notifications/unread-count");
}

// Dispara a análise do backend para gerar possíveis sugestões/notificações.
export function analyzeNotifications() {
  return request<{ analyzed: boolean; notification?: NotificationData }>(
    "/notifications/analyze",
    { method: "POST" }
  );
}

export function markNotificationRead(id: string) {
  return request<NotificationData>(`/notifications/${id}/read`, {
    method: "PATCH",
  });
}

export function acceptNotification(id: string) {
  return request<{ analyzed: boolean; notification?: NotificationData }>(
    `/notifications/${id}/accept`,
    { method: "POST" }
  );
}

export function rejectNotification(id: string) {
  return request<NotificationData>(`/notifications/${id}/reject`, {
    method: "POST",
  });
}

/* ============================================================================
 * CHAT / CONVERSATIONS
 * Lista de conversas, histórico, envio normal e streaming da resposta do Axon.
 * ========================================================================== */

export type ConversationBackendType = "regular" | "axon_direct";

export interface ConversationData {
  id: string;
  title: string;
  type: "general" | "planning" | "focus" | "project";
  conversation_type: "regular" | "axon_direct";
  archived: boolean;
  created_at: string;
  last_message?: string;
  message_count: number;
  project_id?: string | null;
}

export function getConversations() {
  return request<ConversationData[]>("/chat/conversations");
}

export async function createConversation(
  title: string,
  type: string,
  projectId?: string | null
) {
  const payload = {
    title,
    type,
    ...(projectId !== undefined ? { project_id: projectId } : {}),
  };

  return request<ConversationData>("/chat/conversations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateConversation(
  id: string,
  updates: { title?: string; archived?: boolean; project_id?: string | null }
) {
  return request<ConversationData>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

// Usado no modal da conversa para mover ou remover o chat de um projeto.
export async function updateConversationProject(
  conversationId: string,
  projectId: string | null
) {
  return request<ConversationData>(`/chat/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({
      project_id: projectId,
    }),
  });
}

export function deleteConversation(id: string) {
  return request<void>(`/chat/conversations/${id}`, { method: "DELETE" });
}

export function clearConversationMessages(id: string) {
  return request<void>(`/chat/conversations/${id}/messages`, { method: "DELETE" });
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function getConversationMessages(id: string) {
  return request<StoredMessage[]>(`/chat/conversations/${id}/messages`);
}

export interface ChatApiResponse {
  response: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function chat(message: string, history: ChatMessage[], conversationId?: string) {
  return request<ChatApiResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({ message, history, conversation_id: conversationId ?? null }),
  });
}

export interface ToolEvent {
  tool: string;
  status: "running" | "done";
  label?: string;
  ok?: boolean;
  mutating?: boolean;
  input?: Record<string, unknown>;
  summary?: string;
}

// Usado na conversa interna para mostrar resposta em tempo real e eventos de ferramentas.
export function streamChat(
  message: string,
  history: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  conversationId?: string,
  onTool?: (event: ToolEvent) => void
): void {
  const token = getToken();

  fetch(`${BASE_URL}/chat/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ message, history, conversation_id: conversationId ?? null }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Erro no chat" }));
        throw new Error(error.detail ?? "Erro no chat");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      const pump = async () => {
        const { done, value } = await reader.read();

        if (done) {
          onDone();
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const payload = line.slice(6);

          if (payload === "[DONE]") {
            onDone();
            return;
          }

          try {
            const parsed = JSON.parse(payload);

            if (parsed.text) {
              onChunk(parsed.text);
            } else if (parsed.tool) {
              onTool?.(parsed as ToolEvent);
            }
          } catch {
            // Linhas SSE incompletas/malformadas são ignoradas até o próximo chunk.
          }
        }

        pump();
      };

      pump();
    })
    .catch(onError);
}

/* ============================================================================
 * CHAT PROJECTS
 * Pastas/projetos usados na tela de Chat para agrupar conversas.
 * ========================================================================== */

export interface ChatProjectData {
  id: string;
  name: string;
  description?: string | null;
  conversation_count?: number;
  created_at?: string;
  updated_at?: string;
}

export function getChatProjects() {
  return request<ChatProjectData[]>("/chat/projects");
}

export function createChatProject(payload: {
  name: string;
  description?: string;
}) {
  return request<ChatProjectData>("/chat/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateChatProject(
  projectId: string,
  payload: {
    name: string;
    description?: string;
  }
) {
  return request<ChatProjectData>(`/chat/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function deleteChatProject(projectId: string) {
  return request<void>(`/chat/projects/${projectId}`, {
    method: "DELETE",
  });
}

/* ============================================================================
 * PLANNING PREFERENCES
 * Preferências de planejamento diário/semanal usadas pelas notificações futuras.
 * ========================================================================== */

export interface PlanningPreferences {
  daily_planning_enabled: boolean;
  daily_planning_time: string | null; // "HH:MM"
  daily_use_chronotype: boolean;
  weekly_planning_enabled: boolean;
  weekly_planning_day: number | null; // 0=Seg…6=Dom
  weekly_use_chronotype: boolean;
}

export function getPlanningPreferences() {
  return request<PlanningPreferences>("/profile/planning");
}

export function updatePlanningPreferences(prefs: PlanningPreferences) {
  return request<PlanningPreferences>("/profile/planning", {
    method: "PUT",
    body: JSON.stringify(prefs),
  });
}

/* ============================================================================
 * DAILY LOG
 * Registro diário de sono, humor, produtividade e períodos de maior energia.
 * ========================================================================== */

export type PeakPeriodSlug =
  | "madrugada"
  | "cedo_manha"
  | "manha"
  | "inicio_tarde"
  | "fim_tarde"
  | "inicio_noite"
  | "noite";

export const PEAK_PERIODS: { slug: PeakPeriodSlug; label: string; hours: string }[] = [
  { slug: "madrugada", label: "Madrugada", hours: "00h–05h" },
  { slug: "cedo_manha", label: "Cedo da manhã", hours: "05h–08h" },
  { slug: "manha", label: "Manhã", hours: "08h–12h" },
  { slug: "inicio_tarde", label: "Começo da tarde", hours: "12h–15h" },
  { slug: "fim_tarde", label: "Fim da tarde", hours: "15h–18h" },
  { slug: "inicio_noite", label: "Começo da noite", hours: "18h–21h" },
  { slug: "noite", label: "Noite", hours: "21h–00h" },
];

export interface DailyLog {
  id: string;
  date: string;
  sleep_time: string | null;
  wake_time: string | null;
  hours_slept: number | null;
  sleep_rating: number | null;
  sleep_tags: string[];
  mood_rating: number | null;
  mood_tags: string[];
  productivity_rating: number | null;
  productivity_tags: string[];
  peak_periods: string[];
  exercised: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyLogInput {
  date?: string; // "YYYY-MM-DD" — omitir para registrar hoje; passar ontem para registro retroativo
  sleep_time?: string;
  wake_time?: string;
  sleep_rating?: number;
  sleep_tags?: string[];
  mood_rating?: number;
  mood_tags?: string[];
  productivity_rating?: number;
  productivity_tags?: string[];
  peak_periods?: string[];
  exercised?: boolean;
  notes?: string;
}

export function getDailyLogToday() {
  return request<DailyLog | null>("/daily-log/today");
}

export function getDailyLogYesterday() {
  return request<DailyLog | null>("/daily-log/yesterday");
}

// Rascunho do registro: preenchimento parcial, guardado fora de daily_logs
// para não contar como "dia registrado" nos insights. `data` é o formulário
// como o DayReview o mantém.
export interface DailyLogDraft {
  data: Record<string, unknown>;
  updated_at: string;
}

export function getDailyLogDraft(date?: string) {
  const qs = date ? `?date=${date}` : "";
  return request<DailyLogDraft | null>(`/daily-log/draft${qs}`);
}

export function saveDailyLogDraft(
  data: Record<string, unknown>,
  date?: string
) {
  return request<{ status: string; date: string }>("/daily-log/draft", {
    method: "PUT",
    body: JSON.stringify({ date, data }),
  });
}

export function deleteDailyLogDraft(date?: string) {
  const qs = date ? `?date=${date}` : "";
  return request<null>(`/daily-log/draft${qs}`, { method: "DELETE" });
}

export function getDailyLogHistory(days = 30) {
  return request<DailyLog[]>(`/daily-log/history?days=${days}`);
}

export function saveDailyLog(body: DailyLogInput) {
  return request<DailyLog>("/daily-log/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ============================================================================
 * INSIGHTS
 * Métricas de tarefas, padrões por IA e blocos de energia/foco calibrados.
 * ========================================================================== */

export interface TaskInsightDay {
  date: string;
  weekday: string; // "Seg", "Ter", ...
  completed: number;
  total: number;
  completion_rate: number; // 0–100
  carried_forward: number;
}

export interface TaskInsightSummary {
  total_completed: number;
  avg_completion_rate: number;
  best_weekday: string | null;
  best_weekday_completed: number;
  carry_forward_total: number;
}

export interface TaskInsights {
  period: "week" | "month";
  days: TaskInsightDay[];
  summary: TaskInsightSummary;
}

// Usado no Insights para montar gráficos e resumo de conclusão de tarefas.
export function getTaskInsights(period: "week" | "month" = "week") {
  return request<TaskInsights>(`/insights/tasks?period=${period}`);
}

export interface PatternInsight {
  title: string;
  detail: string;
  type: "sleep" | "productivity" | "mood" | "habit" | "general";
}

export interface PatternInsightsResponse {
  status: "collecting" | "ready";
  data_points?: number;
  days_needed?: number;
  message?: string;
  insights?: PatternInsight[];
  generated_at?: string;
  cached?: boolean;
}

// Retorna "collecting" até haver registros suficientes para gerar padrões confiáveis.
export function getPatternInsights(refresh = false) {
  return request<PatternInsightsResponse>(
    `/insights/patterns${refresh ? "?refresh=true" : ""}`
  );
}

export interface FocusBlockItem {
  idx: number;
  level: "sono" | "recuperacao" | "foco_leve" | "foco_moderado" | "foco_profundo" | "pico";
  label: string;
  energy: number;
  focus: number;
  description: string;
  start_time: string;
  end_time: string;
}

export interface FocusBlocksResponse {
  chronotype: string;
  calibrated: boolean;
  data_points: number;
  min_data_points: number;
  blocks: FocusBlockItem[];
}

// Usado no Focus/Insights para visualizar blocos de energia ao longo do dia.
export function getFocusBlocks() {
  return request<FocusBlocksResponse>("/insights/blocks");
}

/* ============================================================================
 * ROUTINES
 * Rotinas recorrentes compostas por itens fixos ou flexíveis.
 * ========================================================================== */

export type RoutineStatus = "active" | "paused";

export interface RoutineItem {
  id: string;
  routine_id: string;
  title: string;
  days_of_week: number[]; // 0=Seg, 1=Ter, ..., 6=Dom
  start_time?: string | null; // "HH:MM" para item fixo
  end_time?: string | null; // "HH:MM" para item fixo
  duration_minutes?: number | null; // duração usada em item flexível
  created_at: string;
  updated_at: string;
}

export interface Routine {
  id: string;
  name: string;
  status: RoutineStatus;
  start_date: string; // "YYYY-MM-DD"
  end_date?: string | null;
  paused_until?: string | null;
  generated_until: string;
  created_at: string;
  updated_at: string;
  streak: number;
  streak_unit: string; // sempre "dias"
  item_count: number;
}

export interface RoutineDetail extends Omit<Routine, "item_count"> {
  items: RoutineItem[];
}

// Item fixo usa start_time/end_time; item flexível usa duration_minutes.
export interface RoutineItemCreateInput {
  title: string;
  days_of_week: number[]; // 0=Seg, ..., 6=Dom
  start_time?: string; // "HH:MM"
  end_time?: string; // "HH:MM"
  duration_minutes?: number;
}

export interface RoutineCreateInput {
  name: string;
  start_date?: string; // "YYYY-MM-DD" — backend usa hoje quando omitido
  end_date?: string | null;
  items: RoutineItemCreateInput[];
}

export function createRoutine(body: RoutineCreateInput) {
  return request<RoutineDetail>("/routines", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getRoutines() {
  return request<Routine[]>("/routines");
}

export function getRoutine(id: string) {
  return request<RoutineDetail>(`/routines/${id}`);
}

export function pauseRoutine(id: string, pausedUntil?: string | null) {
  return request<RoutineDetail>(`/routines/${id}/pause`, {
    method: "POST",
    body: JSON.stringify({ paused_until: pausedUntil ?? null }),
  });
}

export function resumeRoutine(id: string) {
  return request<RoutineDetail>(`/routines/${id}/resume`, {
    method: "POST",
  });
}

export function updateRoutine(
  id: string,
  body: { name?: string; end_date?: string | null; status?: RoutineStatus }
) {
  return request<RoutineDetail>(`/routines/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteRoutine(id: string) {
  return request<void>(`/routines/${id}`, { method: "DELETE" });
}

// No PATCH, envie null no campo não usado ao trocar entre item fixo e flexível.
export interface RoutineItemUpdateInput {
  title?: string;
  days_of_week?: number[];
  start_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
}

export function addRoutineItem(routineId: string, body: RoutineItemCreateInput) {
  return request<RoutineItem>(`/routines/${routineId}/items`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateRoutineItem(
  routineId: string,
  itemId: string,
  body: RoutineItemUpdateInput
) {
  return request<RoutineItem>(`/routines/${routineId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteRoutineItem(routineId: string, itemId: string) {
  return request<void>(`/routines/${routineId}/items/${itemId}`, {
    method: "DELETE",
  });
}

/* ============================================================================
 * MEMÓRIAS DO AXON
 * O que o agente aprendeu sobre o usuário ao longo das conversas.
 * ========================================================================== */

export interface UserMemory {
  id: string;
  content: string;
  created_at: string;
}

export function getMemories() {
  return request<UserMemory[]>("/profile/memories");
}

export function deleteMemory(id: string) {
  return request<void>(`/profile/memories/${id}`, { method: "DELETE" });
}

/* ============================================================================
 * OBJECTIVES
 * Objetivos de longo prazo que podem agrupar tarefas/subtarefas.
 * ========================================================================== */

export interface Objective {
  id: string;
  title: string;
  description?: string | null;
  deadline?: string | null;
  status: "active" | "done";
  priority?: "low" | "medium" | "high" | null;
  progress: number;
  subtask_count: number;
  done_count: number;
  created_at: string;
  updated_at: string;
  subtasks?: Task[];
}

export function getObjectives() {
  return request<Objective[]>("/objectives");
}

export function getObjective(id: string) {
  return request<Objective & { subtasks: Task[] }>(`/objectives/${id}`);
}

export function createObjective(payload: {
  title: string;
  description?: string;
  deadline?: string;
  priority?: "low" | "medium" | "high";
}) {
  return request<Objective>("/objectives", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateObjective(
  id: string,
  payload: {
    title?: string;
    description?: string;
    deadline?: string | null;
    priority?: "low" | "medium" | "high";
  }
) {
  return request<Objective>(`/objectives/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteObjective(id: string) {
  return request<void>(`/objectives/${id}`, { method: "DELETE" });
}
