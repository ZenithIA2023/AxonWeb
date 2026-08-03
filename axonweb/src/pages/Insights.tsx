import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Focus,
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

// ===========================================================================
// TIPOS E CONFIGURAÇÕES DOS GRÁFICOS
// ===========================================================================

type SeriesKey = "tarefas" | "sono" | "qualidade" | "humor" | "prod";

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "tarefas", label: "Tarefas %", color: "#c084fc" },
  { key: "sono", label: "Sono", color: "#60a5fa" },
  { key: "qualidade", label: "Qualidade do sono", color: "#f472b6" },
  { key: "humor", label: "Humor", color: "#34d399" },
  { key: "prod", label: "Produtividade", color: "#fbbf24" },
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

type PatternCardProps = {
  title: string;
  description: string;
  value: string;
  icon: React.ElementType;
};

// ===========================================================================
// CONFIGURAÇÕES DOS BLOCOS DE FOCO
// ===========================================================================

const LEVEL_COLOR: Record<string, { bar: string; text: string }> = {
  sono:          { bar: "#1e293b", text: "#475569" },
  recuperacao:   { bar: "#1e3a5f", text: "#60a5fa" },
  foco_leve:     { bar: "#713f12", text: "#fde68a" },
  foco_moderado: { bar: "#4c1d95", text: "#c084fc" },
  foco_profundo: { bar: "#6d28d9", text: "#a78bfa" },
  pico:          { bar: "#7c3aed", text: "#f0abfc" },
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
// Escala máxima do eixo de sono em horas.
const CHART_MAX = 12;

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
  // Dia do gráfico de tarefas em destaque: hover no desktop, clique no celular
  // (onde não existe hover). Guarda a data (chave estável), não o índice.
  const [activeTaskDay, setActiveTaskDay] = useState<string | null>(null);
  // Dados usados no gráfico comparativo.
  const [compareTaskInsights, setCompareTaskInsights] =
    useState<TaskInsights | null>(null);

  // Histórico de sono e registros diários.
  const [sleepHistory, setSleepHistory] = useState<api.DailyLog[]>([]);
  const [loadingSleep, setLoadingSleep] = useState(true);
  const [compareLogs, setCompareLogs] = useState<api.DailyLog[]>([]);
  const [active, setActive] = useState<SeriesKey[]>(["tarefas", "sono"]);
  // Insights de padrões gerados a partir dos registros do usuário.
  const [patterns, setPatterns] = useState<api.PatternInsightsResponse | null>(
    null
  );
  const [loadingPatterns, setLoadingPatterns] = useState(true);
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
  const [routineConsistency, setRoutineConsistency] = useState<api.RoutineConsistency[]>([]);

  // Carrega o registro diário atual para abrir/atualizar o DayReview.
  useEffect(() => {
    api
      .getDailyLogToday()
      .then(setTodayLog)
      .catch(() => setTodayLog(null));
  }, []);

  // Consistência de rotinas ativas na semana atual (card "Rotinas desta semana").
  useEffect(() => {
    api.getDashboard()
      .then((d) => setRoutineConsistency(d.routine_consistency ?? []))
      .catch(() => setRoutineConsistency([]));
  }, []);

  // Busca os blocos de foco personalizados.
  useEffect(() => {
    api.getFocusBlocks()
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
      .then(setPatterns)
      .catch(() => setPatterns(null))
      .finally(() => setLoadingPatterns(false));
  }, []);

  // Busca estatísticas de tarefas do card principal.
  useEffect(() => {
    setLoadingTasks(true);

    api
      .getTaskInsights(taskPeriod)
      .then(setTaskInsights)
      .catch(() => setTaskInsights(null))
      .finally(() => setLoadingTasks(false));
  }, [taskPeriod]);

  // Busca histórico recente de sono para o gráfico de horas dormidas.
  useEffect(() => {
    api
      .getDailyLogHistory(7)
      .then((logs) => setSleepHistory(logs.filter((l) => l.hours_slept != null)))
      .catch(() => setSleepHistory([]))
      .finally(() => setLoadingSleep(false));
  }, []);

  // O gráfico de comparação usa sua PRÓPRIA busca de tarefas (série "tarefas %"),
  // independente de taskInsights do card "Tarefas concluídas" — senão os dois
  // ficariam acoplados ao mesmo período.
  useEffect(() => {
    api
      .getTaskInsights(comparePeriod)
      .then(setCompareTaskInsights)
      .catch(() => setCompareTaskInsights(null));
  }, [comparePeriod]);

  // Busca registros diários no mesmo período usado no gráfico comparativo.
  useEffect(() => {
    const days = comparePeriod === "week" ? 7 : 30;

    api
      .getDailyLogHistory(days)
      .then(setCompareLogs)
      .catch(() => setCompareLogs([]));
  }, [comparePeriod]);

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
    return (compareTaskInsights?.days ?? []).map((d) => {
      const log = byDate.get(d.date);
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
        // valores reais (para o tooltip)
        tarefas: d.completion_rate,
        sono: log?.hours_slept ?? null,
        qualidade,
        humor,
        prod,
        // valores escalados p/ o eixo esquerdo 0–100 (notas ×20)
        qualidade_plot: qualidade != null ? qualidade * 20 : null,
        humor_plot: humor != null ? humor * 20 : null,
        prod_plot: prod != null ? prod * 20 : null,
      };
    });
  }, [compareTaskInsights, compareLogs]);

  // Maior volume de tarefas no período — escala as barras por volume real.
  const maxTaskTotal = Math.max(
    1,
    ...(taskInsights?.days ?? []).map((d) => d.total)
  );
  // Largura fixa das barras: garante arredondamento uniforme (raio = largura/2).
  const taskBarWidth = taskPeriod === "week" ? "1.5rem" : "0.5rem";

  // Cronotipo usado para contextualizar sono, foco e sidebar.
  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, []);

  const result = results[resultKey];

  // Cálculos derivados do sono registrado.
  const sleepTarget =
    SLEEP_TARGET_BY_CHRONOTYPE[resultKey] ?? DEFAULT_SLEEP_TARGET;
  const sleptValues = sleepHistory.map((l) => l.hours_slept as number);
  const avgSleep = sleptValues.length
    ? sleptValues.reduce((a, b) => a + b, 0) / sleptValues.length
    : 0;
  const deficit = Math.max(0, sleepTarget - avgSleep);

  const bestFocusLabel =
    resultKey === "Matutino"
      ? "manhã"
      : resultKey === "Bimodal"
      ? "manhã e noite"
      : resultKey === "Vespertino"
      ? "tarde"
      : resultKey === "Noturno"
      ? "noite"
      : "variação ao longo do dia";

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 min-h-screen px-4 pb-6 pt-5">
        <PageHeader
          title="Insights"
          subtitle="Padrões do seu ritmo"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        <section className="mb-5">
          <div className="relative overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_50%)]" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,var(--app-grid-color)_1px,transparent_1px)] [background-size:26px_26px] opacity-70" />

            <div className="relative">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-medium text-accent">
                <Sparkles className="h-3.5 w-3.5" />
                Análise personalizada
              </div>

              <h1 className="text-[2rem] font-semibold leading-[1.04] tracking-[-0.055em] text-primary">
                Seu melhor desempenho aparece mais na {bestFocusLabel}.
              </h1>

              <p className="mt-4 text-sm leading-6 text-muted">
                O Axon usa seus dados iniciais para identificar padrões de
                energia, foco e queda de rendimento ao longo do dia.
              </p>

              <div className="mt-6 rounded-[1.5rem] border border-accent-soft bg-accent-soft p-4">
                <div className="mb-3 flex items-center gap-2">
                  <img src="/axon-logo.svg" alt="Axon" className="h-6 w-6 object-contain" />
                  <p className="text-sm font-semibold text-accent">
                    {result.label}
                  </p>
                </div>

                <p className="text-sm leading-6 text-muted">
                  {result.recommendation}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Registro diário — alimenta toda a análise abaixo */}
        <section className="mb-5">
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className={`group w-full overflow-hidden rounded-[2rem] border p-4 text-left shadow-card backdrop-blur-2xl active:scale-[0.98] ${
              todayLog
                ? "border-emerald-300/25 bg-emerald-400/[0.08] shadow-card"
                : "border-accent-soft bg-accent-soft shadow-card"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                  todayLog
                    ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-200"
                    : "border-accent-soft bg-surface-elevated text-accent"
                }`}
              >
                {todayLog ? <CheckCircle2 className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-primary">
                  {todayLog ? "Dia registrado" : "Como foi o seu dia?"}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {todayLog
                    ? "Toque para revisar ou ajustar o registro de hoje."
                    : "Leva menos de 1 minuto · Alimenta os insights abaixo."}
                </p>
              </div>

              <span
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  todayLog
                    ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100"
                    : "border-accent-soft bg-surface-elevated text-accent"
                }`}
              >
                {todayLog ? "Editar" : "Registrar"}
              </span>
            </div>
          </button>
        </section>

        <section className="mb-5 rounded-[2rem] border border-accent-soft bg-accent-soft p-5 text-primary shadow-card backdrop-blur-2xl">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <img
                src="/axon-logo.svg"
                alt="Axon"
                className="h-5 w-5 object-contain"
              />
              <p className="text-sm font-semibold text-accent">
                O que o Axon descobriu
              </p>
            </div>

            {patterns?.status === "ready" &&
              formatUpdatedBadge(patterns.generated_at) && (
                <span className="rounded-full border border-soft bg-surface-muted px-2.5 py-1 text-[0.65rem] font-medium text-muted">
                  {formatUpdatedBadge(patterns.generated_at)}
                </span>
              )}
          </div>

          {loadingPatterns ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-[1.4rem] border border-soft bg-surface-muted"
                />
              ))}
            </div>
          ) : patterns?.status === "collecting" ? (
            <div className="rounded-[1.5rem] border border-soft bg-surface-muted p-5">
              <Sparkles className="mx-auto mb-3 h-6 w-6 text-accent" />

              {/* O que o usuário ganha ao concluir os registros. */}
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
                    className="h-full rounded-full bg-gradient-to-r from-purple-400 to-fuchsia-300"
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

              {/* O que fazer para avançar: a ação concreta, no próprio card. */}
              <div className="mt-4 rounded-[1.2rem] border border-soft bg-surface-elevated p-3.5">
                <p className="text-xs leading-5 text-secondary">
                  <span className="font-semibold text-primary">
                    Como avançar:
                  </span>{" "}
                  preencha o registro diário no fim do dia — leva menos de um
                  minuto e cada registro conta como um dia aqui.
                </p>

                <button
                  type="button"
                  onClick={() => setReviewOpen(true)}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent-strong)] px-4 text-xs font-semibold text-white shadow-card transition active:scale-[0.98]"
                >
                  <NotebookPen className="h-3.5 w-3.5" />
                  {todayLog
                    ? "Editar registro de hoje"
                    : "Registrar meu dia agora"}
                </button>

                {todayLog && (
                  <p className="mt-2 text-center text-[0.65rem] text-muted">
                    O dia de hoje já está registrado. Volte amanhã para somar
                    mais um.
                  </p>
                )}
              </div>
            </div>
          ) : patterns?.status === "ready" &&
            (patterns.insights?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              {patterns.insights!.map((it, i) => {
                const style = TYPE_STYLE[it.type] ?? TYPE_STYLE.general;
                const Icon = style.icon;
                return (
                  <div
                    key={i}
                    className="rounded-[1.4rem] border border-soft bg-surface-muted p-4"
                  >
                    <div className="mb-2 flex items-start gap-3">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-soft"
                        style={{
                          backgroundColor: `${style.color}1a`,
                          color: style.color,
                        }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <p className="pt-1 text-sm font-semibold leading-5 text-primary">
                        {it.title}
                      </p>
                    </div>
                    <p className="text-xs leading-6 text-muted">
                      {it.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-soft bg-surface-muted p-5 text-center">
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
                  .then(setPatterns)
                  .catch(() => {})
                  .finally(() => setLoadingPatterns(false));
              }}
              className="mt-4 inline-flex items-center gap-2 rounded-full px-1 text-xs font-semibold text-accent/80 active:scale-[0.98]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar insights
            </button>
          )}
        </section>

        {/* Blocos de foco — sempre visível: barra + legenda; lista expandível */}
        {focusBlocks.length > 0 && (
          <section className="mb-5 rounded-[2rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
            {/* Cabeçalho com toggle */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-primary">Blocos de foco</p>
                <p className="mt-1 text-xs text-muted">
                  Seu mapa de energia nas 24h
                </p>

                {/* Status de calibração */}
                {blocksCalibrated ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[0.65rem] font-medium text-emerald-700 dark:text-emerald-300/80">
                      Perfil personalizado · {blocksDataPoints} dias de dados
                    </span>
                  </div>
                ) : (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      <span className="text-[0.65rem] font-medium text-muted">
                        Perfil base · {blocksDataPoints}/{blocksMinPoints} dias para personalização
                      </span>
                    </div>
                    <div className="h-1 w-28 overflow-hidden rounded-full bg-[var(--border-soft)]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 to-purple-400 transition-all"
                        style={{ width: `${Math.min(100, (blocksDataPoints / blocksMinPoints) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <Focus className="h-5 w-5 shrink-0 text-accent" />
            </div>

            {/* Barra visual 24h — sempre visível */}
            <div className="mb-2 flex h-8 w-full overflow-hidden rounded-2xl border border-soft">
              {focusBlocks.map((block) => (
                <div
                  key={block.idx}
                  className="h-full flex-1"
                  style={{ backgroundColor: LEVEL_COLOR[block.level].bar }}
                  title={`${block.start_time} ${block.label}`}
                />
              ))}
            </div>

            {/* Labels de hora — sempre visível */}
            <div className="mb-4 flex justify-between px-0.5 text-[0.6rem] text-soft">
              <span>00h</span>
              <span>06h</span>
              <span>12h</span>
              <span>18h</span>
              <span>24h</span>
            </div>

            {/* Legenda — sempre visível */}
            <div className="mb-4 flex flex-wrap gap-2">
              {LEVEL_ORDER.map(({ level, label }) => (
                <span
                  key={level}
                  className="flex items-center gap-1.5 rounded-full border border-soft bg-surface-muted px-2.5 py-1 text-[0.65rem] font-medium text-secondary"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: LEVEL_COLOR[level].bar }}
                  />
                  {label}
                </span>
              ))}
            </div>

            {/* Botão expandir/recolher */}
            <button
              type="button"
              onClick={() => {
                setBlocksListExpanded((v) => !v);
                if (blocksListExpanded) setExpandedBlockIdx(null);
              }}
              className="flex w-full items-center justify-between rounded-2xl border border-soft bg-surface-muted px-4 py-2.5 text-xs font-semibold text-muted transition active:scale-[0.98]"
            >
              <span>
                {blocksListExpanded ? "Recolher blocos" : "Ver todos os blocos"}
              </span>
              <span>{blocksListExpanded ? "▲" : "▼"}</span>
            </button>

            {/* Lista detalhada — apenas quando expandido */}
            {blocksListExpanded && (
              <div className="mt-3 space-y-1.5">
                {focusBlocks.map((block) => {
                  const color = LEVEL_COLOR[block.level];
                  const isExpanded = expandedBlockIdx === block.idx;
                  const now = new Date();
                  const currentMinutes = now.getHours() * 60 + now.getMinutes();
                  const blockStart = block.idx * 90;
                  const blockEnd = blockStart + 90;
                  const isCurrent = currentMinutes >= blockStart && currentMinutes < blockEnd;

                  return (
                    <div key={block.idx}>
                      <button
                        type="button"
                        onClick={() => setExpandedBlockIdx(isExpanded ? null : block.idx)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${
                          isCurrent
                            ? "border-accent-soft bg-accent-soft"
                            : "border-[var(--border-soft)] bg-surface-muted"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: color.bar }}
                        />
                        <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-muted">
                          {block.start_time}
                        </span>
                        <span
                          className="flex-1 truncate text-xs font-semibold"
                          style={{ color: color.text }}
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
        )}

        <section className="mb-5 rounded-[2rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">
                Tarefas concluídas
              </p>
              <p className="mt-1 text-xs text-muted">
                {taskPeriod === "week" ? "Últimos 7 dias" : "Últimos 30 dias"}
              </p>
            </div>

            <div className="flex shrink-0 rounded-full border border-soft bg-surface-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setTaskPeriod("week");
                  setActiveTaskDay(null);
                }}
                className={`rounded-full px-3 py-1 font-medium transition active:scale-[0.97] ${
                  taskPeriod === "week"
                    ? "bg-accent-soft text-accent"
                    : "text-muted"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => {
                  setTaskPeriod("month");
                  setActiveTaskDay(null);
                }}
                className={`rounded-full px-3 py-1 font-medium transition active:scale-[0.97] ${
                  taskPeriod === "month"
                    ? "bg-accent-soft text-accent"
                    : "text-muted"
                }`}
              >
                Mês
              </button>
            </div>
          </div>

          <div className="flex h-44 items-end gap-1.5 rounded-[1.5rem] border border-soft bg-surface-muted p-4">
            {loadingTasks ? (
              <div className="flex h-full w-full items-center justify-center">
                <p className="text-xs text-muted">Carregando...</p>
              </div>
            ) : (
              (taskInsights?.days ?? []).map((d, i) => {
                const totalH = (d.total / maxTaskTotal) * 100;
                const completedFill = d.total
                  ? (d.completed / d.total) * 100
                  : 0;
                const isActive = activeTaskDay === d.date;
                return (
                  <div
                    key={d.date}
                    className="relative flex flex-1 flex-col items-center gap-2"
                    onMouseEnter={() => setActiveTaskDay(d.date)}
                    onMouseLeave={() => setActiveTaskDay(null)}
                  >
                    {isActive && (
                      <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-xl border border-soft bg-surface-elevated px-2.5 py-1.5 text-center shadow-card">
                        <p className="text-[0.65rem] font-semibold text-primary">
                          {d.completed}/{d.total} concluídas
                        </p>
                        <p className="text-[0.6rem] text-muted">
                          {d.completion_rate}% do dia
                        </p>
                      </div>
                    )}

                    <button
                      type="button"
                      // No celular não existe hover: o clique alterna o mesmo destaque.
                      onClick={() =>
                        setActiveTaskDay(isActive ? null : d.date)
                      }
                      className="flex h-28 w-full items-end justify-center"
                      aria-label={`${d.weekday}: ${d.completed} de ${d.total} tarefas concluídas, ${d.completion_rate}%`}
                    >
                      {/* Cápsula cinza = total; roxo preenche de baixo = concluídas */}
                      <div
                        className={`relative overflow-hidden rounded-full bg-[var(--border-soft)] transition ${
                          isActive ? "ring-2 ring-accent-soft" : ""
                        }`}
                        style={{
                          width: taskBarWidth,
                          height: `${totalH}%`,
                          minHeight: taskBarWidth,
                        }}
                      >
                        <div
                          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-purple-500 to-fuchsia-400"
                          style={{ height: `${completedFill}%` }}
                        />
                      </div>
                    </button>

                    <p className="text-[0.6rem] text-muted">
                      {taskPeriod === "week" || i % 5 === 0 ? d.weekday : ""}
                    </p>
                  </div>
                );
              })
            )}
          </div>

          {taskInsights && !loadingTasks && (
            <div className="mt-4 rounded-[1.4rem] border border-accent-soft bg-accent-soft p-4">
              <p className="text-sm leading-6 text-muted">
                {taskInsights.summary.best_weekday ? (
                  <>
                    Seu dia mais produtivo costuma ser{" "}
                    <span className="font-semibold text-accent">
                      {taskInsights.summary.best_weekday}
                    </span>
                    . Você concluiu{" "}
                    <span className="font-semibold text-accent">
                      {taskInsights.summary.best_weekday_completed}
                    </span>{" "}
                    tarefas nesse dia.
                  </>
                ) : (
                  "Conclua tarefas no Planejamento para ver seus padrões de produtividade aqui."
                )}
              </p>
            </div>
          )}
        </section>

        <section className="mb-5 rounded-[2rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-primary">Horas de sono</p>
              <p className="mt-1 text-xs text-muted">
                Últimos dias registrados
              </p>
            </div>
            <Moon className="h-5 w-5 text-accent" />
          </div>

          {loadingSleep ? (
            <div className="h-44 rounded-[1.5rem] border border-soft bg-surface-muted" />
          ) : sleepHistory.length === 0 ? (
            <div className="flex flex-col items-center rounded-[1.6rem] border border-dashed border-soft bg-surface-muted px-5 py-8 text-center">
              <Moon className="mb-3 h-6 w-6 text-accent/70" />
              <p className="text-sm font-semibold text-primary">
                Sem dados de sono ainda
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Preencha o registro diário por alguns dias para ver seu padrão de
                sono aqui.
              </p>
            </div>
          ) : (
            <>
              <div className="relative flex h-44 items-end gap-2 rounded-[1.5rem] border border-soft bg-surface-muted p-4">
                <div
                  className="pointer-events-none absolute inset-x-4 border-t border-dashed border-fuchsia-300/60"
                  style={{
                    bottom: `calc(1rem + ${(sleepTarget / CHART_MAX) * 100}% * 0.72)`,
                  }}
                  title={`Meta: ${sleepTarget}h`}
                />
                {sleepHistory.map((l) => {
                  const h = l.hours_slept as number;
                  const reachedTarget = h >= sleepTarget;
                  return (
                    <div
                      key={l.date}
                      className="flex flex-1 flex-col items-center gap-2"
                    >
                      <div className="flex h-28 w-full items-end">
                        <div
                          className={`w-full rounded-t-xl ${
                            reachedTarget
                              ? "bg-gradient-to-t from-purple-500/35 to-fuchsia-300"
                              : "bg-gradient-to-t from-amber-500/30 to-amber-300/80"
                          }`}
                          style={{
                            height: `${Math.min(100, (h / CHART_MAX) * 100)}%`,
                          }}
                          title={`~${h}h`}
                        />
                      </div>
                      <p className="text-[0.6rem] text-muted">
                        {formatDayLabel(l.date)}
                      </p>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 rounded-[1.4rem] border border-accent-soft bg-accent-soft p-4 text-center">
                <div>
                  <p className="text-[0.65rem] uppercase tracking-wide text-muted">
                    Média
                  </p>
                  <p className="mt-1 text-sm font-semibold text-accent">
                    ~{avgSleep.toFixed(1)}h
                  </p>
                </div>
                <div>
                  <p className="text-[0.65rem] uppercase tracking-wide text-muted">
                    Meta
                  </p>
                  <p className="mt-1 text-sm font-semibold text-primary">
                    {sleepTarget}h
                  </p>
                </div>
                <div>
                  <p className="text-[0.65rem] uppercase tracking-wide text-muted">
                    Déficit
                  </p>
                  <p className="mt-1 text-sm font-semibold text-amber-700 dark:text-amber-200">
                    {deficit > 0 ? `~${deficit.toFixed(1)}h` : "—"}
                  </p>
                </div>
              </div>
            </>
          )}
        </section>

        {routineConsistency.length > 0 && (
          <section className="mb-5 rounded-[2rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-primary">Rotinas desta semana</p>
                <p className="mt-1 text-xs text-muted">
                  Consistência nos últimos 7 dias
                </p>
              </div>
              <RefreshCw className="h-5 w-5 text-accent" />
            </div>

            <div className="space-y-3">
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
          </section>
        )}

        <section className="mb-5 rounded-[2rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-primary">
                Comparar métricas
              </p>
              <p className="mt-1 text-xs text-muted">Compare 2 indicadores</p>
            </div>

            <div className="flex shrink-0 rounded-full border border-soft bg-surface-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => setComparePeriod("week")}
                className={`rounded-full px-3 py-1 font-medium transition active:scale-[0.97] ${
                  comparePeriod === "week"
                    ? "bg-accent-soft text-accent"
                    : "text-muted"
                }`}
              >
                Semana
              </button>
              <button
                type="button"
                onClick={() => setComparePeriod("month")}
                className={`rounded-full px-3 py-1 font-medium transition active:scale-[0.97] ${
                  comparePeriod === "month"
                    ? "bg-accent-soft text-accent"
                    : "text-muted"
                }`}
              >
                Mês
              </button>
            </div>
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
                    style={{ backgroundColor: on ? s.color : "#555" }}
                  />
                  {s.label}
                </button>
              );
            })}
          </div>

          {chartData.length === 0 ? (
            <div className="flex flex-col items-center rounded-[1.6rem] border border-dashed border-soft bg-surface-muted px-5 py-8 text-center">
              <p className="text-sm font-semibold text-primary">
                Ainda sem dados para comparar
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Use o registro diário e conclua tarefas por alguns dias para
                liberar as comparações.
              </p>
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border-soft)"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(date: string) =>
                      chartData.find((d) => d.date === date)?.label ?? date
                    }
                    tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="pct"
                    domain={[0, 100]}
                    tick={{ fill: "var(--text-soft)", fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="hours"
                    orientation="right"
                    domain={[0, 12]}
                    tick={{ fill: "var(--text-soft)", fontSize: 10 }}
                  />
                  <Tooltip content={<CustomTooltip />} />

                  {active.includes("tarefas") && (
                    <Line
                      yAxisId="pct"
                      dataKey="tarefas"
                      name="Tarefas %"
                      stroke="#c084fc"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#c084fc", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  )}
                  {active.includes("qualidade") && (
                    <Line
                      yAxisId="pct"
                      dataKey="qualidade_plot"
                      name="Qualidade do sono"
                      stroke="#f472b6"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#f472b6", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  )}
                  {active.includes("humor") && (
                    <Line
                      yAxisId="pct"
                      dataKey="humor_plot"
                      name="Humor"
                      stroke="#34d399"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#34d399", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  )}
                  {active.includes("prod") && (
                    <Line
                      yAxisId="pct"
                      dataKey="prod_plot"
                      name="Produtividade"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#fbbf24", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  )}
                  {active.includes("sono") && (
                    <Line
                      yAxisId="hours"
                      dataKey="sono"
                      name="Sono"
                      stroke="#60a5fa"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#60a5fa", strokeWidth: 0 }}
                      connectNulls={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="mb-5">
          <div className="mb-4">
            <p className="text-sm font-semibold text-primary">
              Padrões percebidos
            </p>
            <p className="mt-1 text-xs text-muted">
              Leituras iniciais do seu comportamento
            </p>
          </div>

          <div className="space-y-3">
            <PatternCard
              icon={Moon}
              title="Ritmo de sono"
              value={result.label}
              description="Seu perfil sugere que a organização do dia deve respeitar suas janelas naturais de disposição."
            />

            <PatternCard
              icon={Focus}
              title="Execução profunda"
              value={result.focusWindow}
              description="Tarefas complexas tendem a funcionar melhor quando encaixadas no seu período de maior foco."
            />

            <PatternCard
              icon={CalendarDays}
              title="Distribuição de tarefas"
              value="Blocos separados"
              description="Agrupar demandas leves evita alternância de contexto e preserva energia para o que importa."
            />
          </div>
        </section>
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
            .then(setPatterns)
            .catch(() => {});
        }}
      />
    </main>
  );
}

// ===========================================================================
// CARD DE PADRÃO DO USUÁRIO
// ===========================================================================

function PatternCard({
  title,
  description,
  value,
  icon: Icon,
}: PatternCardProps) {
  return (
    <div className="rounded-[1.7rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
            <Icon className="h-4 w-4" />
          </div>

          <div>
            <p className="text-sm font-semibold text-primary">{title}</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-soft bg-surface-muted px-3 py-2">
        <p className="text-xs font-medium text-accent">{value}</p>
      </div>
    </div>
  );
}

// ===========================================================================
// HELPERS DE FORMATAÇÃO
// ===========================================================================

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
      {row.sono != null && <Row color="#60a5fa" text={`Sono: ~${row.sono}h`} />}
      {row.qualidade != null && (
        <Row color="#f472b6" text={`Qualidade do sono: ${row.qualidade}/5`} />
      )}
      {row.humor != null && <Row color="#34d399" text={`Humor: ${row.humor}/5`} />}
      {row.prod != null && (
        <Row color="#fbbf24" text={`Produtividade: ${row.prod}/5`} />
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
