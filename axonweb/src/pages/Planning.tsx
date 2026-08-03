import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Edit3,
  ListTodo,
  Loader2,
  Plus,
  Repeat,
  RotateCcw,
  Sparkles,
  Star,
  Target,
  Trash2,
  X,
} from "lucide-react";

import { results, type ChronotypeResultKey } from "../data/results";
import Sidebar from "../components/layout/Sidebar";
import Routines from "./Routines";
import Goals from "./Goals";
import * as api from "../lib/api";
import type { Task, TaskType, TaskStatus, Subtask, DailyStat } from "../lib/api";
import AppBackground from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";
import BottomSheet from "../components/ui/BottomSheet";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import EmptyState from "../components/ui/EmptyState";

// ===========================================================================
// TIPOS E CONSTANTES GERAIS
// ===========================================================================

type ViewMode = "month" | "week";
type DisplayStatus = "todo" | "progress" | "done" | "scheduled";

const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

const typeLabels: Record<TaskType, string> = {
  task: "Tarefa",
  event: "Evento",
  routine: "Rotina",
};

const statusLabels: Record<TaskStatus, string> = {
  todo: "A fazer",
  progress: "Em andamento",
  done: "Concluída",
  scheduled: "Agendado",
};

const recurrenceLabels: Record<string, string> = {
  daily: "Todos os dias",
  weekly: "Toda semana",
  monthly: "Todo mês",
};

const monthNames = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const weekdayShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const CALENDAR_SETUP_STORAGE_KEY = "axon_calendar_setup_choice";
type CalendarSetupChoice = "google" | "independent";

// ===========================================================================
// HELPERS DE DATA E STATUS
// ===========================================================================

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getTaskEndDate(task: Task): string | undefined {
  return (task as Task & { end_date?: string | null }).end_date || undefined;
}

function getDisplayStatus(task: Task, selectedIso: string): DisplayStatus {
  const isDone = task.status === "done";

  if (isDone) {
    return "done";
  }

  const endDate = getTaskEndDate(task);
  const isMultiDayEvent =
    task.task_type === "event" &&
    task.scheduled_date &&
    endDate &&
    endDate !== task.scheduled_date;

  if (isMultiDayEvent && task.scheduled_date && endDate) {
    if (selectedIso > task.scheduled_date && selectedIso < endDate) {
      return "progress";
    }

    if (selectedIso === endDate) {
      return "progress";
    }

    return "scheduled";
  }

  if (task.task_type === "event") {
    return "scheduled";
  }

  return task.status as DisplayStatus;
}

function isEventCompleted(task: Task, now: Date): boolean {
  // evento multi-dia marcado manualmente já conta como concluído
  if (task.status === "done") return true;

  const endIso = getTaskEndDate(task) || task.scheduled_date;
  if (!endIso) return false;

  // usa o fim do evento; se não houver, o início; se não houver horário, fim do dia
  const time = hhmm(task.end_time) || hhmm(task.start_time) || "23:59";
  const endDateTime = new Date(`${endIso}T${time}:00`);

  return now >= endDateTime;
}

function isTaskOnDate(task: Task, isoDate: string): boolean {
  if (!task.scheduled_date) return false;

  const startDate = task.scheduled_date;
  const endDate = getTaskEndDate(task);

  if (task.task_type === "event" && endDate) {
    return isoDate >= startDate && isoDate <= endDate;
  }

  return isoDate === startDate;
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);

  const diffMs = end.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(diffDays + 1, 1);
}

function getDayIndexInRange(startIso: string, currentIso: string): number {
  const start = new Date(`${startIso}T00:00:00`);
  const current = new Date(`${currentIso}T00:00:00`);

  const diffMs = current.getTime() - start.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return Math.max(diffDays + 1, 1);
}

function getMultiDayEventProgress(task: Task, selectedIso: string) {
  const endDate = getTaskEndDate(task);

  if (!task.scheduled_date || !endDate || endDate === task.scheduled_date) {
    return null;
  }

  const totalDays = daysBetweenInclusive(task.scheduled_date, endDate);
  const currentDay = Math.min(
    getDayIndexInRange(task.scheduled_date, selectedIso),
    totalDays
  );

  const progress = Math.round((currentDay / totalDays) * 100);
  const isLastDay = selectedIso === endDate;

  return {
    totalDays,
    currentDay,
    progress,
    isLastDay,
  };
}

function hhmm(value?: string | null): string | undefined {
  return value ? value.slice(0, 5) : undefined;
}

function weekDaysOf(selected: Date): Date[] {
  const dow = selected.getDay(); // 0 Dom .. 6 Sáb
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(selected);
  monday.setDate(selected.getDate() + mondayOffset);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

// ===========================================================================
// CONFIGURAÇÃO DO HUB DE PLANEJAMENTO
// ===========================================================================

type View = "agenda" | "rotinas" | "objetivos";

const TABS: { key: View; label: string; icon: typeof CalendarDays }[] = [
  { key: "agenda", label: "Agenda", icon: CalendarDays },
  { key: "rotinas", label: "Rotinas", icon: Repeat },
  { key: "objetivos", label: "Objetivos", icon: Target },
];

// ===========================================================================
// HUB DE PLANEJAMENTO
// ===========================================================================
// Controla o cabeçalho, a sidebar e as abas Agenda, Rotinas e Objetivos.
export default function Planning({
  initialView = "agenda",
}: {
  initialView?: View;
} = {}) {
  const navigate = useNavigate();

  // Aba ativa do hub e estado da sidebar global.
  const [view, setView] = useState<View>(initialView);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Cronotipo usado para alimentar a sidebar.
  const resultKey: ChronotypeResultKey = (() => {
    const s = localStorage.getItem("axon_chronotype");
    return s && validKeys.includes(s as ChronotypeResultKey)
      ? (s as ChronotypeResultKey)
      : "Misto";
  })();
  const result = results[resultKey];

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 min-h-screen px-4 pb-6 pt-5">
        <PageHeader
          title="Planejamento"
          subtitle="Agenda, rotinas e objetivos"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        {/* Seletor de visão */}
        <div className="mb-5 flex rounded-2xl border border-soft bg-surface-elevated p-1 shadow-card backdrop-blur-2xl">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = view === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setView(tab.key)}
                className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition active:scale-[0.98] ${
                  active
                    ? "bg-[var(--accent-strong)] text-white shadow-card"
                    : "text-muted"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Conteúdo da visão ativa (sem moldura própria) */}
        {view === "agenda" && <AgendaView embedded />}
        {view === "rotinas" && <Routines embedded />}
        {view === "objetivos" && <Goals embedded />}
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
      />
    </main>
  );
}

// ===========================================================================
// VISÃO DE AGENDA
// ===========================================================================
// Pode funcionar embutida no hub ou como página independente.
function AgendaView({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();

  // Controles visuais da agenda.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [subtasksMap, setSubtasksMap] = useState<Record<string, Subtask[]>>({});

  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const [carriedCount, setCarriedCount] = useState(0);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [calendarSetupChoice, setCalendarSetupChoice] =
    useState<CalendarSetupChoice | null>(() => {
      const stored = localStorage.getItem(CALENDAR_SETUP_STORAGE_KEY);

      if (stored === "google" || stored === "independent") {
        return stored;
      }

      return null;
    });
  const [isConnectingCalendar, setIsConnectingCalendar] = useState(false);
  const [calendarConnectError, setCalendarConnectError] =
    useState<string | null>(null);
  const [dailyStatsMap, setDailyStatsMap] =
    useState<Record<string, DailyStat>>({});

  // Cronotipo local da agenda quando ela é renderizada fora do hub.
  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const stored = localStorage.getItem("axon_chronotype");
    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }
    return "Misto";
  }, []);

  const result = results[resultKey];

  // Carrega todas as subtarefas e agrupa por task_id para renderização rápida.
  const loadSubtasks = useCallback(async () => {
    try {
      const all = await api.getSubtasks();

      const map: Record<string, Subtask[]> = {};

      for (const subtask of all) {
        if (!map[subtask.task_id]) {
          map[subtask.task_id] = [];
        }

        map[subtask.task_id].push(subtask);
      }

      Object.values(map).forEach((items) => {
        items.sort((a, b) => a.position - b.position);
      });

      setSubtasksMap(map);
    } catch {
      setSubtasksMap({});
    }
  }, []);

  // Carrega tarefas e subtarefas em conjunto.
  const loadTasks = useCallback(async () => {
    setError(null);
    try {
      const [data] = await Promise.all([api.getTasks(), loadSubtasks()]);
      setTasks(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar tarefas");
    } finally {
      setLoading(false);
    }
  }, [loadSubtasks]);

  useEffect(() => {
    // Primeiro arrasta pendentes de ontem, depois carrega a lista atualizada
    api.carryForwardTasks()
      .then((moved) => {
        if (moved.length > 0) setCarriedCount(moved.length);
      })
      .catch(() => null)
      .finally(async () => {
        await loadTasks();
        await loadSubtasks();
        await loadDailyStats();
      });
  }, [loadTasks, loadSubtasks]);

  // Datas com tarefas/eventos, usadas para desenhar indicadores no calendário.
  const taskDates = useMemo(() => {
    const dates = new Set<string>();

    tasks.forEach((task) => {
      if (!task.scheduled_date) return;

      const endDate = getTaskEndDate(task);

      if (task.task_type === "event" && endDate) {
        const current = new Date(`${task.scheduled_date}T00:00:00`);
        const last = new Date(`${endDate}T00:00:00`);

        while (current <= last) {
          dates.add(toISODate(current));
          current.setDate(current.getDate() + 1);
        }

        return;
      }

      dates.add(task.scheduled_date);
    });

    return dates;
  }, [tasks]);

  // Dados derivados do dia selecionado.
  const selectedIso = toISODate(selectedDate);
  const dayTasks = useMemo(
    () =>
      tasks
        .filter((task) => isTaskOnDate(task, selectedIso))
        .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? "")),
    [tasks, selectedIso]
  );
  const undatedTasks = useMemo(() => {
    const W: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return tasks
      .filter((t) => !t.scheduled_date)
      .sort((a, b) => (W[a.priority ?? "medium"] ?? 1) - (W[b.priority ?? "medium"] ?? 1));
  }, [tasks]);

  const now = new Date();
  // base = itens do dia selecionado (dayTasks já filtra por isTaskOnDate); agora inclui eventos
  const actionable = dayTasks;

  // Pontuação proporcional: tarefas sem subtarefas valem 0 ou 1;
  // tarefas com subtarefas contribuem com a fração concluída (ex: 3/5 = 0.6).
  const completedScore = actionable.reduce((acc, t) => {
    if (t.task_type === "event") return acc + (isEventCompleted(t, now) ? 1 : 0);
    const subs = subtasksMap[t.id];
    if (subs && subs.length > 0) {
      return acc + subs.filter((s) => s.done).length / subs.length;
    }
    return acc + (t.status === "done" ? 1 : 0);
  }, 0);

  const todayIso = toISODate(new Date());
  const selectedDailyStat = dailyStatsMap[selectedIso];
  // Só usa o snapshot se ele REALMENTE existir para o dia. Sem isso, um dia
  // passado sem linha em daily_task_stats (job de fim de dia ainda não rodou
  // para esse usuário/dia) caía no fallback "?? 0" e mostrava 0% mesmo tendo
  // tarefas concluídas de verdade — o cálculo ao vivo abaixo é sempre um
  // resultado melhor que "0% categórico" quando não há snapshot.
  const shouldUseSnapshot = selectedIso < todayIso && !!selectedDailyStat;

  const liveCompletedItems = actionable.filter((t) =>
    t.task_type === "event" ? isEventCompleted(t, now) : t.status === "done"
  ).length;

  const completedItems = shouldUseSnapshot
    ? selectedDailyStat!.completed_items
    : liveCompletedItems;

  const totalItems = shouldUseSnapshot
    ? selectedDailyStat!.total
    : actionable.length;

  const progress = shouldUseSnapshot
    ? selectedDailyStat!.completion_rate
    : totalItems === 0
    ? 0
    : Math.round((completedScore / totalItems) * 100);

  // Estatísticas históricas usadas quando o usuário consulta dias anteriores.
  const loadDailyStats = useCallback(async () => {
    try {
      const { start, end } = monthRangeOf(selectedDate);
      const stats = await api.getDailyStats(start, end);

      const map: Record<string, DailyStat> = {};

      for (const stat of stats) {
        map[stat.date] = stat;
      }

      setDailyStatsMap(map);
    } catch {
      setDailyStatsMap({});
    }
  }, [selectedDate]);

  useEffect(() => {
    loadDailyStats();
  }, [loadDailyStats]);

  async function handleToggleDone(task: Task) {
    const next =
      task.status === "done"
        ? { status: "todo" as TaskStatus, progress: 0 }
        : { status: "done" as TaskStatus, progress: 100 };
    try {
      await api.updateTask(task.id, next);
      await loadTasks();
      await loadSubtasks();
    } catch {
      // mantém o estado atual em caso de erro
    }
  }

  async function handleToggleSubtask(subtask: Subtask) {
    const nextDone = !subtask.done;

    setSubtasksMap((prev) => ({
      ...prev,
      [subtask.task_id]: (prev[subtask.task_id] ?? []).map((item) =>
        item.id === subtask.id ? { ...item, done: nextDone } : item
      ),
    }));

    try {
      await api.updateSubtask(subtask.id, { done: nextDone });
      await loadTasks();
      await loadSubtasks();
    } catch {
      await loadSubtasks();
    }
  }

  async function handleDeleteSubtask(subtask: Subtask) {
    const previous = subtasksMap;
    // Otimista: some da lista na hora.
    setSubtasksMap((map) => ({
      ...map,
      [subtask.task_id]: (map[subtask.task_id] ?? []).filter(
        (s) => s.id !== subtask.id
      ),
    }));

    try {
      await api.deleteSubtask(subtask.id);
      // O backend recalcula status/progresso da tarefa mãe a cada exclusão
      // (ex.: excluir a única pendente conclui a tarefa) — recarrega ambos.
      await loadTasks();
      await loadSubtasks();
    } catch {
      setSubtasksMap(previous); // reverte
      showToast("Não foi possível excluir a subtarefa");
    }
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  async function handleToggleKey(task: Task) {
    const marking = !task.is_key_task;
    // Troca: já existe outra tarefa chave no mesmo dia? (o backend desmarca-a)
    const hadOtherKey =
      marking && dayTasks.some((t) => t.is_key_task && t.id !== task.id);
    try {
      await api.updateTask(task.id, { is_key_task: marking });
      // O backend desmarca a anterior automaticamente, então recarregamos o dia
      // inteiro em vez de atualizar só o card clicado.
      await loadTasks();
      if (marking) {
        showToast(
          hadOtherKey ? "Tarefa chave atualizada" : "Tarefa chave definida"
        );
      } else {
        showToast("Tarefa chave removida");
      }
    } catch {
      // mantém o estado atual em caso de erro
    }
  }

  function handleDelete(task: Task) {
    setTaskToDelete(task);
  }

  function handleEdit(task: Task) {
    setTaskToEdit(task);
  }

  async function confirmDeleteTask() {
    if (!taskToDelete) return;

    setIsDeletingTask(true);

    try {
      await api.deleteTask(taskToDelete.id);
      setTaskToDelete(null);
      await loadTasks();
      await loadSubtasks();
    } catch {
      // depois podemos colocar um toast/erro visual aqui
    } finally {
      setIsDeletingTask(false);
    }
  }

  function cancelDeleteTask() {
    if (isDeletingTask) return;
    setTaskToDelete(null);
  }

  async function handleConnectGoogleCalendar() {
    if (isConnectingCalendar) return;

    setIsConnectingCalendar(true);
    setCalendarConnectError(null);

    try {
      const { auth_url } = await api.connectGoogleCalendar();

      localStorage.setItem(CALENDAR_SETUP_STORAGE_KEY, "google");
      setCalendarSetupChoice("google");
      window.location.href = auth_url;
    } catch (e) {
      setCalendarConnectError(
        e instanceof Error
          ? e.message
          : "Não foi possível iniciar a conexão com o Google Calendar."
      );
      setIsConnectingCalendar(false);
    }
  }

  function handleUseIndependentCalendar() {
    localStorage.setItem(CALENDAR_SETUP_STORAGE_KEY, "independent");
    setCalendarSetupChoice("independent");
    setCalendarConnectError(null);
  }

  // Conteúdo principal da agenda, compartilhado entre modo embutido e página própria.
  const inner = (
    <>
      {carriedCount > 0 && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3">
            <p className="text-xs leading-5 text-amber-700 dark:text-amber-100">
              <span className="font-semibold">{carriedCount} {carriedCount === 1 ? "tarefa pendente" : "tarefas pendentes"}</span> de ontem {carriedCount === 1 ? "foi movida" : "foram movidas"} para hoje.
            </p>
            <button
              type="button"
              onClick={() => setCarriedCount(0)}
              className="shrink-0 text-amber-700/60 transition active:scale-95 dark:text-amber-200/60"
              aria-label="Fechar aviso"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <section className="mb-4">
          <div className="relative overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_48%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.18),transparent_40%)] opacity-60 dark:opacity-30" />

            <div className="relative">
              <div className="mb-4">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
                  <Sparkles className="h-3.5 w-3.5" />
                  Hoje
                </div>

                <h1 className="text-[1.8rem] font-semibold leading-[1.02] tracking-[-0.055em] text-primary">
                  {actionable.length === 0
                    ? "Seu plano começa aqui."
                    : "Seu plano está em movimento."}
                </h1>

                <p className="mt-2 text-sm leading-6 text-muted">
                  {actionable.length === 0
                    ? "Nenhuma tarefa ainda — crie pela conversa com o Axon ou no botão +."
                    : `${completedItems} de ${totalItems} itens concluídos.`}
                </p>
              </div>

              <div className="flex flex-col items-center">
                <CircularProgress value={progress} />

                <div className="mt-4 grid w-full grid-cols-3 gap-2 rounded-[1.4rem] border border-soft bg-surface-muted p-2">
                  <LegendItem color="bg-white/30" label="A fazer" />
                  <LegendItem color="bg-purple-300" label="Em andamento" />
                  <LegendItem color="bg-emerald-300" label="Concluído" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-4 rounded-[2rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">
                {calendarSetupChoice ? "Calendário" : "Configurar calendário"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {calendarSetupChoice
                  ? "Mês, semana e blocos do dia"
                  : "Escolha como deseja usar sua agenda no Axon"}
              </p>
            </div>

            {calendarSetupChoice && (
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-card transition active:scale-[0.96]"
                aria-label="Criar novo item"
              >
                <Plus className="h-5 w-5" />
              </button>
            )}
          </div>

          {!calendarSetupChoice ? (
            <CalendarSetupCard
              isConnecting={isConnectingCalendar}
              error={calendarConnectError}
              onConnect={handleConnectGoogleCalendar}
              onUseIndependent={handleUseIndependentCalendar}
            />
          ) : (
            <>
              {calendarSetupChoice === "independent" && (
                <div className="mb-4 rounded-[1.4rem] border border-soft bg-surface-muted p-3">
                  <p className="text-xs leading-5 text-muted">
                    Você está usando o calendário independente do Axon. Depois será
                    possível conectar o Google Calendar pelas configurações.
                  </p>
                </div>
              )}

              {calendarSetupChoice === "google" && (
                <div className="mb-4 rounded-[1.4rem] border border-accent-soft bg-accent-soft p-3">
                  <p className="text-xs leading-5 text-accent">
                    Google Calendar selecionado. Se a autorização ainda não foi
                    concluída, o Axon terminará a conexão após o retorno do Google.
                  </p>
                </div>
              )}

              <div className="mb-4 flex rounded-2xl border border-soft bg-surface-muted p-1">
                <button
                  type="button"
                  onClick={() => setViewMode("month")}
                  className={`min-h-10 flex-1 rounded-xl text-xs font-semibold transition active:scale-[0.98] ${
                    viewMode === "month"
                      ? "bg-[var(--accent-strong)] text-white shadow-card"
                      : "text-muted"
                  }`}
                >
                  Mês
                </button>

                <button
                  type="button"
                  onClick={() => setViewMode("week")}
                  className={`min-h-10 flex-1 rounded-xl text-xs font-semibold transition active:scale-[0.98] ${
                    viewMode === "week"
                      ? "bg-[var(--accent-strong)] text-white shadow-card"
                      : "text-muted"
                  }`}
                >
                  Dia/Semana
                </button>
              </div>

              {viewMode === "month" ? (
                <MonthCalendar
                  selectedDate={selectedDate}
                  onSelect={setSelectedDate}
                  tasks={tasks}
                />
              ) : (
                <>
                  <WeekCalendar
                    selectedDate={selectedDate}
                    onSelect={setSelectedDate}
                    taskDates={taskDates}
                  />

                  <div className="mt-5">
                    {/* Chip da fila — sempre visível quando há tarefas sem data */}
                    {undatedTasks.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setIsQueueOpen(true)}
                        className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-indigo-300/25 bg-indigo-500/10 px-4 py-3 text-left transition active:scale-[0.98]"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-700 dark:text-indigo-200">
                          <ListTodo className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-100">Fila de tarefas</p>
                          <p className="text-xs text-indigo-700/55 dark:text-indigo-200/55">
                            {undatedTasks.length} {undatedTasks.length === 1 ? "tarefa sem data definida" : "tarefas sem data definida"}
                          </p>
                        </div>
                        <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-indigo-500 px-1.5 text-xs font-bold text-white">
                          {undatedTasks.length}
                        </span>
                      </button>
                    )}

                    {loading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando tarefas…
                      </div>
                    ) : error ? (
                      <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-100">
                        {error}
                      </div>
                    ) : dayTasks.length === 0 && undatedTasks.length === 0 ? (
                      <EmptyState
                        icon={ListTodo}
                        title="Nenhuma tarefa neste dia"
                        description="Converse com o Axon para ele organizar sua rotina, ou crie manualmente."
                        actionLabel="Criar tarefa"
                        onAction={() => setIsCreateModalOpen(true)}
                      />
                    ) : dayTasks.length === 0 ? (
                      <EmptyState title="Nenhuma tarefa neste dia" />
                    ) : (
                      <div className="space-y-5">
                        {dayTasks.map((task) => (
                          <TimelineItem
                            key={task.id}
                            task={task}
                            selectedIso={selectedIso}
                            subtasks={subtasksMap[task.id] ?? []}
                            onToggle={handleToggleDone}
                            onToggleKey={handleToggleKey}
                            onEdit={handleEdit}
                            onDelete={handleDelete}
                            onToggleSubtask={handleToggleSubtask}
                            onDeleteSubtask={handleDeleteSubtask}
                            onSubtaskChange={loadSubtasks}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {viewMode === "month" && (
          <section className="rounded-[2rem] border border-accent-soft bg-accent-soft p-4 text-primary shadow-card backdrop-blur-2xl">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" />
              <p className="text-sm font-semibold text-accent">
                Visão do mês
              </p>
            </div>

            <p className="text-sm leading-6 text-muted">
              Os pontos indicam dias com tarefas agendadas. Toque em um dia e volte
              para a visão de semana para ver os detalhes.
            </p>
          </section>
        )}
    </>
  );

  // Modais e toasts ficam fora do conteúdo para manter a hierarquia visual fixa.
  const modals = (
    <>
      <CreatePlanningItemModal
        isOpen={isCreateModalOpen}
        defaultDate={selectedIso}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={async () => {
          setIsCreateModalOpen(false);
          await loadTasks();
          await loadSubtasks();
        }}
      />

      <EditPlanningItemModal
        task={taskToEdit}
        onClose={() => setTaskToEdit(null)}
        onUpdated={async () => {
          setTaskToEdit(null);
          await loadTasks();
          await loadSubtasks();
        }}
        onSubtaskChange={loadSubtasks}
      />

      <DeletePlanningItemModal
        task={taskToDelete}
        isDeleting={isDeletingTask}
        onClose={cancelDeleteTask}
        onConfirm={confirmDeleteTask}
      />

      {isQueueOpen && (
        <UndatedTasksSheet
          tasks={undatedTasks}
          onClose={() => setIsQueueOpen(false)}
          onEdit={(t) => { setIsQueueOpen(false); handleEdit(t); }}
          onDelete={(t) => { setIsQueueOpen(false); handleDelete(t); }}
          onToggle={handleToggleDone}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border border-amber-300/25 bg-surface-elevated px-4 py-2.5 text-sm font-medium text-amber-700 shadow-soft backdrop-blur-xl dark:text-amber-100">
            <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
            {toast}
          </div>
        </div>
      )}
    </>
  );

  // No hub (embedded), a moldura — main, header, Sidebar — vem do componente
  // Planning (hub de abas) acima, neste mesmo arquivo.
  if (embedded) {
    return (
      <>
        {inner}
        {modals}
      </>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 min-h-screen px-4 pb-6 pt-5">
        <PageHeader
          title="Planejamento"
          subtitle="Rotina e tarefas"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        {inner}
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
      />

      {modals}
    </main>
  );
}

// ===========================================================================
// CONFIGURAÇÃO INICIAL DO CALENDÁRIO
// ===========================================================================

function CalendarSetupCard({
  isConnecting,
  error,
  onConnect,
  onUseIndependent,
}: {
  isConnecting: boolean;
  error: string | null;
  onConnect: () => void;
  onUseIndependent: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.7rem] border border-accent-soft bg-accent-soft p-5 text-primary">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_48%)]" />
      <div className="relative">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-soft bg-surface-elevated text-accent">
          <CalendarDays className="h-5 w-5" />
        </div>

        <h2 className="text-[1.45rem] font-semibold leading-[1.05] tracking-[-0.05em] text-primary">
          Como você quer usar sua agenda?
        </h2>

        <p className="mt-3 text-sm leading-6 text-muted">
          Conecte o Google Calendar para sincronizar seus compromissos ou use o
          calendário independente do Axon por enquanto.
        </p>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={onConnect}
            disabled={isConnecting}
            className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Conectando…
              </>
            ) : (
              <>
                <CalendarDays className="mr-2 h-4 w-4" />
                Vincular Google Calendar
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onUseIndependent}
            disabled={isConnecting}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-5 text-sm font-semibold text-secondary transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continuar sem vincular
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-500/10 p-3 text-xs leading-5 text-rose-700 dark:text-rose-100">
            {error}
          </p>
        )}

        <p className="mt-4 text-xs leading-5 text-soft">
          Você poderá conectar o Google Calendar depois em Configurações.
        </p>
      </div>
    </div>
  );
}

// ===========================================================================
// ESTADOS VISUAIS E PROGRESSO
// ===========================================================================

function CircularProgress({ value }: { value: number }) {
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (circumference * value) / 100;

  return (
    <div className="relative flex h-48 w-48 items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_62%)] blur-xl" />

      <svg className="relative h-44 w-44 -rotate-90" viewBox="0 0 150 150">
        <circle
          cx="75"
          cy="75"
          r={radius}
          stroke="var(--border-medium)"
          strokeWidth="14"
          fill="none"
        />

        <circle
          cx="75"
          cy="75"
          r={radius}
          stroke="url(#progress-gradient)"
          strokeWidth="14"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />

        <defs>
          <linearGradient
            id="progress-gradient"
            x1="20"
            y1="20"
            x2="130"
            y2="130"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#f0abfc" />
            <stop offset="0.52" stopColor="#a855f7" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
      </svg>

      <div className="absolute text-center">
        <p className="text-4xl font-semibold tracking-[-0.06em] text-primary">
          {value}%
        </p>
        <p className="mt-1 text-xs font-medium text-muted">concluído</p>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex min-h-9 items-center justify-center gap-2 rounded-xl bg-surface-muted px-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} />
      <p className="text-[0.62rem] font-medium text-muted">{label}</p>
    </div>
  );
}

// ===========================================================================
// CALENDÁRIO MENSAL
// ===========================================================================

function MonthCalendar({
  selectedDate,
  onSelect,
  tasks,
}: {
  selectedDate: Date;
  onSelect: (d: Date) => void;
  tasks: Task[];
}) {
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = toISODate(new Date());

  function shiftMonth(delta: number) {
    onSelect(new Date(year, month + delta, 1));
  }

  function getItemsForDay(date: Date) {
    const iso = toISODate(date);

    return tasks.filter((task) => {
      if (!task.scheduled_date) return false;

      const startDate = task.scheduled_date;

      /**
       * Preparado para eventos de vários dias.
       * Quando o backend tiver end_date, ele já funciona.
       */
      const endDate = (task as Task & { end_date?: string }).end_date;

      if (endDate) {
        return iso >= startDate && iso <= endDate;
      }

      return iso === startDate;
    });
  }
  

  function isMultiDayEventOnDate(task: Task, date: Date) {
    const iso = toISODate(date);
    const endDate = (task as Task & { end_date?: string }).end_date;

    return Boolean(
      task.task_type === "event" &&
        task.scheduled_date &&
        endDate &&
        iso >= task.scheduled_date &&
        iso <= endDate
    );
  }

  return (
    <div className="rounded-[1.6rem] border border-soft bg-surface-muted p-4">
      <div className="mb-5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="text-center">
          <p className="text-sm font-semibold text-primary">
            {monthNames[month]} {year}
          </p>
          <p className="mt-1 text-xs text-muted">Planejamento mensal</p>
        </div>

        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-3 grid grid-cols-7 gap-2 text-center">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((day, index) => (
          <p key={`${day}-${index}`} className="text-[0.68rem] text-muted">
            {day}
          </p>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`blank-${i}`} />
        ))}

        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const date = new Date(year, month, day);
          const iso = toISODate(date);

          const isSelected = iso === toISODate(selectedDate);
          const isToday = iso === todayIso;

          const items = getItemsForDay(date);
          const visibleItems = items.slice(0, 3);
          const extraCount = items.length - visibleItems.length;

          const hasMultiDayEvent = items.some((item) =>
            isMultiDayEventOnDate(item, date)
          );

          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelect(date)}
              className={`relative flex min-h-[4.4rem] flex-col items-center justify-start rounded-xl border px-1.5 py-2 text-xs font-medium transition active:scale-[0.96] ${
                isSelected
                  ? "border-accent-soft bg-[var(--accent-strong)] text-white shadow-card"
                  : isToday
                  ? "border-accent-soft bg-accent-soft text-accent"
                  : "border-soft bg-surface-muted text-muted"
              }`}
            >
              <span className="text-sm font-semibold">{day}</span>

              {hasMultiDayEvent && (
                <span
                  className={`mt-1 h-1.5 w-full rounded-full ${
                    isSelected ? "bg-white/75" : "bg-cyan-300/70"
                  }`}
                />
              )}

              {items.length > 0 && (
                <div className="mt-auto flex w-full flex-col items-center gap-1 pt-1">
                  <div className="flex max-w-full justify-center gap-1">
                    {visibleItems.map((item) => (
                      <span
                        key={item.id}
                        className={`h-1.5 w-1.5 rounded-full ${getMonthItemColor(
                          item.task_type,
                          isSelected
                        )}`}
                      />
                    ))}
                  </div>

                  {extraCount > 0 && (
                    <span
                      className={`text-[0.58rem] font-semibold leading-none ${
                        isSelected ? "text-white/80" : "text-muted"
                      }`}
                    >
                      +{extraCount}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-[1.25rem] border border-soft bg-surface-muted p-2">
        <MonthLegendDot color="bg-purple-300" label="Tarefa" />
        <MonthLegendDot color="bg-cyan-300" label="Evento" />
        <MonthLegendDot color="bg-fuchsia-300" label="Rotina" />
      </div>
    </div>
  );
}

function getMonthItemColor(taskType: TaskType, isSelected: boolean) {
  if (isSelected) return "bg-white";

  if (taskType === "event") return "bg-cyan-300";
  if (taskType === "routine") return "bg-fuchsia-300";

  return "bg-purple-300";
}

function MonthLegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-xl bg-surface-muted px-2 py-2">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span className="text-[0.62rem] font-medium text-muted">{label}</span>
    </div>
  );
}

function monthRangeOf(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);

  return {
    start: toISODate(start),
    end: toISODate(end),
  };
}

function isPastDate(isoDate: string) {
  return isoDate < toISODate(new Date());
}

// ===========================================================================
// CALENDÁRIO SEMANAL
// ===========================================================================

function WeekCalendar({
  selectedDate,
  onSelect,
  taskDates,
}: {
  selectedDate: Date;
  onSelect: (d: Date) => void;
  taskDates: Set<string>;
}) {
  const days = weekDaysOf(selectedDate);
  const todayIso = toISODate(new Date());
  const monthLabel = `${monthNames[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`;

  function shiftWeek(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(selectedDate.getDate() + delta * 7);
    onSelect(d);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="text-center">
          <p className="text-sm font-semibold text-primary">{monthLabel}</p>
          <p className="mt-1 text-xs text-muted">Semana atual</p>
        </div>

        <button
          type="button"
          onClick={() => shiftWeek(1)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0">
        {days.map((date) => {
          const iso = toISODate(date);
          const isSelected = iso === toISODate(selectedDate);
          const isToday = iso === todayIso;
          const hasTask = taskDates.has(iso);

          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(date)}
              className={`relative flex min-h-[82px] min-w-[62px] flex-col items-center justify-center rounded-[1.4rem] border transition active:scale-[0.98] sm:min-w-0 sm:w-full ${
                isSelected
                  ? "border-accent-soft bg-[var(--accent-strong)] text-white shadow-card"
                  : isToday
                  ? "border-accent-soft bg-accent-soft text-accent"
                  : "border-soft bg-surface-muted text-muted"
              }`}
            >
              <p className="text-xl font-semibold">{date.getDate()}</p>
              <p className="mt-1 text-xs">{weekdayShort[date.getDay()]}</p>

              {hasTask && (
                <span
                  className={`absolute bottom-2 h-1 w-1 rounded-full ${
                    isSelected ? "bg-white" : "bg-[var(--accent)]"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// ITEM DA LINHA DO TEMPO
// ===========================================================================

function TimelineItem({
  task,
  selectedIso,
  subtasks = [],
  onToggle,
  onToggleKey,
  onEdit,
  onDelete,
  onToggleSubtask,
  onDeleteSubtask,
  onSubtaskChange,
}: {
  task: Task;
  selectedIso: string;
  subtasks?: Subtask[];
  onToggle: (t: Task) => void;
  onToggleKey?: (t: Task) => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToggleSubtask: (subtask: Subtask) => void;
  onDeleteSubtask: (subtask: Subtask) => void;
  onSubtaskChange?: () => void;
}) {
  const isKey = !!task.is_key_task;
  const Icon =
    task.task_type === "task"
      ? ListTodo
      : task.task_type === "event"
      ? CalendarDays
      : Repeat;

  const start = hhmm(task.start_time);
  const end = hhmm(task.end_time);
  const subtitle = task.description || typeLabels[task.task_type];

  const isDone = task.status === "done";
  const isEvent = task.task_type === "event";
  const isRoutine = task.task_type === "routine";

  const completedSubtasks = subtasks.filter((subtask) => subtask.done).length;
  const hasSubtasks = subtasks.length > 0;
  const visualProgress = hasSubtasks
    ? Math.round((completedSubtasks / subtasks.length) * 100)
    : task.progress ?? 0;

  const displayStatus = hasSubtasks && completedSubtasks === subtasks.length
    ? "done"
    : getDisplayStatus(task, selectedIso);
  const isDisplayDone = displayStatus === "done";
  const isDisplayProgress = displayStatus === "progress";
  const isDisplayScheduled = displayStatus === "scheduled";

  const multiDayProgress = isEvent
    ? getMultiDayEventProgress(task, selectedIso)
    : null;

  const isMultiDayEvent = Boolean(multiDayProgress);
  const canCompleteMultiDayEvent = multiDayProgress?.isLastDay;
  const taskEndDate = getTaskEndDate(task);

  const detailLabel =
    isRoutine && task.recurrence
      ? recurrenceLabels[task.recurrence] ?? task.recurrence
      : isMultiDayEvent && task.scheduled_date && taskEndDate
      ? `${task.scheduled_date} até ${taskEndDate}`
      : isEvent
      ? `${start ?? "—"}${end ? ` - ${end}` : ""}`
      : start && end
      ? `${start} - ${end}`
      : start ?? "Sem horário";

  return (
    <div className="grid grid-cols-[3.4rem_1fr] gap-3">
      <div className="flex flex-col pt-1">
        <p className="text-xs font-semibold text-secondary">{start ?? "—"}</p>

        <div
          className={`mx-auto my-2 w-px flex-1 border-l ${
            isRoutine
              ? "border-dashed border-accent-soft"
              : "border-dashed border-[var(--border-soft)]"
          }`}
        />

        <p className="pb-1 text-xs font-semibold text-muted">{end ?? "—"}</p>
      </div>

      <div
        className={`min-w-0 rounded-[1.55rem] border p-4 shadow-xl shadow-card ${
          isKey ? "ring-1 ring-amber-300/45 " : ""
        }${
          isKey
            ? "border-amber-300/30 bg-amber-400/[0.08]"
            : isDisplayDone
            ? "border-emerald-300/20 bg-emerald-400/10"
            : isEvent && isDisplayProgress
            ? "border-accent-soft bg-accent-soft"
            : isEvent
            ? "border-cyan-300/20 bg-cyan-400/10"
            : isRoutine
            ? "border-fuchsia-300/20 bg-fuchsia-400/10"
            : isDisplayProgress
            ? "border-accent-soft bg-accent-soft"
            : "border-soft bg-surface-muted"
        }`}
      >
        {/* Header do card: tipo, status, subtarefas e ações rápidas. */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {isKey && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/30 bg-amber-400/10 px-3 py-1 text-[0.65rem] font-semibold text-amber-100">
                <Star className="h-3 w-3 fill-amber-300 text-amber-300" />
                Tarefa chave
              </span>
            )}

            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.65rem] font-semibold ${
                isEvent
                  ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                  : isRoutine
                  ? "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100"
                  : isDisplayDone
                  ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  : isDisplayProgress
                  ? "border-accent-soft bg-accent-soft text-accent"
                  : "border-soft bg-surface-muted text-muted"
              }`}
            >
              <Icon className="h-3 w-3" />
              {typeLabels[task.task_type]}
            </span>

            <span
              className={`rounded-full border px-3 py-1 text-[0.65rem] font-semibold ${
                isDisplayDone
                  ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                  : isDisplayProgress
                  ? "border-accent-soft bg-accent-soft text-accent"
                  : isDisplayScheduled
                  ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                  : "border-soft bg-surface-muted text-muted"
              }`}
            >
              {statusLabels[displayStatus]}
            </span>

            {hasSubtasks && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft px-3 py-1 text-[0.65rem] font-semibold text-accent">
                <CheckCircle2 className="h-3 w-3" />
                {completedSubtasks}/{subtasks.length}
              </span>
            )}

            {task.carry_count > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border border-orange-300/20 bg-orange-400/10 px-3 py-1 text-[0.65rem] font-semibold text-orange-100"
                title={`Adiada ${task.carry_count}x`}
              >
                <RotateCcw className="h-3 w-3" />
                {task.carry_count}x adiada
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onToggleKey && (
              <button
                type="button"
                onClick={() => onToggleKey(task)}
                className={`flex h-8 w-8 items-center justify-center rounded-xl active:scale-[0.94] ${
                  isKey
                    ? "bg-amber-400/15 text-amber-200"
                    : "bg-surface-muted text-muted"
                }`}
                aria-label={
                  isKey ? "Desmarcar tarefa chave" : "Marcar como tarefa chave"
                }
                title={
                  isKey ? "Desmarcar tarefa chave" : "Marcar como tarefa chave"
                }
              >
                <Star
                  className={`h-4 w-4 ${isKey ? "fill-amber-300 text-amber-300" : ""}`}
                />
              </button>
            )}

            <button
              type="button"
              onClick={() => onEdit(task)}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
              aria-label="Editar item"
            >
              <Edit3 className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => onDelete(task)}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
              aria-label="Remover item"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Conteúdo principal do card. */}
        <div className="mb-4 flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
              isDisplayDone
                ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                : isEvent && isDisplayProgress
                ? "border-accent-soft bg-accent-soft text-accent"
                : isEvent
                ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                : isRoutine
                ? "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100"
                : isDisplayProgress
                ? "border-accent-soft bg-accent-soft text-accent"
                : "border-soft bg-surface-muted text-muted"
            }`}
          >
            {isDisplayDone ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Icon className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="break-words text-base font-semibold text-primary">
              {task.title}
            </p>
            <p className="mt-1 truncate text-xs text-muted">{subtitle}</p>
            {task.objective_title && (
              <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft px-2.5 py-0.5 text-[0.65rem] font-medium text-accent">
                <Target className="h-2.5 w-2.5" />
                {task.objective_title}
              </div>
            )}
          </div>
        </div>

        {/* Linha de horário e ação de conclusão. */}
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="truncate text-xs text-muted">{detailLabel}</p>

          {isMultiDayEvent ? (
            <button
              type="button"
              onClick={() => {
                if (canCompleteMultiDayEvent) {
                  onToggle(task);
                }
              }}
              disabled={!canCompleteMultiDayEvent}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold active:scale-[0.97] disabled:cursor-not-allowed ${
                isDone
                  ? "text-emerald-200"
                  : canCompleteMultiDayEvent
                  ? "text-accent"
                  : "text-soft"
              }`}
            >
              {isDone ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Concluído
                </>
              ) : canCompleteMultiDayEvent ? (
                <>
                  <Circle className="h-3.5 w-3.5" />
                  Marcar
                </>
              ) : (
                <>
                  <Circle className="h-3.5 w-3.5" />
                  Em andamento
                </>
              )}
            </button>
          ) : !isEvent ? (
            <button
              type="button"
              onClick={() => onToggle(task)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent transition active:scale-[0.97]"
            >
              {isDone ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Feita
                </>
              ) : (
                <>
                  <Circle className="h-3.5 w-3.5" />
                  Marcar
                </>
              )}
            </button>
          ) : null}
        </div>

        {/* Barra de progresso. Em tarefas com subtarefas, usa o checklist como fonte. */}
        {isMultiDayEvent ? (
          <div>
            <div className="mb-2 flex items-center justify-between text-[0.68rem] text-muted">
              <span>
                Dia {multiDayProgress?.currentDay} de {multiDayProgress?.totalDays}
              </span>

              <span>{isDone ? "100" : multiDayProgress?.progress}%</span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border-soft)]">
              <div
                className={`h-full rounded-full ${
                  isDone
                    ? "bg-emerald-300"
                    : "bg-gradient-to-r from-cyan-300 to-purple-300"
                }`}
                style={{
                  width: `${isDone ? 100 : multiDayProgress?.progress ?? 0}%`,
                }}
              />
            </div>
          </div>
        ) : !isEvent ? (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border-soft)]">
              <div
                className={`h-full rounded-full ${
                  isDisplayDone
                    ? "bg-emerald-300"
                    : isRoutine
                    ? "bg-gradient-to-r from-fuchsia-300 to-purple-300"
                    : isDisplayProgress
                    ? "bg-gradient-to-r from-purple-400 to-fuchsia-300"
                    : "bg-white/30"
                }`}
                style={{ width: `${Math.max(visualProgress, 6)}%` }}
              />
            </div>

            <SubtasksPreview
              taskId={task.id}
              subtasks={subtasks}
              completedSubtasks={completedSubtasks}
              onToggleSubtask={onToggleSubtask}
              onDeleteSubtask={onDeleteSubtask}
              onSubtaskChange={onSubtaskChange}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
// ===========================================================================
// PRÉVIA DE SUBTAREFAS NO CARD
// ===========================================================================

function SubtasksPreview({
  taskId,
  subtasks,
  completedSubtasks,
  onToggleSubtask,
  onDeleteSubtask,
  onSubtaskChange,
}: {
  taskId: string;
  subtasks: Subtask[];
  completedSubtasks: number;
  onToggleSubtask: (subtask: Subtask) => void;
  onDeleteSubtask: (subtask: Subtask) => void;
  onSubtaskChange?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const hasSubtasks = subtasks.length > 0;
  const visibleSubtasks = expanded ? subtasks : subtasks.slice(0, 3);
  const hiddenCount = subtasks.length - visibleSubtasks.length;
  const canExpand = subtasks.length > 3;

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await api.createSubtask(taskId, { title });
      setNewTitle("");
      setAdding(false);
      onSubtaskChange?.();
    } catch {
      // Mantém o estado atual em caso de erro.
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 space-y-2 rounded-[1.25rem] border border-soft bg-surface-muted p-3">
      {hasSubtasks && (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-soft">
              Subtarefas
            </p>

            <p className="text-[0.68rem] font-semibold text-accent">
              {completedSubtasks} de {subtasks.length}
            </p>
          </div>

          {visibleSubtasks.map((subtask) => (
            // Linha = div com dois botões irmãos: <button> aninhado é HTML
            // inválido e faria o X disparar o toggle junto.
            <div
              key={subtask.id}
              className="flex w-full items-start gap-2 rounded-xl px-1 py-1.5 text-left"
            >
              <button
                type="button"
                onClick={() => onToggleSubtask(subtask)}
                className="flex min-w-0 flex-1 items-start gap-2 text-left active:scale-[0.99]"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    subtask.done
                      ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-100"
                      : "border-soft bg-surface-muted text-soft"
                  }`}
                >
                  {subtask.done && <CheckCircle2 className="h-3.5 w-3.5" />}
                </span>

                <span
                  className={`min-w-0 flex-1 break-words text-xs ${
                    subtask.done ? "text-soft line-through" : "text-secondary"
                  }`}
                >
                  {subtask.title}
                </span>
              </button>

              <button
                type="button"
                aria-label={`Excluir subtarefa ${subtask.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteSubtask(subtask);
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-soft transition hover:text-red-400 active:scale-[0.92]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {canExpand && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 pl-7 text-[0.68rem] font-semibold text-accent transition active:scale-[0.98]"
            >
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
              />
              {expanded ? "Ver menos" : `Ver mais (${hiddenCount})`}
            </button>
          )}
        </>
      )}

      {adding ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
              if (e.key === "Escape") {
                setAdding(false);
                setNewTitle("");
              }
            }}
            placeholder="Nome da subtarefa…"
            className="min-h-[34px] flex-1 rounded-xl border border-accent-soft bg-surface-muted px-3 text-xs text-primary outline-none placeholder:text-soft"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newTitle.trim()}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-strong)] text-white transition active:scale-[0.94] disabled:opacity-45"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setNewTitle("");
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-soft)] py-1.5 text-[0.68rem] font-semibold text-muted active:scale-[0.98]"
        >
          <Plus className="h-3.5 w-3.5" />
          Adicionar subtarefa
        </button>
      )}
    </div>
  );
}

// ===========================================================================
// MODAL DE CRIAÇÃO DE ITEM
// ===========================================================================

function CreatePlanningItemModal({
  isOpen,
  defaultDate,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [selectedType, setSelectedType] = useState<TaskType>("task");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [endDate, setEndDate] = useState(defaultDate);
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [location, setLocation] = useState("");
  const [recurrence, setRecurrence] = useState<"daily" | "weekly" | "monthly">(
    "daily"
  );
  const [axonPickTime, setAxonPickTime] = useState(false);
  const [duration, setDuration] = useState("");
  const [isKeyTask, setIsKeyTask] = useState(false);

  const [description, setDescription] = useState("");
  const [draftSubtasks, setDraftSubtasks] = useState<
    { key: string; title: string }[]
  >([]);
  const [objectiveId, setObjectiveId] = useState("");
  const [objectives, setObjectives] = useState<api.Objective[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function addDraftSubtask() {
    setDraftSubtasks((prev) => [
      ...prev,
      { key: Math.random().toString(36).slice(2), title: "" },
    ]);
  }
  function updateDraftSubtask(key: string, title: string) {
    setDraftSubtasks((prev) =>
      prev.map((subtask) =>
        subtask.key === key ? { ...subtask, title } : subtask
      )
    );
  }
  function removeDraftSubtask(key: string) {
    setDraftSubtasks((prev) => prev.filter((s) => s.key !== key));
  }

  useEffect(() => {
    if (isOpen) {
      setSelectedType("task");
      setTitle("");
      setDate(defaultDate);
      setStartTime("");
      setEndTime("");
      setPriority("medium");
      setLocation("");
      setRecurrence("daily");
      setDescription("");
      setDraftSubtasks([]);
      setObjectiveId("");
      setFormError(null);
      setEndDate(defaultDate);
      setAxonPickTime(false);
      setDuration("");
      setIsKeyTask(false);

      // Objetivos ativos para o campo "Vincular a objetivo".
      api.getObjectives()
        .then((list) => setObjectives(list.filter((o) => o.status === "active")))
        .catch(() => setObjectives([]));
    }
  }, [isOpen, defaultDate]);

  const titlePlaceholder =
    selectedType === "task"
      ? "Ex: Estender as roupas"
      : selectedType === "event"
      ? "Ex: Reunião com cliente"
      : "Ex: Pilates";

  const description_text =
    selectedType === "task"
      ? "Tarefas são ações pontuais que você pode marcar como concluídas."
      : selectedType === "event"
      ? "Eventos ocupam um horário fixo, com início e fim definidos."
      : "Rotinas são compromissos recorrentes que se repetem automaticamente.";

  async function handleSubmit() {
    if (!title.trim()) {
      setFormError("Dê um nome para o item.");
      return;
    }
    if (selectedType === "event" && endDate && date && endDate < date) {
      setFormError("A data final do evento não pode ser anterior à data inicial.");
      return;
    }
    if (!axonPickTime && startTime && endTime && endTime <= startTime) {
      setFormError("O horário de término precisa ser depois do horário de início.");
      return;
    }
    if (axonPickTime && selectedType !== "routine") {
      const d = Number(duration);
      if (!duration || !Number.isFinite(d) || d <= 0) {
        setFormError("Informe a duração em minutos para o Axon escolher o horário.");
        return;
      }
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const useAxon = axonPickTime && selectedType !== "routine";
      const task = await api.createTask({
        title: title.trim(),
        task_type: selectedType,
        scheduled_date: date || undefined,
        end_date: selectedType === "event" ? endDate || date : undefined,
        start_time: useAxon ? undefined : startTime || undefined,
        end_time: useAxon ? undefined : endTime || undefined,
        priority: selectedType === "task" ? priority : undefined,
        location: selectedType === "event" ? location || undefined : undefined,
        recurrence: selectedType === "routine" ? recurrence : undefined,
        description: description || undefined,
        axon_pick_time: useAxon || undefined,
        duration_minutes: useAxon ? Number(duration) : undefined,
        is_key_task: selectedType === "task" && isKeyTask ? true : undefined,
        objective_id:
          selectedType === "task" && objectiveId ? objectiveId : undefined,
      } as any);

      const validDrafts = draftSubtasks.filter((s) => s.title.trim());
      if (validDrafts.length > 0) {
        await Promise.all(
          validDrafts.map((subtask) =>
            api.createSubtask(task.id, { title: subtask.title.trim() })
          )
        );
      }
      await onCreated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao criar item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      closeOnOverlayClick={false}
      ariaLabel="Adicionar ao planejamento"
      maxHeightClassName="max-h-[88vh]"
      surfaceClassName="bg-surface-elevated"
      footer={
        <>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-6 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Criando…
              </>
            ) : (
              <>
                Criar {typeLabels[selectedType].toLowerCase()}
                <Plus className="ml-2 h-4 w-4" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-6 text-sm font-semibold text-secondary transition active:scale-[0.98]"
          >
            Cancelar
          </button>
        </>
      }
    >
      {/* Cabeçalho mantido no conteúdo para preservar o visual. */}
      <div className="mb-4">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
          <Plus className="h-3.5 w-3.5" />
          Novo item
        </div>

        <h2 className="text-[1.55rem] font-semibold leading-[1.05] tracking-[-0.05em] text-primary">
          Adicionar ao planejamento
        </h2>

        <p className="mt-2 text-xs leading-5 text-muted">
          {description_text}
        </p>
      </div>

          <div className="mb-4 grid grid-cols-3 gap-2">
            <TypeButton
              active={selectedType === "task"}
              icon={ListTodo}
              label="Tarefa"
              onClick={() => setSelectedType("task")}
            />

            <TypeButton
              active={selectedType === "event"}
              icon={CalendarDays}
              label="Evento"
              onClick={() => setSelectedType("event")}
            />

            <TypeButton
              active={selectedType === "routine"}
              icon={Repeat}
              label="Rotina"
              onClick={() => setSelectedType("routine")}
            />
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-muted">
                Nome
              </span>

              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={titlePlaceholder}
                className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none placeholder:text-soft focus:border-accent-soft"
              />
            </label>

            {selectedType === "event" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-muted">
                    Data inicial
                  </span>

                  <input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);

                      if (!endDate || endDate < e.target.value) {
                        setEndDate(e.target.value);
                      }
                    }}
                    className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-muted">
                    Data final
                  </span>

                  <input
                    type="date"
                    value={endDate}
                    min={date}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                  />
                </label>
              </div>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Data
                </span>

                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                />
              </label>
            )}

            {selectedType !== "routine" && (
              <div>
                <span className="mb-2 block text-xs font-medium text-muted">
                  Horário
                </span>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAxonPickTime(false)}
                    className={`flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition active:scale-[0.97] ${
                      !axonPickTime
                        ? "border-accent-soft bg-accent-soft text-accent"
                        : "border-soft bg-surface-muted text-muted"
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Horário fixo
                  </button>
                  <button
                    type="button"
                    onClick={() => setAxonPickTime(true)}
                    className={`flex items-center justify-center gap-1.5 rounded-2xl border px-3 py-2.5 text-xs font-semibold transition active:scale-[0.97] ${
                      axonPickTime
                        ? "border-accent-soft bg-accent-soft text-accent"
                        : "border-soft bg-surface-muted text-muted"
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Axon decide
                  </button>
                </div>

                {axonPickTime ? (
                  <div>
                    <label className="block">
                      <span className="mb-2 block text-xs font-medium text-muted">
                        Duração (minutos)
                      </span>
                      <input
                        type="number"
                        min={1}
                        value={duration}
                        onChange={(e) => setDuration(e.target.value)}
                        placeholder="Ex: 45"
                        className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none placeholder:text-soft focus:border-accent-soft"
                      />
                    </label>
                    <p className="mt-2 text-[0.7rem] leading-4 text-muted">
                      O Axon escolhe o melhor horário com base no seu cronotipo e no que já está agendado no dia.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-2 block text-xs font-medium text-muted">
                        Início
                      </span>
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-xs font-medium text-muted">
                        Fim
                      </span>
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {selectedType === "task" && (
              <button
                type="button"
                onClick={() => {
                  const next = !isKeyTask;
                  setIsKeyTask(next);
                  if (next) setPriority("high");
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                  isKeyTask
                    ? "border-amber-300/30 bg-amber-400/[0.08]"
                    : "border-soft bg-surface-muted"
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                  isKeyTask
                    ? "border-amber-300/30 bg-amber-400/15 text-amber-700 dark:text-amber-200"
                    : "border-soft bg-surface-muted text-muted"
                }`}>
                  <Star className={`h-4.5 w-4.5 ${isKeyTask ? "fill-amber-300 text-amber-300" : ""}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${isKeyTask ? "text-amber-700 dark:text-amber-100" : "text-secondary"}`}>
                    Tarefa chave do dia
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-muted">
                    A única que, se feita, torna o dia bem-sucedido.
                  </p>
                </div>
                <div className={`h-5 w-5 shrink-0 rounded-full border-2 transition ${
                  isKeyTask ? "border-amber-400 bg-amber-400" : "border-soft bg-transparent"
                }`} />
              </button>
            )}

            {selectedType === "task" && (
              <label className="block">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">
                    Prioridade
                  </span>
                  {isKeyTask && (
                    <span className="text-[0.68rem] font-semibold text-amber-300/80">
                      Travada em Alta pela tarefa chave
                    </span>
                  )}
                </div>

                <select
                  value={priority}
                  disabled={isKeyTask}
                  onChange={(e) =>
                    setPriority(e.target.value as "low" | "medium" | "high")
                  }
                  className={`min-h-[52px] w-full rounded-2xl border px-4 text-sm text-white outline-none transition ${
                    isKeyTask
                      ? "cursor-not-allowed border-amber-300/20 bg-amber-400/[0.06] opacity-70"
                      : "border-soft bg-surface-muted focus:border-accent-soft"
                  }`}
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </label>
            )}

            {selectedType === "task" && objectives.length > 0 && (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Vincular a objetivo
                </span>

                <select
                  value={objectiveId}
                  onChange={(e) => setObjectiveId(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none transition focus:border-accent-soft"
                >
                  <option value="">Nenhum</option>
                  {objectives.map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {selectedType === "event" && (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Local ou link
                </span>

                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Ex: Google Meet, sala 203..."
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none placeholder:text-soft focus:border-accent-soft"
                />
              </label>
            )}

            {selectedType === "routine" && (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Repetição
                </span>

                <select
                  value={recurrence}
                  onChange={(e) =>
                    setRecurrence(e.target.value as "daily" | "weekly" | "monthly")
                  }
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                >
                  <option value="daily">Todos os dias</option>
                  <option value="weekly">Toda semana</option>
                  <option value="monthly">Todo mês</option>
                </select>
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-muted">
                Observação
              </span>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Adicione detalhes, contexto ou instruções..."
                rows={3}
                className="w-full resize-none rounded-2xl border border-soft bg-surface-muted px-4 py-3 text-sm leading-6 text-primary outline-none placeholder:text-soft focus:border-accent-soft"
              />
            </label>

            {selectedType === "task" && (
              <div className="rounded-2xl border border-soft bg-surface-muted p-4">
                <p className="mb-3 text-xs font-semibold text-muted">Subtarefas (opcional)</p>
                {draftSubtasks.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {draftSubtasks.map((s, idx) => (
                      <div key={s.key} className="flex items-center gap-2">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-soft text-[0.55rem] font-bold text-soft">
                          {idx + 1}
                        </span>
                        <input
                          value={s.title}
                          onChange={(e) => updateDraftSubtask(s.key, e.target.value)}
                          placeholder={`Subtarefa ${idx + 1}`}
                          autoFocus={idx === draftSubtasks.length - 1}
                          className="min-h-[38px] flex-1 rounded-xl border border-soft bg-surface-muted px-3 text-sm text-primary outline-none placeholder:text-soft focus:border-accent-soft"
                        />
                        <button
                          type="button"
                          onClick={() => removeDraftSubtask(s.key)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={addDraftSubtask}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-soft)] py-2 text-xs font-semibold text-muted active:scale-[0.98]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar subtarefa
                </button>
              </div>
            )}

            {formError && (
              <p className="text-xs font-medium text-rose-300">{formError}</p>
            )}
          </div>
    </BottomSheet>
  );
}

function TypeButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[4.4rem] flex-col items-center justify-center gap-2 rounded-2xl border text-[0.68rem] font-semibold transition active:scale-[0.98] ${
        active
          ? "border-accent-soft bg-accent-soft text-accent shadow-card"
          : "border-soft bg-surface-muted text-muted"
      }`}
    >
      <Icon className="h-4.5 w-4.5" />
      {label}
    </button>
  );
}


// ===========================================================================
// MODAL DE EXCLUSÃO DE ITEM
// ===========================================================================

function DeletePlanningItemModal({
  task,
  isDeleting,
  onClose,
  onConfirm,
}: {
  task: Task | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!task) return null;

  const itemLabel = typeLabels[task.task_type].toLowerCase();

  return (
    <ConfirmDialog
      isOpen
      title={`Remover ${itemLabel}?`}
      description={
        <>
          <p>
            Essa ação vai excluir{" "}
            <span className="font-semibold text-primary">"{task.title}"</span>{" "}
            do seu planejamento.
          </p>

          <div className="mt-5 rounded-[1.35rem] border border-soft bg-surface-muted p-3 text-left">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-soft">
              Item selecionado
            </p>

            <p className="mt-2 truncate text-sm font-semibold text-primary">
              {task.title}
            </p>

            <p className="mt-1 text-xs text-muted">
              {typeLabels[task.task_type]} · {statusLabels[task.status]}
            </p>
          </div>
        </>
      }
      confirmLabel="Excluir"
      variant="danger"
      icon={Trash2}
      loading={isDeleting}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

// ===========================================================================
// MODAL DE EDIÇÃO DE ITEM
// ===========================================================================

function EditPlanningItemModal({
  task,
  onClose,
  onUpdated,
  onSubtaskChange,
}: {
  task: Task | null;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
  onSubtaskChange?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [location, setLocation] = useState("");
  const [recurrence, setRecurrence] = useState<"daily" | "weekly" | "monthly">(
    "daily"
  );
  const [description, setDescription] = useState("");
  const [isKeyTask, setIsKeyTask] = useState(false);
  const [objectiveId, setObjectiveId] = useState("");
  const [objectives, setObjectives] = useState<api.Objective[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!task) return;

    setTitle(task.title ?? "");
    setDate(task.scheduled_date ?? "");
    setEndDate((task as Task & { end_date?: string | null }).end_date ?? task.scheduled_date ?? "");
    setStartTime(hhmm(task.start_time) ?? "");
    setEndTime(hhmm(task.end_time) ?? "");
    setPriority((task.priority as "low" | "medium" | "high") ?? "medium");
    setLocation(task.location ?? "");
    setRecurrence((task.recurrence as "daily" | "weekly" | "monthly") ?? "daily");
    setDescription(task.description ?? "");
    setIsKeyTask(!!task.is_key_task);
    setObjectiveId(task.objective_id ?? "");
    setFormError(null);

    // Objetivos ativos para o campo "Vincular a objetivo". Mantém o objetivo
    // já vinculado na lista mesmo que ele esteja concluído, para não perder a
    // seleção atual da tarefa.
    api.getObjectives()
      .then((list) =>
        setObjectives(
          list.filter(
            (o) => o.status === "active" || o.id === task.objective_id
          )
        )
      )
      .catch(() => setObjectives([]));
  }, [task]);

  if (!task) return null;

  const isEvent = task.task_type === "event";
  const isTask = task.task_type === "task";
  const isRoutine = task.task_type === "routine";

  const descriptionText = isTask
    ? "Atualize os detalhes dessa tarefa pontual."
    : isEvent
    ? "Atualize data, horário e informações desse evento."
    : "Atualize os detalhes dessa rotina recorrente.";

  async function handleSubmit() {
    if (!title.trim()) {
      setFormError("Dê um nome para o item.");
      return;
    }

    if (isEvent && endDate && date && endDate < date) {
      setFormError("A data final do evento não pode ser anterior à data inicial.");
      return;
    }

    if (startTime && endTime && endTime <= startTime) {
      setFormError("O horário de término precisa ser depois do horário de início.");
      return;
    }

    if (!task) return;

    setSubmitting(true);
    setFormError(null);

    try {
      await api.updateTask(
        task.id,
        {
          title: title.trim(),
          scheduled_date: date || undefined,
          end_date: isEvent ? endDate || date : undefined,
          start_time: startTime || undefined,
          end_time: endTime || undefined,
          priority: isTask ? priority : undefined,
          location: isEvent ? location || undefined : undefined,
          recurrence: isRoutine ? recurrence : undefined,
          description: description || undefined,
          is_key_task: isTask ? isKeyTask : undefined,
          objective_id: isTask ? objectiveId : undefined,
        } as any
      );

      await onUpdated();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao atualizar item");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      closeOnOverlayClick={false}
      dismissDisabled={submitting}
      ariaLabel="Ajustar planejamento"
      maxHeightClassName="max-h-[88vh]"
      surfaceClassName="bg-surface-elevated"
      footer={
        <>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-6 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                Salvar alterações
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-6 text-sm font-semibold text-secondary transition active:scale-[0.98] disabled:opacity-50"
          >
            Cancelar
          </button>
        </>
      }
    >
      {/* Cabeçalho mantido no conteúdo para preservar o visual. */}
      <div className="mb-4">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
          <Edit3 className="h-3.5 w-3.5" />
          Editar {typeLabels[task.task_type].toLowerCase()}
        </div>

        <h2 className="text-[1.55rem] font-semibold leading-[1.05] tracking-[-0.05em] text-primary">
          Ajustar planejamento
        </h2>

        <p className="mt-2 text-xs leading-5 text-muted">
          {descriptionText}
        </p>
      </div>

          <div className="mb-4 rounded-[1.35rem] border border-soft bg-surface-muted p-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-soft">
              Tipo de item
            </p>

            <p className="mt-1 text-sm font-semibold text-primary">
              {typeLabels[task.task_type]}
            </p>

            <p className="mt-1 text-xs leading-5 text-muted">
              O tipo não pode ser alterado depois da criação. Para trocar de tipo,
              exclua este item e crie um novo.
            </p>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="mb-2 block text-xs font-medium text-muted">
                Nome
              </span>

              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none placeholder:text-soft focus:border-accent-soft"
              />
            </label>

            {isEvent ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-muted">
                    Data inicial
                  </span>

                  <input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);

                      if (!endDate || endDate < e.target.value) {
                        setEndDate(e.target.value);
                      }
                    }}
                    className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-medium text-muted">
                    Data final
                  </span>

                  <input
                    type="date"
                    value={endDate}
                    min={date}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                  />
                </label>
              </div>
            ) : (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Data
                </span>

                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                />
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Início
                </span>

                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Fim
                </span>

                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                />
              </label>
            </div>

            {isTask && (
              <button
                type="button"
                onClick={() => {
                  const next = !isKeyTask;
                  setIsKeyTask(next);
                  if (next) setPriority("high");
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                  isKeyTask
                    ? "border-amber-300/30 bg-amber-400/[0.08]"
                    : "border-soft bg-surface-muted"
                }`}
              >
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                  isKeyTask
                    ? "border-amber-300/30 bg-amber-400/15 text-amber-700 dark:text-amber-200"
                    : "border-soft bg-surface-muted text-muted"
                }`}>
                  <Star className={`h-4.5 w-4.5 ${isKeyTask ? "fill-amber-300 text-amber-300" : ""}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${isKeyTask ? "text-amber-700 dark:text-amber-100" : "text-secondary"}`}>
                    Tarefa chave do dia
                  </p>
                  <p className="mt-0.5 text-xs leading-4 text-muted">
                    A única que, se feita, torna o dia bem-sucedido.
                  </p>
                </div>
                <div className={`h-5 w-5 shrink-0 rounded-full border-2 transition ${
                  isKeyTask ? "border-amber-400 bg-amber-400" : "border-soft bg-transparent"
                }`} />
              </button>
            )}

            {isTask && (
              <label className="block">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted">
                    Prioridade
                  </span>
                  {isKeyTask && (
                    <span className="text-[0.68rem] font-semibold text-amber-300/80">
                      Travada em Alta pela tarefa chave
                    </span>
                  )}
                </div>

                <select
                  value={priority}
                  disabled={isKeyTask}
                  onChange={(e) =>
                    setPriority(e.target.value as "low" | "medium" | "high")
                  }
                  className={`min-h-[52px] w-full rounded-2xl border px-4 text-sm text-white outline-none transition ${
                    isKeyTask
                      ? "cursor-not-allowed border-amber-300/20 bg-amber-400/[0.06] opacity-70"
                      : "border-soft bg-surface-muted focus:border-accent-soft"
                  }`}
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </label>
            )}

            {isTask && objectives.length > 0 && (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Vincular a objetivo
                </span>

                <select
                  value={objectiveId}
                  onChange={(e) => setObjectiveId(e.target.value)}
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none transition focus:border-accent-soft"
                >
                  <option value="">Nenhum</option>
                  {objectives.map((objective) => (
                    <option key={objective.id} value={objective.id}>
                      {objective.title}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {isEvent && (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Local ou link
                </span>

                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Ex: Google Meet, sala 203..."
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none placeholder:text-soft focus:border-accent-soft"
                />
              </label>
            )}

            {isRoutine && (
              <label className="block">
                <span className="mb-2 block text-xs font-medium text-muted">
                  Repetição
                </span>

                <select
                  value={recurrence}
                  onChange={(e) =>
                    setRecurrence(e.target.value as "daily" | "weekly" | "monthly")
                  }
                  className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none focus:border-accent-soft"
                >
                  <option value="daily">Todos os dias</option>
                  <option value="weekly">Toda semana</option>
                  <option value="monthly">Todo mês</option>
                </select>
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-xs font-medium text-muted">
                Observação
              </span>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Adicione detalhes, contexto ou instruções..."
                rows={3}
                className="w-full resize-none rounded-2xl border border-soft bg-surface-muted px-4 py-3 text-sm leading-6 text-primary outline-none placeholder:text-soft focus:border-accent-soft"
              />
            </label>

            {isTask && (
              <SubtaskEditor taskId={task.id} onSubtaskChange={onSubtaskChange} />
            )}

            {formError && (
              <p className="text-xs font-medium text-rose-300">{formError}</p>
            )}
          </div>
    </BottomSheet>
  );
}
// ===========================================================================
// EDITOR DE SUBTAREFAS DO MODAL DE EDIÇÃO
// ===========================================================================

function SubtaskEditor({
  taskId,
  onSubtaskChange,
}: {
  taskId: string;
  onSubtaskChange?: () => void;
}) {
  const [subtasks, setSubtasks] = useState<api.Subtask[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api.getTaskSubtasks(taskId)
      .then(setSubtasks)
      .catch(() => setSubtasks([]))
      .finally(() => setLoading(false));
  }, [taskId]);

  async function handleToggle(s: api.Subtask) {
    try {
      const updated = await api.updateSubtask(s.id, { done: !s.done });
      setSubtasks((prev) =>
        prev.map((subtask) =>
          subtask.id === updated.id ? updated : subtask
        )
      );
      onSubtaskChange?.();
    } catch {
      // Mantém o estado atual em caso de erro.
    }
  }

  async function handleDelete(subtaskId: string) {
    try {
      await api.deleteSubtask(subtaskId);
      setSubtasks((prev) => prev.filter((x) => x.id !== subtaskId));
      onSubtaskChange?.();
    } catch {
      // Mantém o estado atual em caso de erro.
    }
  }

  async function handleAdd() {
    const t = newTitle.trim();
    if (!t) return;
    try {
      const created = await api.createSubtask(taskId, { title: t });
      setSubtasks((prev) => [...prev, created]);
      setNewTitle("");
      setAdding(false);
      onSubtaskChange?.();
    } catch {
      // Mantém o estado atual em caso de erro.
    }
  }

  return (
    <div className="rounded-2xl border border-soft bg-surface-muted p-4">
      <p className="mb-3 text-xs font-semibold text-muted">Subtarefas</p>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…
        </div>
      ) : (
        <>
          {subtasks.length > 0 && (
            <div className="mb-3 space-y-2">
              {subtasks.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle(s)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition active:scale-90 ${
                      s.done
                        ? "border-emerald-400 bg-emerald-400 text-[#11111a]"
                        : "border-soft hover:border-accent-soft"
                    }`}
                  >
                    {s.done && <CheckCircle2 className="h-3 w-3" />}
                  </button>
                  <p className={`flex-1 truncate text-sm ${s.done ? "text-soft line-through" : "text-primary"}`}>
                    {s.title}
                  </p>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {adding ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleAdd(); }
                  if (e.key === "Escape") { setAdding(false); setNewTitle(""); }
                }}
                placeholder="Nome da subtarefa…"
                className="min-h-[38px] flex-1 rounded-xl border border-accent-soft bg-surface-muted px-3 text-sm text-primary outline-none placeholder:text-soft"
              />
              <button type="button" onClick={handleAdd} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-strong)] text-white transition active:scale-[0.94]">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button type="button" onClick={() => { setAdding(false); setNewTitle(""); }} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border-soft)] py-2 text-xs font-semibold text-muted active:scale-[0.98]"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar subtarefa
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// FILA DE TAREFAS SEM DATA
// ===========================================================================

const PRIORITY_META_QUEUE = {
  high: { label: "Alta", dot: "bg-rose-400", badge: "border-rose-300/25 bg-rose-500/10 text-rose-200" },
  medium: { label: "Média", dot: "bg-amber-400", badge: "border-amber-300/25 bg-amber-500/10 text-amber-200" },
  low: { label: "Baixa", dot: "bg-sky-400", badge: "border-sky-300/25 bg-sky-500/10 text-sky-200" },
};

const QUEUE_PAGE_SIZE = 10;

function UndatedTasksSheet({
  tasks,
  onClose,
  onEdit,
  onDelete,
  onToggle,
}: {
  tasks: Task[];
  onClose: () => void;
  onEdit: (t: Task) => void;
  onDelete: (t: Task) => void;
  onToggle: (t: Task) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? tasks : tasks.slice(0, QUEUE_PAGE_SIZE);
  const hidden = tasks.length - QUEUE_PAGE_SIZE;

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      ariaLabel="Tarefas sem data"
      maxHeightClassName="max-h-[82vh]"
      surfaceClassName="bg-surface-elevated"
    >
      {/* Cabeçalho da fila mantido no conteúdo para preservar o visual. */}
      <div className="mb-4">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-indigo-300/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-100">
          <ListTodo className="h-3.5 w-3.5" />
          Fila · {tasks.length} {tasks.length === 1 ? "tarefa" : "tarefas"}
        </div>
        <h2 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.04em] text-primary">
          Tarefas sem data
        </h2>
        <p className="mt-1 text-xs text-muted">
          Ordenadas por prioridade. Toque no lápis para atribuir uma data.
        </p>
      </div>

      {tasks.length === 0 ? (
            <EmptyState icon={ListTodo} title="Fila vazia" />
          ) : (
            <div className="space-y-2">
              {visible.map((task) => {
                const priority = (task.priority as "low" | "medium" | "high") ?? "medium";
                const meta = PRIORITY_META_QUEUE[priority];
                const isDone = task.status === "done";
                const Icon =
                  task.task_type === "task"
                    ? ListTodo
                    : task.task_type === "event"
                    ? CalendarDays
                    : Repeat;

                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-3 rounded-2xl border p-3 ${
                      isDone
                        ? "border-emerald-300/20 bg-emerald-400/[0.08]"
                        : "border-soft bg-surface-muted"
                    }`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />

                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-semibold ${isDone ? "text-soft line-through" : "text-primary"}`}>
                        {task.title}
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[0.6rem] font-semibold ${meta.badge}`}>
                          {meta.label}
                        </span>
                        <span className="flex items-center gap-1 text-[0.6rem] text-soft">
                          <Icon className="h-2.5 w-2.5" />
                          {typeLabels[task.task_type]}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onToggle(task)}
                        className={`flex h-7 w-7 items-center justify-center rounded-xl active:scale-[0.94] ${
                          isDone ? "bg-emerald-400/15 text-emerald-600 dark:text-emerald-300" : "bg-surface-muted text-muted"
                        }`}
                        aria-label={isDone ? "Desmarcar" : "Marcar como feita"}
                      >
                        {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(task)}
                        className="flex h-7 w-7 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
                        aria-label="Editar"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(task)}
                        className="flex h-7 w-7 items-center justify-center rounded-xl bg-surface-muted text-muted transition active:scale-[0.94]"
                        aria-label="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {!showAll && hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl border border-soft bg-surface-muted py-3 text-xs font-semibold text-secondary transition active:scale-[0.98]"
                >
                  Mostrar mais {hidden} {hidden === 1 ? "tarefa" : "tarefas"}
                </button>
              )}
            </div>
          )}
    </BottomSheet>
  );
}