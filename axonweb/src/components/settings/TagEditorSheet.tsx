import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Plus, RefreshCcw, Tag, X } from "lucide-react";

import BottomSheet from "../ui/BottomSheet";
import EmptyState from "../ui/EmptyState";
import * as api from "../../lib/api";
import type { TagPreferences } from "../../lib/api";
import { slugifyTag } from "../../lib/tagSlug";
import {
  MOOD_TAGS,
  PRODUCTIVITY_TAGS,
  SLEEP_TAGS,
} from "../../data/dayReviewTags";

// ===========================================================================
// TIPOS DO COMPONENTE
// ===========================================================================

type Category = "sleep" | "mood" | "productivity";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

// ===========================================================================
// CONFIGURAÇÃO DAS CATEGORIAS
// ===========================================================================

const CATEGORY_CONFIG: { key: Category; label: string }[] = [
  { key: "sleep", label: "Sono" },
  { key: "mood", label: "Humor" },
  { key: "productivity", label: "Produtividade" },
];

const DEFAULT_PREFS: TagPreferences = {
  sleep: SLEEP_TAGS.map((tag) => ({
    slug: tag.slug,
    label: tag.label,
  })),
  mood: MOOD_TAGS.map((tag) => ({
    slug: tag.slug,
    label: tag.label,
  })),
  productivity: PRODUCTIVITY_TAGS.map((tag) => ({
    slug: tag.slug,
    label: tag.label,
  })),
};

// ===========================================================================
// HELPERS
// ===========================================================================

// Cria um identificador estável para tags personalizadas criadas pelo usuário.
// Compartilhado com o registro diário (ver lib/tagSlug.ts).
const slugify = slugifyTag;

function getCategoryLabel(category: Category) {
  return CATEGORY_CONFIG.find((item) => item.key === category)?.label ?? "";
}

// ===========================================================================
// SHEET DE EDIÇÃO DE TAGS
// ===========================================================================

export default function TagEditorSheet({ isOpen, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  // ---------------------------------------------------------------------------
  // Estado principal da edição
  // ---------------------------------------------------------------------------
  const [prefs, setPrefs] = useState<TagPreferences>(DEFAULT_PREFS);
  const [activeTab, setActiveTab] = useState<Category>("sleep");
  const [inputValue, setInputValue] = useState("");

  // ---------------------------------------------------------------------------
  // Feedback de carregamento, salvamento e erro
  // ---------------------------------------------------------------------------
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Carregamento ao abrir
  // ---------------------------------------------------------------------------
  // Sempre reabre na aba Sono e busca preferências salvas no backend.
  useEffect(() => {
    if (!isOpen) return;

    setActiveTab("sleep");
    setInputValue("");
    setError(null);
    setLoading(true);

    api
      .getTagPreferences()
      .then(setPrefs)
      .catch(() => setPrefs(DEFAULT_PREFS))
      .finally(() => setLoading(false));
  }, [isOpen]);

  const currentTags = prefs[activeTab];

  // ---------------------------------------------------------------------------
  // Ações de edição
  // ---------------------------------------------------------------------------
  function changeTab(category: Category) {
    setActiveTab(category);
    setInputValue("");
    setError(null);
  }

  function removeTag(slug: string) {
    setPrefs((previousPrefs) => ({
      ...previousPrefs,
      [activeTab]: previousPrefs[activeTab].filter((tag) => tag.slug !== slug),
    }));
  }

  function addTag() {
    const label = inputValue.trim();

    if (!label) return;

    if (label.length > 40) {
      setError("Máximo de 40 caracteres.");
      return;
    }

    const slug = slugify(label);
    const tagAlreadyExists = currentTags.some(
      (tag) =>
        tag.slug === slug || tag.label.toLowerCase() === label.toLowerCase()
    );

    if (tagAlreadyExists) {
      setError("Essa tag já existe nesta categoria.");
      return;
    }

    setPrefs((previousPrefs) => ({
      ...previousPrefs,
      [activeTab]: [...previousPrefs[activeTab], { slug, label }],
    }));

    setInputValue("");
    setError(null);
    inputRef.current?.focus();
  }

  function resetCategory() {
    setPrefs((previousPrefs) => ({
      ...previousPrefs,
      [activeTab]: DEFAULT_PREFS[activeTab],
    }));

    setError(null);
  }

  // ---------------------------------------------------------------------------
  // Salvamento
  // ---------------------------------------------------------------------------
  async function handleSave() {
    setSaving(true);
    setError(null);

    try {
      const updated = await api.updateTagPreferences(prefs);

      setPrefs(updated);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Tags da análise diária"
      subtitle="Personalize as opções que aparecem ao registrar seu dia"
      ariaLabel="Editor de tags"
      maxHeightClassName="max-h-[88vh]"
    >
      {/* Abas de categoria fixas no topo do conteúdo rolável. */}
      <div className="sticky -top-4 z-10 -mx-5 mb-4 bg-surface-elevated px-5 pb-3 pt-1 backdrop-blur-xl">
        <CategoryTabs activeTab={activeTab} onChangeTab={changeTab} />
      </div>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          <TagList tags={currentTags} onRemove={removeTag} />

          <AddTagControl
            inputRef={inputRef}
            value={inputValue}
            error={error}
            onChange={(value) => {
              setInputValue(value);
              setError(null);
            }}
            onAdd={addTag}
          />

          <ResetCategoryButton activeTab={activeTab} onReset={resetCategory} />

          <SaveButton saving={saving} onSave={handleSave} />
        </>
      )}
    </BottomSheet>
  );
}

// ===========================================================================
// ABAS
// ===========================================================================

function CategoryTabs({
  activeTab,
  onChangeTab,
}: {
  activeTab: Category;
  onChangeTab: (category: Category) => void;
}) {
  return (
    <div className="flex gap-2">
      {CATEGORY_CONFIG.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChangeTab(key)}
          className={`flex-1 rounded-2xl border py-2.5 text-xs font-semibold transition active:scale-[0.97] ${
            activeTab === key
              ? "border-accent-soft bg-accent-soft text-accent"
              : "border-soft bg-surface-muted text-muted"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ===========================================================================
// LISTA E EDIÇÃO DE TAGS
// ===========================================================================

function TagList({
  tags,
  onRemove,
}: {
  tags: TagPreferences[Category];
  onRemove: (slug: string) => void;
}) {
  return (
    <div className="mb-4 min-h-[80px]">
      {tags.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="Nenhuma tag nesta categoria"
          description="Adicione uma abaixo."
        />
      ) : (
        <div className="flex flex-wrap gap-2 py-2">
          {tags.map((tag) => (
            <motion.div
              key={tag.slug}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-1.5 rounded-full border border-soft bg-surface-muted py-1.5 pl-3.5 pr-2"
            >
              <span className="text-xs font-medium text-primary">
                {tag.label}
              </span>

              <button
                type="button"
                onClick={() => onRemove(tag.slug)}
                className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-muted text-muted transition hover:bg-red-500/20 hover:text-red-600 active:scale-[0.9] dark:hover:text-red-400"
                aria-label={`Remover ${tag.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddTagControl({
  inputRef,
  value,
  error,
  onChange,
  onAdd,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mb-2">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onAdd()}
          maxLength={40}
          placeholder="Nova tag..."
          className="min-w-0 flex-1 rounded-2xl border border-soft bg-surface-muted px-4 py-3 text-sm text-primary outline-none ring-[var(--accent-soft)] transition placeholder:text-soft focus:border-accent-soft focus:ring-2"
        />

        <button
          type="button"
          onClick={onAdd}
          disabled={!value.trim()}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-card transition active:scale-[0.96] disabled:opacity-30"
          aria-label="Adicionar tag"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {error && <p className="mt-2 px-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function ResetCategoryButton({
  activeTab,
  onReset,
}: {
  activeTab: Category;
  onReset: () => void;
}) {
  const label = getCategoryLabel(activeTab).toLowerCase();

  return (
    <button
      type="button"
      onClick={onReset}
      className="mb-6 flex items-center gap-1.5 px-1 text-xs text-soft transition hover:text-secondary active:scale-[0.97]"
    >
      <RefreshCcw className="h-3 w-3" />
      Restaurar padrões de {label}
    </button>
  );
}

// ===========================================================================
// FEEDBACKS E AÇÕES FINAIS
// ===========================================================================

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-accent" />
    </div>
  );
}

function SaveButton({
  saving,
  onSave,
}: {
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saving}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-50"
    >
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Check className="h-4 w-4" />
      )}
      Salvar alterações
    </button>
  );
}
