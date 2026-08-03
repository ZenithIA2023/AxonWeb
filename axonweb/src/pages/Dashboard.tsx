import { useCallback, useEffect, useMemo, useState } from "react";
import type { ElementType } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  Focus,
  MessageCircle,
  Flame,
  Moon,
  Sparkles,
  Star,
  Target,
  Zap,
  Bell,
  X,
} from "lucide-react";

import DayReview from "./DayReview";
import Sidebar from "../components/layout/Sidebar";
import * as api from "../lib/api";
import type { DashboardData, FocusBlock, Task, Subtask } from "../lib/api";
import { AppBackground } from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";
import axonHeadHappy from "../assets/axon/axon-head-happy.png";
import EmptyState from "../components/ui/EmptyState";
import { ScrollArea } from "../components/ui/ScrollArea";

const NOTIFICATIONS_PAGE_SIZE = 10;

// ============================================================================
// Tipos locais
// Props e aliases usados apenas na montagem visual do Dashboard.
// ============================================================================

// ============================================================================
// Página Dashboard
// Tela inicial pós-login: ritmo atual, tarefa-chave, plano do dia e notificações.
// ============================================================================

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();

  // --------------------------------------------------------------------------
  // Estados da página
  // Controlam menu lateral, carregamento inicial, plano do dia e modais locais.
  // --------------------------------------------------------------------------
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [reports, setReports] = useState<api.DashboardReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyTask, setKeyTask] = useState<Task | null>(null);
  const [subtasksMap, setSubtasksMap] = useState<Record<string, Subtask[]>>({});
  const [showNextBlock, setShowNextBlock] = useState(false);
  const [todayLog, setTodayLog] = useState<api.DailyLog | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Pop-up automático (1x/dia), independente do DayReview manual acima.
  const [autoReviewOpen, setAutoReviewOpen] = useState(false);
  const [autoReviewDate, setAutoReviewDate] = useState<string | undefined>(
    undefined
  );
  const [yesterdayLog, setYesterdayLog] = useState<api.DailyLog | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // --------------------------------------------------------------------------
  // Notificações
  // Mantém o contador do sino sincronizado com o toast global e o modal.
  // --------------------------------------------------------------------------
  const refreshUnreadCount = useCallback(() => {
    api
      .getNotifications(NOTIFICATIONS_PAGE_SIZE + 1, 0)
      .then((notifications) => {
        const visibleNotifications = notifications.slice(
          0,
          NOTIFICATIONS_PAGE_SIZE
        );

        const nextUnreadCount = visibleNotifications.filter(
          (notification) => notification.status === "unread"
        ).length;

        setUnreadCount(nextUnreadCount);
      })
      .catch(() => setUnreadCount(0));
  }, []);

  useEffect(() => {
    const handleNotificationsUpdated = () => {
      refreshUnreadCount();
    };

    window.addEventListener(
      "axon:notifications-updated",
      handleNotificationsUpdated
    );

    return () => {
      window.removeEventListener(
        "axon:notifications-updated",
        handleNotificationsUpdated
      );
    };
  }, [refreshUnreadCount]);

  // --------------------------------------------------------------------------
  // Subtarefas do plano enxuto
  // Agrupa por task_id para mostrar progresso compacto dentro da seção “Hoje”.
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // Carregamento principal
  // Busca dashboard, tarefa-chave, revisão diária, subtarefas e notificações.
  // Também atualiza dados ao retornar para a aba e a cada 30 minutos.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!api.isLoggedIn()) {
      navigate("/login");
      return;
    }

    const todayISO = new Date().toISOString().slice(0, 10);

    const loadDashboard = () => {
      api
        .getDashboard()
        .then(setData)
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    };

    const loadKeyTask = () => {
      api
        .getTasks({ scheduled_date: todayISO })
        .then((tasks) => setKeyTask(tasks.find((t) => t.is_key_task) ?? null))
        .catch(() => null);
    };

    const loadDailyLog = () => {
      api
        .getDailyLogToday()
        .then(setTodayLog)
        .catch(() => setTodayLog(null));
    };

    // Relatórios narrativos mudam no máximo uma vez por semana/mês — carrega
    // só na entrada, sem entrar no intervalo de 30min nem no refresh de aba.
    const loadReports = () => {
      api
        .getDashboardReports()
        .then(setReports)
        .catch(() => setReports(null));
    };

    const analyzeNotificationsAndRefresh = () => {
      api
        .analyzeNotifications()
        .catch(() => null)
        .finally(() => {
          refreshUnreadCount();
        });
    };

    loadDashboard();
    loadDailyLog();
    loadReports();
    loadKeyTask();
    loadSubtasks();
    refreshUnreadCount();
    analyzeNotificationsAndRefresh();

    const interval = window.setInterval(() => {
      loadDashboard();
      loadKeyTask();
      loadSubtasks();
    }, 30 * 60 * 1000);

    // Captura notificações geradas pelo scheduler enquanto o app permanece aberto.
    const notifInterval = window.setInterval(refreshUnreadCount, 2 * 60 * 1000);

    const handleVisibility = () => {
      if (document.hidden) return;

      loadDashboard();
      loadSubtasks();
      refreshUnreadCount();
      analyzeNotificationsAndRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      window.clearInterval(notifInterval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [navigate, refreshUnreadCount, loadSubtasks]);

  // --------------------------------------------------------------------------
  // Abertura automática da revisão diária
  // Permite que outra tela navegue para cá já abrindo o DayReview.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (location.state?.openDayReview) {
      setReviewOpen(true);
      window.history.replaceState({}, "", location.pathname);
    }
  }, [location.state, location.pathname]);

  // --------------------------------------------------------------------------
  // Relatório visto: sai do Dashboard e passa a viver só no histórico (Perfil).
  // Otimista — o card some na hora; se o POST falhar, ele volta no próximo
  // carregamento, o que é melhor que travar a UI esperando a rede.
  // --------------------------------------------------------------------------
  function handleReportSeen(reportId: string) {
    setReports((prev) =>
      prev
        ? {
            weekly: prev.weekly?.id === reportId ? null : prev.weekly,
            monthly: prev.monthly?.id === reportId ? null : prev.monthly,
          }
        : prev
    );
    api.markReportSeen(reportId).catch(() => {});
  }

  // --------------------------------------------------------------------------
  // Pop-up automático de registro diário (1x por dia)
  // Prioridade: ontem sem registro > hoje incompleto.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!api.isLoggedIn()) return;

    // sv-SE produz YYYY-MM-DD no fuso LOCAL. toISOString() converteria para
    // UTC e, em UTC-3 após as 21h, devolveria a data de amanhã.
    const todayISO = new Date().toLocaleDateString("sv-SE");
    if (localStorage.getItem("axon_last_opened") === todayISO) return;
    localStorage.setItem("axon_last_opened", todayISO);

    Promise.all([
      api.getDailyLogYesterday().catch(() => null),
      api.getDailyLogToday().catch(() => null),
    ]).then(([yesterday, today]) => {
      setYesterdayLog(yesterday);

      // Ontem sem registro: prioridade máxima.
      if (!yesterday) {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        setAutoReviewDate(d.toLocaleDateString("sv-SE"));
        setAutoReviewOpen(true);
        return;
      }

      // Ontem ok — hoje está completo?
      const todayComplete =
        today?.sleep_rating != null &&
        today?.mood_rating != null &&
        today?.productivity_rating != null;

      if (!todayComplete) {
        setAutoReviewDate(undefined); // sem targetDate = hoje
        setAutoReviewOpen(true);
      }
    });
  }, []);

  // --------------------------------------------------------------------------
  // Abertura automática das notificações
  // O toast global usa /dashboard?notifications=open para abrir o modal do sino.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (searchParams.get("notifications") !== "open") return;

    setIsNotificationsOpen(true);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("notifications");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // --------------------------------------------------------------------------
  // Dados derivados do dashboard
  // Centraliza fallbacks e rótulos calculados para simplificar o JSX.
  // --------------------------------------------------------------------------
  const showReviewCard = new Date().getHours() >= 18 && todayLog === null;

  const chronotypeKey =
    data?.chronotype_key ??
    localStorage.getItem("axon_chronotype") ??
    "intermediate";

  const chronotypeLabel = data?.chronotype_label ?? "Perfil Intermediário";
  const energyPeak = data?.energy_peak ?? "Entre 9h e 15h";
  const focusWindow = data?.focus_window ?? "Meio do dia";
  const greeting = data?.greeting ?? "Bom dia";

  const energyPercent = data?.energy_percent ?? 78;
  const focusPercent = data?.focus_percent ?? 64;

  const nextFocus = data?.next_focus;
  const dayBlocks = data?.day_blocks ?? [];

  const currentBlock = data?.current_block;
  const nextBlock = data?.next_block;

  const rhythmLabel = useMemo(() => {
    if (chronotypeKey === "night") return "Noturno";
    if (chronotypeKey === "morning") return "Matutino";
    if (chronotypeKey === "evening") return "Vespertino";
    return "Estável";
  }, [chronotypeKey]);

  const nextPeakValue = nextFocus?.start ?? energyPeak;

  const mainAction =
    nextFocus?.status === "active"
      ? "Sua melhor janela de foco está ativa agora."
      : "Sua próxima janela produtiva está chegando.";

  const isDashboardBooting = loading && !data;

  const flatTasks = dayBlocks.flatMap((block) => block.tasks);

  const focusRecommendationByTaskId = useMemo(() => {
    const recommendationMap: Record<
      string,
      {
        label: string;
        time: string;
      }
    > = {};

    currentBlock?.tasks.forEach((task) => {
      recommendationMap[task.id] = {
        label: "Pico atual",
        time: `${currentBlock.start} – ${currentBlock.end}`,
      };
    });

    nextBlock?.tasks.forEach((task) => {
      if (recommendationMap[task.id]) return;

      recommendationMap[task.id] = {
        label: "Próximo pico",
        time: `${nextBlock.start} – ${nextBlock.end}`,
      };
    });

    return recommendationMap;
  }, [currentBlock, nextBlock]);

  const taskTypeLabel: Record<string, string> = {
    task: "Tarefa",
    event: "Evento",
    routine: "Rotina",
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 mx-auto min-h-screen w-full max-w-[430px] px-4 pb-6 pt-5 lg:max-w-[1120px] lg:px-8 lg:pt-7">
        <PageHeader
          title="Dashboard"
          subtitle="Central do Axon"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
          rightSlot={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-2xl border border-soft bg-surface-muted px-2.5 text-secondary backdrop-blur-2xl transition active:scale-[0.96]"
                aria-label="Ver ofensiva"
              >
                <Flame className="h-4 w-4 text-accent" />
                <span className="text-[0.65rem] font-black text-muted">0</span>
              </button>

              <button
                type="button"
                onClick={() => setIsNotificationsOpen(true)}
                className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary backdrop-blur-2xl transition active:scale-[0.96]"
                aria-label="Abrir notificações"
              >
                <Bell className="h-4 w-4" />

                {unreadCount !== null && unreadCount > 0 && (
                  <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-[var(--app-bg)] bg-[var(--accent)]" />
                )}
              </button>
            </div>
          }
        />

        {isDashboardBooting ? (
          <DashboardGreetingSkeleton />
        ) : (
          <section className="mt-5">
            <div className="relative overflow-hidden rounded-[2.15rem] border border-soft bg-surface-elevated p-5 shadow-card backdrop-blur-2xl lg:p-6">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_54%)]" />
              <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--accent-muted)] to-transparent" />

              <div className="relative flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                    {chronotypeLabel}
                  </p>

                  <h1 className="mt-2 text-[1.75rem] font-black leading-[0.95] tracking-[-0.055em] text-primary">
                    {greeting}
                  </h1>

                  <p className="mt-3 max-w-[16.5rem] text-xs leading-5 text-muted">
                    Seu painel foi ajustado para energia, foco e prioridades de hoje.
                  </p>

                  {showReviewCard && (
                    <button
                      type="button"
                      onClick={() => setReviewOpen(true)}
                      className="mt-4 inline-flex min-h-9 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft px-3 text-[0.68rem] font-semibold text-accent transition active:scale-[0.96]"
                    >
                      Revisar dia
                    </button>
                  )}
                </div>

                <div className="relative flex h-[112px] w-[116px] shrink-0 items-center justify-center sm:h-[128px] sm:w-[138px] lg:h-[142px] lg:w-[180px]">
                  <div className="absolute h-[104px] w-[104px] rounded-full bg-accent-soft blur-2xl sm:h-[118px] sm:w-[118px] lg:h-[132px] lg:w-[132px]" />

                  <img
                    src={axonHeadHappy}
                    alt="Axon feliz"
                    className="relative z-10 h-[108px] w-auto object-contain drop-shadow-[0_22px_42px_rgba(45,8,80,0.16)] sm:h-[122px] lg:h-[136px] dark:drop-shadow-[0_26px_46px_rgba(0,0,0,0.34)]"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)] lg:items-stretch lg:gap-5">
          <div className="space-y-4">
            <section>
              {isDashboardBooting ? (
                <FocusBlockSkeleton />
              ) : (
                <div className="mt-2 rounded-[2rem] border border-soft bg-surface-elevated p-4 shadow-card backdrop-blur-2xl lg:p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-primary">
                        Bloco de foco atual
                      </p>
                      <p className="mt-1 text-[0.68rem] font-medium text-muted">
                        Janela recomendada para foco
                      </p>
                    </div>

                    <span className="shrink-0 rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-[0.65rem] font-black text-accent">
                      {currentBlock
                        ? `${currentBlock.start} – ${currentBlock.end}`
                        : nextFocus?.start ?? energyPeak}
                    </span>
                  </div>

                  <CurrentFocusBlockCard
                    currentBlock={currentBlock}
                    nextBlock={nextBlock}
                    fallbackLabel={nextFocus?.label}
                    fallbackStart={nextFocus?.start}
                    fallbackProgress={energyPercent}
                    showNextBlock={showNextBlock}
                    onToggleNext={() => setShowNextBlock((current) => !current)}
                  />

                  <button
                    type="button"
                    onClick={() => navigate("/chat")}
                    className="mt-3 inline-flex items-center gap-2 rounded-full text-xs font-semibold text-accent transition active:scale-[0.98]"
                  >
                    Ajustar com o Axon
                    <MessageCircle className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </section>

            {keyTask && (
          <section>
            <button
              type="button"
              onClick={() => navigate("/planning")}
              className={`group w-full rounded-[1.8rem] border p-4 text-left shadow-card transition active:scale-[0.98] ${
                keyTask.status === "done"
                  ? "border-emerald-300/25 bg-emerald-500/10"
                  : "border-amber-300/25 bg-amber-500/10"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                    keyTask.status === "done"
                      ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100"
                      : "border-amber-300/25 bg-amber-500/10 text-amber-700 dark:text-amber-100"
                  }`}
                >
                  <Star
                    className={`h-5 w-5 ${
                      keyTask.status !== "done"
                        ? "fill-amber-400 text-amber-400"
                        : ""
                    }`}
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[0.68rem] font-black uppercase tracking-[0.14em] text-muted">
                    Tarefa-chave
                  </p>

                  <p
                    className={`mt-1 truncate text-sm font-black ${
                      keyTask.status === "done"
                        ? "text-emerald-700 line-through opacity-70 dark:text-emerald-100"
                        : "text-primary"
                    }`}
                  >
                    {keyTask.title}
                  </p>
                </div>

                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-[0.68rem] font-black ${
                    keyTask.status === "done"
                      ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-100"
                      : "border-amber-300/25 bg-amber-500/10 text-amber-700 dark:text-amber-100"
                  }`}
                >
                  {keyTask.status === "done" ? "Feita" : "Pendente"}
                </span>
              </div>
            </button>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3">
          <CircularMetricCard
            icon={Zap}
            label="Energia"
            value={isDashboardBooting ? null : energyPercent}
            helper="nível atual"
          />

          <CircularMetricCard
            icon={Focus}
            label="Foco"
            value={isDashboardBooting ? null : focusPercent}
            helper="clareza mental"
          />
        </section>
          </div>

          <div className="space-y-4 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
        <section className="relative overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated p-4 shadow-card backdrop-blur-2xl lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_58%)]" />

          <div className="relative mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[1.35rem] font-black leading-none tracking-[-0.04em] text-primary">
                Hoje
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                Próximos movimentos do seu dia
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/planning")}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-2xl border border-accent-soft bg-accent-soft px-3 text-xs font-black text-accent transition active:scale-[0.96]"
              aria-label="Abrir planejamento"
            >
              <CalendarDays className="h-4 w-4" />
              <span className="hidden sm:inline">Agenda</span>
            </button>
          </div>

          {flatTasks.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="Nenhuma tarefa para hoje"
              description="Converse com o Axon para organizar seu dia ou adicione tarefas no Planejamento."
              actionLabel="Adicionar tarefa"
              onAction={() => navigate("/planning")}
            />
          ) : (
            <div className="custom-scrollbar relative space-y-2.5 lg:min-h-0 lg:flex-1 lg:space-y-3 lg:overflow-y-auto lg:pr-1">
              {flatTasks.slice(0, 5).map((task) => {
                const isActive = task.status === "progress";
                const isDone = task.status === "done";
                const isKey = task.is_key_task;

                const subtasks = subtasksMap[task.id] ?? [];
                const completedSubtasks = subtasks.filter(
                  (subtask) => subtask.done
                ).length;
                const hasSubtasks = subtasks.length > 0;
                const focusRecommendation = focusRecommendationByTaskId[task.id];

                return (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => navigate("/planning")}
                    className={`group relative flex w-full gap-3 overflow-hidden rounded-[1.45rem] border p-3 text-left transition active:scale-[0.99] lg:p-3.5 ${
                      isKey
                        ? "border-amber-300/25 bg-amber-500/10"
                        : focusRecommendation
                        ? "border-accent-soft bg-accent-soft"
                        : isActive
                        ? "border-accent-soft bg-surface-muted"
                        : "border-soft bg-surface-muted"
                    }`}
                  >
                    <div
                      className={`absolute left-0 top-4 h-[calc(100%-2rem)] w-1 rounded-r-full ${
                        isKey
                          ? "bg-amber-400"
                          : focusRecommendation || isActive
                          ? "bg-[var(--accent)]"
                          : "bg-transparent"
                      }`}
                    />

                    <div className="min-w-0 flex-1 py-0.5">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className={`min-w-0 truncate text-sm font-black leading-5 ${
                              isDone
                                ? "text-muted line-through"
                                : isKey
                                ? "text-amber-700 dark:text-amber-100"
                                : "text-primary"
                            }`}
                          >
                            {task.title}
                          </p>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span>
                              {task.objective_title ? task.objective_title : taskTypeLabel[task.task_type] ?? "Tarefa"}
                            </span>

                            {hasSubtasks && (
                              <>
                                <span className="text-soft">·</span>

                                <span className="inline-flex items-center gap-1 font-semibold text-accent">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {completedSubtasks}/{subtasks.length}
                                </span>
                              </>
                            )}

                            {isKey && (
                              <>
                                <span className="text-soft">·</span>

                                <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-100">
                                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                                  Tarefa-chave
                                </span>
                              </>
                            )}

                            {focusRecommendation && (
                              <>
                                <span className="text-soft">·</span>

                                <span
                                  title={focusRecommendation.time}
                                  className="inline-flex items-center gap-1 font-semibold text-accent"
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {focusRecommendation.label}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {(task.start_time || task.end_time) && (
                          <div className="shrink-0 pt-0.5 text-right">
                            <p className="text-[0.7rem] font-black leading-none text-secondary">
                              {task.start_time ?? "—"}
                            </p>

                            {task.end_time && (
                              <p className="mt-1 text-[0.56rem] font-semibold leading-none text-soft">
                                até {task.end_time}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {isDone && (
                      <div className="flex shrink-0 items-center text-emerald-700 dark:text-emerald-100">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {flatTasks.length > 5 && (
            <button
              type="button"
              onClick={() => navigate("/planning")}
              className="relative mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-4 text-xs font-black text-secondary transition active:scale-[0.98] lg:hidden"
            >
              Ver todos os movimentos
              <CalendarDays className="ml-2 h-4 w-4" />
            </button>
          )}
        </section>

        {reports?.weekly && (
          <PeriodReportCard
            title="Relatório da semana"
            report={reports.weekly}
            onSeen={handleReportSeen}
          />
        )}

        {reports?.monthly && (
          <PeriodReportCard
            title="Relatório do mês"
            report={reports.monthly}
            onSeen={handleReportSeen}
          />
        )}
          </div>
        </div>
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={chronotypeLabel}
        energyPeak={energyPeak}
      />

      <DayReview
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
        existing={todayLog}
        onSaved={(log) => setTodayLog(log)}
      />

      <DayReview
        isOpen={autoReviewOpen}
        onClose={() => setAutoReviewOpen(false)}
        existing={autoReviewDate ? yesterdayLog : todayLog}
        targetDate={autoReviewDate}
        isYesterday={!!autoReviewDate}
        onSaved={(log) => {
          setAutoReviewOpen(false);
          if (autoReviewDate) setYesterdayLog(log);
          else setTodayLog(log);
        }}
      />

      <NotificationsSheet
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        onUnreadCountChange={(count) => setUnreadCount(Number(count) || 0)}
      />
    </main>
  );
}

// ============================================================================
// Componentes internos do Dashboard
// Cards visuais usados apenas nesta página.
// ============================================================================

function DashboardGreetingSkeleton() {
  return (
    <section className="mt-5">
      <div className="relative overflow-hidden rounded-[2.15rem] border border-soft bg-surface-elevated p-5 shadow-card backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_54%)]" />

        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1 animate-pulse">
            <div className="h-3 w-32 rounded-full bg-surface-muted" />
            <div className="mt-4 h-9 w-40 rounded-2xl bg-surface-muted" />
            <div className="mt-4 h-3 w-full max-w-[15rem] rounded-full bg-surface-muted" />
            <div className="mt-2 h-3 w-4/5 rounded-full bg-surface-muted" />
          </div>

          <div className="relative flex h-[112px] w-[116px] shrink-0 items-center justify-center sm:h-[128px] sm:w-[138px] lg:h-[142px] lg:w-[180px]">
            <div className="absolute h-[104px] w-[104px] rounded-full bg-accent-soft blur-2xl sm:h-[118px] sm:w-[118px] lg:h-[132px] lg:w-[132px]" />
            <div className="relative z-10 h-[88px] w-[104px] rounded-[2rem] bg-surface-muted" />
          </div>
        </div>
      </div>
    </section>
  );
}

function FocusBlockSkeleton() {
  return (
    <div className="mt-2 rounded-[2rem] border border-soft bg-surface-elevated p-4 shadow-card backdrop-blur-2xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="animate-pulse">
          <div className="h-4 w-36 rounded-full bg-surface-muted" />
          <div className="mt-2 h-3 w-44 rounded-full bg-surface-muted" />
        </div>

        <div className="h-7 w-24 rounded-full border border-accent-soft bg-accent-soft" />
      </div>

      <div className="rounded-[1.6rem] border border-soft bg-surface-muted p-4">
        <div className="animate-pulse">
          <div className="h-5 w-28 rounded-full bg-surface-elevated" />
          <div className="mt-5 h-4 w-full rounded-full bg-surface-elevated" />
          <div className="mt-3 h-4 w-4/5 rounded-full bg-surface-elevated" />
          <div className="mt-8 h-2 w-full rounded-full bg-surface-elevated" />
        </div>
      </div>
    </div>
  );
}

function CircularMetricCard({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: ElementType;
  label: string;
  value: number | null;
  helper: string;
}) {
  const isLoading = value === null;
  const safeValue = isLoading ? 0 : clampPercent(value);

  return (
    <div className="rounded-[1.8rem] border border-soft bg-surface-elevated p-4 shadow-card backdrop-blur-2xl">
      <div className="flex items-center gap-3">
        <div
          className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(var(--accent) ${safeValue * 3.6}deg, var(--surface-muted) 0deg)`,
          }}
        >
          <div className="flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full bg-surface-elevated">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-sm font-black text-primary">{label}</p>
          <p className="mt-1 text-[1.35rem] font-black leading-none tracking-[-0.04em] text-primary">
            {isLoading ? "—" : `${safeValue}%`}
          </p>
          <p className="mt-1 text-xs text-muted">{helper}</p>
        </div>
      </div>
    </div>
  );
}


// Narrativa gerada pelo scheduler (relatório semanal ou mensal), com os
// principais números do período em chips abaixo do texto.
function PeriodReportCard({
  title,
  report,
  onSeen,
}: {
  title: string;
  report: api.PeriodReport;
  onSeen: (reportId: string) => void;
}) {
  const { data, narrative } = report;
  const topRoutine = [...data.routine_consistency].sort(
    (a, b) => b.percent - a.percent
  )[0];

  return (
    <section className="rounded-[2rem] border border-soft bg-surface-elevated p-4 shadow-card backdrop-blur-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent" />
          <p className="text-sm font-semibold text-primary">{title}</p>
        </div>

        <span className="shrink-0 text-xs text-muted">
          {formatPeriodRange(report.period_start, report.period_end)}
        </span>
      </div>

      <p className="text-sm leading-6 text-secondary">{narrative}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="rounded-full border border-accent-soft bg-accent-soft px-3 py-1 text-[0.7rem] font-semibold text-accent">
          {data.avg_completion_rate}% de conclusão média
        </div>

        {data.most_productive_day && (
          <div className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-[0.7rem] font-semibold text-emerald-700 dark:text-emerald-100">
            Melhor dia: {formatShortDate(data.most_productive_day.date)} ({data.most_productive_day.completion_rate}%)
          </div>
        )}

        {data.key_tasks.defined > 0 && (
          <div className="rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-[0.7rem] font-semibold text-amber-700 dark:text-amber-100">
            {data.key_tasks.done}/{data.key_tasks.defined} tarefas-chave
          </div>
        )}

        {topRoutine && (
          <div className="rounded-full border border-soft bg-surface-muted px-3 py-1 text-[0.7rem] font-semibold text-muted">
            {topRoutine.name}: {topRoutine.percent}%
          </div>
        )}
      </div>

      {/* Dispensar tira o card do Dashboard; o relatório segue no histórico. */}
      <button
        type="button"
        onClick={() => onSeen(report.id)}
        className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-4 text-xs font-semibold text-muted transition active:scale-[0.98]"
      >
        Entendi, guardar no histórico
      </button>
    </section>
  );
}

// Exibe o bloco cronobiológico atual; usa fallback enquanto o backend carrega.
function CurrentFocusBlockCard({
  currentBlock,
  nextBlock,
  fallbackLabel,
  fallbackStart,
  fallbackProgress,
  showNextBlock,
  onToggleNext,
}: {
  currentBlock?: FocusBlock;
  nextBlock?: FocusBlock;
  fallbackLabel?: string;
  fallbackStart?: string;
  fallbackProgress: number;
  showNextBlock: boolean;
  onToggleNext: () => void;
}) {
  if (!currentBlock) {
    const fallbackProgressSafe = clampPercent(fallbackProgress);

    return (
      <div className="rounded-[1.25rem] border border-soft bg-surface-muted p-3.5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Target className="h-4 w-4 shrink-0 text-accent" />

            <p className="truncate text-sm font-semibold text-primary">
              Bloco de foco
            </p>
          </div>

          <p className="shrink-0 text-xs text-muted">
            {fallbackStart ?? "10:40"}
          </p>
        </div>

        <p className="text-sm leading-5 text-secondary">
          {fallbackLabel ?? "Comece pela tarefa que mais impacta seu dia."}
        </p>

        <div className="mt-3">
          <div className="mb-2 flex items-center justify-between text-[0.68rem] text-soft">
            <span>Progresso</span>
            <span>{fallbackProgressSafe}%</span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-400 to-fuchsia-300 shadow-[0_0_16px_rgba(192,132,252,0.45)]"
              style={{
                width: `${fallbackProgressSafe}%`,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const progress = getCurrentBlockProgress(currentBlock);

  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-soft bg-surface-muted p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-accent">
            {currentBlock.level_label}
          </p>
        </div>

        <div className="shrink-0 rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
          {progress}%
        </div>
      </div>

      <p className="mt-3 text-sm leading-5 text-secondary">
        {currentBlock.description}
      </p>

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between text-[0.68rem] text-soft">
          <span>Progresso</span>
          <span>{progress}%</span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-purple-400 to-fuchsia-300 shadow-[0_0_16px_rgba(192,132,252,0.42)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {nextBlock && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onToggleNext}
            className="flex min-h-10 w-full items-center rounded-2xl border border-soft bg-surface-muted px-3.5 text-xs font-semibold text-muted active:scale-[0.98]"
          >
            <span>
              {showNextBlock ? "Ocultar próximo" : "Próximo bloco"}
            </span>

            <span className="ml-auto mr-2 text-[0.68rem] font-medium text-soft">
              {nextBlock.start} – {nextBlock.end}
            </span>

            {showNextBlock ? (
              <ChevronUp className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" />
            )}
          </button>

          {showNextBlock && (
            <div className="mt-2.5 rounded-[1.15rem] border border-soft bg-surface-muted p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="truncate text-xs font-semibold text-secondary">
                  {nextBlock.level_label}
                </p>

                <p className="shrink-0 text-[0.68rem] font-medium text-soft">
                  {nextBlock.start} – {nextBlock.end}
                </p>
              </div>

              <p className="text-xs leading-5 text-muted">
                {nextBlock.description}
              </p>

            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Helpers de cálculo
// Mantêm regras de progresso fora do JSX principal.
// ============================================================================

// Calcula o avanço temporal do bloco atual com base no horário local do usuário.
function getCurrentBlockProgress(block: FocusBlock) {
  const now = new Date();

  const [startHour, startMinute] = block.start.split(":").map(Number);
  const [endHour, endMinute] = block.end.split(":").map(Number);

  const start = new Date(now);
  start.setHours(startHour, startMinute, 0, 0);

  const end = new Date(now);
  end.setHours(endHour, endMinute, 0, 0);

  // Blocos que terminam em 00:00 precisam ser tratados como fim no dia seguinte.
  if (end <= start) {
    end.setDate(end.getDate() + 1);
  }

  const total = end.getTime() - start.getTime();
  const elapsed = now.getTime() - start.getTime();

  if (elapsed <= 0) return 0;
  if (elapsed >= total) return 100;

  return clampPercent(Math.round((elapsed / total) * 100));
}

function clampPercent(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

// "2026-06-29" -> "29/06"
function formatShortDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

// "2026-06-29" + "2026-07-05" -> "29/06 – 05/07"
function formatPeriodRange(start: string, end: string) {
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

// ============================================================================
// Central de notificações
// Modal aberto pelo sino do header e pelo toast global via query param.
// ============================================================================

type NotificationAction = {
  task_id?: string;
  new_date?: string | null;
  new_start_time?: string | null;
  new_end_time?: string | null;
  reason?: string | null;
};

type NotificationWithAction = api.NotificationData & {
  action?: NotificationAction | null;
};

// Item individual do modal: leitura simples, alteração aplicada ou sugestão acionável.
function NotificationItem({
  notification,
  onRead,
  onAccept,
  onReject,
}: {
  notification: api.NotificationData;
  onRead: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const typedNotification = notification as NotificationWithAction;

  const isUnread = notification.status === "unread";
  const isImprovement = notification.type === "improvement";
  const isChange = notification.type === "change";
  const isAccepted = notification.status === "accepted";
  const isRejected = notification.status === "rejected";
  const isHandled = isAccepted || isRejected;

  const canAct = isImprovement && !isHandled;
  const action = typedNotification.action;

  function handleCardClick() {
    if (isUnread) {
      onRead(notification.id);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          handleCardClick();
        }
      }}
      className={`rounded-[1.55rem] border p-4 text-left transition active:scale-[0.99] ${
        isImprovement
          ? isHandled
            ? "border-soft bg-surface-muted"
            : "border-accent-soft bg-surface-elevated shadow-card"
          : isUnread
          ? "border-accent-soft bg-surface-elevated shadow-card"
          : "border-soft bg-surface-muted"
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border ${
              isImprovement || isChange || isUnread
                ? "border-accent-soft bg-accent-soft text-accent"
                : "border-soft bg-surface-muted text-secondary"
            }`}
          >
            {isImprovement ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] ${
                  isImprovement || isChange || isUnread
                    ? "border-accent-soft bg-accent-soft text-accent"
                    : "border-soft bg-surface-muted text-secondary"
                }`}
              >
                {isImprovement
                  ? "Sugestão"
                  : isChange
                  ? "Alteração"
                  : "Aviso"}
              </span>

              {isUnread && (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              )}
            </div>

            <p className="text-sm font-semibold leading-5 text-primary">
              {notification.title}
            </p>

            <p className="mt-1 text-xs leading-5 text-muted">
              {notification.body}
            </p>
          </div>
        </div>

        <span
          className={`shrink-0 text-[0.65rem] font-medium ${
            isUnread ? "text-accent" : "text-soft"
          }`}
        >
          {formatNotificationTime(notification.created_at)}
        </span>
      </div>

      {isImprovement && action && !isHandled && (
        <div className="mb-3 rounded-[1.15rem] border border-soft bg-surface-muted p-3">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-soft">
            Ajuste sugerido
          </p>

          {(action.new_date || action.new_start_time || action.new_end_time) && (
            <p className="mt-2 text-xs font-semibold text-secondary">
              {action.new_date && <>Data: {action.new_date}</>}
              {action.new_start_time && (
                <>
                  {action.new_date ? " · " : ""}
                  {action.new_start_time}
                  {action.new_end_time ? ` – ${action.new_end_time}` : ""}
                </>
              )}
            </p>
          )}

          {action.reason && (
            <p className="mt-1 text-xs leading-5 text-muted">
              {action.reason}
            </p>
          )}
        </div>
      )}

      {canAct && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAccept(notification.id);
            }}
            className="inline-flex min-h-10 items-center justify-center rounded-2xl bg-purple-500 px-4 text-xs font-semibold text-white shadow-lg shadow-purple-950/25 active:scale-[0.98]"
          >
            Aceitar
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onReject(notification.id);
            }}
            className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-soft bg-surface-muted px-4 text-xs font-semibold text-muted active:scale-[0.98]"
          >
            Recusar
          </button>
        </div>
      )}

      {!isImprovement && isUnread && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRead(notification.id);
          }}
          className="mt-3 inline-flex min-h-8 items-center justify-center rounded-xl border border-accent-soft bg-accent-soft px-3 text-[0.68rem] font-semibold text-accent transition active:scale-[0.98]"
        >
          Marcar como lida
        </button>
      )}

      {isAccepted && (
        <p className="mt-3 text-[0.68rem] font-semibold text-accent">
          Sugestão aceita
        </p>
      )}

      {isRejected && (
        <p className="mt-3 text-[0.68rem] font-semibold text-soft">
          Sugestão recusada
        </p>
      )}
    </div>
  );
}

// Formata datas recentes em linguagem curta para caber no card mobile.
function formatNotificationTime(createdAt: string) {
  const date = new Date(createdAt);
  const now = new Date();

  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diffMin < 1) return "Agora";
  if (diffMin < 60) return `Há ${diffMin} min`;

  const diffH = Math.floor(diffMin / 60);

  if (diffH < 24) return `Há ${diffH}h`;

  const diffDays = Math.floor(diffH / 24);

  if (diffDays === 1) return "Ontem";

  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function NotificationsSheet({
  isOpen,
  onClose,
  onUnreadCountChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}) {
  // Estados do modal: lista local, aba ativa, paginação e carregamento.
  const [notifications, setNotifications] = useState<api.NotificationData[]>([]);
  const [notificationView, setNotificationView] = useState<"unread" | "read">(
    "unread"
  );
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // Listas derivadas para separar rapidamente o que está pendente do que já foi tratado.
  const unreadNotifications = notifications.filter(
    (notification) => notification.status === "unread"
  );

  const readNotifications = notifications.filter(
    (notification) => notification.status !== "unread"
  );

  const filteredNotifications =
    notificationView === "unread" ? unreadNotifications : readNotifications;
  const shouldShowLoadMore =
    hasMore && filteredNotifications.length >= NOTIFICATIONS_PAGE_SIZE;

  const unreadCount = unreadNotifications.length;
  const readCount = readNotifications.length;

  // Carrega uma página extra para descobrir se ainda existe “Ver mais”.
  function loadNotifications({ showLoading = true } = {}) {
    if (showLoading) {
      setLoading(true);
    }

    api
      .getNotifications(NOTIFICATIONS_PAGE_SIZE + 1, 0)
      .then((data) => {
        const visibleNotifications = data.slice(0, NOTIFICATIONS_PAGE_SIZE);

        setNotifications(visibleNotifications);
        setHasMore(data.length > NOTIFICATIONS_PAGE_SIZE);

        const nextUnreadCount = visibleNotifications.filter(
          (notification) => notification.status === "unread"
        ).length;

        onUnreadCountChange(nextUnreadCount);
      })
      .catch(() => null)
      .finally(() => {
        if (showLoading) {
          setLoading(false);
        }
      });
  }

  useEffect(() => {
    if (!isOpen) return;

    loadNotifications({ showLoading: true });

    const handleNotificationsUpdated = () => {
      loadNotifications({ showLoading: false });
    };

    window.addEventListener(
      "axon:notifications-updated",
      handleNotificationsUpdated
    );

    return () => {
      window.removeEventListener(
        "axon:notifications-updated",
        handleNotificationsUpdated
      );
    };
  }, [isOpen]);

  async function loadMore() {
    try {
      const more = await api.getNotifications(
        NOTIFICATIONS_PAGE_SIZE + 1,
        notifications.length
      );

      const visibleMore = more.slice(0, NOTIFICATIONS_PAGE_SIZE);

      setNotifications((prev) => {
        const next = [...prev, ...visibleMore];

        return next;
      });

      setHasMore(more.length > NOTIFICATIONS_PAGE_SIZE);
    } catch {
      // Falha silenciosa para não travar a central de notificações.
    }
  }

  function syncUnreadCount(nextNotifications: api.NotificationData[]) {
    const nextUnreadCount = nextNotifications.filter(
      (notification) => notification.status === "unread"
    ).length;

    onUnreadCountChange(nextUnreadCount);
  }

  // Marca como lida de forma otimista, sem recarregar a central inteira.
  async function handleRead(id: string) {
    const currentNotification = notifications.find(
      (notification) => notification.id === id
    );

    if (!currentNotification || currentNotification.status !== "unread") {
      return;
    }

    const nextNotifications = notifications.map((notification) =>
      notification.id === id
        ? { ...notification, status: "read" as const }
        : notification
    );

    setNotifications(nextNotifications);
    syncUnreadCount(nextNotifications);

    await api.markNotificationRead(id).catch(() => {
      loadNotifications({ showLoading: false });
    });
  }

  // Aceita sugestões de melhoria e move o item para a aba de lidas/tratadas.
  async function handleAccept(id: string) {
    const nextNotifications = notifications.map((notification) =>
      notification.id === id
        ? { ...notification, status: "accepted" as const }
        : notification
    );

    setNotifications(nextNotifications);
    syncUnreadCount(nextNotifications);
    setNotificationView("read");

    await api.acceptNotification(id).catch(() => {
      loadNotifications({ showLoading: false });
    });
  }

  // Recusa sugestões mantendo o histórico visível na aba de lidas/tratadas.
  async function handleReject(id: string) {
    const nextNotifications = notifications.map((notification) =>
      notification.id === id
        ? { ...notification, status: "rejected" as const }
        : notification
    );

    setNotifications(nextNotifications);
    syncUnreadCount(nextNotifications);
    setNotificationView("read");

    await api.rejectNotification(id).catch(() => {
      loadNotifications({ showLoading: false });
    });
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
      <div className="relative flex h-[82dvh] max-h-[720px] w-full max-w-[430px] flex-col overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated shadow-soft backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.22),transparent_48%)]" />

        <div className="relative border-b border-soft px-5 pb-4 pt-5">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
                <Bell className="h-3.5 w-3.5" />
                Central do Axon
              </div>

              <h2 className="text-[1.65rem] font-semibold leading-[1.05] tracking-[-0.055em] text-primary">
                Notificações
              </h2>

              <p className="mt-2 text-xs leading-5 text-muted">
                Avisos importantes, lembretes inteligentes e sugestões para
                melhorar seu planejamento.
              </p>
            </div>

            <button
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted active:scale-[0.96]"
              aria-label="Fechar notificações"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex rounded-2xl border border-soft bg-surface-muted p-1">
            <button
              type="button"
              onClick={() => setNotificationView("unread")}
              className={`min-h-10 flex-1 rounded-xl text-xs font-semibold transition active:scale-[0.98] ${
                notificationView === "unread"
                  ? "bg-purple-500 text-white shadow-lg shadow-purple-950/25"
                  : "text-muted"
              }`}
            >
              Não lidas
              {unreadCount > 0 && (
                <span className="ml-1 text-[0.65rem] opacity-75">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setNotificationView("read")}
              className={`min-h-10 flex-1 rounded-xl text-xs font-semibold transition active:scale-[0.98] ${
                notificationView === "read"
                  ? "bg-purple-500 text-white shadow-lg shadow-purple-950/25"
                  : "text-muted"
              }`}
            >
              Lidas
              {readCount > 0 && (
                <span className="ml-1 text-[0.65rem] opacity-75">
                  {readCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <ScrollArea
          className="min-h-0 flex-1 overflow-hidden"
          contentClassName="relative px-5 py-4"
        >
          {loading && notifications.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">
              Carregando...
            </div>
          ) : filteredNotifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title={
                notificationView === "unread"
                  ? "Nenhuma notificação não lida"
                  : "Nenhuma notificação lida"
              }
              description={
                notificationView === "unread"
                  ? "Quando houver novos avisos ou sugestões, eles aparecerão aqui."
                  : "Notificações já lidas, aceitas ou recusadas aparecerão nesta aba."
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={handleRead}
                  onAccept={handleAccept}
                  onReject={handleReject}
                />
              ))}

              {shouldShowLoadMore && (
                <button
                  type="button"
                  onClick={loadMore}
                  className="mt-1 inline-flex min-h-10 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-4 text-xs font-semibold text-muted active:scale-[0.98]"
                >
                  Ver mais
                </button>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}