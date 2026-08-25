import { useEffect, useState } from "react";
import type { ElementType, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Dumbbell, Moon, Plus, Smile, Target, X, Zap } from "lucide-react";

import * as api from "../lib/api";
import type { DailyLog, TagItem } from "../lib/api";
import { PEAK_PERIODS } from "../lib/api";
import { slugifyTag } from "../lib/tagSlug";
import {
  MOOD_TAGS,
  PRODUCTIVITY_TAGS,
  SLEEP_TAGS,
  TIME_OPTIONS,
} from "../data/dayReviewTags";

// Fallbacks locais usados até as preferências personalizadas do usuário carregarem.
const DEFAULT_SLEEP_TAGS: TagItem[] = SLEEP_TAGS.map((t) => ({
  slug: t.slug,
  label: t.label,
}));

const DEFAULT_MOOD_TAGS: TagItem[] = MOOD_TAGS.map((t) => ({
  slug: t.slug,
  label: t.label,
}));

const DEFAULT_PRODUCTIVITY_TAGS: TagItem[] = PRODUCTIVITY_TAGS.map((t) => ({
  slug: t.slug,
  label: t.label,
}));

// Marcador de dia livre. Espelha backend/services/daily_rest.DAY_OFF_TAG.
// Ele viaja junto de `peak_periods` porque o usuário o marca na mesma seção da
// tela, mas NÃO é um período: sem faixa de horário e sem posição no ranking. O
// backend o separa antes de validar (models/schemas._extrair_dia_livre).
const DAY_OFF = "dia_livre";

// Espelha daily_rest.resolve_day_off. Usado ao restaurar o formulário: um
// registro salvo só com o marcador dentro de peak_periods reabriria com o
// botão apagado sem isto.
function resolveDayOff(
  explicit: boolean | null | undefined,
  peakPeriods: string[] | null | undefined
): boolean {
  return !!explicit || (peakPeriods ?? []).includes(DAY_OFF);
}

// O marcador nunca deve virar um "período" selecionado na tela.
function stripDayOff(peakPeriods: string[] | null | undefined): string[] {
  return (peakPeriods ?? []).filter((p) => p !== DAY_OFF);
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
  existing?: DailyLog | null;
  onSaved?: (log: DailyLog) => void;
  targetDate?: string; // "YYYY-MM-DD" — quando presente, salva nessa data em vez de hoje
  isYesterday?: boolean; // exibe o banner de aviso "Você não registrou ontem"
};

export default function DayReview({
  isOpen,
  onClose,
  existing,
  onSaved,
  targetDate,
  isYesterday,
}: Props) {
  // ---------------------------------------------------------------------------
  // Campos do registro diário
  // ---------------------------------------------------------------------------
  const [sleepTime, setSleepTime] = useState(existing?.sleep_time ?? "23:30");
  const [wakeTime, setWakeTime] = useState(existing?.wake_time ?? "07:00");
  const [sleepRating, setSleepRating] = useState<number | null>(
    existing?.sleep_rating ?? null
  );
  const [sleepTags, setSleepTags] = useState<string[]>(existing?.sleep_tags ?? []);
  const [moodRating, setMoodRating] = useState<number | null>(
    existing?.mood_rating ?? null
  );
  const [moodTags, setMoodTags] = useState<string[]>(existing?.mood_tags ?? []);
  const [prodRating, setProdRating] = useState<number | null>(
    existing?.productivity_rating ?? null
  );
  const [prodTags, setProdTags] = useState<string[]>(existing?.productivity_tags ?? []);
  const [peakPeriods, setPeakPeriods] = useState<string[]>(stripDayOff(existing?.peak_periods));
  const [exercised, setExercised] = useState<boolean>(existing?.exercised ?? false);
  const [isDayOff, setIsDayOff] = useState<boolean>(existing?.is_day_off ?? false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  // ---------------------------------------------------------------------------
  // Estado de envio e mensagens de erro
  // ---------------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rascunho: `draftLoaded` evita que o autosave dispare antes de restaurar o
  // que já estava salvo; `hasDraft` controla o aviso de rascunho recuperado.
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  // ---------------------------------------------------------------------------
  // Tags disponíveis
  // ---------------------------------------------------------------------------
  // Começa com tags locais e troca pelas preferências salvas quando o sheet abre.
  const [availableSleepTags, setAvailableSleepTags] = useState<TagItem[]>(
    DEFAULT_SLEEP_TAGS
  );
  const [availableMoodTags, setAvailableMoodTags] = useState<TagItem[]>(
    DEFAULT_MOOD_TAGS
  );
  const [availableProdTags, setAvailableProdTags] = useState<TagItem[]>(
    DEFAULT_PRODUCTIVITY_TAGS
  );

  // ---------------------------------------------------------------------------
  // Sincronização ao abrir o sheet
  // ---------------------------------------------------------------------------
  // O componente pode continuar montado entre aberturas; por isso os campos são
  // reidratados a partir de `existing` sempre que o usuário abre a revisão.
  useEffect(() => {
    if (!isOpen) return;
    setSleepTime(existing?.sleep_time ?? "23:30");
    setWakeTime(existing?.wake_time ?? "07:00");
    setSleepRating(existing?.sleep_rating ?? null);
    setSleepTags(existing?.sleep_tags ?? []);
    setMoodRating(existing?.mood_rating ?? null);
    setMoodTags(existing?.mood_tags ?? []);
    setProdRating(existing?.productivity_rating ?? null);
    setProdTags(existing?.productivity_tags ?? []);
    setPeakPeriods(stripDayOff(existing?.peak_periods));
    setIsDayOff(resolveDayOff(existing?.is_day_off, existing?.peak_periods));
    setExercised(existing?.exercised ?? false);
    setNotes(existing?.notes ?? "");
    setError(null);
    setDraftLoaded(false);

    // Carrega preferências personalizadas sem bloquear a abertura do formulário.
    api
      .getTagPreferences()
      .then((prefs) => {
        setAvailableSleepTags(prefs.sleep);
        setAvailableMoodTags(prefs.mood);
        setAvailableProdTags(prefs.productivity);
      })
      .catch(() => {});

    // Registro já salvo é a fonte da verdade: um rascunho anterior à conclusão
    // mostraria dados velhos por cima do que o usuário de fato registrou.
    if (existing) {
      setHasDraft(false);
      setDraftLoaded(true);
      return;
    }

    // Rascunho: restaura o preenchimento parcial por cima dos defaults acima.
    // Roda depois dos setters porque eles são agendados na mesma passada — o
    // .then() cai numa atualização posterior, então não é sobrescrito.
    // `cancelled` descarta a resposta se o sheet fechar ou a data mudar antes
    // de ela chegar, evitando escrever o rascunho de um dia no formulário de outro.
    let cancelled = false;
    api
      .getDailyLogDraft(targetDate)
      .then((draft) => {
        if (cancelled || !draft?.data) return;
        const d = draft.data as Partial<DailyLog>;
        if (d.sleep_time) setSleepTime(d.sleep_time);
        if (d.wake_time) setWakeTime(d.wake_time);
        if (d.sleep_rating != null) setSleepRating(d.sleep_rating);
        if (d.sleep_tags) setSleepTags(d.sleep_tags);
        if (d.mood_rating != null) setMoodRating(d.mood_rating);
        if (d.mood_tags) setMoodTags(d.mood_tags);
        if (d.productivity_rating != null) setProdRating(d.productivity_rating);
        if (d.productivity_tags) setProdTags(d.productivity_tags);
        if (d.peak_periods) setPeakPeriods(stripDayOff(d.peak_periods));
        if (typeof d.is_day_off === "boolean" || d.peak_periods) {
          setIsDayOff(resolveDayOff(d.is_day_off, d.peak_periods));
        }
        if (d.exercised != null) setExercised(d.exercised);
        if (d.notes) setNotes(d.notes);
        setHasDraft(true);
      })
      .catch(() => {})
      // Só libera a gravação do rascunho depois de tentar carregá-lo, senão o
      // primeiro autosave salvaria os defaults por cima do que estava salvo.
      .finally(() => {
        if (!cancelled) setDraftLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, existing, targetDate]);

  // ---------------------------------------------------------------------------
  // Autosave do rascunho
  // ---------------------------------------------------------------------------
  // Grava o formulário parcial enquanto o usuário preenche, com debounce para
  // não disparar um PUT por tecla digitada nas notas.
  useEffect(() => {
    // `existing` = registro já salvo: editar um registro concluído vai direto
    // pelo POST, não faz sentido acumular rascunho por cima dele.
    if (!isOpen || !draftLoaded || saving || existing) return;

    const timer = window.setTimeout(() => {
      api
        .saveDailyLogDraft(
          {
            sleep_time: sleepTime,
            wake_time: wakeTime,
            sleep_rating: sleepRating,
            sleep_tags: sleepTags,
            mood_rating: moodRating,
            mood_tags: moodTags,
            productivity_rating: prodRating,
            productivity_tags: prodTags,
            peak_periods: isDayOff ? [DAY_OFF] : peakPeriods,
            is_day_off: isDayOff,
            exercised,
            notes,
          },
          targetDate
        )
        .catch(() => {}); // rascunho é conveniência: falhar não atrapalha o registro
    }, 800);

    return () => window.clearTimeout(timer);
  }, [
    isOpen,
    draftLoaded,
    saving,
    existing,
    targetDate,
    sleepTime,
    wakeTime,
    sleepRating,
    sleepTags,
    moodRating,
    moodTags,
    prodRating,
    prodTags,
    peakPeriods,
    isDayOff,
    exercised,
    notes,
  ]);

  // ---------------------------------------------------------------------------
  // Validações e dados derivados
  // ---------------------------------------------------------------------------
  // Data do registro: a data alvo (retroativo), o dia já registrado (edição)
  // ou hoje (novo).
  const reviewDate = formatReviewDate(targetDate ?? existing?.date);

  const canSave =
    sleepRating !== null && moodRating !== null && prodRating !== null && !saving;

  // ---------------------------------------------------------------------------
  // Seleções do formulário
  // ---------------------------------------------------------------------------
  // Limita cada grupo a 3 tags para manter o registro rápido e comparável.
  function toggleTag(list: string[], set: (v: string[]) => void, slug: string) {
    if (list.includes(slug)) {
      set(list.filter((t) => t !== slug));
    } else if (list.length < 3) {
      set([...list, slug]);
    }
  }

  // Até 3 períodos, na ORDEM em que o usuário clica: o 1º clique é o período
  // mais produtivo do dia. O backend usa essa ordem para pesar a calibração
  // (1º com peso 1.0, 2º com 0.75, 3º com 0.5), então remover um item do meio
  // precisa reordenar os seguintes — o filter abaixo já faz isso naturalmente.
  function togglePeakPeriod(slug: string) {
    if (peakPeriods.includes(slug)) {
      setPeakPeriods(peakPeriods.filter((p) => p !== slug));
    } else if (peakPeriods.length < 3) {
      // Escolher um período contradiz "dia livre": ou o dia foi de descanso,
      // ou houve um momento mais produtivo. Desmarcamos em vez de bloquear o
      // clique — o usuário está corrigindo a resposta anterior, e travar o
      // botão faria parecer que o app quebrou.
      setIsDayOff(false);
      setPeakPeriods([...peakPeriods, slug]);
    }
  }

  // Dia livre é exclusivo: marcar limpa os períodos já escolhidos.
  function toggleDayOff() {
    const next = !isDayOff;
    setIsDayOff(next);
    if (next) setPeakPeriods([]);
  }

  // ---------------------------------------------------------------------------
  // Descarte do rascunho
  // ---------------------------------------------------------------------------
  // Volta o formulário ao estado inicial e apaga o rascunho no servidor.
  // `draftLoaded=false` desliga o autosave durante a limpeza, senão o debounce
  // regravaria os campos vazios logo em seguida.
  async function discardDraft() {
    setDraftLoaded(false);
    setHasDraft(false);

    setSleepTime(existing?.sleep_time ?? "23:30");
    setWakeTime(existing?.wake_time ?? "07:00");
    setSleepRating(existing?.sleep_rating ?? null);
    setSleepTags(existing?.sleep_tags ?? []);
    setMoodRating(existing?.mood_rating ?? null);
    setMoodTags(existing?.mood_tags ?? []);
    setProdRating(existing?.productivity_rating ?? null);
    setProdTags(existing?.productivity_tags ?? []);
    setPeakPeriods(stripDayOff(existing?.peak_periods));
    setIsDayOff(resolveDayOff(existing?.is_day_off, existing?.peak_periods));
    setExercised(existing?.exercised ?? false);
    setNotes(existing?.notes ?? "");

    try {
      await api.deleteDailyLogDraft(targetDate);
    } catch {
      // rascunho órfão no servidor não impede o usuário de seguir preenchendo
    } finally {
      setDraftLoaded(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Criação rápida de tag
  // ---------------------------------------------------------------------------
  // Persiste em profiles.custom_tags (PUT substitui a lista inteira, por isso
  // enviamos as três categorias) e já deixa a tag nova selecionada.
  // Devolve null em caso de sucesso ou a mensagem de erro para exibir inline.
  async function createTag(
    category: "sleep" | "mood" | "productivity",
    label: string
  ): Promise<string | null> {
    const slug = slugifyTag(label);

    const currentByCategory = {
      sleep: availableSleepTags,
      mood: availableMoodTags,
      productivity: availableProdTags,
    };
    const current = currentByCategory[category];

    // Slug vazio acontece quando o label só tem símbolos/acentos ("!!!", "ção").
    if (slug === "custom_") {
      return "Use letras ou números no nome da tag.";
    }
    if (current.some((t) => t.slug === slug)) {
      return "Você já tem uma tag com esse nome.";
    }

    const next = { ...currentByCategory, [category]: [...current, { slug, label }] };

    try {
      const saved = await api.updateTagPreferences(next);
      setAvailableSleepTags(saved.sleep);
      setAvailableMoodTags(saved.mood);
      setAvailableProdTags(saved.productivity);

      // Seleciona a tag recém-criada, respeitando o limite de 3 por grupo.
      const selectedByCategory = {
        sleep: [sleepTags, setSleepTags] as const,
        mood: [moodTags, setMoodTags] as const,
        productivity: [prodTags, setProdTags] as const,
      };
      const [selected, setSelected] = selectedByCategory[category];
      if (selected.length < 3) setSelected([...selected, slug]);

      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Não foi possível criar a tag.";
    }
  }

  // ---------------------------------------------------------------------------
  // Salvamento
  // ---------------------------------------------------------------------------
  // Envia apenas o resumo do dia; os Insights usam esse histórico depois.
  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const log = await api.saveDailyLog({
        date: targetDate, // undefined quando não passado = hoje
        sleep_time: sleepTime,
        wake_time: wakeTime,
        sleep_rating: sleepRating ?? undefined,
        sleep_tags: sleepTags,
        mood_rating: moodRating ?? undefined,
        mood_tags: moodTags,
        productivity_rating: prodRating ?? undefined,
        productivity_tags: prodTags,
        // Com dia livre marcado, peakPeriods já está vazio (as respostas se
        // excluem), então o array leva só o marcador. Mandamos também o
        // booleano de propósito: se um dia o array mudar de forma, a
        // informação não se perde.
        peak_periods: isDayOff ? [DAY_OFF] : peakPeriods,
        is_day_off: isDayOff,
        exercised,
        notes: notes.trim() || undefined,
      });
      // O backend já apagou o rascunho ao salvar; aqui só limpamos o estado
      // local para o aviso não reaparecer numa reabertura sem remontar.
      setHasDraft(false);
      onSaved?.(log);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {/* Sheet mobile-first de revisão diária. */}
      {isOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-[110] max-h-[90vh] overflow-y-auto rounded-t-[2rem] border-t border-soft bg-surface-elevated p-5 pb-10 text-primary shadow-soft backdrop-blur-2xl"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[var(--border-medium)]" />

            {/* Cabeçalho do registro: data e ação de fechar. */}
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-primary">
                  {targetDate ? "Como foi seu dia de ontem?" : "Como foi o seu dia?"}
                </h2>
                <p className="mt-1 text-xs font-medium capitalize text-accent">
                  {reviewDate}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Leva menos de 1 minuto
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isYesterday && (
              <div className="mb-4 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3">
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">
                  Você não registrou ontem
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Ainda dá tempo — preencha como foi seu dia de ontem.
                </p>
              </div>
            )}

            {hasDraft && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-accent-soft bg-accent-soft px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-accent">
                    Continuando de onde você parou
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    Recuperamos o que você já tinha preenchido.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={discardDraft}
                  className="shrink-0 rounded-full border border-soft bg-surface-muted px-3 py-1.5 text-[0.68rem] font-semibold text-muted transition active:scale-[0.96]"
                >
                  Recomeçar
                </button>
              </div>
            )}


            {/* Sono: horários, avaliação e até 3 tags. */}
            <Section icon={Moon} title="Como você dormiu?">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <TimeSelect
                  label="Dormiu às"
                  value={sleepTime}
                  onChange={setSleepTime}
                />
                <TimeSelect
                  label="Acordou às"
                  value={wakeTime}
                  onChange={setWakeTime}
                />
              </div>
              <RatingDots value={sleepRating} onChange={setSleepRating} />
              <TagRow
                tags={availableSleepTags}
                selected={sleepTags}
                onToggle={(s) => toggleTag(sleepTags, setSleepTags, s)}
                onCreate={(label) => createTag("sleep", label)}
              />
            </Section>

            {/* Humor: percepção geral do dia e fatores associados. */}
            <Section icon={Smile} title="Como você se sentiu?">
              <RatingDots value={moodRating} onChange={setMoodRating} />
              <TagRow
                tags={availableMoodTags}
                selected={moodTags}
                onToggle={(s) => toggleTag(moodTags, setMoodTags, s)}
                onCreate={(label) => createTag("mood", label)}
              />
            </Section>

            {/* Produtividade: base para cruzar energia, foco e execução. */}
            <Section icon={Target} title="Como avalia sua produtividade?">
              <RatingDots value={prodRating} onChange={setProdRating} />
              <TagRow
                tags={availableProdTags}
                selected={prodTags}
                onToggle={(s) => toggleTag(prodTags, setProdTags, s)}
                onCreate={(label) => createTag("productivity", label)}
              />
            </Section>

            {/* Pico produtivo: até 3 janelas ORDENADAS por produtividade. A ordem
                de clique é o próprio dado — o badge numerado existe para que o
                usuário perceba que ela conta. */}
            <Section icon={Zap} title="Quando você foi mais produtivo? (opcional)">
              <p className="mb-3 text-xs text-soft">
                {isDayOff
                  ? "Dia marcado como livre. Toque nele de novo para escolher períodos."
                  : "Toque em até 3 períodos, começando pelo mais produtivo. Se foi dia de descanso, marque \"Dia livre\"."}
              </p>
              <div className="flex flex-wrap gap-2">
                {PEAK_PERIODS.map((p) => {
                  const rank = peakPeriods.indexOf(p.slug); // -1 = não selecionado
                  const isSelected = rank >= 0;
                  // Dia livre desabilita os períodos: as duas respostas se excluem.
                  const atLimit =
                    !isSelected && (isDayOff || peakPeriods.length >= 3);
                  return (
                    <button
                      key={p.slug}
                      type="button"
                      onClick={() => togglePeakPeriod(p.slug)}
                      disabled={atLimit}
                      aria-label={
                        isSelected
                          ? `${p.label}, ${p.hours}, ${rank + 1}º período mais produtivo. Toque para remover.`
                          : isDayOff
                          ? `${p.label}, ${p.hours}. Indisponível: o dia está marcado como livre.`
                          : `${p.label}, ${p.hours}. Toque para marcar.`
                      }
                      className={`flex flex-col items-start rounded-2xl border px-3.5 py-2.5 text-left transition active:scale-[0.96] ${
                        isSelected
                          ? "border-accent-soft bg-accent-soft text-accent"
                          : atLimit
                          ? "cursor-not-allowed border-soft bg-surface-muted text-soft opacity-55"
                          : "border-soft bg-surface-muted text-secondary"
                      }`}
                    >
                      {/* Posição na ordem. O aria-label acima já carrega a mesma
                          informação, então aqui o número é puramente visual. */}
                      {isSelected && (
                        <span
                          className="mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-[0.6rem] font-bold text-white"
                          aria-hidden="true"
                        >
                          {rank + 1}
                        </span>
                      )}
                      <span className="text-xs font-semibold">{p.label}</span>
                      <span
                        className={`text-[0.62rem] ${
                          isSelected ? "text-accent" : "text-soft"
                        }`}
                      >
                        {p.hours}
                      </span>
                    </button>
                  );
                })}

                {/* Dia livre: último da grade, com as mesmas classes dos
                    períodos para não destoar. Não é um período — sem faixa de
                    horário e sem posição no ranking — então não recebe badge
                    numerado nem entra no limite de 3, e o `atLimit` dos outros
                    nunca o desabilita. Convive com eles: dá para ter folgado e
                    ainda assim ter rendido bem de manhã. */}
                <button
                  type="button"
                  onClick={toggleDayOff}
                  aria-pressed={isDayOff}
                  aria-label={
                    isDayOff
                      ? "Dia livre marcado. Toque para desmarcar."
                      : "Dia livre ou dia de descanso. Toque para marcar."
                  }
                  className={`flex flex-col items-start rounded-2xl border px-3.5 py-2.5 text-left transition active:scale-[0.96] ${
                    isDayOff
                      ? "border-accent-soft bg-accent-soft text-accent"
                      : "border-soft bg-surface-muted text-secondary"
                  }`}
                >
                  <span className="text-xs font-semibold">Dia livre</span>
                  <span
                    className={`text-[0.62rem] ${
                      isDayOff ? "text-accent" : "text-soft"
                    }`}
                  >
                    dia de descanso
                  </span>
                </button>
              </div>
              {peakPeriods.length >= 3 && (
                <p className="mt-2 text-xs text-soft">
                  Máximo de 3 períodos. Toque em um selecionado para remover.
                </p>
              )}
            </Section>

            {/* Exercício: sinal simples para comparar energia e humor. */}
            <Section icon={Dumbbell} title="Você se exercitou hoje?">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setExercised(true)}
                  className={`flex-1 rounded-2xl border py-3 text-sm font-semibold transition active:scale-[0.98] ${
                    exercised
                      ? "border-accent-soft bg-accent-soft text-accent"
                      : "border-soft bg-surface-muted text-muted"
                  }`}
                >
                  Sim
                </button>
                <button
                  type="button"
                  onClick={() => setExercised(false)}
                  className={`flex-1 rounded-2xl border py-3 text-sm font-semibold transition active:scale-[0.98] ${
                    !exercised
                      ? "border-accent-soft bg-accent-soft text-accent"
                      : "border-soft bg-surface-muted text-muted"
                  }`}
                >
                  Não
                </button>
              </div>
            </Section>

            {/* Notas livres: contexto qualitativo para o usuário lembrar do dia. */}
            <Section icon={Zap} title="Algo que queira registrar? (opcional)">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Ex: reunião pesada drenou minha energia..."
                className="w-full resize-none rounded-2xl border border-soft bg-surface-muted p-3.5 text-sm text-primary placeholder:text-soft focus:outline-none focus:ring-1 focus:ring-[var(--accent-soft)]"
              />
              <p className="mt-1 text-right text-xs text-soft">
                {notes.length}/500
              </p>
            </Section>

            {error && (
              <div className="mb-4 rounded-2xl border border-red-300/25 bg-red-500/10 p-3">
                <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="min-h-12 w-full rounded-2xl bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving
                ? "Salvando..."
                : existing
                ? "Atualizar registro"
                : "Salvar registro"}
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ===========================================================================
// HELPERS DE FORMATAÇÃO
// ===========================================================================

// Formata a data do registro exibida no topo do sheet.
// `iso` ("YYYY-MM-DD") vem do registro em edição; sem ela, usa hoje.
function formatReviewDate(iso?: string | null) {
  const date = iso ? new Date(`${iso}T00:00:00`) : new Date();
  return date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

// ===========================================================================
// SUBCOMPONENTES DO FORMULÁRIO
// ===========================================================================

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: ElementType;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-4 rounded-[1.6rem] border border-soft bg-surface-muted p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-accent-soft bg-accent-soft text-accent">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-sm font-semibold text-primary">{title}</p>
      </div>
      {children}
    </div>
  );
}

// Labels exibidas abaixo da nota selecionada.
const RATING_LABELS = ["Péssimo", "Ruim", "Regular", "Bom", "Ótimo"];

// Escala compacta de 1 a 5 usada em sono, humor e produtividade.
function RatingDots({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-11 flex-1 rounded-2xl border text-sm font-semibold transition active:scale-[0.96] ${
              value !== null && n <= value
                ? "border-accent-soft bg-accent-soft text-accent"
                : "border-soft bg-surface-muted text-muted"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="mt-2 h-4 text-center text-xs text-muted">
        {value !== null ? RATING_LABELS[value - 1] : ""}
      </p>
    </div>
  );
}

// Chips reutilizáveis com limite de seleção controlado pelo componente pai.
function TagRow({
  tags,
  selected,
  onToggle,
  onCreate,
}: {
  tags: { slug: string; label: string }[];
  selected: string[];
  onToggle: (slug: string) => void;
  onCreate: (label: string) => Promise<string | null>;
}) {
  const atLimit = selected.length >= 3;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function submitNewTag() {
    const label = draft.trim();
    if (!label || creating) return;
    setCreating(true);
    setCreateError(null);
    const error = await onCreate(label);
    setCreating(false);
    if (error) {
      setCreateError(error);
      return;
    }
    setDraft("");
    setAdding(false);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const isSelected = selected.includes(tag.slug);
          const isDisabled = !isSelected && atLimit;
          return (
            <button
              key={tag.slug}
              type="button"
              onClick={() => onToggle(tag.slug)}
              disabled={isDisabled}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition active:scale-[0.96] ${
                isSelected
                  ? "border-accent-soft bg-accent-soft text-accent"
                  : isDisabled
                  ? "cursor-not-allowed border-soft bg-surface-muted text-soft opacity-55"
                  : "border-soft bg-surface-muted text-secondary"
              }`}
            >
              {tag.label}
            </button>
          );
        })}

        {/* Criar uma tag sem sair do registro; ela fica salva para os próximos. */}
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setCreateError(null);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-soft px-3.5 py-1.5 text-xs font-medium text-muted transition active:scale-[0.96]"
          >
            <Plus className="h-3 w-3" />
            Nova tag
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex items-center gap-2">
          <input
            autoFocus
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitNewTag();
              } else if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
                setCreateError(null);
              }
            }}
            placeholder="Nome da tag"
            className="min-w-0 flex-1 rounded-full border border-soft bg-surface-muted px-3.5 py-1.5 text-xs text-primary outline-none placeholder:text-soft focus:border-accent-soft"
          />
          <button
            type="button"
            onClick={submitNewTag}
            disabled={!draft.trim() || creating}
            className="rounded-full bg-[var(--accent-strong)] px-3.5 py-1.5 text-xs font-semibold text-white transition active:scale-[0.96] disabled:opacity-40"
          >
            {creating ? "..." : "Criar"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft("");
              setCreateError(null);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition active:scale-[0.92]"
            aria-label="Cancelar nova tag"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {createError && <p className="mt-2 text-xs text-red-400">{createError}</p>}

      {atLimit && (
        <p className="mt-2 text-xs text-soft">
          Máximo de 3 tags selecionado
        </p>
      )}
    </div>
  );
}

// Select padronizado para horários de dormir/acordar.
function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-2xl border border-soft bg-surface-muted px-3 py-2.5 text-center text-sm text-primary focus:outline-none focus:ring-1 focus:ring-[var(--accent-soft)]"
      >
        {TIME_OPTIONS.map((t) => (
          <option key={t} value={t} className="bg-surface-elevated">
            {t}
          </option>
        ))}
      </select>
    </div>
  );
}
