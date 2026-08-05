import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Info,
  Moon,
  NotebookPen,
  RefreshCw,
  Smile,
  Sparkles,
  Target,
} from "lucide-react";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { results, type ChronotypeResultKey } from "../data/results";
import Sidebar from "../components/layout/Sidebar";
import DayReview from "./DayReview";
import * as api from "../lib/api";
import type { TaskInsights, FocusBlockItem } from "../lib/api";
import AppBackground from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";
import axonHeadHappy from "../assets/axon/axon-head-happy.png";

// ===========================================================================
// TOKENS VISUAIS DA PÁGINA
// ===========================================================================
// Cartão-base repetido em todas as seções: mantém raio, borda e sombra
// idênticos entre os blocos (o mockup trata a página como uma pilha de
// cartões iguais, só o conteúdo muda).
// p-2: as caixas internas (gráficos, listas) quase encostam na borda do
// cartão. O respiro do conteúdo vem do padding de cada caixa interna, não
// deste — assim sobra largura para os gráficos no telefone.
const CARD =
  "rounded-[1.75rem] border border-soft bg-surface-elevated p-2 text-primary shadow-card backdrop-blur-2xl";

// Caixa interna que envolve os gráficos dentro de cada cartão.
const CHART_BOX = "rounded-[1.4rem] border border-soft bg-surface-muted p-4";

// Variante do gráfico de linhas: recuo lateral mínimo para os rótulos dos
// eixos encostarem nas bordas. A área que sobra fica toda para os dias.
const CHART_BOX_AXES =
  "rounded-[1.4rem] border border-soft bg-surface-muted px-1 py-3";

// ===========================================================================
// TIPOS E CONFIGURAÇÕES DOS GRÁFICOS
// ===========================================================================

type SeriesKey = "tarefas" | "sono" | "qualidade" | "humor" | "prod";

// Cada métrica tem sua própria unidade, então cada uma pede uma escala
// própria no eixo — não dá para espremer nota de 1–5 no mesmo eixo de
// porcentagem sem falsear a leitura.
type ScaleKey = "pct" | "hours" | "rating";

const SCALES: Record<
  ScaleKey,
  {
    domain: [number, number];
    ticks: number[];
    format: (v: number) => string;
    width: number;
  }
> = {
  pct: {
    domain: [0, 100],
    ticks: [0, 20, 40, 60, 80, 100],
    format: (v) => String(v).padStart(2, "0"),
    width: 24,
  },
  hours: {
    domain: [0, 10],
    ticks: [0, 2, 4, 6, 8, 10],
    format: (v) => (v === 0 ? "00h" : `${v}h`),
    width: 26,
  },
  rating: {
    // Domínio começa em 0 para os dias sem registro caberem no gráfico; as
    // marcas continuam de 1 a 5, que são as notas que existem de verdade.
    domain: [0, 5],
    ticks: [1, 2, 3, 4, 5],
    format: (v) => String(v),
    width: 16,
  },
};

// Ordem fixa de quem ocupa o eixo esquerdo quando duas escalas convivem —
// assim o lado de cada métrica não muda conforme a ordem de seleção.
const SCALE_ORDER: ScaleKey[] = ["hours", "pct", "rating"];

const SERIES: {
  key: SeriesKey;
  label: string;
  color: string;
  scale: ScaleKey;
  dataKey: string;
}[] = [
  { key: "tarefas", label: "% Tarefas", color: "#c084fc", scale: "pct", dataKey: "tarefas" },
  { key: "sono", label: "Sono", color: "#60a5fa", scale: "hours", dataKey: "sono" },
  { key: "qualidade", label: "Qualidade sono", color: "#f472b6", scale: "rating", dataKey: "qualidade" },
  { key: "humor", label: "Humor", color: "#34d399", scale: "rating", dataKey: "humor" },
  { key: "prod", label: "Produtividade", color: "#fbbf24", scale: "rating", dataKey: "prod" },
];

const TYPE_STYLE: Record<
  api.PatternInsight["type"],
  { icon: React.ElementType; color: string }
> = {
  sleep: { icon: Moon, color: "#60a5fa" },
  productivity: { icon: Target, color: "#c084fc" },
  mood: { icon: Smile, color: "#34d399" },
  habit: { icon: Activity, color: "#fbbf24" },
  general: { icon: Sparkles, color: "#c084fc" },
};

// ===========================================================================
// CONFIGURAÇÕES DOS BLOCOS DE FOCO
// ===========================================================================
// Classes Tailwind (e não hex fixo) porque a barra de 24h precisa funcionar
// nos dois temas: no claro os tons escuros do mockup viram chapados pretos.

const LEVEL_STYLE: Record<string, { bar: string; text: string }> = {
  sono:          { bar: "bg-slate-300 dark:bg-slate-800",       text: "text-slate-500 dark:text-slate-400" },
  recuperacao:   { bar: "bg-sky-300 dark:bg-sky-900",           text: "text-sky-600 dark:text-sky-300" },
  foco_leve:     { bar: "bg-amber-300 dark:bg-amber-700",       text: "text-amber-600 dark:text-amber-300" },
  foco_moderado: { bar: "bg-violet-400 dark:bg-violet-800",     text: "text-violet-600 dark:text-violet-300" },
  foco_profundo: { bar: "bg-violet-500 dark:bg-violet-600",     text: "text-violet-700 dark:text-violet-300" },
  pico:          { bar: "bg-fuchsia-500 dark:bg-fuchsia-500",   text: "text-fuchsia-700 dark:text-fuchsia-300" },
};

const LEVEL_ORDER: { level: string; label: string }[] = [
  { level: "pico", label: "Pico" },
  { level: "foco_profundo", label: "Foco profundo" },
  { level: "foco_moderado", label: "Foco moderado" },
  { level: "foco_leve", label: "Foco leve" },
  { level: "recuperacao", label: "Recuperação" },
  { level: "sono", label: "Sono" },
];

// ===========================================================================
// CONFIGURAÇÕES DO CRONOTIPO E SONO
// ===========================================================================

const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

const SLEEP_TARGET_BY_CHRONOTYPE: Record<string, number> = {
  Matutino: 7.5,
  Vespertino: 7.5,
  Noturno: 7.5,
  Misto: 7.5,
  Bimodal: 7.5,
};
const DEFAULT_SLEEP_TARGET = 7.5;
// Topo do eixo de sono, em horas: as linhas-guia de 4h e 8h são posicionadas
// como fração desta escala.
const SLEEP_SCALE = 10;
const SLEEP_GUIDES = [4, 8];
// Altura da faixa dos rótulos de dia sob as barras: h-5 (1.25rem) do
// círculo + gap-2 (0.5rem). As linhas-guia usam isso para se alinhar à
// base das barras, e não à base do cartão.
const SLEEP_LABEL_BAND = "1.75rem";

// Limites de navegação no card de tarefas: até 2 anos de semanas para trás e
// 5 anos na visão anual. Impede que o usuário role indefinidamente por
// janelas vazias (a conta é do frontend; o backend aceita até 520 semanas).
const MAX_WEEK_OFFSET = 104;
const MAX_YEARS_BACK = 5;
// Deslocamento mínimo (px) para um arrasto contar como troca de período.
const SWIPE_THRESHOLD = 56;

// ===========================================================================
// PÁGINA DE INSIGHTS
// ===========================================================================
// Consolida padrões de tarefas, sono, humor, produtividade e blocos de foco.
export default function Insights() {
  const navigate = useNavigate();

  // Sidebar global da página.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Períodos independentes: cada gráfico tem seu próprio toggle
  // semana/mês — alterar um não deve afetar o outro.
  const [taskPeriod, setTaskPeriod] = useState<"week" | "month">("week");
  const [comparePeriod, setComparePeriod] = useState<"week" | "month">("week");
  // Dados do card de tarefas concluídas.
  const [taskInsights, setTaskInsights] = useState<TaskInsights | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(true);
  // Navegação do card de tarefas: quantas semanas para trás (modo semana) e
  // qual ano está sendo exibido (modo mês).
  const [taskWeekOffset, setTaskWeekOffset] = useState(0);
  const [taskYear, setTaskYear] = useState(() => new Date().getFullYear());
  const [taskMonths, setTaskMonths] = useState<api.TaskMonths | null>(null);
  const [loadingMonths, setLoadingMonths] = useState(true);
  const [activeMonth, setActiveMonth] = useState<number | null>(null);
  // Caixinha com o resumo do dia/mês: aparece só depois de um toque na
  // barra (ou na tira de dias), nunca sozinha ao abrir a página.
  const [taskTipOpen, setTaskTipOpen] = useState(false);
  // Dia em destaque nos gráficos. Guarda a data (chave estável), não o índice.
  // A tira numerada acima de cada gráfico é quem controla esse destaque —
  // funciona igual no desktop e no celular, onde não existe hover.
  const [activeTaskDay, setActiveTaskDay] = useState<string | null>(null);
  const [activeSleepDay, setActiveSleepDay] = useState<string | null>(null);
  const [activeCompareDay, setActiveCompareDay] = useState<string | null>(null);
  // Janela exibida no comparativo: semanas (ou blocos de 30 dias) atrás.
  const [compareOffset, setCompareOffset] = useState(0);
  // Dados usados no gráfico comparativo.
  const [compareTaskInsights, setCompareTaskInsights] =
    useState<TaskInsights | null>(null);

  // Sono: semana do calendário exibida (mesma navegação do card de tarefas).
  const [sleepWeek, setSleepWeek] = useState<api.DailyLogWeek | null>(null);
  const [sleepWeekOffset, setSleepWeekOffset] = useState(0);
  const [loadingSleep, setLoadingSleep] = useState(true);
  const [sleepTipOpen, setSleepTipOpen] = useState(false);
  const [compareLogs, setCompareLogs] = useState<api.DailyLog[]>([]);
  const [active, setActive] = useState<SeriesKey[]>(["tarefas", "sono"]);
  // Insights de padrões gerados a partir dos registros do usuário.
  const [patterns, setPatterns] = useState<api.PatternInsightsResponse | null>(
    null
  );
  const [loadingPatterns, setLoadingPatterns] = useState(true);
  // Índice do padrão exibido no carrossel do card do Axon.
  const [patternIdx, setPatternIdx] = useState(0);
  // Registro diário usado pelo modal DayReview.
  const [todayLog, setTodayLog] = useState<api.DailyLog | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Blocos de foco calculados pelo backend com base no cronotipo e histórico.
  const [focusBlocks, setFocusBlocks] = useState<FocusBlockItem[]>([]);
  const [blocksCalibrated, setBlocksCalibrated] = useState(false);
  const [blocksDataPoints, setBlocksDataPoints] = useState(0);
  const [blocksMinPoints, setBlocksMinPoints] = useState(14);
  const [expandedBlockIdx, setExpandedBlockIdx] = useState<number | null>(null);
  const [blocksListExpanded, setBlocksListExpanded] = useState(false);
  // Legenda + status de calibração ficam atrás do botão de informação, como
  // no mockup: o cartão fechado mostra só a barra de 24h.
  const [blocksInfoOpen, setBlocksInfoOpen] = useState(false);
  const [routineConsistency, setRoutineConsistency] = useState<
    api.RoutineConsistency[]
  >([]);

  // Carrega o registro diário atual para abrir/atualizar o DayReview.
  useEffect(() => {
    api
      .getDailyLogToday()
      .then(setTodayLog)
      .catch(() => setTodayLog(null));
  }, []);

  // Consistência de rotinas ativas na semana atual (card "Rotinas desta semana").
  useEffect(() => {
    api
      .getDashboard()
      .then((d) => setRoutineConsistency(d.routine_consistency ?? []))
      .catch(() => setRoutineConsistency([]));
  }, []);

  // Busca os blocos de foco personalizados.
  useEffect(() => {
    api
      .getFocusBlocks()
      .then((res) => {
        setFocusBlocks(res.blocks);
        setBlocksCalibrated(res.calibrated);
        setBlocksDataPoints(res.data_points);
        setBlocksMinPoints(res.min_data_points);
      })
      .catch(() => setFocusBlocks([]));
  }, []);

  // Busca padrões gerais de comportamento e produtividade.
  useEffect(() => {
    api
      .getPatternInsights()
      .then((res) => {
        setPatterns(res);
        setPatternIdx(0);
      })
      .catch(() => setPatterns(null))
      .finally(() => setLoadingPatterns(false));
  }, []);

  // Busca a semana exibida no card de tarefas (offset 0 = semana atual).
  useEffect(() => {
    if (taskPeriod !== "week") return;

    // Trocar de semana fecha a caixinha aberta na semana anterior.
    setTaskTipOpen(false);
    setLoadingTasks(true);

    api
      .getTaskInsights("week", taskWeekOffset)
      .then((res) => {
        setTaskInsights(res);
        // Na semana atual o destaque começa em hoje; em semanas passadas, no
        // último dia da janela — nunca num gráfico "sem seleção".
        const today = todayISO();
        const hasToday = res.days.some((d) => d.date === today);
        setActiveTaskDay(hasToday ? today : lastDate(res.days));
      })
      .catch(() => setTaskInsights(null))
      .finally(() => setLoadingTasks(false));
  }, [taskPeriod, taskWeekOffset]);

  // Busca os 12 meses do ano exibido (modo mês do card de tarefas).
  useEffect(() => {
    if (taskPeriod !== "month") return;

    setTaskTipOpen(false);
    setLoadingMonths(true);

    api
      .getTaskMonths(taskYear)
      .then((res) => {
        setTaskMonths(res);
        // No ano corrente destaca o mês atual; em anos passados, o último mês
        // com registro.
        const currentYear = new Date().getFullYear();
        const withData = res.months.filter((m) => m.total > 0);
        setActiveMonth(
          res.year === currentYear
            ? new Date().getMonth() + 1
            : withData.length
            ? withData[withData.length - 1].month
            : null
        );
      })
      .catch(() => setTaskMonths(null))
      .finally(() => setLoadingMonths(false));
  }, [taskPeriod, taskYear]);

  // Busca a semana de sono exibida (offset 0 = semana atual).
  useEffect(() => {
    setSleepTipOpen(false);
    setLoadingSleep(true);

    api
      .getDailyLogWeek(sleepWeekOffset)
      .then((res) => {
        setSleepWeek(res);
        // Destaque inicial: hoje quando a semana é a atual, senão o último dia
        // com registro (ou nenhum, se a semana estiver vazia).
        const today = todayISO();
        const withSleep = res.logs.filter((l) => l.hours_slept != null);
        setActiveSleepDay(
          withSleep.some((l) => l.date === today) ? today : lastDate(withSleep)
        );
      })
      .catch(() => setSleepWeek(null))
      .finally(() => setLoadingSleep(false));
  }, [sleepWeekOffset]);

  // O gráfico de comparação usa sua PRÓPRIA busca de tarefas (série "tarefas %"),
  // independente de taskInsights do card "Tarefas concluídas" — senão os dois
  // ficariam acoplados ao mesmo período.
  //
  // Tarefas e registros diários vêm na MESMA sequência porque os registros são
  // buscados pelo intervalo que as tarefas devolveram. Buscando os dois em
  // paralelo (como antes, com "últimos 7 dias"), uma janela passada traria
  // sono e humor de outro período.
  useEffect(() => {
    let cancelled = false;

    api
      .getTaskInsights(comparePeriod, compareOffset)
      .then(async (res) => {
        if (cancelled) return;

        setCompareTaskInsights(res);

        // Destaque inicial: hoje quando está na janela. Sem isso a semana do
        // calendário caía no último dia dela (sábado), que ainda nem chegou.
        const today = todayISO();
        setActiveCompareDay(
          res.days.some((d) => d.date === today) ? today : lastDate(res.days)
        );

        const logs =
          res.start && res.end
            ? await api.getDailyLogRange(res.start, res.end).catch(() => [])
            : await api
                .getDailyLogHistory(comparePeriod === "week" ? 7 : 30)
                .catch(() => []);

        if (!cancelled) setCompareLogs(logs);
      })
      .catch(() => {
        if (cancelled) return;
        setCompareTaskInsights(null);
        setCompareLogs([]);
      });

    return () => {
      cancelled = true;
    };
  }, [comparePeriod, compareOffset]);

  // Permite comparar até duas séries ao mesmo tempo no gráfico final.
  function toggleSeries(key: SeriesKey) {
    setActive((cur) =>
      cur.includes(key)
        ? cur.filter((k) => k !== key)
        : cur.length < 2
        ? [...cur, key]
        : cur
    );
  }

  // Une por data. days do insights/tasks é a espinha (sempre 7 ou 30 dias).
  // Usa compareTaskInsights (período próprio do card de comparação), não
  // taskInsights (período do card "Tarefas concluídas") — mantém os dois
  // gráficos independentes.
  const chartData = useMemo(() => {
    const byDate = new Map(compareLogs.map((l) => [l.date, l]));
    const today = todayISO();

    return (compareTaskInsights?.days ?? []).map((d) => {
      const log = byDate.get(d.date);
      // A semana do calendário inclui dias que ainda não aconteceram: neles a
      // % de conclusão é 0 por definição e derrubaria a linha até o eixo.
      const isFuture = d.date > today;
      const humor = log?.mood_rating ?? null;
      const prod = log?.productivity_rating ?? null;
      const qualidade = log?.sleep_rating ?? null;
      const [, mm, dd] = d.date.split("-");
      return {
        date: d.date,
        label: d.weekday,
        // dia + data completa: no modo mês há vários "Seg" na mesma janela,
        // então o weekday sozinho é ambíguo no tooltip (a data ISO é única).
        tooltipLabel: `${d.weekday}, ${dd}/${mm}`,
        // Dia já vivido sem registro entra como zero: a linha continua em vez
        // de abrir um buraco. Dia futuro segue nulo — não é campo vazio, é
        // campo que ainda não existe (senão o mês inteiro à frente de hoje
        // viraria uma linha reta no zero).
        tarefas: isFuture ? null : d.completion_rate,
        sono: isFuture ? null : log?.hours_slept ?? 0,
        qualidade: isFuture ? null : qualidade ?? 0,
        humor: isFuture ? null : humor ?? 0,
        prod: isFuture ? null : prod ?? 0,
      };
    });
  }, [compareTaskInsights, compareLogs]);

  const taskDays = taskInsights?.days ?? [];
  // Maior volume de tarefas no período — escala as barras por volume real.
  const maxTaskTotal = Math.max(1, ...taskDays.map((d) => d.total));

  // Rótulo da semana derivado dos próprios dias retornados — e não de
  // `start`/`end` da resposta. Assim o card não quebra quando o backend em
  // execução ainda é uma versão que não manda esses campos.
  const weekLabel = taskDays.length
    ? formatWeekRange(taskDays[0].date, taskDays[taskDays.length - 1].date)
    : "—";

  const monthList = taskMonths?.months ?? [];
  const maxMonthTotal = Math.max(1, ...monthList.map((m) => m.total));

  // Navegação do card de tarefas. dir = -1 volta no tempo, +1 avança.
  const currentYear = new Date().getFullYear();
  const canGoBack =
    taskPeriod === "week"
      ? taskWeekOffset < MAX_WEEK_OFFSET
      : taskYear > currentYear - MAX_YEARS_BACK;
  const canGoForward =
    taskPeriod === "week" ? taskWeekOffset > 0 : taskYear < currentYear;

  function shiftTaskWindow(dir: -1 | 1) {
    if (dir === -1 ? !canGoBack : !canGoForward) return;

    if (taskPeriod === "week") {
      // offset cresce para o passado, por isso o sinal invertido.
      setTaskWeekOffset((o) => Math.min(MAX_WEEK_OFFSET, Math.max(0, o - dir)));
    } else {
      setTaskYear((y) =>
        Math.min(currentYear, Math.max(currentYear - MAX_YEARS_BACK, y + dir))
      );
    }
  }

  // Arrasto horizontal sobre o gráfico troca de semana/ano (no celular é o
  // gesto natural; as setas continuam para quem usa mouse ou teclado).
  const swipeStartX = useRef<number | null>(null);

  // Devolve os handlers de arrasto para um gráfico específico.
  function swipeHandlers(shift: (dir: -1 | 1) => void) {
    return {
      onTouchStart: (e: React.TouchEvent) => {
        swipeStartX.current = e.touches[0].clientX;
      },
      onTouchEnd: (e: React.TouchEvent) => {
        const from = swipeStartX.current;
        swipeStartX.current = null;
        if (from == null) return;

        const dx = e.changedTouches[0].clientX - from;
        if (Math.abs(dx) < SWIPE_THRESHOLD) return;

        // Arrastar para a direita revela o que veio antes.
        shift(dx > 0 ? -1 : 1);
      },
    };
  }

  // Só as escalas das métricas selecionadas aparecem: com "Humor" e
  // "Produtividade" juntos, por exemplo, existe um eixo só (notas de 1 a 5).
  const activeScales = SCALE_ORDER.filter((sc) =>
    SERIES.some((s) => active.includes(s.key) && s.scale === sc)
  );
  const leftScale = activeScales[0] ?? null;
  const rightScale = activeScales[1] ?? null;

  // No mês o intervalo é sempre o mês inteiro, então o nome dele já diz tudo
  // ("Agosto" em vez de "1 – 31 de ago"). Ano só aparece quando não é o atual.
  const compareLabel =
    compareTaskInsights?.start && compareTaskInsights?.end
      ? comparePeriod === "month"
        ? formatMonthLabel(compareTaskInsights.start)
        : formatWeekRange(compareTaskInsights.start, compareTaskInsights.end)
      : "—";

  function shiftCompareWindow(dir: -1 | 1) {
    setCompareOffset((o) => Math.min(MAX_WEEK_OFFSET, Math.max(0, o - dir)));
  }

  const patternList = patterns?.insights ?? [];
  const currentPattern = patternList[patternIdx] ?? null;

  // Cronotipo usado para contextualizar sono, foco e sidebar.
  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, []);

  const result = results[resultKey];

  // Os 7 dias da semana exibida, com ou sem registro — dias vazios entram
  // como `log: null` para o gráfico manter a coluna do dia.
  const sleepDays = useMemo(() => {
    if (!sleepWeek) return [];

    const byDate = new Map(sleepWeek.logs.map((l) => [l.date, l]));

    return weekDates(sleepWeek.start).map((d) => ({
      ...d,
      log: byDate.get(d.date) ?? null,
    }));
  }, [sleepWeek]);

  const sleepWeekLabel = sleepWeek
    ? formatWeekRange(sleepWeek.start, sleepWeek.end)
    : "—";

  function shiftSleepWindow(dir: -1 | 1) {
    setSleepWeekOffset((o) =>
      Math.min(MAX_WEEK_OFFSET, Math.max(0, o - dir))
    );
  }

  // Cálculos derivados do sono registrado na semana exibida.
  const sleepTarget =
    SLEEP_TARGET_BY_CHRONOTYPE[resultKey] ?? DEFAULT_SLEEP_TARGET;
  const sleptValues = sleepDays
    .map((d) => d.log?.hours_slept)
    .filter((h): h is number => h != null);
  const avgSleep = sleptValues.length
    ? sleptValues.reduce((a, b) => a + b, 0) / sleptValues.length
    : 0;
  const deficit = Math.max(0, sleepTarget - avgSleep);

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      {/* px-1 no telefone: os cartões encostam quase na borda, porque a
          margem externa era espaço morto. No desktop entra a mesma medida do
          Dashboard — coluna centrada de 1120px. */}
      <div className="relative z-10 mx-auto min-h-screen w-full max-w-[430px] space-y-4 px-1 pb-6 pt-5 lg:max-w-[1120px] lg:space-y-5 lg:px-8 lg:pt-7">
        <PageHeader
          title="Insights"
          subtitle="Padrões do seu ritmo"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        {/* ============================================================
            O QUE O AXON DESCOBRIU — carrossel de padrões
            ============================================================ */}
        <section className={CARD}>
          <div className="mb-4 flex items-start gap-3 px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft">
              <img
                src="/axon-logo.svg"
                alt="Axon"
                className="h-5 w-5 object-contain"
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-primary">
                O que o Axon descobriu
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                O Axon analisa e compara seus dados para descobrir padrões que
                podem passar despercebidos.
              </p>
            </div>

            {patterns?.status === "ready" &&
              formatUpdatedBadge(patterns.generated_at) && (
                <span className="shrink-0 rounded-full border border-soft bg-surface-muted px-2.5 py-1 text-[0.6rem] font-medium text-muted">
                  {formatUpdatedBadge(patterns.generated_at)}
                </span>
              )}
          </div>

          {/* Mascote: âncora visual do card, igual ao mockup. */}
          <div className="relative mb-4 flex h-28 items-center justify-center">
            <div className="absolute h-24 w-24 rounded-full bg-accent-soft blur-2xl" />
            <img
              src={axonHeadHappy}
              alt="Axon"
              className="relative z-10 h-24 w-auto object-contain drop-shadow-[0_18px_36px_rgba(45,8,80,0.16)] dark:drop-shadow-[0_20px_40px_rgba(0,0,0,0.4)]"
            />
          </div>

          {loadingPatterns ? (
            <div className="h-28 animate-pulse rounded-[1.4rem] border border-soft bg-surface-muted" />
          ) : patterns?.status === "collecting" ? (
            <div className="rounded-[1.4rem] border border-soft bg-surface-muted p-4">
              <p className="text-center text-sm font-semibold leading-6 text-primary">
                Descubra o que afeta a sua produtividade
              </p>
              <p className="mt-1.5 text-center text-xs leading-5 text-secondary">
                Com {patterns.days_needed ?? 7} registros o Axon começa a cruzar
                seu sono, humor e energia com as tarefas que você conclui — e te
                mostra os padrões que você não percebe sozinho.
              </p>

              {/* Contagem regressiva vinda do backend (única fonte do "faltam X"). */}
              {patterns.message && (
                <p className="mt-2 text-center text-xs leading-5 text-accent">
                  {patterns.message}
                </p>
              )}

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-[0.68rem] text-muted">
                  <span>Progresso</span>
                  <span>
                    {patterns.data_points ?? 0}/{patterns.days_needed ?? 7}{" "}
                    registros
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--border-soft)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-400"
                    style={{
                      width: `${Math.min(
                        100,
                        ((patterns.data_points ?? 0) /
                          (patterns.days_needed ?? 7)) *
                          100
                      )}%`,
                    }}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setReviewOpen(true)}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent-strong)] px-4 text-xs font-semibold text-white shadow-card transition active:scale-[0.98]"
              >
                <NotebookPen className="h-3.5 w-3.5" />
                {todayLog
                  ? "Editar registro de hoje"
                  : "Registrar meu dia agora"}
              </button>
            </div>
          ) : currentPattern ? (
            <>
              {/* Carrossel: um padrão por vez, setas nas laterais. */}
              <div className="flex items-stretch gap-2">
                <CarouselArrow
                  direction="prev"
                  disabled={patternList.length < 2}
                  onClick={() =>
                    setPatternIdx(
                      (i) => (i - 1 + patternList.length) % patternList.length
                    )
                  }
                />

                <div className="flex min-h-[7.5rem] flex-1 flex-col justify-center rounded-[1.4rem] border border-soft bg-surface-muted p-4">
                  <div className="mb-2 flex items-center gap-2.5">
                    {(() => {
                      const style =
                        TYPE_STYLE[currentPattern.type] ?? TYPE_STYLE.general;
                      const Icon = style.icon;
                      return (
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            backgroundColor: `${style.color}1f`,
                            color: style.color,
                          }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      );
                    })()}
                    <p className="text-sm font-semibold leading-5 text-primary">
                      {currentPattern.title}
                    </p>
                  </div>

                  <p className="text-xs leading-6 text-muted">
                    {currentPattern.detail}
                  </p>
                </div>

                <CarouselArrow
                  direction="next"
                  disabled={patternList.length < 2}
                  onClick={() =>
                    setPatternIdx((i) => (i + 1) % patternList.length)
                  }
                />
              </div>

              {patternList.length > 1 && (
                <div className="mt-3 flex items-center justify-center gap-1.5">
                  {patternList.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPatternIdx(i)}
                      aria-label={`Ver padrão ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all ${
                        i === patternIdx
                          ? "w-5 bg-[var(--accent-strong)]"
                          : "w-1.5 bg-[var(--border-medium)]"
                      }`}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-[1.4rem] border border-soft bg-surface-muted p-5 text-center">
              <p className="text-sm leading-6 text-muted">
                {patterns?.message ??
                  "Os insights do Axon aparecerão aqui conforme você registra seus dias."}
              </p>
            </div>
          )}

          {patterns?.status === "ready" && (
            <button
              type="button"
              onClick={() => {
                setLoadingPatterns(true);
                api
                  .getPatternInsights(true)
                  .then((res) => {
                    setPatterns(res);
                    setPatternIdx(0);
                  })
                  .catch(() => {})
                  .finally(() => setLoadingPatterns(false));
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-full px-2 text-xs font-semibold text-accent/80 active:scale-[0.98]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar insights
            </button>
          )}
        </section>

        {/* Duas colunas independentes no desktop. Num grid de LINHAS a linha
            inteira tem a altura do cartão mais alto, e o mais baixo fica com
            um vão até o fim dela — era o buraco entre "Dia registrado" e
            "Tarefas concluídas". Empilhando por coluna, cada cartão começa
            logo depois do anterior, então o espaçamento é o mesmo em toda a
            página. No telefone as duas colunas viram uma pilha só. */}
        {/* No telefone os wrappers de coluna somem (`display: contents`) e os
            cartões viram filhos diretos desta pilha flex — aí o `order` de
            cada um define a ordem no celular. No desktop os wrappers voltam a
            ser caixas e empilham a própria coluna, ignorando o `order`. É o
            que permite ordens diferentes nas duas telas sem duplicar nada. */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">
          {/* Coluna esquerda */}
          <div className="contents lg:block lg:space-y-5">
              {/* ============================================================
                REGISTRO DIÁRIO — alimenta toda a análise abaixo
                ============================================================ */}
            <section className="order-1 rounded-[1.75rem] border border-accent-soft bg-accent-soft p-4 shadow-card backdrop-blur-2xl">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-accent">
                  {todayLog ? (
                    <CheckCircle2 className="h-6 w-6" />
                  ) : (
                    <Moon className="h-6 w-6" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary">
                    {todayLog ? "Dia registrado" : "Como foi seu dia?"}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-muted">
                    {todayLog ? (
                      "Toque para revisar ou ajustar o registro de hoje."
                    ) : (
                      <>
                        Conte para o Axon como foi seu dia, para que ele possa
                        entender seus padrões.{" "}
                        <span className="font-semibold text-secondary">
                          Leva menos de 1 minuto
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  className="min-h-11 shrink-0 rounded-2xl border border-accent-soft bg-surface-elevated px-4 text-xs font-semibold text-accent shadow-card transition active:scale-[0.97]"
                >
                  {todayLog ? "Editar dia" : "Registrar dia"}
                </button>
              </div>
            </section>

            {/* ============================================================
                TAREFAS CONCLUÍDAS
                ============================================================ */}
            <section className={`${CARD} order-3`}>
              <div className="mb-4 flex items-start justify-between gap-3 px-2">
                <div>
                  <p className="text-sm font-semibold text-primary">
                    Tarefas concluídas
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {taskPeriod === "week"
                      ? formatWeekSubtitle(taskWeekOffset)
                      : "Mês a mês"}
                  </p>
                </div>

                <PeriodToggle value={taskPeriod} onChange={setTaskPeriod} />
              </div>

              {/* Navegação da janela: setas + arrasto sobre o gráfico. */}
              <WindowNav
                label={taskPeriod === "week" ? weekLabel : String(taskYear)}
                emphasis={taskPeriod === "month"}
                canPrev={canGoBack}
                canNext={canGoForward}
                onPrev={() => shiftTaskWindow(-1)}
                onNext={() => shiftTaskWindow(1)}
              />

              {taskPeriod === "week" ? (
                <>
                  <DayStrip
                    days={taskDays}
                    activeDate={activeTaskDay}
                    onSelect={(date) => {
                      setActiveTaskDay(date);
                      setTaskTipOpen(true);
                    }}
                  />

                  <div
                    className={`${CHART_BOX} h-64 touch-pan-y`}
                    {...swipeHandlers(shiftTaskWindow)}
                  >
                    {loadingTasks ? (
                      <ChartLoading />
                    ) : taskDays.length === 0 ? (
                      <ChartEmpty text="Conclua tarefas no Planejamento para ver seus padrões aqui." />
                    ) : (
                      <div className="flex h-full items-end gap-1.5">
                        {taskDays.map((d) => {
                          const isActive = activeTaskDay === d.date;
                          // Dias ainda por vir da semana atual: aparecem só como
                          // cápsula do volume planejado, sem preenchimento.
                          const isFuture = d.date > todayISO();

                          return (
                            <TaskBar
                              key={d.date}
                              label={d.weekday.charAt(0)}
                              trackPercent={(d.total / maxTaskTotal) * 100}
                              fillPercent={
                                d.total ? (d.completed / d.total) * 100 : 0
                              }
                              isActive={isActive}
                              isMuted={isFuture}
                              width="1.9rem"
                              showTip={isActive && taskTipOpen && d.total > 0}
                              tipTitle={`${d.completed}/${d.total} concluídas`}
                              tipSubtitle={`${d.completion_rate}% do dia`}
                              onClick={() => {
                                // Tocar de novo na barra ativa fecha a caixinha.
                                if (isActive && taskTipOpen) {
                                  setTaskTipOpen(false);
                                  return;
                                }
                                setActiveTaskDay(d.date);
                                setTaskTipOpen(true);
                              }}
                              ariaLabel={`${d.weekday}: ${d.completed} de ${d.total} tarefas concluídas, ${d.completion_rate}%`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div
                    className={`${CHART_BOX} h-64 touch-pan-y`}
                    {...swipeHandlers(shiftTaskWindow)}
                  >
                    {loadingMonths ? (
                      <ChartLoading />
                    ) : monthList.length === 0 ? (
                      <ChartEmpty text="Não foi possível carregar os meses deste ano." />
                    ) : (
                      <div className="flex h-full items-end gap-1">
                        {monthList.map((m) => {
                          const isActive = activeMonth === m.month;

                          return (
                            <TaskBar
                              key={m.month}
                              label={m.label.charAt(0)}
                              trackPercent={(m.total / maxMonthTotal) * 100}
                              fillPercent={m.completion_rate}
                              isActive={isActive}
                              isMuted={m.total === 0}
                              width="1.5rem"
                              showTip={isActive && taskTipOpen && m.total > 0}
                              tipTitle={`${m.completed}/${m.total} concluídas`}
                              tipSubtitle={`${m.completion_rate}% do mês`}
                              onClick={() => {
                                if (isActive && taskTipOpen) {
                                  setTaskTipOpen(false);
                                  return;
                                }
                                setActiveMonth(m.month);
                                setTaskTipOpen(true);
                              }}
                              ariaLabel={`${m.label}: ${m.completed} de ${m.total} tarefas concluídas, ${m.completion_rate}%`}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            {/* ============================================================
                COMPARAR MÉTRICAS
                ============================================================ */}
            <section className={`${CARD} order-5`}>
              <div className="mb-4 flex items-start justify-between gap-3 px-2">
                <div>
                  <p className="text-sm font-semibold text-primary">
                    Compare métricas
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Compare 2 indicadores diferentes
                  </p>
                </div>

                <PeriodToggle
                  value={comparePeriod}
                  onChange={(v) => {
                    setComparePeriod(v);
                    setCompareOffset(0);
                  }}
                />
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {SERIES.map((s) => {
                  const on = active.includes(s.key);
                  const blocked = !on && active.length >= 2;
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => toggleSeries(s.key)}
                      disabled={blocked}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        on
                          ? "border-accent-soft bg-accent-soft text-accent"
                          : "border-soft bg-surface-muted text-muted"
                      } ${blocked ? "opacity-30" : "active:scale-[0.97]"}`}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: on ? s.color : "var(--text-soft)",
                        }}
                      />
                      {s.label}
                    </button>
                  );
                })}
              </div>

              {chartData.length === 0 ? (
                <div className="flex flex-col items-center rounded-[1.4rem] border border-dashed border-soft bg-surface-muted px-5 py-8 text-center">
                  <p className="text-sm font-semibold text-primary">
                    Ainda sem dados para comparar
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Use o registro diário e conclua tarefas por alguns dias para
                    liberar as comparações.
                  </p>
                </div>
              ) : (
                <>
                  <WindowNav
                    label={compareLabel}
                    canPrev={compareOffset < MAX_WEEK_OFFSET}
                    canNext={compareOffset > 0}
                    onPrev={() => shiftCompareWindow(-1)}
                    onNext={() => shiftCompareWindow(1)}
                  />

                  {comparePeriod === "week" && (
                    <DayStrip
                      days={chartData.map((d) => ({
                        date: d.date,
                        weekday: d.label,
                      }))}
                      activeDate={activeCompareDay}
                      onSelect={setActiveCompareDay}
                    />
                  )}

                  <div
                    className={`${CHART_BOX_AXES} h-64 touch-pan-y`}
                    {...swipeHandlers(shiftCompareWindow)}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={chartData}
                        // Sem margem lateral: quem reserva o espaço dos
                        // rótulos é a largura de cada eixo, logo abaixo.
                        margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
                        onClick={(e) => {
                          const date = e?.activeLabel;
                          if (typeof date === "string") setActiveCompareDay(date);
                        }}
                      >
                        <CartesianGrid
                          vertical={false}
                          stroke="var(--border-soft)"
                        />
                        <XAxis
                          dataKey="date"
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(date: string) => {
                            const row = chartData.find((d) => d.date === date);
                            if (!row) return "";
                            // No mês: só o número do dia, sem zero à esquerda
                            // (1, 2, … 31) — são 31 rótulos lado a lado.
                            return comparePeriod === "week"
                              ? row.label.charAt(0)
                              : String(Number(date.slice(8, 10)));
                          }}
                          // interval 0 = todos os dias rotulados, cada número sob
                          // o seu ponto. No mês são 30 rótulos, daí a fonte menor.
                          interval={0}
                          tick={{
                            fill: "var(--text-muted)",
                            fontSize: comparePeriod === "week" ? 11 : 7,
                          }}
                          tickMargin={6}
                          // Folga mínima nas pontas: o primeiro e o último ponto
                          // não encostam nos rótulos dos eixos, e o vão entre os
                          // dias continua igual do começo ao fim.
                          padding={{ left: 6, right: 6 }}
                        />
                        {/* Um eixo por escala em uso. A largura é a justa para o
                            texto (o padrão do recharts é 60px), o que cola os
                            rótulos nas bordas do cartão. */}
                        {leftScale && (
                          <YAxis
                            yAxisId={leftScale}
                            orientation="left"
                            domain={SCALES[leftScale].domain}
                            ticks={SCALES[leftScale].ticks}
                            tickFormatter={SCALES[leftScale].format}
                            width={SCALES[leftScale].width}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={2}
                            tick={{ fill: "var(--text-soft)", fontSize: 10 }}
                          />
                        )}
                        {rightScale && (
                          <YAxis
                            yAxisId={rightScale}
                            orientation="right"
                            domain={SCALES[rightScale].domain}
                            ticks={SCALES[rightScale].ticks}
                            tickFormatter={SCALES[rightScale].format}
                            width={SCALES[rightScale].width}
                            axisLine={false}
                            tickLine={false}
                            tickMargin={2}
                            tick={{ fill: "var(--text-soft)", fontSize: 10 }}
                          />
                        )}
                        <Tooltip content={<CustomTooltip />} cursor={false} />

                        {activeCompareDay && leftScale && (
                          <ReferenceLine
                            yAxisId={leftScale}
                            x={activeCompareDay}
                            stroke="var(--accent)"
                            strokeDasharray="3 3"
                          />
                        )}

                        {/* Cada linha é plotada no eixo da sua própria escala. */}
                        {SERIES.filter((serie) => active.includes(serie.key)).map(
                          (serie) => (
                            <Line
                              key={serie.key}
                              yAxisId={serie.scale}
                              type="monotone"
                              dataKey={serie.dataKey}
                              name={serie.label}
                              stroke={serie.color}
                              strokeWidth={2.5}
                              dot={{ r: 4, fill: serie.color, strokeWidth: 0 }}
                              activeDot={{ r: 6 }}
                              connectNulls={false}
                            />
                          )
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </section>
          </div>

          {/* Coluna direita */}
          <div className="contents lg:block lg:space-y-5">
            {/* ============================================================
                BLOCOS DE FOCO — barra 24h; legenda atrás do botão de info
                ============================================================ */}
            <section className={`${CARD} order-2`}>
                <div className="mb-4 flex items-start justify-between gap-3 px-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-primary">
                      Blocos de foco
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Seu mapa de foco 24 horas por dia
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setBlocksInfoOpen((v) => !v)}
                    aria-label="Sobre os blocos de foco"
                    aria-expanded={blocksInfoOpen}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition active:scale-[0.96] ${
                      blocksInfoOpen
                        ? "border-accent-soft bg-accent-soft text-accent"
                        : "border-soft bg-surface-muted text-muted"
                    }`}
                  >
                    <Info className="h-4 w-4" />
                  </button>
                </div>

                {/* Barra visual 24h */}
                <div className="flex h-9 w-full overflow-hidden rounded-full border border-soft">
                  {focusBlocks.map((block) => (
                    <div
                      key={block.idx}
                      className={`h-full flex-1 ${
                        (LEVEL_STYLE[block.level] ?? LEVEL_STYLE.sono).bar
                      }`}
                      title={`${block.start_time} ${block.label}`}
                    />
                  ))}
                </div>

                <div className="mt-2 flex justify-between px-1 text-[0.6rem] text-soft">
                  <span>00h</span>
                  <span>06h</span>
                  <span>12h</span>
                  <span>18h</span>
                  <span>24h</span>
                </div>

                {/* Legenda + calibração: só quando o usuário pede. */}
                {blocksInfoOpen && (
                  <div className="mt-4 rounded-[1.4rem] border border-soft bg-surface-muted p-4">
                    <div className="flex flex-wrap gap-2">
                      {LEVEL_ORDER.map(({ level, label }) => (
                        <span
                          key={level}
                          className="flex items-center gap-1.5 rounded-full border border-soft bg-surface-elevated px-2.5 py-1 text-[0.65rem] font-medium text-secondary"
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${LEVEL_STYLE[level].bar}`}
                          />
                          {label}
                        </span>
                      ))}
                    </div>

                    {blocksCalibrated ? (
                      <div className="mt-3 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        <span className="text-[0.65rem] font-medium text-emerald-700 dark:text-emerald-300/80">
                          Perfil personalizado · {blocksDataPoints} dias de dados
                        </span>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          <span className="text-[0.65rem] font-medium text-muted">
                            Perfil base · {blocksDataPoints}/{blocksMinPoints} dias
                            para personalização
                          </span>
                        </div>
                        <div className="h-1 w-28 overflow-hidden rounded-full bg-[var(--border-soft)]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-purple-400 transition-all"
                            style={{
                              width: `${Math.min(
                                100,
                                (blocksDataPoints / blocksMinPoints) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setBlocksListExpanded((v) => !v);
                    if (blocksListExpanded) setExpandedBlockIdx(null);
                  }}
                  className="mt-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-soft bg-surface-muted px-4 text-xs font-semibold text-muted transition active:scale-[0.98]"
                >
                  {blocksListExpanded ? "Recolher blocos" : "Ver todos os blocos"}
                </button>

                {/* Lista detalhada — apenas quando expandido */}
                {blocksListExpanded && (
                  <div className="mt-3 space-y-1.5">
                    {focusBlocks.map((block) => {
                      const style = LEVEL_STYLE[block.level] ?? LEVEL_STYLE.sono;
                      const isExpanded = expandedBlockIdx === block.idx;
                      const now = new Date();
                      const currentMinutes = now.getHours() * 60 + now.getMinutes();
                      const blockStart = block.idx * 90;
                      const blockEnd = blockStart + 90;
                      const isCurrent =
                        currentMinutes >= blockStart && currentMinutes < blockEnd;

                      return (
                        <div key={block.idx}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedBlockIdx(isExpanded ? null : block.idx)
                            }
                            className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
                              isCurrent
                                ? "border-accent-soft bg-accent-soft"
                                : "border-[var(--border-soft)] bg-surface-muted"
                            }`}
                          >
                            <span
                              className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.bar}`}
                            />
                            <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-muted">
                              {block.start_time}
                            </span>
                            <span
                              className={`flex-1 truncate text-xs font-semibold ${style.text}`}
                            >
                              {block.label}
                              {isCurrent && (
                                <span className="ml-2 text-[0.6rem] font-medium text-accent">
                                  agora
                                </span>
                              )}
                            </span>
                            <span className="text-[0.6rem] text-soft">
                              {isExpanded ? "▲" : "▼"}
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="mx-1 rounded-b-2xl border border-t-0 border-[var(--border-soft)] bg-surface-muted px-4 py-3">
                              <p className="text-xs leading-5 text-muted">
                                {block.description}
                              </p>
                              <div className="mt-2 flex gap-3 text-[0.65rem] text-muted">
                                <span>Energia: {block.energy}%</span>
                                <span>Foco: {block.focus}%</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
            </section>

            {/* ============================================================
                HORAS DE SONO
                ============================================================ */}
            <section className={`${CARD} order-4`}>
              <div className="mb-4 flex items-start justify-between gap-3 px-2">
                <div>
                  <p className="text-sm font-semibold text-primary">Horas de sono</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatWeekSubtitle(sleepWeekOffset)}
                  </p>
                </div>
                <Moon className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
              </div>

              {/* Navegação por semanas — sem alternador de período: o card de
                  sono é sempre semanal. */}
              <WindowNav
                label={sleepWeekLabel}
                canPrev={sleepWeekOffset < MAX_WEEK_OFFSET}
                canNext={sleepWeekOffset > 0}
                onPrev={() => shiftSleepWindow(-1)}
                onNext={() => shiftSleepWindow(1)}
              />

              <DayStrip
                days={sleepDays}
                activeDate={activeSleepDay}
                onSelect={(date) => {
                  setActiveSleepDay(date);
                  setSleepTipOpen(true);
                }}
              />

              <div
                className={`${CHART_BOX} h-56 touch-pan-y`}
                {...swipeHandlers(shiftSleepWindow)}
              >
                {loadingSleep ? (
                  <ChartLoading />
                ) : sleepDays.length === 0 ? (
                  <ChartEmpty text="Não foi possível carregar esta semana." />
                ) : (
                  <div className="relative h-full">
                    {/* Linhas-guia de 4h e 8h, com o rótulo à direita. Ficam presas
                        à faixa das barras (por isso o recuo inferior de 1.75rem =
                        h-5 do rótulo do dia + gap-2), senão a linha de 8h não
                        bateria com uma barra de 8h. */}
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0"
                      style={{ bottom: SLEEP_LABEL_BAND }}
                    >
                      {SLEEP_GUIDES.map((h) => (
                        <div
                          key={h}
                          className="absolute inset-x-0 flex items-center"
                          style={{ bottom: `${(h / SLEEP_SCALE) * 100}%` }}
                        >
                          <div className="h-px flex-1 bg-[var(--border-soft)]" />
                          <span className="ml-2 w-6 text-[0.65rem] text-soft">
                            {h}h
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="flex h-full items-end gap-2 pr-8">
                      {sleepDays.map((d) => {
                        const hours = d.log?.hours_slept ?? null;
                        const isActive = activeSleepDay === d.date;
                        const barPercent =
                          hours != null
                            ? Math.min(100, (hours / SLEEP_SCALE) * 100)
                            : 0;

                        return (
                          <button
                            key={d.date}
                            type="button"
                            onClick={() => {
                              if (isActive && sleepTipOpen) {
                                setSleepTipOpen(false);
                                return;
                              }
                              setActiveSleepDay(d.date);
                              setSleepTipOpen(true);
                            }}
                            className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                            aria-label={
                              hours != null
                                ? `${d.weekday}: ${hours} horas de sono`
                                : `${d.weekday}: sem registro`
                            }
                          >
                            <div className="relative flex w-full flex-1 items-end justify-center">
                              {isActive && sleepTipOpen && hours != null && (
                                <BarTip
                                  title={`~${hours}h dormidas`}
                                  subtitle={
                                    d.log?.sleep_rating
                                      ? `Qualidade ${d.log.sleep_rating}/5`
                                      : "Sem nota de qualidade"
                                  }
                                  bottomPercent={barPercent}
                                />
                              )}

                              {/* Dia sem registro não desenha barra nenhuma. */}
                              {hours != null && (
                                <div
                                  className={`w-full max-w-[1.9rem] rounded-full bg-gradient-to-t transition-all ${
                                    isActive
                                      ? "from-purple-600 to-fuchsia-400 ring-2 ring-[var(--text-primary)]"
                                      : "from-purple-700 to-purple-400 opacity-90 dark:opacity-80"
                                  }`}
                                  style={{ height: `${barPercent}%` }}
                                />
                              )}
                            </div>

                            <span
                              className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.6rem] font-semibold transition ${
                                isActive
                                  ? "bg-[var(--accent-strong)] text-white"
                                  : "text-muted"
                              }`}
                            >
                              {d.weekday.charAt(0)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <SleepStat
                  label="Média"
                  value={sleptValues.length ? `~${avgSleep.toFixed(1)}h` : "—"}
                  accent
                />
                <SleepStat label="Meta" value={`${sleepTarget}h`} />
                <SleepStat
                  label="Déficit"
                  value={
                    sleptValues.length && deficit > 0
                      ? `~${deficit.toFixed(1)}h`
                      : "—"
                  }
                />
              </div>

              {/* Só para quem ainda não registrou nada nesta semana. */}
              {!loadingSleep && sleptValues.length === 0 && (
                <p className="mt-3 px-2 text-center text-[0.68rem] leading-5 text-muted">
                  Preencha o registro diário para ver seu padrão de sono aqui.
                </p>
              )}
            </section>

            {/* ============================================================
                ROTINAS DESTA SEMANA
                ============================================================ */}
            {/* Sempre renderizado: sumir por completo quando a lista vem vazia
                (rotina pausada, ou o /dashboard falhando) deixava um buraco no
                par de cartões e parecia bug. */}
            <section className={`${CARD} order-6`}>
                <div className="mb-4 flex items-start justify-between gap-3 px-2">
                  <div>
                    <p className="text-sm font-semibold text-primary">
                      Rotinas desta semana
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Consistência nos últimos 7 dias
                    </p>
                  </div>
                  <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                </div>

                {/* Lista de texto puro (sem caixa própria): mantém o recuo do
                    cabeçalho para não colar na borda do cartão. */}
                {routineConsistency.length === 0 ? (
                  <p className="px-2 pb-2 text-xs leading-5 text-muted">
                    Nenhuma rotina ativa nesta semana. Crie uma em Rotinas para
                    acompanhar a consistência por aqui.
                  </p>
                ) : (
                <div className="space-y-3 px-2 pb-1">
                  {[...routineConsistency]
                    .sort((a, b) => b.percent - a.percent)
                    .map((routine) => {
                      const fillColor =
                        routine.percent >= 80
                          ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                          : routine.percent >= 50
                          ? "bg-gradient-to-r from-amber-500 to-amber-400"
                          : "bg-gradient-to-r from-rose-500 to-rose-400";

                      return (
                        <div key={routine.routine_id}>
                          <div className="mb-1.5 flex items-center justify-between gap-3">
                            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">
                              {routine.name}
                            </p>
                            <p className="shrink-0 text-xs text-muted">
                              {routine.days_done} de {routine.days_total} dias
                            </p>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border-soft)]">
                              <div
                                className={`h-full rounded-full ${fillColor}`}
                                style={{ width: `${routine.percent}%` }}
                              />
                            </div>
                            <span className="shrink-0 text-xs font-semibold text-primary">
                              {routine.percent}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
                )}
            </section>
          </div>
        </div>
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
      />

      <DayReview
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
        existing={todayLog}
        onSaved={(log) => {
          setTodayLog(log);
          // O registro recém-salvo pode ter sido o que faltava para destravar
          // os padrões — sem reconsultar, o card ficaria em "coletando" até um
          // reload manual da página.
          api
            .getPatternInsights()
            .then((res) => {
              setPatterns(res);
              setPatternIdx(0);
            })
            .catch(() => {});
        }}
      />
    </main>
  );
}

// ===========================================================================
// CONTROLES REUTILIZADOS PELOS CARTÕES
// ===========================================================================

// Alternador de período no canto superior direito dos cartões de gráfico.
function PeriodToggle({
  value,
  onChange,
}: {
  value: "week" | "month";
  onChange: (v: "week" | "month") => void;
}) {
  return (
    <div className="flex shrink-0 rounded-full border border-soft bg-surface-muted p-1 text-xs">
      {(
        [
          { key: "week", label: "Dia/Semana" },
          { key: "month", label: "Mês" },
        ] as const
      ).map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-full px-3 py-1.5 font-semibold transition active:scale-[0.97] ${
            value === key
              ? "bg-gradient-to-r from-purple-600 to-fuchsia-500 text-white shadow-card"
              : "text-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Navegador da janela exibida (semana ou ano) — setas nas laterais e o
// rótulo do período no centro.
function WindowNav({
  label,
  emphasis = false,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  label: string;
  emphasis?: boolean;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mb-3 flex items-center justify-center gap-2">
      <NavArrow
        direction="prev"
        disabled={!canPrev}
        onClick={onPrev}
        ariaLabel="Período anterior"
      />

      <span
        className={
          emphasis
            ? "min-w-[7rem] text-center text-base font-semibold text-primary"
            : "min-w-[9rem] text-center text-xs font-semibold text-secondary"
        }
      >
        {label}
      </span>

      <NavArrow
        direction="next"
        disabled={!canNext}
        onClick={onNext}
        ariaLabel="Próximo período"
      />
    </div>
  );
}

function NavArrow({
  direction,
  disabled,
  onClick,
  ariaLabel,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-soft bg-surface-muted text-muted transition ${
        disabled ? "opacity-25" : "active:scale-[0.92]"
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

// Barra-cápsula do card de tarefas: a cápsula translúcida é o volume total
// (dia ou mês) e o roxo preenche de baixo a parte concluída. Usada nos dois
// modos para que trocar de visão não mude a leitura do gráfico.
function TaskBar({
  label,
  trackPercent,
  fillPercent,
  isActive,
  isMuted,
  width,
  showTip,
  tipTitle,
  tipSubtitle,
  onClick,
  ariaLabel,
}: {
  label: string;
  trackPercent: number;
  fillPercent: number;
  isActive: boolean;
  isMuted: boolean;
  width: string;
  showTip: boolean;
  tipTitle: string;
  tipSubtitle: string;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={isActive}
      className={`flex h-full flex-1 flex-col items-center justify-end gap-2 ${
        isMuted ? "opacity-60" : ""
      }`}
    >
      <div className="relative flex w-full flex-1 items-end justify-center">
        {/* Resumo flutuante logo acima da barra tocada. */}
        {showTip && (
          <BarTip
            title={tipTitle}
            subtitle={tipSubtitle}
            bottomPercent={trackPercent}
          />
        )}

        {/* Sem nenhuma tarefa no dia/mês não há barra — nem a cápsula vazia,
            que dava a impressão de um volume que não existiu. */}
        {trackPercent > 0 && (
          <div
            // O contorno usa --text-primary: branco no tema escuro e escuro no
            // claro, onde um branco chapado sumiria contra a caixa do gráfico.
            className={`relative overflow-hidden rounded-full bg-[var(--border-soft)] transition-all ${
              isActive ? "ring-2 ring-[var(--text-primary)]" : ""
            }`}
            style={{
              width,
              height: `${trackPercent}%`,
              minHeight: width,
            }}
          >
            <div
              className={`absolute inset-x-0 bottom-0 rounded-full bg-gradient-to-t transition-all ${
                isActive
                  ? "from-purple-600 to-fuchsia-400"
                  : "from-purple-900 to-purple-600 opacity-90 dark:opacity-80"
              }`}
              style={{ height: `${fillPercent}%` }}
            />
          </div>
        )}
      </div>

      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.6rem] font-semibold transition ${
          isActive ? "bg-[var(--accent-strong)] text-white" : "text-muted"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

// Caixinha de resumo que flutua logo acima da barra selecionada.
function BarTip({
  title,
  subtitle,
  bottomPercent,
}: {
  title: string;
  subtitle: string;
  bottomPercent: number;
}) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-xl border-2 border-[var(--text-primary)] bg-surface-elevated px-2.5 py-1.5 text-center shadow-card"
      style={{ bottom: `calc(${Math.min(bottomPercent, 100)}% + 0.4rem)` }}
    >
      <p className="text-[0.65rem] font-semibold text-primary">{title}</p>
      <p className="text-[0.6rem] text-muted">{subtitle}</p>
    </div>
  );
}

function ChartLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <p className="text-xs text-muted">Carregando...</p>
    </div>
  );
}

function ChartEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 text-center">
      <p className="text-xs leading-5 text-muted">{text}</p>
    </div>
  );
}

// Tira numerada acima dos gráficos: escolhe o dia em destaque. Substitui o
// hover (inexistente no celular) como forma de ler um dia específico.
function DayStrip({
  days,
  activeDate,
  onSelect,
}: {
  days: { date: string; weekday: string }[];
  activeDate: string | null;
  onSelect: (date: string) => void;
}) {
  if (days.length === 0) return null;

  return (
    <div className="custom-scrollbar mb-2 flex items-center gap-1 overflow-x-auto pb-1">
      {days.map((d) => {
        const on = d.date === activeDate;
        return (
          <button
            key={d.date}
            type="button"
            onClick={() => onSelect(d.date)}
            aria-label={`${d.weekday}, dia ${d.date.slice(8, 10)}`}
            aria-pressed={on}
            // A área de toque continua ocupando a coluna inteira; o destaque
            // fica num círculo interno de tamanho fixo, igual ao marcador do
            // dia da semana embaixo do gráfico. Antes o fundo acompanhava a
            // largura do botão e virava uma pílula esticada.
            className="flex h-7 min-w-7 flex-1 shrink-0 items-center justify-center"
          >
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold transition ${
                on
                  ? "bg-[var(--accent-strong)] text-white"
                  : "text-soft active:scale-[0.95]"
              }`}
            >
              {d.date.slice(8, 10)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Seta do carrossel de padrões do Axon.
function CarouselArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Padrão anterior" : "Próximo padrão"}
      className={`flex w-7 shrink-0 items-center justify-center rounded-2xl text-muted transition ${
        disabled ? "opacity-20" : "active:scale-[0.9]"
      }`}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

// Métrica compacta do rodapé do cartão de sono.
function SleepStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-soft bg-surface-muted px-2 py-2.5">
      <p className="text-[0.6rem] uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1 text-sm font-semibold ${
          accent ? "text-accent" : "text-primary"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

// ===========================================================================
// HELPERS DE FORMATAÇÃO
// ===========================================================================

const MONTH_FULL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const MONTH_ABBR = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

// Data local de hoje em ISO (YYYY-MM-DD). new Date().toISOString() daria a
// data em UTC — depois das 21h no Brasil isso já é o dia seguinte.
function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// "4 – 10 de ago" ou "28 de jul – 3 de ago" quando a semana vira o mês.
function formatWeekRange(startISO: string, endISO: string): string {
  const [, sm, sd] = startISO.split("-");
  const [, em, ed] = endISO.split("-");
  const startDay = Number(sd);
  const endDay = Number(ed);
  const startMonth = MONTH_ABBR[Number(sm) - 1];
  const endMonth = MONTH_ABBR[Number(em) - 1];

  return sm === em
    ? `${startDay} – ${endDay} de ${endMonth}`
    : `${startDay} de ${startMonth} – ${endDay} de ${endMonth}`;
}

// "Agosto" — com o ano junto quando a janela não é do ano corrente, senão
// voltar 8 meses viraria um "Dezembro" sem contexto.
function formatMonthLabel(startISO: string): string {
  const [year, month] = startISO.split("-");
  const name = MONTH_FULL[Number(month) - 1];

  return Number(year) === new Date().getFullYear()
    ? name
    : `${name} de ${year}`;
}

function formatWeekSubtitle(offset: number): string {
  if (offset === 0) return "Esta semana";
  if (offset === 1) return "Semana passada";
  return `${offset} semanas atrás`;
}

// Os 7 dias (dom→sáb) a partir da data inicial da semana.
function weekDates(startISO: string): { date: string; weekday: string }[] {
  const base = new Date(startISO + "T00:00:00");

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const iso = `${d.getFullYear()}-${mm}-${dd}`;
    return { date: iso, weekday: formatDayLabel(iso) };
  });
}

// Data do último item da janela (o dia mais recente) — é ele que entra
// pré-selecionado nos gráficos.
function lastDate(items: { date: string }[]): string | null {
  return items.length ? items[items.length - 1].date : null;
}

function formatDayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d.getDay()];
}

function formatUpdatedBadge(iso?: string): string | null {
  if (!iso) return null;
  const gen = new Date(iso);
  gen.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - gen.getTime()) / 86400000);
  if (diff <= 0) return "Atualizado hoje";
  if (diff === 1) return "Atualizado ontem";
  return `Atualizado há ${diff} dias`;
}

// ===========================================================================
// TOOLTIP DO GRÁFICO COMPARATIVO
// ===========================================================================

type TooltipRow = {
  tooltipLabel: string;
  tarefas: number | null;
  sono: number | null;
  qualidade: number | null;
  humor: number | null;
  prod: number | null;
};

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TooltipRow }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-xl border border-soft bg-surface-elevated px-3 py-2 text-xs text-primary shadow-card backdrop-blur-xl">
      <p className="mb-1 font-semibold text-secondary">{row.tooltipLabel}</p>
      {row.tarefas != null && (
        <Row color="#c084fc" text={`Tarefas: ${row.tarefas}%`} />
      )}
      {/* Zero nessas quatro só existe como "não registrou" — 0h de sono ou
          nota 0 não são valores possíveis no registro diário. */}
      {row.sono != null && (
        <Row
          color="#60a5fa"
          text={row.sono ? `Sono: ~${row.sono}h` : "Sono: sem registro"}
        />
      )}
      {row.qualidade != null && (
        <Row
          color="#f472b6"
          text={
            row.qualidade
              ? `Qualidade do sono: ${row.qualidade}/5`
              : "Qualidade do sono: sem registro"
          }
        />
      )}
      {row.humor != null && (
        <Row
          color="#34d399"
          text={row.humor ? `Humor: ${row.humor}/5` : "Humor: sem registro"}
        />
      )}
      {row.prod != null && (
        <Row
          color="#fbbf24"
          text={
            row.prod
              ? `Produtividade: ${row.prod}/5`
              : "Produtividade: sem registro"
          }
        />
      )}
    </div>
  );
}

function Row({ color, text }: { color: string; text: string }) {
  return (
    <p className="flex items-center gap-2 text-primary">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
      {text}
    </p>
  );
}
