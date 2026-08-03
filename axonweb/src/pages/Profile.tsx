import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ElementType,
  type ReactNode,
  type RefObject,
} from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Briefcase,
  CalendarClock,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCcw,
  Sparkles,
  Tag,
  Trash2,
  User,
  Workflow,
  X,
} from "lucide-react";

import { results, type ChronotypeResultKey } from "../data/results";
import Sidebar from "../components/layout/Sidebar";
import TagEditorSheet from "../components/settings/TagEditorSheet";
import * as api from "../lib/api";
import type { ProfileData } from "../lib/api";
import AppBackground from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";

// ===========================================================================
// MAPEAMENTOS DO PERFIL
// ===========================================================================

const CHRONOTYPE_TO_KEY: Record<string, ChronotypeResultKey> = {
  Matutino: "Matutino",
  Vespertino: "Vespertino",
  Noturno: "Noturno",
  Misto: "Misto",
  Bimodal: "Bimodal",
  morning: "Matutino",
  evening: "Vespertino",
  night: "Noturno",
  intermediate: "Misto",
};

const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

type ScheduleType = "flexible" | "fixed";

const SCHEDULE_TYPE_LABEL: Record<string, string> = {
  flexible: "Flexível",
  fixed: "Fixo",
};

// ===========================================================================
// PÁGINA DE PERFIL
// ===========================================================================

export default function Profile() {
  const navigate = useNavigate();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);

  useEffect(() => {
    if (!api.isLoggedIn()) {
      navigate("/login");
      return;
    }

    api
      .getProfile()
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [navigate]);

  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const fromBackend = profile?.chronotype
      ? CHRONOTYPE_TO_KEY[profile.chronotype]
      : undefined;

    if (fromBackend) return fromBackend;

    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, [profile]);

  const result = results[resultKey];
  const hasChronotype = Boolean(profile?.chronotype);

  const userName = profile?.name || "Usuário";
  const userEmail = profile?.email || "";

  const scheduleType: ScheduleType =
    profile?.schedule_type === "fixed" || profile?.schedule_type === "flexible"
      ? profile.schedule_type
      : "flexible";

  const scheduleLabel = SCHEDULE_TYPE_LABEL[scheduleType];

  function openResult() {
    if (!hasChronotype) {
      navigate("/questionnaire-intro");
      return;
    }

    navigate(`/result-report?chronotype=${resultKey}`);
  }

  async function handleScheduleTypeSave(nextScheduleType: ScheduleType) {
    setProfile((prev) =>
      prev ? ({ ...prev, schedule_type: nextScheduleType } as ProfileData) : prev
    );

    setScheduleModalOpen(false);

    try {
      const payload = {
        schedule_type: nextScheduleType,
      } as unknown as Parameters<typeof api.updateProfile>[0];

      const updated = await api.updateProfile(payload);
      setProfile(updated);
    } catch {
      // Mantém a alteração visual até o backend receber esse campo.
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 mx-auto min-h-screen w-full max-w-[430px] overflow-x-hidden px-4 pb-6 pt-5 lg:max-w-[1120px] lg:px-8 lg:pt-7">
        <PageHeader
          title="Perfil"
          subtitle="Suas informações"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        <ProfileHeader
          userName={userName}
          userEmail={userEmail}
          avatarUrl={profile?.avatar_url}
          onEditProfile={() => setIsEditOpen(true)}
        />

        <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start lg:gap-6">
          <div className="min-w-0 space-y-5">
            <ProfileSection title="Seu ritmo">
              <ProductiveProfileCard
                hasChronotype={hasChronotype}
                result={result}
                resultKey={resultKey}
                onOpenResult={openResult}
                onQuestionnaire={() => navigate("/questionnaire-intro")}
              />
            </ProfileSection>

            <ProfileSection title="Como o Axon se adapta a você">
              <PreferencesCard
                scheduleLabel={scheduleLabel}
                onEditSchedule={() => setScheduleModalOpen(true)}
                onEditTags={() => setTagEditorOpen(true)}
              />
            </ProfileSection>
          </div>

          <div className="min-w-0 space-y-5">
            <AxonMemories />
            <ReportsHistory />
          </div>
        </div>
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
        userName={userName}
        userEmail={userEmail}
      />

      <EditProfileModal
        isOpen={isEditOpen}
        currentName={userName}
        avatarUrl={profile?.avatar_url}
        onAvatarUpdate={(updated) => setProfile(updated)}
        onClose={() => setIsEditOpen(false)}
        onSaveName={(newName) => {
          setProfile((prev) => (prev ? { ...prev, name: newName } : prev));
          setIsEditOpen(false);
        }}
      />

      <ScheduleStyleModal
        isOpen={scheduleModalOpen}
        currentValue={scheduleType}
        onClose={() => setScheduleModalOpen(false)}
        onSave={handleScheduleTypeSave}
      />

      <TagEditorSheet
        isOpen={tagEditorOpen}
        onClose={() => setTagEditorOpen(false)}
      />
    </main>
  );
}

// ===========================================================================
// CARDS PRINCIPAIS DO PERFIL
// ===========================================================================

function ProfileHeader({
  userName,
  userEmail,
  avatarUrl,
  onEditProfile,
}: {
  userName: string;
  userEmail: string;
  avatarUrl?: string;
  onEditProfile: () => void;
}) {
  return (
    <section className="mt-5">
      <div className="relative overflow-hidden rounded-[2.15rem] border border-soft bg-surface-elevated px-5 pb-5 pt-7 text-center shadow-card backdrop-blur-2xl lg:p-7">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,var(--accent-soft),transparent_58%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[var(--accent-muted)] to-transparent" />

        <div className="relative mx-auto flex w-fit items-center justify-center">
          <div className="absolute h-44 w-44 rounded-full bg-[var(--accent)]/28 blur-[48px]" />
          <AvatarDisplay avatarUrl={avatarUrl} userName={userName} />
        </div>

        <div className="relative mx-auto mt-5 max-w-[20rem]">
          <h1 className="truncate text-2xl font-black leading-none tracking-[-0.05em] text-primary">
            {userName}
          </h1>

          {userEmail && (
            <div className="mx-auto mt-2 flex min-w-0 max-w-[18rem] items-center justify-center gap-1.5 text-[0.72rem] font-medium text-muted">
              <Mail className="h-3 w-3 shrink-0 text-accent" />
              <span className="truncate">{userEmail}</span>
            </div>
          )}

        </div>

        <button
          type="button"
          onClick={onEditProfile}
          className="relative mx-auto mt-5 inline-flex min-h-11 w-full max-w-[17rem] items-center justify-center rounded-2xl border border-soft bg-surface-muted px-5 text-sm font-semibold text-secondary transition hover:border-accent-soft hover:text-primary active:scale-[0.98]"
        >
          Editar perfil
          <Edit3 className="ml-2 h-4 w-4" />
        </button>
      </div>
    </section>
  );
}

function AvatarDisplay({
  avatarUrl,
  userName,
}: {
  avatarUrl?: string;
  userName: string;
}) {
  const initial = userName.trim().charAt(0).toUpperCase() || "A";

  return (
    <div className="relative z-10 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-3xl font-black text-accent shadow-[0_24px_80px_rgba(123,44,191,0.34)] ring-4 ring-white/6 dark:shadow-[0_28px_90px_rgba(168,85,247,0.32)]">
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={userName}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-5 min-w-0">
      <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-soft">
        {title}
      </p>

      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ProductiveProfileCard({
  hasChronotype,
  result,
  resultKey,
  onOpenResult,
  onQuestionnaire,
}: {
  hasChronotype: boolean;
  result: (typeof results)[ChronotypeResultKey];
  resultKey: ChronotypeResultKey;
  onOpenResult: () => void;
  onQuestionnaire: () => void;
}) {
  return (
    <article className="relative w-full min-w-0 overflow-hidden rounded-[1.95rem] border border-accent-soft bg-accent-soft p-5 text-primary shadow-card backdrop-blur-2xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_50%)]" />
      <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-[var(--accent)]/18 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 left-[-4rem] h-44 w-44 rounded-full bg-[var(--accent)]/10 blur-3xl" />

      <div className="relative">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-surface-elevated px-3 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em] text-accent">
              <Brain className="h-3.5 w-3.5" />
              Seu ritmo atual
            </div>

            <h2 className="text-[1.85rem] font-black leading-[0.95] tracking-[-0.06em] text-primary">
              {hasChronotype ? result.label : "Cronotipo não definido"}
            </h2>
          </div>

          <span className="shrink-0 rounded-full border border-accent-soft bg-surface-elevated px-2.5 py-1 text-[0.58rem] font-black uppercase tracking-[0.08em] text-accent">
            {resultKey}
          </span>
        </div>

        <p className="max-w-[21rem] text-sm leading-6 text-muted">
          {hasChronotype
            ? result.subtitle
            : "Responda o questionário para o Axon entender seus horários de energia, foco e descanso."}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <ProductiveMetric label="Pico de energia" value={result.energyPeak} />
          <ProductiveMetric label="Melhor foco" value={result.focusWindow} />
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <button
            type="button"
            onClick={onOpenResult}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-4 text-sm font-black text-white shadow-card transition active:scale-[0.98]"
          >
            Ver relatório completo
            <ChevronRight className="ml-2 h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onQuestionnaire}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-accent-soft bg-surface-elevated px-4 text-sm font-black text-accent transition active:scale-[0.98] sm:w-auto"
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Recalibrar
          </button>
        </div>

        <p className="mt-3 text-[0.68rem] leading-5 text-muted">
          Sua rotina mudou? Recalibre para o Axon ajustar melhor suas sugestões.
        </p>
      </div>
    </article>
  );
}

function ProductiveMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-[1.35rem] border border-accent-soft bg-surface-elevated px-3 py-3">
      <p className="truncate text-[0.62rem] font-black uppercase tracking-[0.08em] text-soft">
        {label}
      </p>
      <p className="mt-1 truncate text-xs font-black text-primary">{value}</p>
    </div>
  );
}

function PreferencesCard({
  scheduleLabel,
  onEditSchedule,
  onEditTags,
}: {
  scheduleLabel: string;
  onEditSchedule: () => void;
  onEditTags: () => void;
}) {
  return (
    <div className="grid min-w-0 gap-2">
      <PreferenceRow
        icon={CalendarClock}
        title="Estilo de rotina"
        description="Horários fixos ou rotina flexível."
        value={scheduleLabel}
        onClick={onEditSchedule}
      />

      <PreferenceRow
        icon={MessageCircle}
        title="Tom do Axon"
        description="Como o chat deve conversar com você."
        value="Em breve"
      />

      <PreferenceRow
        icon={Tag}
        title="Tags da revisão"
        description="Categorias usadas para registrar seu dia."
        value="Editar"
        onClick={onEditTags}
      />
    </div>
  );
}

function PreferenceRow({
  icon: Icon,
  title,
  description,
  value,
  onClick,
}: {
  icon: ElementType;
  title: string;
  description: string;
  value: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-primary">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted">{description}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-[0.62rem] font-black text-accent">
          {value}
        </span>

        {onClick && <ChevronRight className="h-4 w-4 text-soft" />}
      </div>
    </>
  );

  const className =
    "group flex w-full min-w-0 items-center gap-3 rounded-[1.55rem] border border-soft bg-surface-elevated px-4 py-3 text-left shadow-card backdrop-blur-2xl transition active:scale-[0.98]";

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

// ===========================================================================
// MEMÓRIAS DO AXON
// ===========================================================================

function AxonMemories() {
  const [memories, setMemories] = useState<api.UserMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const visibleMemories = memories.slice(0, 2);

  useEffect(() => {
    api
      .getMemories()
      .then(setMemories)
      .catch(() => setMemories([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(id: string) {
    setDeletingId(id);

    try {
      await api.deleteMemory(id);
      setMemories((prev) => prev.filter((memory) => memory.id !== id));
      setConfirmingId(null);
    } catch {
      // Mantém a memória na lista em caso de erro.
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <ProfileSection title="Memórias do Axon">
        <div className="relative min-w-0 overflow-hidden rounded-[1.95rem] border border-soft bg-surface-elevated p-5 shadow-card backdrop-blur-2xl lg:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_58%)]" />
          <div className="pointer-events-none absolute -right-14 -top-16 h-36 w-36 rounded-full bg-[var(--accent)]/12 blur-3xl" />

          <div className="relative">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
                <Brain className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <p className="truncate text-sm font-black text-primary">
                    O que torna o Axon mais pessoal
                  </p>

                  <span className="shrink-0 rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-[0.62rem] font-black text-accent">
                    {memories.length}
                  </span>
                </div>

                <p className="mt-1 text-xs leading-5 text-muted">
                  Informações salvas pelo chat para adaptar respostas,
                  planejamento e recomendações ao seu contexto real.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {loading ? (
                <div className="flex items-center gap-2 rounded-[1.35rem] border border-soft bg-surface-muted px-4 py-5 text-xs text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  Carregando memórias…
                </div>
              ) : memories.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-soft bg-surface-muted px-4 py-6 text-center">
                  <p className="text-sm font-black text-primary">
                    Nenhuma memória registrada
                  </p>
                  <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-5 text-muted">
                    Quando o Axon aprender algo importante sobre você, aparecerá aqui.
                  </p>
                </div>
              ) : (
                visibleMemories.map((memory) => (
                  <p
                    key={memory.id}
                    className="line-clamp-2 rounded-[1.25rem] border border-soft bg-surface-muted px-4 py-3 text-xs leading-5 text-secondary"
                  >
                    {memory.content}
                  </p>
                ))
              )}
            </div>

            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft px-4 text-sm font-black text-accent transition active:scale-[0.98]"
            >
              Ver memórias salvas
              <ChevronRight className="ml-2 h-4 w-4" />
            </button>
          </div>
        </div>
      </ProfileSection>

      <MemoriesModal
        isOpen={isModalOpen}
        memories={memories}
        confirmingId={confirmingId}
        deletingId={deletingId}
        onClose={() => setIsModalOpen(false)}
        onAskConfirm={setConfirmingId}
        onCancelConfirm={() => setConfirmingId(null)}
        onDelete={handleDelete}
      />
    </>
  );
}

function MemoriesModal({
  isOpen,
  memories,
  confirmingId,
  deletingId,
  onClose,
  onAskConfirm,
  onCancelConfirm,
  onDelete,
}: {
  isOpen: boolean;
  memories: api.UserMemory[];
  confirmingId: string | null;
  deletingId: string | null;
  onClose: () => void;
  onAskConfirm: (id: string) => void;
  onCancelConfirm: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="custom-scrollbar max-h-[86dvh] w-full max-w-[430px] overflow-y-auto rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-black text-primary">
                  Memórias do Axon
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Informações salvas a partir das conversas.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {memories.length === 0 ? (
              <div className="rounded-[1.35rem] border border-dashed border-soft bg-surface-muted px-4 py-8 text-center">
                <p className="text-sm font-black text-primary">
                  Nenhuma memória ainda
                </p>
                <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-5 text-muted">
                  Quando o chat salvar informações importantes, elas aparecem aqui.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {memories.map((memory) => (
                  <div
                    key={memory.id}
                    className="rounded-[1.35rem] border border-soft bg-surface-muted px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      <p className="min-w-0 flex-1 break-words text-xs leading-5 text-secondary">
                        {memory.content}
                      </p>

                      {confirmingId !== memory.id && (
                        <button
                          type="button"
                          onClick={() => onAskConfirm(memory.id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-soft bg-surface-elevated text-muted transition active:scale-[0.94]"
                          aria-label="Remover memória"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {confirmingId === memory.id && (
                      <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--border-soft)] pt-3">
                        <p className="text-[0.7rem] leading-4 text-muted">
                          Remover esta memória permanentemente?
                        </p>

                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={onCancelConfirm}
                            disabled={deletingId === memory.id}
                            className="flex h-8 w-8 items-center justify-center rounded-xl border border-soft bg-surface-elevated text-muted active:scale-[0.94] disabled:opacity-50"
                            aria-label="Cancelar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => onDelete(memory.id)}
                            disabled={deletingId === memory.id}
                            className="flex h-8 items-center gap-1.5 rounded-xl bg-rose-500/90 px-3 text-xs font-semibold text-white active:scale-[0.96] disabled:opacity-60"
                          >
                            {deletingId === memory.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            Remover
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ===========================================================================
// HISTÓRICO DE RELATÓRIOS
// ===========================================================================

// Formata "2026-07-27" + "2026-08-02" como "27 jul – 2 ago".
function formatReportRange(start: string, end: string) {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "short",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

function ReportsHistory() {
  const [reports, setReports] = useState<api.PeriodReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "weekly" | "monthly">("all");

  useEffect(() => {
    api
      .getReportsHistory()
      .then(setReports)
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const visible =
    filter === "all" ? reports : reports.filter((r) => r.period_type === filter);
  const preview = reports.slice(0, 2);

  return (
    <>
      <ProfileSection title="Relatórios do Axon">
        <div className="relative min-w-0 overflow-hidden rounded-[1.95rem] border border-soft bg-surface-elevated p-5 shadow-card backdrop-blur-2xl lg:p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_58%)]" />

          <div className="relative">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
                <FileText className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <p className="truncate text-sm font-black text-primary">
                    Seus resumos de semana e mês
                  </p>

                  <span className="shrink-0 rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-[0.62rem] font-black text-accent">
                    {reports.length}
                  </span>
                </div>

                <p className="mt-1 text-xs leading-5 text-muted">
                  Todo relatório que o Axon já escreveu fica guardado aqui para
                  você comparar períodos.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {loading ? (
                <div className="flex items-center gap-2 rounded-[1.35rem] border border-soft bg-surface-muted px-4 py-5 text-xs text-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                  Carregando relatórios…
                </div>
              ) : reports.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-soft bg-surface-muted px-4 py-6 text-center">
                  <p className="text-sm font-black text-primary">
                    Nenhum relatório ainda
                  </p>
                  <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-5 text-muted">
                    O Axon escreve um resumo ao fim de cada semana e de cada mês.
                    O primeiro aparece aqui assim que o período fechar.
                  </p>
                </div>
              ) : (
                preview.map((report) => (
                  <div
                    key={report.id}
                    className="rounded-[1.25rem] border border-soft bg-surface-muted px-4 py-3"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-accent">
                        {report.period_type === "weekly" ? "Semana" : "Mês"}
                      </span>
                      <span className="shrink-0 text-[0.62rem] text-muted">
                        {formatReportRange(report.period_start, report.period_end)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs leading-5 text-secondary">
                      {report.narrative}
                    </p>
                  </div>
                ))
              )}
            </div>

            {reports.length > 0 && (
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft px-4 text-sm font-black text-accent transition active:scale-[0.98]"
              >
                Ver todos os relatórios
                <ChevronRight className="ml-2 h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </ProfileSection>

      <ReportsHistoryModal
        isOpen={isModalOpen}
        reports={visible}
        filter={filter}
        onFilterChange={setFilter}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}

function ReportsHistoryModal({
  isOpen,
  reports,
  filter,
  onFilterChange,
  onClose,
}: {
  isOpen: boolean;
  reports: api.PeriodReport[];
  filter: "all" | "weekly" | "monthly";
  onFilterChange: (value: "all" | "weekly" | "monthly") => void;
  onClose: () => void;
}) {
  const filters: { key: "all" | "weekly" | "monthly"; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "weekly", label: "Semanais" },
    { key: "monthly", label: "Mensais" },
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center"
        >
          <motion.div
            initial={{ y: "100%", opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0.6 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft sm:rounded-[2rem]"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-black text-primary">
                  Relatórios do Axon
                </p>
                <p className="mt-1 text-xs text-muted">
                  Compare como foram suas semanas e meses.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4 flex gap-2">
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onFilterChange(f.key)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition active:scale-[0.96] ${
                    filter === f.key
                      ? "border-accent-soft bg-accent-soft text-accent"
                      : "border-soft bg-surface-muted text-muted"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {reports.length === 0 ? (
              <div className="rounded-[1.35rem] border border-dashed border-soft bg-surface-muted px-4 py-8 text-center">
                <p className="text-sm text-muted">
                  Nenhum relatório neste filtro.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {reports.map((report) => (
                  <article
                    key={report.id}
                    className="rounded-[1.5rem] border border-soft bg-surface-muted p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-[0.62rem] font-black text-accent">
                        {report.period_type === "weekly" ? "Semana" : "Mês"}
                      </span>
                      <span className="shrink-0 text-[0.65rem] text-muted">
                        {formatReportRange(
                          report.period_start,
                          report.period_end
                        )}
                      </span>
                    </div>

                    <p className="text-xs leading-6 text-secondary">
                      {report.narrative}
                    </p>

                    {/* Números do período: é o que permite comparar entre si. */}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-full border border-accent-soft bg-accent-soft px-3 py-1 text-[0.65rem] font-semibold text-accent">
                        {report.data.avg_completion_rate}% de conclusão média
                      </span>

                      {report.data.most_productive_day && (
                        <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-[0.65rem] font-semibold text-emerald-700 dark:text-emerald-100">
                          Melhor dia:{" "}
                          {report.data.most_productive_day.completion_rate}%
                        </span>
                      )}

                      {report.data.key_tasks.defined > 0 && (
                        <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-[0.65rem] font-semibold text-amber-700 dark:text-amber-100">
                          {report.data.key_tasks.done}/
                          {report.data.key_tasks.defined} tarefas-chave
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ===========================================================================
// MODAL DE ESTILO DE ROTINA
// ===========================================================================

type WeekDayKey = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";

type FixedRoutineEntry = {
  id: string;
  activity: string;
  days: WeekDayKey[];
  startTime: string;
  endTime: string;
};

const WEEK_DAYS: Array<{ key: WeekDayKey; label: string; fullLabel: string }> = [
  { key: "seg", label: "S", fullLabel: "Segunda" },
  { key: "ter", label: "T", fullLabel: "Terça" },
  { key: "qua", label: "Q", fullLabel: "Quarta" },
  { key: "qui", label: "Q", fullLabel: "Quinta" },
  { key: "sex", label: "S", fullLabel: "Sexta" },
  { key: "sab", label: "S", fullLabel: "Sábado" },
  { key: "dom", label: "D", fullLabel: "Domingo" },
];

function createFixedRoutineEntry(): FixedRoutineEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    activity: "",
    days: [],
    startTime: "",
    endTime: "",
  };
}

function ScheduleStyleModal({
  isOpen,
  currentValue,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  currentValue: ScheduleType;
  onClose: () => void;
  onSave: (value: ScheduleType) => void;
}) {
  const [selected, setSelected] = useState<ScheduleType>(currentValue);
  const [fixedRoutines, setFixedRoutines] = useState<FixedRoutineEntry[]>([
    createFixedRoutineEntry(),
  ]);

  useEffect(() => {
    if (!isOpen) return;

    setSelected(currentValue);
    setFixedRoutines([createFixedRoutineEntry()]);
  }, [isOpen, currentValue]);

  function updateFixedRoutine(
    id: string,
    field: "activity" | "startTime" | "endTime",
    value: string
  ) {
    setFixedRoutines((current) =>
      current.map((routine) =>
        routine.id === id ? { ...routine, [field]: value } : routine
      )
    );
  }

  function toggleRoutineDay(id: string, day: WeekDayKey) {
    setFixedRoutines((current) =>
      current.map((routine) => {
        if (routine.id !== id) return routine;

        const nextDays = routine.days.includes(day)
          ? routine.days.filter((currentDay) => currentDay !== day)
          : [...routine.days, day];

        return {
          ...routine,
          days: nextDays,
        };
      })
    );
  }

  function addFixedRoutine() {
    setFixedRoutines((current) => [...current, createFixedRoutineEntry()]);
  }

  function removeFixedRoutine(id: string) {
    setFixedRoutines((current) => {
      if (current.length === 1) return current;

      return current.filter((routine) => routine.id !== id);
    });
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="custom-scrollbar max-h-[88dvh] w-full max-w-[460px] overflow-y-auto rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl"
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-black text-primary">
                  Estilo de rotina
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Configure seus horários fixos sem precisar digitar os dias.
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-2">
              <ScheduleOption
                active={selected === "flexible"}
                icon={Sparkles}
                title="Rotina flexível"
                description="Meus horários mudam bastante ou organizo o dia livremente."
                onClick={() => setSelected("flexible")}
              />

              <ScheduleOption
                active={selected === "fixed"}
                icon={Briefcase}
                title="Rotina fixa"
                description="Tenho trabalho, estudo ou compromissos em horários definidos."
                onClick={() => setSelected("fixed")}
              />
            </div>

            {selected === "fixed" && (
              <div className="mt-4 space-y-3">
                <div className="rounded-[1.5rem] border border-accent-soft bg-accent-soft p-4">
                  <p className="text-xs font-black uppercase tracking-[0.12em] text-accent">
                    Rotinas fixas
                  </p>

                  <p className="mt-1 text-xs leading-5 text-muted">
                    Adicione uma rotina para cada bloco fixo do seu dia. Assim,
                    se algum dia tiver horário diferente, basta criar outro
                    bloco com dias e horários próprios.
                  </p>
                </div>

                {fixedRoutines.map((routine, index) => (
                  <FixedRoutineCard
                    key={routine.id}
                    routine={routine}
                    index={index}
                    canRemove={fixedRoutines.length > 1}
                    onRemove={() => removeFixedRoutine(routine.id)}
                    onChange={(field, value) =>
                      updateFixedRoutine(routine.id, field, value)
                    }
                    onToggleDay={(day) => toggleRoutineDay(routine.id, day)}
                  />
                ))}

                <button
                  type="button"
                  onClick={addFixedRoutine}
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl border border-dashed border-accent-soft bg-accent-soft px-4 text-sm font-black text-accent transition active:scale-[0.98]"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Adicionar outra rotina
                </button>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onClose}
                className="min-h-12 rounded-2xl border border-soft bg-surface-muted px-4 text-sm font-semibold text-secondary transition active:scale-[0.98]"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => onSave(selected)}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-4 text-sm font-semibold text-white shadow-card transition active:scale-[0.98]"
              >
                Salvar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ScheduleOption({
  active,
  icon: Icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: ElementType;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-[1.45rem] border p-3 text-left transition active:scale-[0.98] ${
        active
          ? "border-accent-soft bg-accent-soft"
          : "border-soft bg-surface-muted"
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
          active
            ? "border-accent-soft bg-surface-elevated text-accent"
            : "border-soft bg-surface-elevated text-muted"
        }`}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-black text-primary">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>

      {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
    </button>
  );
}

function FixedRoutineCard({
  routine,
  index,
  canRemove,
  onRemove,
  onChange,
  onToggleDay,
}: {
  routine: FixedRoutineEntry;
  index: number;
  canRemove: boolean;
  onRemove: () => void;
  onChange: (
    field: "activity" | "startTime" | "endTime",
    value: string
  ) => void;
  onToggleDay: (day: WeekDayKey) => void;
}) {
  return (
    <div className="rounded-[1.5rem] border border-soft bg-surface-muted p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.12em] text-soft">
          Rotina {index + 1}
        </p>

        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-red-300/20 bg-red-500/10 text-red-600 transition active:scale-[0.94] dark:text-red-300"
            aria-label="Remover rotina"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <ScheduleInput
        label="Tipo de compromisso"
        placeholder="Ex.: trabalho, faculdade, estágio"
        value={routine.activity}
        onChange={(value) => onChange("activity", value)}
      />

      <div className="mt-3">
        <p className="mb-2 text-xs font-semibold text-muted">
          Dias da semana
        </p>

        <div className="grid grid-cols-7 gap-1.5">
          {WEEK_DAYS.map((day) => {
            const active = routine.days.includes(day.key);

            return (
              <button
                key={day.key}
                type="button"
                onClick={() => onToggleDay(day.key)}
                title={day.fullLabel}
                className={`flex h-9 items-center justify-center rounded-xl border text-xs font-black transition active:scale-[0.94] ${
                  active
                    ? "border-accent-soft bg-[var(--accent-strong)] text-white"
                    : "border-soft bg-surface-elevated text-muted"
                }`}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <ScheduleInput
          label="Início"
          type="time"
          placeholder="08:00"
          value={routine.startTime}
          onChange={(value) => onChange("startTime", value)}
        />

        <ScheduleInput
          label="Fim"
          type="time"
          placeholder="18:00"
          value={routine.endTime}
          onChange={(value) => onChange("endTime", value)}
        />
      </div>
    </div>
  );
}

function ScheduleInput({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "time";
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-muted">
        {label}
      </span>

      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-soft bg-surface-elevated px-4 py-3 text-sm font-medium text-primary outline-none transition placeholder:text-soft focus:border-accent-soft"
      />
    </label>
  );
}

// ===========================================================================
// AVATAR DO PERFIL
// ===========================================================================

function AvatarUpload({
  avatarUrl,
  onUpdate,
}: {
  avatarUrl?: string;
  onUpdate: (profile: ProfileData) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Estado local do upload, menu e erro visual.
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  // Fecha o menu de avatar ao clicar fora dele.
  useEffect(() => {
    if (!showMenu) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }

    document.addEventListener("mousedown", handleClick);

    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [showMenu]);

  // Envia a nova imagem e atualiza o perfil retornado pelo backend.
  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];

    if (!file) return;

    setShowMenu(false);
    setError(null);
    setLoading(true);

    try {
      const updated = await api.uploadAvatar(file);
      onUpdate(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao enviar imagem.");
    } finally {
      setLoading(false);

      // Permite selecionar o mesmo arquivo novamente depois de um envio.
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  // Remove a foto atual e sincroniza o card com o perfil atualizado.
  async function handleDelete() {
    setShowMenu(false);
    setLoading(true);
    setError(null);

    try {
      const updated = await api.deleteAvatar();
      onUpdate(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro ao remover imagem.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative shrink-0 overflow-visible" ref={menuRef}>
      {/* Input fica oculto; o clique acontece pelo avatar. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        type="button"
        onClick={() =>
          avatarUrl ? setShowMenu((value) => !value) : fileInputRef.current?.click()
        }
        disabled={loading}
        className="group relative flex h-28 w-28 shrink-0 items-center justify-center overflow-visible rounded-full text-3xl font-black text-accent transition active:scale-[0.97] disabled:opacity-60"
        aria-label="Foto de perfil"
      >
        <span className="absolute inset-0 overflow-hidden rounded-full bg-accent-soft shadow-[0_24px_80px_rgba(123,44,191,0.34)] ring-4 ring-white/6 dark:shadow-[0_28px_90px_rgba(168,85,247,0.32)]">
          {loading ? (
            <span className="flex h-full w-full items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-accent" />
            </span>
          ) : avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              <User className="h-10 w-10" />
            </span>
          )}
        </span>

        {!loading && (
          <span className="absolute -bottom-1 -right-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--surface-elevated)] bg-[var(--accent-strong)] text-white shadow-card transition group-active:scale-[0.94]">
            <Camera className="h-3.5 w-3.5" />
          </span>
        )}
      </button>

      {/* Menu aparece apenas quando já existe uma foto cadastrada. */}
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute left-1/2 top-[calc(100%+12px)] z-50 min-w-[180px] -translate-x-1/2 overflow-hidden rounded-2xl border border-soft bg-surface-elevated py-1 text-primary shadow-soft backdrop-blur-2xl"
          >
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                fileInputRef.current?.click();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-secondary transition hover:bg-surface-muted active:bg-surface-muted"
            >
              <Camera className="h-4 w-4 text-accent" />
              Trocar foto
            </button>

            <button
              type="button"
              onClick={handleDelete}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm text-red-600 transition hover:bg-red-500/10 active:bg-red-500/10 dark:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              Remover foto
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <p className="absolute left-1/2 top-[calc(100%+42px)] z-50 w-52 -translate-x-1/2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-[0.7rem] leading-5 text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

// ===========================================================================
// MODAL DE EDIÇÃO DE NOME
// ===========================================================================

function EditProfileModal({
  isOpen,
  currentName,
  avatarUrl,
  onAvatarUpdate,
  onClose,
  onSaveName,
}: {
  isOpen: boolean;
  currentName: string;
  avatarUrl?: string;
  onAvatarUpdate: (profile: ProfileData) => void;
  onClose: () => void;
  onSaveName: (name: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const [nameValue, setNameValue] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNameValue(currentName);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen, currentName]);

  async function handleSave() {
    const trimmedName = nameValue.trim();

    if (!trimmedName) {
      setError("O nome não pode ser vazio.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await api.updateProfile({ name: trimmedName });
      onSaveName(trimmedName);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => event.target === event.currentTarget && onClose()}
        >
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="custom-scrollbar max-h-[86dvh] w-full max-w-[430px] overflow-y-auto rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
                  <Edit3 className="h-4 w-4" />
                </div>

                <div>
                  <p className="text-sm font-black text-primary">
                    Editar perfil
                  </p>
                  <p className="text-xs text-muted">
                    Foto e nome do perfil
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-5 flex flex-col items-center text-center">
              <AvatarUpload avatarUrl={avatarUrl} onUpdate={onAvatarUpdate} />

            </div>

            <div className="space-y-3">
              <ProfileEditField
                inputRef={inputRef}
                icon={User}
                label="Nome"
                value={nameValue}
                onChange={setNameValue}
                placeholder="Seu nome"
              />

            </div>

            {error && (
              <p className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="min-h-12 rounded-2xl border border-soft bg-surface-muted px-4 text-sm font-semibold text-secondary transition active:scale-[0.98] disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !nameValue.trim()}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[var(--accent-strong)] px-4 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Salvar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ProfileEditField({
  inputRef,
  icon: Icon,
  label,
  value,
  onChange,
  placeholder,
  disabled = false,
  helper,
}: {
  inputRef?: RefObject<HTMLInputElement | null>;
  icon: ElementType;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  helper?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-black uppercase tracking-[0.12em] text-soft">
        {label}
      </span>

      <div className="flex min-h-12 items-center gap-3 rounded-2xl border border-soft bg-surface-muted px-4 transition focus-within:border-accent-soft">
        <Icon className="h-4 w-4 shrink-0 text-accent" />

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm font-medium text-primary outline-none placeholder:text-soft disabled:cursor-not-allowed disabled:text-muted"
        />
      </div>

      {helper && <p className="mt-2 px-1 text-xs text-muted">{helper}</p>}
    </label>
  );
}