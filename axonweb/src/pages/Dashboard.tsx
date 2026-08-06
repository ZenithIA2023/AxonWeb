import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementType, PointerEvent as ReactPointerEvent, ReactNode } from "react";
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
import type { BlockTask, DashboardData, FocusBlock, Subtask } from "../lib/api";
import { AppBackground } from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";
import axonHeadHappy from "../assets/axon/axon-head-happy.png";
import EmptyState from "../components/ui/EmptyState";
import { ScrollArea } from "../components/ui/ScrollArea";

const NOTIFICATIONS_PAGE_SIZE = 10;

// Gesto de arrastar nas linhas de "Hoje" -----------------------------------
// Folga (px) antes de assumir o toque como horizontal: abaixo disso o gesto
// continua sendo rolagem vertical da lista.
const SWIPE_ENGAGE_PX = 12;
// Deslocamento (px) a partir do qual soltar dispara a ação.
const SWIPE_TRIGGER_PX = 92;
// Teto do arraste, para a linha não sair de dentro do card.
const SWIPE_MAX_PX = 136;
// Duração (ms) da animação de saída antes de a ação rodar de fato.
const SWIPE_EXIT_MS = 180;

// Marcador lateral das linhas de "Hoje" -------------------------------------
// Janela assumida para tarefas sem horário de término: passados esses minutos
// desde o início, a tarefa deixa de estar "acontecendo agora".
const DEFAULT_TASK_DURATION_MIN = 30;
// De quanto em quanto tempo o relógio da página avança (ms). O marcador muda
// de estado sozinho na virada do horário, sem depender de recarregar a página.
const CLOCK_TICK_MS = 30 * 1000;

// Esperas (ms) entre as tentativas da carga inicial do dashboard. Em dev o
// front sobe antes do uvicorn e serviços hospedados podem estar em cold
// start, então a primeira chamada costuma pegar o backend ainda de pé.
const DASHBOARD_RETRY_DELAYS_MS = [1500, 4000];

// ============================================================================
// Tipos locais
// Props e aliases usados apenas na montagem visual do Dashboard.
// ============================================================================

// Situação da tarefa em relação ao relógio, usada só no marcador lateral:
// "current" = o horário dela é agora; "overdue" = o horário passou e ela
// continua pendente; null = ainda vai acontecer (ou já foi concluída).
type TaskTiming = "current" | "overdue" | null;

function minutesSinceMidnight() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function parseClockMinutes(value?: string | null) {
  if (!value) return null;

  const [rawHours, rawMinutes] = value.split(":");
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  return hours * 60 + minutes;
}

function getTaskTiming(task: BlockTask, nowMinutes: number): TaskTiming {
  if (task.status === "done") return null;

  // Tocada manualmente como "em andamento": vale como agora, independente do
  // relógio (o usuário adiantou ou atrasou a execução de propósito).
  const isRunning = task.status === "progress";

  const start = parseClockMinutes(task.start_time);
  if (start === null) return isRunning ? "current" : null;

  const parsedEnd = parseClockMinutes(task.end_time);
  const end =
    parsedEnd === null
      ? start + DEFAULT_TASK_DURATION_MIN
      : parsedEnd <= start
      ? parsedEnd + 24 * 60 // término no dia seguinte
      : parsedEnd;

  if (nowMinutes < start) return isRunning ? "current" : null;
  if (nowMinutes < end) return "current";

  return "overdue";
}

// ============================================================================
// Página Dashboard
// Tela inicial pós-login: ritmo atual, plano do dia e notificações.
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
  // Falha ao carregar o dashboard. Sem este estado, erro e carregamento eram
  // indistinguíveis (ambos deixam `data` nulo) e a tela caía nos fallbacks,
  // exibindo perfil e percentuais genéricos como se fossem do usuário.
  // (Não há mais um `loading` aqui: a ausência de `data` já significa
  // "ainda não tenho o que mostrar", e `loadError` diz se foi falha.)
  const [loadError, setLoadError] = useState(false);
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
  // Linhas de "Hoje" já resolvidas por gesto (concluir/adiar) e escondidas na
  // hora, antes de o dashboard recarregar. A lista do servidor é a verdade: um
  // id só sai daqui quando some da resposta (ver efeito abaixo) ou quando a
  // ação falha/é desfeita.
  const [swipedTaskIds, setSwipedTaskIds] = useState<string[]>([]);
  const [swipeToast, setSwipeToast] = useState<{
    message: string;
    tone: "done" | "error";
    onUndo?: () => void;
  } | null>(null);
  const swipeToastTimer = useRef<number | null>(null);
  // Minuto atual do dia (0–1439), base do marcador lateral das tarefas.
  const [nowMinutes, setNowMinutes] = useState(() => minutesSinceMidnight());

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
  // Carga do dashboard
  // `attempt < 0` (padrão) = recarga de rotina — intervalo de 30min ou volta
  // à aba: falha direto, sem insistir. `attempt >= 0` = carga inicial, que
  // retenta conforme DASHBOARD_RETRY_DELAYS_MS antes de assumir o erro.
  // --------------------------------------------------------------------------
  const loadDashboard = useCallback((attempt = -1) => {
    setLoadError(false);

    api
      .getDashboard()
      .then(setData)
      .catch(() => {
        const next = attempt + 1;

        if (attempt >= 0 && next <= DASHBOARD_RETRY_DELAYS_MS.length) {
          window.setTimeout(
            () => loadDashboard(next),
            DASHBOARD_RETRY_DELAYS_MS[next - 1]
          );
          return;
        }

        // Sem dados: a tela mostra o esqueleto e o aviso de falha, nunca os
        // valores de fallback.
        setData(null);
        setLoadError(true);
      });
  }, []);

  // --------------------------------------------------------------------------
  // Gestos da lista "Hoje"
  // Arrastar a linha para a direita conclui; para a esquerda, empurra para
  // amanhã. Nos dois casos o item deixa de pertencer ao plano de hoje (o
  // dashboard só devolve pendentes da data atual), então a linha some na hora
  // e o toast oferece desfazer enquanto estiver visível.
  // --------------------------------------------------------------------------
  const showSwipeToast = useCallback(
    (toast: {
      message: string;
      tone: "done" | "error";
      onUndo?: () => void;
    }) => {
      setSwipeToast(toast);

      if (swipeToastTimer.current) {
        window.clearTimeout(swipeToastTimer.current);
      }

      swipeToastTimer.current = window.setTimeout(
        () => setSwipeToast(null),
        6000
      );
    },
    []
  );

  useEffect(() => {
    return () => {
      if (swipeToastTimer.current) window.clearTimeout(swipeToastTimer.current);
    };
  }, []);

  const refreshDayPlan = useCallback(() => {
    loadDashboard();
    loadSubtasks();
  }, [loadDashboard, loadSubtasks]);

  // Traz a linha de volta quando a ação falha ou o usuário desfaz.
  const restoreSwipedTask = useCallback((taskId: string) => {
    setSwipedTaskIds((ids) => ids.filter((id) => id !== taskId));
  }, []);

  const completeTaskBySwipe = useCallback(
    async (task: BlockTask) => {
      setSwipedTaskIds((ids) =>
        ids.includes(task.id) ? ids : [...ids, task.id]
      );

      // Reabrir devolve ao estado anterior; `progress: 0` acompanha o que o
      // Planejamento já faz ao desmarcar (o backend também desmarca as
      // subtarefas concluídas junto).
      const previousStatus = task.status === "progress" ? "progress" : "todo";

      try {
        await api.updateTask(task.id, { status: "done", progress: 100 });
        refreshDayPlan();

        showSwipeToast({
          message: `“${task.title}” concluída`,
          tone: "done",
          onUndo: async () => {
            try {
              await api.updateTask(task.id, {
                status: previousStatus,
                progress: 0,
              });
            } finally {
              restoreSwipedTask(task.id);
              refreshDayPlan();
            }
          },
        });
      } catch {
        restoreSwipedTask(task.id);
        showSwipeToast({
          message: "Não foi possível concluir agora",
          tone: "error",
        });
      }
    },
    [refreshDayPlan, restoreSwipedTask, showSwipeToast]
  );

  const postponeTaskBySwipe = useCallback(
    async (task: BlockTask) => {
      setSwipedTaskIds((ids) =>
        ids.includes(task.id) ? ids : [...ids, task.id]
      );

      // "sv-SE" = YYYY-MM-DD no fuso local, o mesmo formato que o backend usa
      // em scheduled_date (o ISO em UTC erraria o dia perto da meia-noite).
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowISO = tomorrow.toLocaleDateString("sv-SE");

      try {
        // Sem toast no sucesso: a própria linha saindo da lista já é o retorno
        // do gesto. Só a falha avisa (abaixo), porque aí a linha volta.
        await api.updateTask(task.id, { scheduled_date: tomorrowISO });
        refreshDayPlan();
      } catch {
        restoreSwipedTask(task.id);
        showSwipeToast({
          message: "Não foi possível adiar agora",
          tone: "error",
        });
      }
    },
    [refreshDayPlan, restoreSwipedTask, showSwipeToast]
  );

  // --------------------------------------------------------------------------
  // Carregamento principal
  // Busca dashboard, revisão diária, subtarefas e notificações.
  // Também atualiza dados ao retornar para a aba e a cada 30 minutos.
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!api.isLoggedIn()) {
      navigate("/login");
      return;
    }

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

    loadDashboard(0); // só a carga inicial retenta (backend pode estar subindo)
    loadDailyLog();
    loadReports();
    loadSubtasks();
    refreshUnreadCount();
    analyzeNotificationsAndRefresh();

    const interval = window.setInterval(() => {
      loadDashboard();
      loadSubtasks();
    }, 30 * 60 * 1000);

    // Captura notificações geradas pelo scheduler enquanto o app permanece aberto.
    const notifInterval = window.setInterval(refreshUnreadCount, 2 * 60 * 1000);

    const handleVisibility = () => {
      if (document.hidden) return;

      // Em aba oculta o navegador estrangula o setInterval do relógio; ao
      // voltar, o marcador precisa refletir o horário de agora na hora.
      setNowMinutes(minutesSinceMidnight());
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
  }, [navigate, refreshUnreadCount, loadSubtasks, loadDashboard]);

  // Relógio da página: só o minuto importa, então um tique de 30s já garante
  // que a tarefa vire "agora" (e depois "atrasada") sem recarregar nada.
  useEffect(() => {
    const clock = window.setInterval(
      () => setNowMinutes(minutesSinceMidnight()),
      CLOCK_TICK_MS
    );

    return () => window.clearInterval(clock);
  }, []);

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

    // A marca é gravada só quando o pop-up REALMENTE abre. Gravar antes fazia
    // com que abrir o app de manhã (quando ainda não há o que registrar)
    // queimasse a única chance do dia — à noite o pop-up não vinha mais e o
    // registro se perdia.
    const markShown = () => localStorage.setItem("axon_last_opened", todayISO);

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
        markShown();
        return;
      }

      // Ontem ok — hoje está completo?
      const todayComplete =
        today?.sleep_rating != null &&
        today?.mood_rating != null &&
        today?.productivity_rating != null;

      // Só pede o registro de HOJE quando o dia já rendeu algo para avaliar.
      // Abrir de manhã não faz sentido: o usuário ainda não tem como dizer
      // como foi a produtividade do dia, e o pop-up vira ruído logo na
      // abertura do app. À noite (18h+) é quando o registro é respondível —
      // mesmo horário em que o card "Revisar dia" aparece.
      const REVIEW_HOUR = 18;
      if (!todayComplete && new Date().getHours() >= REVIEW_HOUR) {
        setAutoReviewDate(undefined); // sem targetDate = hoje
        setAutoReviewOpen(true);
        markShown();
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
  // O backend devolve "Bom dia, Nome Completo" — na saudação exibimos só o
  // primeiro nome para manter o título curto.
  const greeting = useMemo(() => {
    const raw = data?.greeting ?? "Bom dia";
    const [salutation, ...rest] = raw.split(",");
    const firstName = rest.join(",").trim().split(/\s+/)[0];
    return firstName ? `${salutation.trim()}, ${firstName}` : raw;
  }, [data?.greeting]);

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

  // Sem dados = esqueleto, tanto carregando quanto após falha. Antes era
  // `loading && !data`: numa falha o loading virava false, a expressão dava
  // false e a tela renderizava os fallbacks acima ("Perfil Intermediário",
  // "Entre 9h e 15h", energia/foco fixos) como se fossem dados reais.
  const isDashboardBooting = !data;

  const dayTasks = dayBlocks.flatMap((block) => block.tasks);

  // O backend agrupa o dia em blocos de 90 min e, DENTRO de cada bloco, ordena
  // por importância (tarefa chave → prioridade → horário). Achatar os blocos
  // herda essa ordem e embaralha o relógio — aqui a lista é uma linha do dia,
  // então reordena por start_time ("HH:MM" ordena bem como texto).
  const flatTasks = dayTasks
    .filter((task) => !swipedTaskIds.includes(task.id))
    .sort((a, b) =>
      (a.start_time || "99:99").localeCompare(b.start_time || "99:99")
    );

  // Quando a tarefa arrastada some da resposta do dashboard, o esconde-esconde
  // local já cumpriu o papel e pode ser descartado. Ids que continuam voltando
  // do servidor seguem escondidos até a ação confirmar (ou o catch/desfazer
  // devolver a linha), evitando o pisca-pisca de reaparecer e sumir.
  useEffect(() => {
    setSwipedTaskIds((ids) => {
      if (ids.length === 0) return ids;

      const stillListed = ids.filter((id) =>
        dayTasks.some((task) => task.id === id)
      );

      return stillListed.length === ids.length ? ids : stillListed;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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

        {loadError && (
          <section className="mt-5 rounded-[1.75rem] border border-amber-300/30 bg-amber-400/10 p-4 lg:p-5">
            <p className="text-sm font-black text-amber-700 dark:text-amber-200">
              Não foi possível carregar seu painel
            </p>
            <p className="mt-1.5 text-xs leading-5 text-muted">
              O app não conseguiu falar com o servidor. Seus números ficam
              ocultos para não mostrar informação incorreta.
            </p>

            <button
              type="button"
              onClick={() => loadDashboard(0)}
              className="mt-3 inline-flex min-h-10 items-center justify-center rounded-2xl border border-soft bg-surface-elevated px-4 text-xs font-black text-secondary transition active:scale-[0.97]"
            >
              Tentar novamente
            </button>
          </section>
        )}

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

        {/* A tarefa-chave não tem card próprio: aparece na lista "Próximos
            movimentos do seu dia", junto das demais tarefas/eventos. */}
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
        {/* No desktop o card fica absoluto dentro deste wrapper: assim ele não
            empurra a altura da linha do grid — quem manda na altura é a coluna
            da esquerda (bloco de foco + energia/foco) e o card termina alinhado
            com ela, rolando a lista por dentro quando há mais movimentos. */}
        <div className="lg:relative lg:min-h-0 lg:flex-1">
        <section className="relative overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated p-4 shadow-card backdrop-blur-2xl lg:absolute lg:inset-0 lg:flex lg:min-h-0 lg:flex-col lg:p-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_58%)]" />

          <div className="relative mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-[1.35rem] font-black leading-none tracking-[-0.04em] text-primary">
                Hoje
              </p>
              <p className="mt-2 text-xs leading-5 text-muted">
                Próximos movimentos do seu dia
              </p>

              {/* O gesto é invisível por natureza: sem esta dica ninguém
                  descobre que dá para resolver a tarefa sem sair do Dashboard. */}
              {flatTasks.length > 0 && (
                <p className="mt-1 flex items-center gap-1.5 text-[0.62rem] font-semibold text-soft">
                  Arraste
                  <span className="text-emerald-700 dark:text-emerald-100">
                    → concluir
                  </span>
                  ·
                  <span className="text-indigo-700 dark:text-indigo-200">
                    ← amanhã
                  </span>
                </p>
              )}
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
              {flatTasks.map((task) => {
                const isActive = task.status === "progress";
                const isDone = task.status === "done";
                const isKey = task.is_key_task;

                const subtasks = subtasksMap[task.id] ?? [];
                const completedSubtasks = subtasks.filter(
                  (subtask) => subtask.done
                ).length;
                const hasSubtasks = subtasks.length > 0;
                const focusRecommendation = focusRecommendationByTaskId[task.id];
                const timing = getTaskTiming(task, nowMinutes);

                return (
                  <SwipeableTaskRow
                    key={task.id}
                    onComplete={() => completeTaskBySwipe(task)}
                    onPostpone={() => postponeTaskBySwipe(task)}
                  >
                    <button
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
                      {/* Marcador lateral: âmbar na tarefa chave (visual
                          próprio, sempre), roxo enquanto o horário da tarefa
                          está acontecendo e vermelho quando esse horário passou
                          sem ela ser concluída. */}
                      <div
                        aria-hidden
                        className={`absolute left-0 top-4 h-[calc(100%-2rem)] w-1 rounded-r-full transition-colors ${
                          isKey
                            ? "bg-amber-400"
                            : timing === "current"
                            ? "bg-[var(--accent)]"
                            : timing === "overdue"
                            ? "bg-rose-400"
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
                  </SwipeableTaskRow>
                );
              })}
            </div>
          )}

        </section>
        </div>

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

      {/* Direto de `data` (props opcionais): sem dados o Sidebar omite, em vez
          de exibir o perfil genérico como se fosse o do usuário. */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={data?.chronotype_label}
        energyPeak={data?.energy_peak}
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

      {/* Retorno das ações por gesto. Fica acima da barra inferior e some em
          6s — o "Desfazer" só existe enquanto o toast estiver na tela. */}
      {swipeToast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
          <div
            role="status"
            className={`pointer-events-auto flex max-w-full items-center gap-3 rounded-full border bg-surface-elevated py-2.5 pl-4 pr-2 text-sm font-semibold shadow-soft backdrop-blur-xl ${
              swipeToast.tone === "done"
                ? "border-emerald-300/25 text-emerald-700 dark:text-emerald-100"
                : "border-rose-300/25 text-rose-700 dark:text-rose-200"
            }`}
          >
            {swipeToast.tone === "done" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <X className="h-4 w-4 shrink-0" />
            )}

            <span className="min-w-0 truncate">{swipeToast.message}</span>

            {swipeToast.onUndo && (
              <button
                type="button"
                onClick={() => {
                  const undo = swipeToast.onUndo;
                  setSwipeToast(null);
                  undo?.();
                }}
                className="shrink-0 rounded-full border border-soft bg-surface-muted px-3 py-1.5 text-xs font-black text-secondary transition active:scale-[0.96]"
              >
                Desfazer
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

// ============================================================================
// Componentes internos do Dashboard
// Cards visuais usados apenas nesta página.
// ============================================================================

// Linha da lista "Hoje" com ações por arraste: direita conclui, esquerda joga
// para amanhã. O gesto só assume o controle depois de SWIPE_ENGAGE_PX na
// horizontal — antes disso (e sempre que o movimento for mais vertical do que
// horizontal) o toque segue rolando a lista, que no desktop tem scroll próprio.
function SwipeableTaskRow({
  onComplete,
  onPostpone,
  children,
}: {
  onComplete: () => void;
  onPostpone: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const rowRef = useRef<HTMLDivElement | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");
  // O clique que vem depois de um arraste abriria o Planejamento; este flag
  // deixa o onClickCapture engolir esse clique.
  const draggedRef = useRef(false);
  const exitTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (exitTimer.current) window.clearTimeout(exitTimer.current);
    };
  }, []);

  // Resistência depois do gatilho: continua respondendo ao dedo, mas sem
  // deslizar a linha para fora do card.
  function damp(distance: number) {
    const magnitude = Math.abs(distance);

    const eased =
      magnitude <= SWIPE_TRIGGER_PX
        ? magnitude
        : SWIPE_TRIGGER_PX + (magnitude - SWIPE_TRIGGER_PX) * 0.35;

    return Math.sign(distance) * Math.min(eased, SWIPE_MAX_PX);
  }

  function leave(direction: 1 | -1, action: () => void) {
    const width = rowRef.current?.offsetWidth ?? 320;

    setIsLeaving(true);
    setIsDragging(false);
    setOffset(direction * (width + 48));

    exitTimer.current = window.setTimeout(action, SWIPE_EXIT_MS);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (isLeaving) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    startPoint.current = { x: event.clientX, y: event.clientY };
    axis.current = "undecided";
    draggedRef.current = false;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = startPoint.current;
    if (!start || isLeaving) return;

    // Mouse solto fora da linha não dispara pointerup aqui; sem esta guarda o
    // próximo movimento do cursor continuaria arrastando sem botão apertado.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      startPoint.current = null;
      axis.current = "undecided";
      setIsDragging(false);
      setOffset(0);
      return;
    }

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;

    if (axis.current === "undecided") {
      // Rolagem vertical vence: abandona o gesto até o próximo toque.
      if (Math.abs(deltaY) > SWIPE_ENGAGE_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
        axis.current = "vertical";
        startPoint.current = null;
        return;
      }

      if (Math.abs(deltaX) <= SWIPE_ENGAGE_PX) return;

      axis.current = "horizontal";
      draggedRef.current = true;
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    setOffset(damp(deltaX));
  }

  function handlePointerEnd() {
    if (axis.current !== "horizontal" || isLeaving) {
      startPoint.current = null;
      axis.current = "undecided";
      return;
    }

    startPoint.current = null;
    axis.current = "undecided";
    setIsDragging(false);

    if (offset >= SWIPE_TRIGGER_PX) {
      leave(1, onComplete);
      return;
    }

    if (offset <= -SWIPE_TRIGGER_PX) {
      leave(-1, onPostpone);
      return;
    }

    setOffset(0); // não chegou ao gatilho: volta ao lugar
  }

  const progress = Math.min(1, Math.abs(offset) / SWIPE_TRIGGER_PX);
  const isArmed = Math.abs(offset) >= SWIPE_TRIGGER_PX;
  const direction = offset > 0 ? 1 : offset < 0 ? -1 : 0;

  return (
    <div
      ref={rowRef}
      // `touch-pan-y` entrega a rolagem vertical ao navegador e deixa só o eixo
      // horizontal para o gesto.
      className="relative touch-pan-y select-none overflow-hidden rounded-[1.45rem]"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={(event) => {
        if (!draggedRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        draggedRef.current = false;
      }}
    >
      <div
        aria-hidden
        className={`absolute inset-0 flex items-center justify-between rounded-[1.45rem] px-4 text-xs font-black transition-colors ${
          direction === 1
            ? "bg-emerald-500/15"
            : direction === -1
            ? "bg-indigo-500/15"
            : ""
        }`}
        style={{ opacity: direction === 0 ? 0 : 0.35 + progress * 0.65 }}
      >
        <span
          className={`flex items-center gap-2 text-emerald-700 dark:text-emerald-100 ${
            direction === 1 ? "" : "invisible"
          }`}
        >
          <CheckCircle2
            className={`h-5 w-5 transition-transform ${
              isArmed ? "scale-110" : "scale-90"
            }`}
          />
          Concluir
        </span>

        <span
          className={`flex items-center gap-2 text-indigo-700 dark:text-indigo-200 ${
            direction === -1 ? "" : "invisible"
          }`}
        >
          Amanhã
          <Clock3
            className={`h-5 w-5 transition-transform ${
              isArmed ? "scale-110" : "scale-90"
            }`}
          />
        </span>
      </div>

      <div
        className={`relative ${
          isDragging ? "" : "transition-transform duration-200 ease-out"
        }`}
        style={{ transform: `translateX(${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
}

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