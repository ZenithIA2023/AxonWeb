import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Check,
  Clock,
  ListChecks,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import Sidebar from "../components/layout/Sidebar";
import NewRoutineSheet from "../components/routines/NewRoutineSheet";
import {
  blankItem,
  draftToCreateInput,
  draftToUpdateInput,
  itemToDraft,
  itemValid,
  RoutineItemEditor,
  WEEKDAYS,
  type DraftItem,
} from "../components/routines/RoutineItem";
import * as api from "../lib/api";
import type { Routine, RoutineDetail, RoutineItem } from "../lib/api";
import AppBackground from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import EmptyState from "../components/ui/EmptyState";

// ===========================================================================
// LISTA DE ROTINAS
// ===========================================================================
// Renderiza a aba/página de rotinas e abre o fluxo de criação de nova rotina.
export default function Routines({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const navigate = useNavigate();

  // Controles visuais da página/lista.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Carrega a lista de rotinas do usuário.
  function load() {
    setLoading(true);
    api
      .getRoutines()
      .then((data) => {
        setRoutines(data);
        setError(null);
      })
      .catch((e: Error) => {
        setError(e.message || "Não foi possível carregar suas rotinas.");
        setRoutines([]);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  // Pausa ou retoma uma rotina diretamente pelo card.
  async function toggleStatus(routine: Routine) {
    if (actioningId) return;
    setActioningId(routine.id);
    try {
      if (routine.status === "active") {
        await api.pauseRoutine(routine.id);
      } else {
        await api.resumeRoutine(routine.id);
      }
      // Recarrega para refletir streak/contagens recalculados no backend.
      const fresh = await api.getRoutines();
      setRoutines(fresh);
      setError(null);
    } catch (e) {
      setError(
        (e as Error).message || "Não foi possível atualizar a rotina."
      );
    } finally {
      setActioningId(null);
    }
  }

  function goCreate() {
    setIsCreateOpen(true);
  }

  const isEmpty = !loading && routines !== null && routines.length === 0;

  // Conteúdo compartilhado entre a rota própria e a aba embedded do Planning.
  const inner = (
    <>
      <section className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.7rem] font-semibold leading-tight tracking-[-0.04em] text-primary">
            Minhas Rotinas
          </h1>

          <p className="mt-1 text-sm text-muted">
            Hábitos que o Axon agenda por você.
          </p>
        </div>

        <button
            type="button"
            onClick={goCreate}
            className="flex shrink-0 items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent shadow-card transition active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" />
          Nova Rotina
        </button>
      </section>

      {error && (
          <div className="mb-4 rounded-[1.4rem] border border-red-300/25 bg-red-500/10 p-4 text-sm leading-6 text-red-600 dark:text-red-600 dark:text-red-600 dark:text-red-100/80">
            {error}
          </div>
      )}

      {loading ? (
          <RoutinesSkeleton />
        ) : isEmpty ? (
          <EmptyState
            icon={Repeat}
            title="Nenhuma rotina por aqui ainda"
            description="Crie sua primeira rotina e deixe o Axon encaixar os hábitos nos seus melhores horários de energia."
            actionLabel="Criar primeira rotina"
            onAction={goCreate}
          />
        ) : (
          <div className="space-y-3">
            {routines!.map((routine) => (
              <RoutineCard
                key={routine.id}
                routine={routine}
                busy={actioningId === routine.id}
                disabled={actioningId !== null && actioningId !== routine.id}
                onToggle={() => toggleStatus(routine)}
                onOpen={() => navigate(`/rotinas/${routine.id}`)}
              />
            ))}
          </div>
      )}
    </>
  );

  // Sheet de criação fica fora do conteúdo para preservar o empilhamento visual.
  const modals = (
    <NewRoutineSheet
      isOpen={isCreateOpen}
      onClose={() => setIsCreateOpen(false)}
      onCreated={load}
    />
  );

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
          title="Rotinas"
          subtitle="Hábitos recorrentes"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        {inner}
      </div>

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {modals}
    </main>
  );
}

// ===========================================================================
// CARD RESUMIDO DA ROTINA
// ===========================================================================

function RoutineCard({
  routine,
  busy,
  disabled,
  onToggle,
  onOpen,
}: {
  routine: Routine;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const isActive = routine.status === "active";
  const itemLabel = `${routine.item_count} ${
    routine.item_count === 1 ? "item" : "itens"
  }`;

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-[1.7rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl transition active:scale-[0.99] hover:border-medium"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
            <Repeat className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-primary">
              {routine.name}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusBadge status={routine.status} />

              {routine.status === "paused" && routine.paused_until && (
                <span className="text-[0.7rem] text-muted">
                  até {formatDate(routine.paused_until)}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          disabled={busy || disabled}
          className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition active:scale-[0.97] ${
            isActive
              ? "border-soft bg-surface-muted text-secondary"
              : "border-emerald-300/25 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-500/15 dark:text-emerald-100"
          } ${busy || disabled ? "opacity-40" : ""}`}
        >
          {busy ? (
            "..."
          ) : isActive ? (
            <>
              <Pause className="h-3.5 w-3.5" />
              Pausar
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" />
              Retomar
            </>
          )}
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-[var(--border-soft)] pt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 text-muted" />
          {itemLabel}
        </span>

        <span className="text-soft">•</span>

        {routine.streak > 0 ? (
          <span className="font-medium text-amber-700 dark:text-amber-100/90">
            🔥 {routine.streak}{" "}
            {routine.streak === 1 ? "dia seguido" : "dias seguidos"}
          </span>
        ) : (
          <span className="text-muted">Comece sua sequência hoje</span>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// BADGES, ESTADOS VISUAIS E HELPERS DA LISTA
// ===========================================================================

function StatusBadge({ status }: { status: Routine["status"] }) {
  const active = status === "active";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-medium ${
        active
          ? "border-emerald-300/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
          : "border-amber-300/25 bg-amber-500/10 text-amber-700 dark:text-amber-200"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? "bg-emerald-400" : "bg-amber-400"
        }`}
      />
      {active ? "Ativa" : "Pausada"}
    </span>
  );
}

function RoutinesSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-[1.7rem] border border-soft bg-surface-muted p-4"
        >
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 shrink-0 animate-pulse rounded-2xl bg-surface-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded-full bg-surface-muted" />
              <div className="h-3 w-1/4 animate-pulse rounded-full bg-surface-muted" />
            </div>
            <div className="h-7 w-20 animate-pulse rounded-full bg-surface-muted" />
          </div>
          <div className="mt-4 h-3 w-1/2 animate-pulse rounded-full bg-surface-muted" />
        </div>
      ))}
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ===========================================================================
// DETALHE DE UMA ROTINA
// ===========================================================================
// Rota /rotinas/:id. Permite renomear, pausar, retomar, excluir e editar itens.
export function RoutineDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  // Estado principal da página de detalhe.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [routine, setRoutine] = useState<RoutineDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edição inline do nome da rotina.
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Edição de item existente.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<DraftItem | null>(null);
  const [savingItem, setSavingItem] = useState(false);

  // Criação de novo item dentro da rotina.
  const [newItemDraft, setNewItemDraft] = useState<DraftItem | null>(null);
  const [savingNewItem, setSavingNewItem] = useState(false);

  // Confirmação de exclusão de item.
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [busyDeleteItem, setBusyDeleteItem] = useState(false);

  // Pausa, retomada e exclusão da rotina inteira.
  const [showPause, setShowPause] = useState(false);
  const [pauseUntil, setPauseUntil] = useState("");
  const [busyStatus, setBusyStatus] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Carrega a rotina selecionada pelo id da rota.
  function load() {
    setLoading(true);
    api
      .getRoutine(id)
      .then((data) => {
        setRoutine(data);
        setError(null);
      })
      .catch((e: Error) => {
        setError(e.message || "Não foi possível carregar a rotina.");
        setRoutine(null);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Inicia a edição inline do nome usando o valor atual da rotina.
  function startEditName() {
    if (!routine) return;
    setNameDraft(routine.name);
    setEditingName(true);
  }

  async function saveName() {
    if (!routine || !nameDraft.trim()) return;
    setSavingName(true);
    try {
      const updated = await api.updateRoutine(routine.id, {
        name: nameDraft.trim(),
      });
      setRoutine(updated);
      setEditingName(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Não foi possível renomear a rotina.");
    } finally {
      setSavingName(false);
    }
  }

  // Converte o item salvo para o draft usado pelo RoutineItemEditor.
  function startEditItem(item: RoutineItem) {
    setItemDraft(itemToDraft(item));
    setEditingItemId(item.id);
  }

  function cancelEditItem() {
    setEditingItemId(null);
    setItemDraft(null);
  }

  // Salva alterações de um item existente e recarrega a rotina.
  async function saveItem() {
    if (!routine || !itemDraft || !editingItemId) return;
    setSavingItem(true);
    try {
      await api.updateRoutineItem(
        routine.id,
        editingItemId,
        draftToUpdateInput(itemDraft)
      );
      // Recarrega a rotina para refletir itens + streak recalculados.
      const fresh = await api.getRoutine(routine.id);
      setRoutine(fresh);
      cancelEditItem();
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Não foi possível salvar o item.");
    } finally {
      setSavingItem(false);
    }
  }

  // Adiciona um novo item à rotina atual.
  async function saveNewItem() {
    if (!routine || !newItemDraft) return;
    setSavingNewItem(true);
    try {
      await api.addRoutineItem(routine.id, draftToCreateInput(newItemDraft));
      const fresh = await api.getRoutine(routine.id);
      setRoutine(fresh);
      setNewItemDraft(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Não foi possível adicionar o item.");
    } finally {
      setSavingNewItem(false);
    }
  }

  // Exclui um item; se for o último, a rotina inteira é removida.
  async function confirmDeleteItem() {
    if (!routine || !deletingItemId) return;
    setBusyDeleteItem(true);
    try {
      // Era o último item: uma rotina sem itens não faz sentido, então a
      // exclusão do item também exclui a rotina inteira (cascata no backend).
      if (routine.items.length === 1) {
        await api.deleteRoutine(routine.id);
        navigate("/rotinas");
        return;
      }
      await api.deleteRoutineItem(routine.id, deletingItemId);
      const fresh = await api.getRoutine(routine.id);
      setRoutine(fresh);
      setDeletingItemId(null);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Não foi possível excluir o item.");
    } finally {
      setBusyDeleteItem(false);
    }
  }

  // Pausa a rotina, com ou sem data automática de retomada.
  async function confirmPause() {
    if (!routine) return;
    setBusyStatus(true);
    try {
      const updated = await api.pauseRoutine(routine.id, pauseUntil || null);
      setRoutine(updated);
      setShowPause(false);
      setPauseUntil("");
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Não foi possível pausar a rotina.");
    } finally {
      setBusyStatus(false);
    }
  }

  // Retoma uma rotina pausada.
  async function resume() {
    if (!routine) return;
    setBusyStatus(true);
    try {
      const updated = await api.resumeRoutine(routine.id);
      setRoutine(updated);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Não foi possível retomar a rotina.");
    } finally {
      setBusyStatus(false);
    }
  }

  // Exclui a rotina inteira e retorna para a lista.
  async function confirmDelete() {
    if (!routine) return;
    setDeleting(true);
    try {
      await api.deleteRoutine(routine.id);
      navigate("/rotinas");
    } catch (e) {
      setError((e as Error).message || "Não foi possível excluir a rotina.");
      setDeleting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 min-h-screen px-4 pb-6 pt-5">
        <PageHeader
          leadingVariant="back"
          onLeadingClick={() => navigate("/rotinas")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        {loading ? (
          <DetailSkeleton />
        ) : !routine ? (
          <div className="rounded-[1.6rem] border border-red-300/25 bg-red-500/10 p-5 text-sm leading-6 text-red-600 dark:text-red-600 dark:text-red-600 dark:text-red-100/80">
            {error || "Rotina não encontrada."}
          </div>
        ) : (
          <>
            {/* Nome editável inline */}
            <section className="mb-5">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="min-w-0 flex-1 rounded-2xl border border-soft bg-surface-muted px-4 py-2.5 text-lg font-semibold text-primary outline-none focus:border-accent-soft"
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={!nameDraft.trim() || savingName}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-300/25 bg-emerald-500/10 text-emerald-700 transition active:scale-[0.96] disabled:opacity-40 dark:text-emerald-100"
                    aria-label="Salvar nome"
                  >
                    <Check className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(false)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary transition active:scale-[0.96]"
                    aria-label="Cancelar"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <h1 className="min-w-0 flex-1 text-[1.8rem] font-semibold leading-tight tracking-[-0.04em] text-primary">
                    {routine.name}
                  </h1>
                  <button
                    type="button"
                    onClick={startEditName}
                    className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
                    aria-label="Editar nome"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                </div>
              )}
            </section>

            {/* Status + streak */}
            <section className="mb-5 rounded-[1.7rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge status={routine.status} />
                {routine.status === "paused" && routine.paused_until && (
                  <span className="text-xs text-muted">
                    Retomar em {formatDate(routine.paused_until)}
                  </span>
                )}
              </div>

              <div className="mt-4 rounded-[1.4rem] border border-amber-300/15 bg-amber-500/[0.07] p-4">
                {routine.streak > 0 ? (
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-100/90">
                    🔥 {routine.streak}{" "}
                    {routine.streak === 1 ? "dia seguido" : "dias seguidos"}
                  </p>
                ) : (
                  <p className="text-sm font-medium text-muted">
                    Sem sequência ainda
                  </p>
                )}
                <p className="mt-1 text-xs leading-5 text-muted">
                  Conclua todos os itens do dia para manter sua sequência.
                </p>
              </div>

              <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                <span>Início {formatDate(routine.start_date)}</span>
                <span className="text-soft">•</span>
                <span>
                  {routine.end_date
                    ? `Término ${formatDate(routine.end_date)}`
                    : "Sem data de término"}
                </span>
              </div>
            </section>

            {/* Itens */}
            <section className="mb-5">
              <p className="mb-3 text-sm font-semibold text-primary">
                Itens da rotina
              </p>

              <div className="space-y-3">
                {routine.items.map((item) =>
                  editingItemId === item.id && itemDraft ? (
                    <div key={item.id}>
                      <div className="mb-2 flex items-center gap-2 rounded-2xl border border-accent-soft bg-accent-soft px-3 py-2 text-xs text-accent">
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        Apenas as tarefas futuras serão alteradas.
                      </div>

                      <RoutineItemEditor
                        item={itemDraft}
                        canRemove={false}
                        onChange={(patch) =>
                          setItemDraft((currentDraft) =>
                            currentDraft
                              ? { ...currentDraft, ...patch }
                              : currentDraft
                          )
                        }
                        onToggleDay={(day) =>
                          setItemDraft((cur) => {
                            if (!cur) return cur;
                            const days = cur.days.includes(day)
                              ? cur.days.filter((d) => d !== day)
                              : [...cur.days, day].sort((a, b) => a - b);
                            return { ...cur, days };
                          })
                        }
                        onRemove={() => {}}
                      />

                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={cancelEditItem}
                          disabled={savingItem}
                          className="rounded-full border border-soft bg-surface-muted px-4 py-2.5 text-sm font-semibold text-secondary transition active:scale-[0.97] disabled:opacity-40"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={saveItem}
                          disabled={savingItem || !itemValid(itemDraft)}
                          className="flex-1 rounded-full bg-[var(--accent-strong)] px-4 py-2.5 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-40"
                        >
                          {savingItem ? "Salvando..." : "Salvar item"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onEdit={() => startEditItem(item)}
                      onDelete={() => setDeletingItemId(item.id)}
                    />
                  )
                )}

                {newItemDraft ? (
                  <div>
                    <RoutineItemEditor
                      item={newItemDraft}
                      canRemove={false}
                      onChange={(patch) =>
                        setNewItemDraft((cur) => (cur ? { ...cur, ...patch } : cur))
                      }
                      onToggleDay={(day) =>
                        setNewItemDraft((cur) => {
                          if (!cur) return cur;
                          const days = cur.days.includes(day)
                            ? cur.days.filter((d) => d !== day)
                            : [...cur.days, day].sort((a, b) => a - b);
                          return { ...cur, days };
                        })
                      }
                      onRemove={() => {}}
                    />

                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setNewItemDraft(null)}
                        disabled={savingNewItem}
                        className="rounded-full border border-soft bg-surface-muted px-4 py-2.5 text-sm font-semibold text-secondary transition active:scale-[0.97] disabled:opacity-40"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={saveNewItem}
                        disabled={savingNewItem || !itemValid(newItemDraft)}
                        className="flex-1 rounded-full bg-[var(--accent-strong)] px-4 py-2.5 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-40"
                      >
                        {savingNewItem ? "Adicionando..." : "Adicionar item"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNewItemDraft(blankItem())}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-soft bg-surface-muted py-3 text-sm font-medium text-secondary transition active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar item
                  </button>
                )}
              </div>
            </section>

            {error && (
              <div className="mb-4 rounded-[1.4rem] border border-red-300/25 bg-red-500/10 p-4 text-sm leading-6 text-red-600 dark:text-red-600 dark:text-red-600 dark:text-red-100/80">
                {error}
              </div>
            )}

            {/* Ações */}
            <section className="space-y-3">
              {routine.status === "active" ? (
                <button
                  type="button"
                  onClick={() => setShowPause(true)}
                  disabled={busyStatus}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-soft bg-surface-muted py-3.5 text-sm font-semibold text-secondary transition active:scale-[0.98] disabled:opacity-40"
                >
                  <Pause className="h-4 w-4" />
                  Pausar rotina
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resume}
                  disabled={busyStatus}
                  className="flex w-full items-center justify-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-500/10 py-3.5 text-sm font-semibold text-emerald-700 transition active:scale-[0.98] disabled:opacity-40 dark:text-emerald-100"
                >
                  <Play className="h-4 w-4" />
                  {busyStatus ? "Retomando..." : "Retomar rotina"}
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowDelete(true)}
                className="flex w-full items-center justify-center gap-2 rounded-full border border-red-300/20 bg-red-500/10 py-3.5 text-sm font-semibold text-red-600 transition active:scale-[0.98] dark:text-red-600 dark:text-red-200/80"
              >
                <Trash2 className="h-4 w-4" />
                Excluir rotina
              </button>
            </section>
          </>
        )}
      </div>

      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      {/* Modal: pausar rotina */}
      <ConfirmDialog
        isOpen={showPause}
        title="Pausar rotina"
        description={
          <>
            <p>
              As tarefas futuras serão removidas. Você pode definir uma data para
              o Axon retomar automaticamente — ou deixar em branco para pausar
              indefinidamente.
            </p>

            <div className="mt-5 text-left">
              <label className="text-sm font-medium text-secondary">
                Retomar em <span className="text-muted">(opcional)</span>
              </label>
              <input
                type="date"
                value={pauseUntil}
                min={new Date().toLocaleDateString("en-CA")}
                onChange={(e) => setPauseUntil(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-soft bg-surface-muted px-4 py-3 text-sm text-primary outline-none focus:border-accent-soft"
              />
            </div>
          </>
        }
        confirmLabel="Confirmar"
        icon={Pause}
        loading={busyStatus}
        onConfirm={confirmPause}
        onClose={() => setShowPause(false)}
      />

      {/* Modal: excluir item */}
      <ConfirmDialog
        isOpen={!!deletingItemId}
        title={
          routine && routine.items.length === 1
            ? "Excluir o último item?"
            : "Excluir este item?"
        }
        description={
          routine && routine.items.length === 1 ? (
            <p>
              Este é o único item da rotina. Ao confirmar, a{" "}
              <span className="font-semibold text-primary">rotina inteira</span>{" "}
              também será excluída. As tarefas futuras serão removidas; as já
              concluídas permanecem no seu histórico.
            </p>
          ) : (
            <p>
              As tarefas futuras geradas por este item serão removidas. As já
              concluídas permanecem no seu histórico.
            </p>
          )
        }
        confirmLabel={
          routine && routine.items.length === 1 ? "Excluir rotina" : "Excluir"
        }
        variant="danger"
        icon={Trash2}
        loading={busyDeleteItem}
        onConfirm={confirmDeleteItem}
        onClose={() => setDeletingItemId(null)}
      />

      {/* Modal: excluir rotina */}
      <ConfirmDialog
        isOpen={showDelete}
        title="Excluir esta rotina?"
        description="As tarefas futuras geradas por ela serão removidas. As tarefas já concluídas permanecem no seu histórico. Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        icon={Trash2}
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => setShowDelete(false)}
      />
    </main>
  );
}

// ===========================================================================
// LINHA DE ITEM DA ROTINA
// ===========================================================================

function ItemRow({
  item,
  onEdit,
  onDelete,
}: {
  item: RoutineItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-[1.5rem] border border-soft bg-surface-elevated p-4 text-primary shadow-card backdrop-blur-2xl">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-primary">
          {item.title}
        </p>
        <p className="mt-1 text-xs text-muted">{daysText(item.days_of_week)}</p>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-soft bg-surface-muted px-2.5 py-1 text-[0.7rem] text-secondary">
          {item.duration_minutes != null ? (
            <>
              <Sparkles className="h-3 w-3 text-accent" />~
              {item.duration_minutes} min · Axon decide
            </>
          ) : (
            <>
              <Clock className="h-3 w-3 text-accent" />
              {item.start_time} – {item.end_time}
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="flex h-9 w-9 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
          aria-label="Editar item"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-9 w-9 items-center justify-center rounded-2xl border border-red-300/20 bg-red-500/10 text-red-600 transition active:scale-[0.96] dark:text-red-600 dark:text-red-200/70"
          aria-label="Excluir item"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// MODAL BASE E SKELETON DO DETALHE
// ===========================================================================

function DetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-2/3 animate-pulse rounded-2xl bg-surface-muted" />
      <div className="h-32 animate-pulse rounded-[1.7rem] bg-surface-muted" />
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[1.5rem] bg-surface-muted"
          />
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// HELPERS DE FORMATAÇÃO
// ===========================================================================

function daysText(days: number[]) {
  if (days.length === 7) return "Todos os dias";
  return days.map((d) => WEEKDAYS[d]?.label ?? d).join(" · ");
}
