import { useEffect, useMemo, useRef, useState, type ElementType, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Archive,
  ArrowLeft,
  Brain,
  Check,
  Edit3,
  Briefcase,
  Loader2,
  Menu,
  MoreVertical,
  Send,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  X,
  Eraser,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
} from "lucide-react";

import { results, type ChronotypeResultKey } from "../data/results";
import { useSpeech } from "../lib/voice/useSpeech";
import Sidebar from "../components/layout/Sidebar";
import * as api from "../lib/api";
import AppBackground from "../components/layout/AppBackground";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import EmptyState from "../components/ui/EmptyState";
import { ScrollArea } from "../components/ui/ScrollArea";

// ============================================================================
// Tipos e contratos locais
// ============================================================================

type ToolActivity = {
  tool: string;
  label: string;
  status: "running" | "done";
  ok?: boolean;
  summary?: string;
};

type Message = {
  id: number;
  sender: "user" | "axon";
  text: string;
  tools?: ToolActivity[];
};

type NotificationItem = {
  id: number;
  title: string;
  description: string;
  time: string;
  category: "planning" | "focus" | "insight" | "system";
  unread?: boolean;
  actionLabel?: string;
  actionPath?: string;
};

type ConfirmAction = "clear" | "archive" | "delete" | null;

// Configuração dinâmica por ação para o modal de confirmação da conversa.
const CONVERSATION_ACTION_CONFIG = {
  clear: {
    title: "Limpar conversa?",
    description:
      "As mensagens desta conversa serão removidas, mas a aba continuará existindo.",
    confirmLabel: "Limpar",
    variant: "default" as const,
    icon: Eraser,
  },
  archive: {
    title: "Arquivar conversa?",
    description:
      "Esta conversa sairá da lista principal. Você poderá recuperá-la futuramente.",
    confirmLabel: "Arquivar",
    variant: "default" as const,
    icon: Archive,
  },
  delete: {
    title: "Excluir conversa?",
    description:
      "Esta ação remove a aba inteira. Depois, essa conversa não poderá ser acessada.",
    confirmLabel: "Excluir",
    variant: "danger" as const,
    icon: Trash2,
  },
};

// Cronotipos aceitos para preencher a Sidebar sem depender de dados externos.
const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

// Conversa especial usada como central fixa de avisos dentro do Chat.
const systemNotifications: NotificationItem[] = [
  {
    id: 1,
    title: "Seu planejamento de hoje está pronto",
    description:
      "Organizamos uma sugestão inicial com base no seu ritmo e nas prioridades do dia.",
    time: "Agora",
    category: "planning",
    unread: true,
    actionLabel: "Ver planejamento",
    actionPath: "/planning",
  },
  {
    id: 2,
    title: "Bom momento para foco profundo",
    description:
      "Seu perfil indica uma janela favorável para executar uma tarefa importante com menos distrações.",
    time: "Há 12 min",
    category: "focus",
    unread: true,
    actionLabel: "Iniciar Focus",
    actionPath: "/focus",
  },
  {
    id: 3,
    title: "Novo insight disponível",
    description:
      "O Axon identificou um padrão inicial entre seus horários de energia e suas tarefas mais exigentes.",
    time: "Hoje",
    category: "insight",
    unread: false,
    actionLabel: "Ver insights",
    actionPath: "/insights",
  },
  {
    id: 4,
    title: "Bem-vindo ao Axon",
    description:
      "Este será seu espaço fixo para avisos importantes, lembretes inteligentes e atualizações do seu ambiente.",
    time: "Primeiro acesso",
    category: "system",
    unread: false,
  },
];


// ============================================================================
// Página principal da conversa
// ============================================================================

type ChatConversationPanelProps = {
  conversationId?: string;
  embedded?: boolean;
  onBack?: () => void;
  onOpenSidebar?: () => void;
};

export function ChatConversationPanel({
  conversationId: controlledConversationId,
  embedded = false,
  onBack,
  onOpenSidebar,
}: ChatConversationPanelProps = {}) {
  const navigate = useNavigate();
  const { chatId } = useParams();
  const conversationId = controlledConversationId ?? chatId;

  // Estados de navegação e modais da conversa atual.
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [isProjectSheetOpen, setIsProjectSheetOpen] = useState(false);

  // Mensagem digitada, histórico renderizado e estado de envio para o composer.
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);

  // Aplica o efeito de digitação apenas na resposta recém-gerada pelo Axon.
  const [streamingMessageId, setStreamingMessageId] = useState<number | null>(null);

  // Leitura em voz alta da resposta (a fala começa na 1ª frase, sem esperar o
  // fim do streaming). Desligada por padrão — o usuário liga no botão do header.
  const speech = useSpeech();

  // Histórico compacto enviado ao backend e marcador usado para rolar até o fim.
  const historyRef = useRef<api.ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Dados da conversa atual usados no título e na movimentação entre projetos.
  const [conversation, setConversation] = useState<api.ConversationData | null>(
    null
  );

  // Busca metadados da conversa para sincronizar título e projeto no header.
  useEffect(() => {
    if (!conversationId || conversationId === "axon-notifications") return;

    api
      .getConversations()
      .then((items) => {
        const currentConversation = items.find(
          (item) => item.id === conversationId
        );

        if (!currentConversation) return;

        setConversation(currentConversation);
        setChatTitle(currentConversation.title);
        setDraftTitle(currentConversation.title);
      })
      .catch(() => null);
  }, [conversationId]);

  // Carrega mensagens persistidas e reconstrói o histórico enviado ao backend.
  useEffect(() => {
    if (!conversationId || conversationId === "axon-notifications") {
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);

    api
      .getConversationMessages(conversationId)
      .then((stored) => {
        const loaded: Message[] = stored.map((m, i) => ({
          id: i + 1,
          sender: m.role === "user" ? "user" : "axon",
          text: m.content,
        }));

        setMessages(loaded);

        historyRef.current = stored.map((m) => ({
          role: m.role,
          content: m.content,
        }));
      })
      .catch(() => {
        // Conversa vazia continua utilizável mesmo se o histórico falhar.
      })
      .finally(() => setLoadingHistory(false));
  }, [conversationId]);

  // Título visível e rascunho usado somente no modal de renomear.
  const [chatTitle, setChatTitle] = useState(formatChatTitle(conversationId));
  const [draftTitle, setDraftTitle] = useState(formatChatTitle(conversationId));

  // Dados de cronotipo exibidos na Sidebar compartilhada do app.
  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, []);

  const result = results[resultKey];
  const isNotificationsChat = conversationId === "axon-notifications";

  function handleBack() {
    if (onBack) {
      onBack();
      return;
    }

    navigate("/chat");
  }

  function handleOpenSidebar() {
    if (onOpenSidebar) {
      onOpenSidebar();
      return;
    }

    setIsSidebarOpen(true);
  }

  // Rota interna que reaproveita o layout do chat como central de notificações.
  if (isNotificationsChat) {
    return (
      <NotificationsConversation
        onBack={handleBack}
        onOpenSidebar={handleOpenSidebar}
        isSidebarOpen={isSidebarOpen}
        onCloseSidebar={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
      />
    );
  }

  // Envio de mensagem: cria bolhas locais e acompanha o streaming do backend.
  function handleSend(e?: FormEvent) {
    e?.preventDefault();
    const text = message.trim();
    if (!text || isSending) return;

    const userMsg: Message = { id: Date.now(), sender: "user", text };
    setMessages((prev) => [...prev, userMsg]);
    setMessage("");
    setIsSending(true);

    const history = historyRef.current;
    const axonId = Date.now() + 1;

    setStreamingMessageId(axonId);
    setMessages((prev) => [...prev, { id: axonId, sender: "axon", text: "" }]);

    speech.begin();

    api.streamChat(
      text,
      history,
      (chunk) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === axonId ? { ...m, text: m.text + chunk } : m))
        );
        speech.push(chunk);
      },
      () => {
        setIsSending(false);
        speech.finish();
        setMessages((prev) => {
          const axonMsg = prev.find((m) => m.id === axonId);
          if (axonMsg) {
            historyRef.current = [
              ...history,
              { role: "user", content: text },
              { role: "assistant", content: axonMsg.text },
            ];
          }
          return prev;
        });

        window.setTimeout(() => {
          setStreamingMessageId(null);
        }, 3500);
      },
      () => {
        setIsSending(false);
        speech.stop();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === axonId
              ? { ...m, text: m.text || "Erro ao obter resposta. Tente novamente." }
              : m
          )
        );

        window.setTimeout(() => {
          setStreamingMessageId(null);
        }, 1200);
      },
      conversationId,
      (event) => {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== axonId) return m;
            const tools = [...(m.tools ?? [])];
            if (event.status === "running") {
              tools.push({
                tool: event.tool,
                label: event.label ?? event.tool,
                status: "running",
              });
            } else {
              for (let i = tools.length - 1; i >= 0; i--) {
                if (tools[i].tool === event.tool && tools[i].status === "running") {
                  tools[i] = {
                    ...tools[i],
                    status: "done",
                    ok: event.ok,
                    summary: event.summary,
                  };
                  break;
                }
              }
            }
            return { ...m, tools };
          })
        );
      }
    );
  }

  // Renomeia a conversa localmente e persiste o título no backend.
  async function handleRename() {
    const newTitle = draftTitle.trim();
    if (!newTitle) return;

    setChatTitle(newTitle);
    setIsRenameOpen(false);

    if (conversationId) {
      await api.updateConversation(conversationId, { title: newTitle }).catch(() => null);
    }
  }

  // Executa ações destrutivas após confirmação no modal.
  async function handleConfirmAction() {
    if (!conversationId || !confirmAction) {
      setConfirmAction(null);
      return;
    }

    setActionLoading(true);
    try {
      if (confirmAction === "clear") {
        await api.clearConversationMessages(conversationId).catch(() => null);
        setMessages([]);
        historyRef.current = [];
        setConfirmAction(null);
        return;
      }

      if (confirmAction === "archive") {
        await api
          .updateConversation(conversationId, { archived: true })
          .catch(() => null);
        setConfirmAction(null);
        handleBack();
        return;
      }

      if (confirmAction === "delete") {
        await api.deleteConversation(conversationId).catch(() => null);
        setConfirmAction(null);
        handleBack();
        return;
      }
    } finally {
      setActionLoading(false);
    }
  }

  // Atualiza o vínculo da conversa com um projeto ou remove esse vínculo.
  async function handleMoveConversationToProject(projectId: string | null) {
    if (!conversation) return;

    const updatedConversation = await api.updateConversationProject(
      conversation.id,
      projectId
    );

    setConversation((prev) =>
      prev
        ? {
            ...prev,
            project_id: updatedConversation.project_id ?? projectId,
          }
        : prev
    );
  }

  // Mantém o usuário no final do histórico ao abrir ou receber novas mensagens.
  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({
        behavior,
        block: "end",
      });
    });
  }

  useEffect(() => {
    if (!loadingHistory) {
      scrollToBottom("auto");
    }
  }, [loadingHistory, conversationId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      scrollToBottom("smooth");
    }, 50);

    return () => clearTimeout(timeout);
  }, [messages, isSending]);

  // Layout principal: header fixo, histórico scrollável, composer e modais globais.
  return (
    <main
      className={
        embedded
          ? "relative h-full overflow-hidden bg-transparent text-primary"
          : "relative h-[100dvh] overflow-hidden bg-app text-primary"
      }
    >
      {!embedded && <AppBackground />}

      <div
        className={
          embedded
            ? "relative z-10 flex h-full flex-col px-4 pb-4 pt-4"
            : "relative z-10 flex h-full flex-col px-4 pb-4 pt-5"
        }
      >
        <header className="mb-4 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {!embedded && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary shadow-card backdrop-blur-2xl transition active:scale-[0.96]"
                  aria-label="Voltar"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}

              <div className="min-w-0">
                <p className="truncate text-base font-black leading-tight tracking-[-0.035em] text-primary">
                  {chatTitle}
                </p>
                <p className="truncate text-xs text-muted">
                  Conversa com o Axon
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const ligando = !speech.enabled;
                  speech.setEnabled(ligando);
                  // Destravar o áudio precisa acontecer DENTRO do clique: o
                  // navegador só libera som que nasce de um gesto do usuário.
                  if (ligando) speech.warmup();
                }}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-card backdrop-blur-2xl transition active:scale-[0.96] ${
                  speech.enabled
                    ? "border-accent-soft bg-accent-soft text-accent"
                    : "border-soft bg-surface-muted text-secondary"
                }`}
                aria-label={
                  speech.enabled ? "Desativar leitura em voz alta" : "Ler respostas em voz alta"
                }
                aria-pressed={speech.enabled}
                title={
                  speech.enabled && !speech.available
                    ? "Nenhuma voz disponível — veja Configurações › Voz do Axon"
                    : undefined
                }
              >
                {speech.enabled ? (
                  <Volume2 className={`h-5 w-5 ${speech.speaking ? "animate-pulse" : ""}`} />
                ) : (
                  <VolumeX className="h-5 w-5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsOptionsOpen(true)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary shadow-card backdrop-blur-2xl transition active:scale-[0.96]"
                aria-label="Opções da conversa"
              >
                <MoreVertical className="h-5 w-5" />
              </button>

              <button
                type="button"
                onClick={handleOpenSidebar}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary shadow-card backdrop-blur-2xl transition active:scale-[0.96]"
                aria-label="Abrir menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1" contentClassName="pr-1 pb-4">
          <div className="space-y-3 pb-4">
            {messages.length === 0 ? (
              <div className="flex min-h-[56vh] items-center justify-center">
                <div className="relative w-full overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated p-6 text-center text-primary shadow-soft backdrop-blur-2xl">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,var(--accent-soft),transparent_58%)]" />

                  <div className="relative">
                    <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
                      <Sparkles className="h-6 w-6" />
                    </div>

                    <h2 className="text-xl font-black tracking-[-0.04em] text-primary">
                      Comece uma conversa.
                    </h2>

                    <p className="mx-auto mt-3 max-w-[260px] text-sm leading-6 text-muted">
                      Use o Axon para reorganizar seu dia, clarear prioridades ou
                      transformar pensamentos soltos em ações.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {messages
                  .filter((item) => item.text?.trim())
                  .map((item) => (
                    <MessageBubble
                      key={item.id}
                      message={item}
                      animateText={item.id === streamingMessageId}
                    />
                  ))}

                {isSending && <TypingIndicator />}
              </>
            )}

            <div ref={messagesEndRef} className="h-1" />
          </div>
        </ScrollArea>

        <footer className="shrink-0 pt-3">
          <form
            onSubmit={(e) => handleSend(e)}
            className="flex min-h-[58px] items-end gap-2 rounded-[1.7rem] border border-soft bg-surface-elevated p-2 shadow-soft backdrop-blur-2xl"
          >
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  window.innerWidth >= 768
                ) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Mensagem para o Axon..."
              rows={1}
              className="max-h-28 min-h-[42px] flex-1 resize-none overflow-y-auto bg-transparent px-3 py-2 text-sm leading-6 text-primary outline-none placeholder:text-soft"
            />

            <button
              type="submit"
              disabled={!message.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent-strong)] text-white shadow-card transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="Enviar mensagem"
            >
              <Send className="h-4.5 w-4.5" />
            </button>
          </form>
        </footer>
      </div>

      {!embedded && (
        <Sidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          chronotypeLabel={result.label}
          energyPeak={result.energyPeak}
        />
      )}

      <ChatOptionsSheet
        isOpen={isOptionsOpen}
        onClose={() => setIsOptionsOpen(false)}
        onRename={() => {
          setIsOptionsOpen(false);
          setIsRenameOpen(true);
        }}
        onMoveProject={() => {
          setIsOptionsOpen(false);
          setIsProjectSheetOpen(true);
        }}
        onClear={() => {
          setIsOptionsOpen(false);
          setConfirmAction("clear");
        }}
        onArchive={() => {
          setIsOptionsOpen(false);
          setConfirmAction("archive");
        }}
        onDelete={() => {
          setIsOptionsOpen(false);
          setConfirmAction("delete");
        }}
      />

      <RenameConversationModal
        isOpen={isRenameOpen}
        value={draftTitle}
        onChange={setDraftTitle}
        onClose={() => setIsRenameOpen(false)}
        onConfirm={handleRename}
      />

      {confirmAction && (
        <ConfirmDialog
          isOpen={!!confirmAction}
          title={CONVERSATION_ACTION_CONFIG[confirmAction].title}
          description={CONVERSATION_ACTION_CONFIG[confirmAction].description}
          confirmLabel={CONVERSATION_ACTION_CONFIG[confirmAction].confirmLabel}
          variant={CONVERSATION_ACTION_CONFIG[confirmAction].variant}
          icon={CONVERSATION_ACTION_CONFIG[confirmAction].icon}
          loading={actionLoading}
          onConfirm={handleConfirmAction}
          onClose={() => setConfirmAction(null)}
        />
      )}

      <MoveConversationProjectSheet
        isOpen={isProjectSheetOpen}
        currentProjectId={conversation?.project_id ?? null}
        onClose={() => setIsProjectSheetOpen(false)}
        onMove={handleMoveConversationToProject}
      />
    </main>
  );
}

export default function ChatConversation() {
  return <ChatConversationPanel />;
}

// ============================================================================
// Sheet de opções e ações da conversa
// ============================================================================

function ChatOptionsSheet({
  isOpen,
  onClose,
  onRename,
  onMoveProject,
  onClear,
  onArchive,
  onDelete,
}: {
  isOpen: boolean;
  onClose: () => void;
  onRename: () => void;
  onMoveProject: () => void;
  onClear: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
      <div className="relative max-h-[88dvh] w-full max-w-[430px] overflow-y-auto rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_50%)]" />

        <div className="relative">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
                <MoreVertical className="h-3.5 w-3.5" />
                Ações
              </div>

              <h2 className="text-[1.65rem] font-black leading-[1.02] tracking-[-0.055em] text-primary">
                Opções da conversa
              </h2>

              <p className="mt-2 text-xs leading-5 text-muted">
                Gerencie esta conversa sem alterar as demais.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-2">
            <OptionButton
              icon={Edit3}
              title="Renomear"
              description="Altere o nome desta conversa."
              onClick={onRename}
            />

            <OptionButton
              icon={Briefcase}
              title="Mover para projeto"
              description="Organize esta conversa dentro de um projeto."
              onClick={onMoveProject}
            />

            <OptionButton
              icon={Eraser}
              title="Limpar mensagens"
              description="Remove as mensagens, mas mantém a conversa."
              onClick={onClear}
            />

            <OptionButton
              icon={Archive}
              title="Arquivar"
              description="Remove da lista principal."
              onClick={onArchive}
            />

            <OptionButton
              icon={Trash2}
              title="Excluir"
              description="Apaga esta conversa permanentemente."
              danger
              onClick={onDelete}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Item reutilizável do menu de ações da conversa.
function OptionButton({
  icon: Icon,
  title,
  description,
  danger = false,
  onClick,
}: {
  icon: ElementType;
  title: string;
  description: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[1.45rem] border p-3 text-left shadow-card transition active:scale-[0.99] ${
        danger
          ? "border-red-300/20 bg-red-500/10"
          : "border-soft bg-surface-muted"
      }`}
    >
      <div
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
          danger
            ? "border-red-300/25 bg-red-500/10 text-red-600 dark:text-red-100"
            : "border-accent-soft bg-accent-soft text-accent"
        }`}
      >
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-black ${
            danger ? "text-red-600 dark:text-red-100" : "text-primary"
          }`}
        >
          {title}
        </p>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>
    </button>
  );
}

// Modal simples para editar apenas o título da conversa atual.
function RenameConversationModal({
  isOpen,
  value,
  onChange,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
      <div className="relative w-full max-w-[430px] overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_50%)]" />

        <div className="relative">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
                <Edit3 className="h-3.5 w-3.5" />
                Conversa
              </div>

              <h2 className="text-[1.65rem] font-black leading-[1.02] tracking-[-0.055em] text-primary">
                Renomear conversa
              </h2>

              <p className="mt-2 text-xs leading-5 text-muted">
                Escolha um nome claro para encontrar esta conversa depois.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-muted">
              Nome da conversa
            </span>

            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className="min-h-[52px] w-full rounded-2xl border border-soft bg-surface-muted px-4 text-sm text-primary outline-none transition placeholder:text-soft focus:border-accent-soft"
            />
          </label>

          <button
            type="button"
            onClick={onConfirm}
            className="mt-5 inline-flex min-h-13 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-6 text-sm font-semibold text-white shadow-card transition active:scale-[0.98]"
          >
            Salvar nome
            <Check className="ml-2 h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-6 text-sm font-semibold text-secondary transition active:scale-[0.98]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Renderização das mensagens
// ============================================================================

// Feedback visual exibido enquanto a resposta do Axon ainda está em andamento.
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="animate-[messageIn_0.25s_ease-out] max-w-[86%] rounded-[1.6rem] rounded-bl-md border border-soft bg-surface-elevated px-4 py-3 shadow-card backdrop-blur-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-accent-soft bg-accent-soft text-accent">
            <Brain className="h-4 w-4" />
          </div>

          <div>
            <p className="text-xs font-semibold text-muted">
              Axon está organizando...
            </p>

            <div className="mt-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--accent)]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Revela a resposta nova em etapas sem animar mensagens antigas do histórico.
function AnimatedMessageText({
  text,
  animate,
}: {
  text: string;
  animate: boolean;
}) {
  const [visibleText, setVisibleText] = useState(animate ? "" : text);
  const visibleLengthRef = useRef(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      visibleLengthRef.current = text.length;
      setVisibleText(text);
      return;
    }

    let cancelled = false;

    function revealNextFrame() {
      if (cancelled) return;

      const targetLength = text.length;
      const currentLength = visibleLengthRef.current;

      if (currentLength >= targetLength) {
        setVisibleText(text);
        return;
      }

      // Textos longos avançam em blocos maiores para manter a animação fluida.
      const remaining = targetLength - currentLength;
      const step = remaining > 220 ? 10 : remaining > 90 ? 6 : 3;
      const nextLength = Math.min(currentLength + step, targetLength);

      visibleLengthRef.current = nextLength;
      setVisibleText(text.slice(0, nextLength));

      window.setTimeout(revealNextFrame, 18);
    }

    revealNextFrame();

    return () => {
      cancelled = true;
    };
  }, [text, animate]);

  return <AxonMarkdown text={visibleText} />;
}

// Bolha única de mensagem; mensagens do Axon também renderizam atividades de tools.
function MessageBubble({
  message,
  animateText = false,
}: {
  message: Message;
  animateText?: boolean;
}) {
  const isUser = message.sender === "user";

  return (
    <div className={`animate-[messageIn_0.25s_ease-out] flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[84%] rounded-[1.45rem] px-4 py-3 text-sm leading-6 shadow-card ${
          isUser
            ? "rounded-br-md bg-[var(--accent-strong)] text-white"
            : "rounded-bl-md border border-soft bg-surface-elevated text-secondary backdrop-blur-2xl"
        }`}
      >
        {!isUser && (
          <div className="mb-2 flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-accent" />
            <p className="text-xs font-semibold text-accent">Axon</p>
          </div>
        )}

        {!isUser && message.tools && message.tools.length > 0 && (
          <div className="mb-2 flex flex-col gap-1.5">
            {message.tools.map((activity, index) => {
              const failed = activity.status === "done" && activity.ok === false;
              return (
                <div
                  key={`${activity.tool}-${index}`}
                  className={`inline-flex items-center gap-2 self-start rounded-full border px-3 py-1 text-[0.68rem] font-medium ${
                    failed
                      ? "border-rose-300/25 bg-rose-500/10 text-rose-700 dark:text-rose-100"
                      : activity.status === "done"
                      ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100"
                      : "border-accent-soft bg-accent-soft text-accent"
                  }`}
                >
                  {activity.status === "running" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : failed ? (
                    <X className="h-3 w-3" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  <span>
                    {activity.status === "running"
                      ? `${activity.label}…`
                      : failed
                      ? `${activity.label}: falhou`
                      : `${activity.label} ✓`}
                    {activity.summary && (
                      <span className="ml-1 opacity-75">
                        — "{activity.summary}"
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {isUser ? (
          message.text
        ) : (
          <AnimatedMessageText text={message.text} animate={animateText} />
        )}
      </div>
    </div>
  );
}

// Markdown controlado para respostas do Axon dentro do visual mobile-first.
function AxonMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p className="mb-2 last:mb-0 leading-6">{children}</p>
        ),
        h1: ({ children }) => (
          <h1 className="mb-2 mt-3 text-base font-semibold text-primary first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-2 mt-3 text-sm font-semibold text-primary first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1.5 mt-3 text-sm font-semibold text-primary first:mt-0">{children}</h3>
        ),
        ul: ({ children }) => (
          <ul className="mb-2 space-y-1 pl-4 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 space-y-1 pl-4 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="leading-6 [&::marker]:text-accent" style={{ listStyleType: "disc" }}>{children}</li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-primary">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-secondary">{children}</em>
        ),
        hr: () => (
          <hr className="my-3 border-[var(--border-soft)]" />
        ),
        code: ({ children }) => (
          <code className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-mono text-accent">{children}</code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-2 border-l-2 border-accent-soft pl-3 text-secondary">{children}</blockquote>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto rounded-xl border border-soft">
            <table className="w-full text-xs">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-surface-muted">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-semibold text-primary">{children}</th>
        ),
        td: ({ children }) => (
          <td className="border-t border-[var(--border-soft)] px-3 py-2 text-secondary">{children}</td>
        ),
      } satisfies Components}
    >
      {text}
    </ReactMarkdown>
  );
}


// ============================================================================
// Projetos: mover conversa entre pastas
// ============================================================================

function MoveConversationProjectSheet({
  isOpen,
  currentProjectId,
  onClose,
  onMove,
}: {
  isOpen: boolean;
  currentProjectId: string | null;
  onClose: () => void;
  onMove: (projectId: string | null) => Promise<void>;
}) {
  const [projects, setProjects] = useState<api.ChatProjectData[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    currentProjectId
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mantém a seleção alinhada à conversa atual sempre que a sheet é aberta.
  useEffect(() => {
    if (!isOpen) return;

    setSelectedProjectId(currentProjectId);
  }, [isOpen, currentProjectId]);

  // Carrega projetos somente quando a sheet abre.
  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);

    api
      .getChatProjects()
      .then(setProjects)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Erro ao carregar projetos")
      )
      .finally(() => setLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleMove() {
    if (!selectedProjectId) return;

    setSubmitting(true);
    setError(null);

    try {
      await onMove(selectedProjectId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao mover conversa");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-sm">
      <div className="relative flex max-h-[88dvh] w-full max-w-[430px] flex-col overflow-hidden rounded-[2rem] border border-soft bg-surface-elevated text-primary shadow-soft backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_50%)]" />

        <div className="relative border-b border-[var(--border-soft)] px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent">
                <Briefcase className="h-3.5 w-3.5" />
                Projeto
              </div>

              <h2 className="text-[1.65rem] font-black leading-[1.02] tracking-[-0.055em] text-primary">
                Mover conversa
              </h2>

              <p className="mt-2 text-xs leading-5 text-muted">
                Escolha o projeto onde esta conversa deve ficar.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96] disabled:opacity-50"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <ScrollArea className="flex-1" contentClassName="relative px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              Carregando projetos…
            </div>
          ) : projects.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-soft bg-surface-muted px-4 py-8 text-center">
              <Briefcase className="mx-auto h-6 w-6 text-accent" />

              <p className="mt-3 text-sm font-black text-primary">
                Nenhum projeto criado
              </p>

              <p className="mx-auto mt-2 max-w-[18rem] text-xs leading-5 text-muted">
                Crie um projeto na tela de Chat para mover esta conversa.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => {
                const isSelected = selectedProjectId === project.id;
                const isCurrent = currentProjectId === project.id;

                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedProjectId(project.id)}
                    disabled={submitting}
                    className={`flex min-h-16 w-full items-center justify-between gap-3 rounded-[1.45rem] border px-4 py-3 text-left shadow-card transition active:scale-[0.98] disabled:opacity-60 ${
                      isSelected
                        ? "border-accent-soft bg-accent-soft"
                        : "border-soft bg-surface-muted"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                          isSelected
                            ? "border-accent-soft bg-surface-elevated text-accent"
                            : "border-soft bg-surface-elevated text-muted"
                        }`}
                      >
                        <Briefcase className="h-4 w-4" />
                      </div>

                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-black text-primary">
                            {project.name}
                          </p>

                          {isCurrent && (
                            <span className="shrink-0 rounded-full border border-accent-soft bg-surface-elevated px-2 py-0.5 text-[0.58rem] font-black text-accent">
                              Atual
                            </span>
                          )}
                        </div>

                        <p className="mt-1 line-clamp-1 text-xs text-muted">
                          {project.description || "Sem descrição"}
                        </p>
                      </div>
                    </div>

                    {isSelected ? (
                      <Check className="h-4 w-4 shrink-0 text-accent" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-300">
              {error}
            </p>
          )}
        </ScrollArea>

        <div className="relative border-t border-[var(--border-soft)] bg-surface-elevated px-5 py-4">
          <button
            type="button"
            onClick={handleMove}
            disabled={
              submitting ||
              !selectedProjectId ||
              selectedProjectId === currentProjectId
            }
            className="inline-flex min-h-13 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-5 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Movendo...
              </>
            ) : (
              <>
                Mover conversa
                <Briefcase className="ml-2 h-4 w-4" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-soft bg-surface-muted px-5 text-sm font-semibold text-secondary transition active:scale-[0.98] disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatChatTitle(chatId?: string) {
  if (!chatId) return "Conversa";

  // UUIDs reais não são transformados em título para evitar nomes ilegíveis.
  if (UUID_RE.test(chatId)) return "Conversa";

  return chatId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ============================================================================
// Conversa especial de notificações
// ============================================================================

function NotificationsConversation({
  onBack,
  onOpenSidebar,
  isSidebarOpen,
  onCloseSidebar,
  chronotypeLabel,
  energyPeak,
}: {
  onBack: () => void;
  onOpenSidebar: () => void;
  isSidebarOpen: boolean;
  onCloseSidebar: () => void;
  chronotypeLabel: string;
  energyPeak: string;
}) {
  const navigate = useNavigate();

  const unreadCount = systemNotifications.filter(
    (notification) => notification.unread
  ).length;

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 flex h-full flex-col px-4 pb-5 pt-5">
        <header className="mb-4 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <button
              onClick={onBack}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary backdrop-blur-2xl transition active:scale-[0.96]"
              aria-label="Voltar"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-primary">
                Notificações do Axon
              </p>
              <p className="truncate text-xs text-muted">
                Avisos, lembretes e atualizações
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenSidebar}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-secondary backdrop-blur-2xl transition active:scale-[0.96]"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <section className="mb-4 overflow-hidden rounded-[2rem] border border-accent-soft bg-accent-soft p-5 shadow-2xl shadow-soft backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_48%)]" />

          <div className="relative">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-soft bg-surface-elevated text-accent shadow-card">
                <Bell className="h-6 w-6" />
              </div>

              {unreadCount > 0 && (
                <div className="rounded-full border border-accent-soft bg-surface-elevated px-3 py-1.5 text-xs font-semibold text-accent">
                  {unreadCount} novas
                </div>
              )}
            </div>

            <h1 className="text-[1.95rem] font-semibold leading-[1.03] tracking-[-0.055em] text-primary">
              Sua central de avisos.
            </h1>

            <p className="mt-3 text-sm leading-6 text-muted">
              Aqui ficam os lembretes importantes, sugestões do Axon e
              atualizações relacionadas ao seu ambiente de produtividade.
            </p>
          </div>
        </section>

        <ScrollArea className="min-h-0 flex-1" contentClassName="pr-1 pb-4">
          <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-soft">
            Recentes
          </p>

          <div className="space-y-3">
            {systemNotifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                onAction={() => {
                  if (notification.actionPath) {
                    navigate(notification.actionPath);
                  }
                }}
              />
            ))}
          </div>

          <div className="mt-5 rounded-[1.5rem] border border-soft bg-surface-muted p-4 text-center backdrop-blur-2xl">
            <CheckCircle2 className="mx-auto h-5 w-5 text-accent" />

            <p className="mt-3 text-sm font-semibold text-primary">
              Você está em dia.
            </p>

            <p className="mt-1 text-xs leading-5 text-muted">
              Novas notificações aparecerão aqui quando o Axon identificar algo
              relevante para sua rotina.
            </p>
          </div>
        </ScrollArea>
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={onCloseSidebar}
        chronotypeLabel={chronotypeLabel}
        energyPeak={energyPeak}
      />
    </main>
  );
}

// Card individual da central fixa de notificações.
function NotificationCard({
  notification,
  onAction,
}: {
  notification: NotificationItem;
  onAction: () => void;
}) {
  const Icon = getNotificationIcon(notification.category);

  return (
    <article
      className={`relative overflow-hidden rounded-[1.7rem] border p-4 shadow-card backdrop-blur-2xl ${
        notification.unread
          ? "border-accent-soft bg-accent-soft"
          : "border-soft bg-surface-elevated"
      }`}
    >
      {notification.unread && (
        <span className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-[var(--accent)] shadow-[0_0_16px_var(--accent-soft)]" />
      )}

      <div className="flex gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
            notification.unread
              ? "border-accent-soft bg-surface-elevated text-accent"
              : "border-soft bg-surface-muted text-muted"
          }`}
        >
          <Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 pr-2">
          <div className="mb-1 flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-primary">
              {notification.title}
            </p>
          </div>

          <p className="text-xs leading-5 text-muted">
            {notification.description}
          </p>

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[0.68rem] text-soft">
              <Clock3 className="h-3.5 w-3.5" />
              {notification.time}
            </div>

            {notification.actionLabel && (
              <button
                type="button"
                onClick={onAction}
                className="rounded-full border border-accent-soft bg-surface-elevated px-3 py-1.5 text-[0.68rem] font-semibold text-accent transition active:scale-[0.98]"
              >
                {notification.actionLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// Escolhe o ícone de acordo com a categoria visual da notificação.
function getNotificationIcon(category: NotificationItem["category"]) {
  if (category === "planning") return CalendarDays;
  if (category === "focus") return Sparkles;
  if (category === "insight") return CheckCircle2;

  return Bell;
}