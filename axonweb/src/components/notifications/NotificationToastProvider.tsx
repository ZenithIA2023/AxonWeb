import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, X } from "lucide-react";

import * as api from "../../lib/api";
import * as push from "../../lib/push";

// ===========================================================================
// CONFIGURAÇÕES DO PROVIDER
// ===========================================================================

const TOAST_ENABLED_ROUTES = [
  "/dashboard",
  "/chat",
  "/planejamento",
  "/insights",
  "/rotina",
  "/focus",
  "/profile",
  "/settings",
  "/day-review",
];

function isToastEnabledRoute(pathname: string) {
  return TOAST_ENABLED_ROUTES.some((route) => {
    return pathname === route || pathname.startsWith(`${route}/`);
  });
}

const SHOWN_NOTIFICATIONS_KEY = "axon_shown_notification_ids";
const TOAST_HIDE_DELAY_MS = 10000;
const TOAST_ROUTE_ENTRY_DELAY_MS = 3500;
const POLLING_INTERVAL_MS = 15000;

type NotificationAction = "read" | "accept" | "reject" | null;

// ===========================================================================
// HISTÓRICO LOCAL DE TOASTS EXIBIDOS
// ===========================================================================
// Evita mostrar repetidamente a mesma notificação em polling.
function getShownIds() {
  try {
    return JSON.parse(
      localStorage.getItem(SHOWN_NOTIFICATIONS_KEY) ?? "[]"
    ) as string[];
  } catch {
    return [];
  }
}

function saveShownId(id: string) {
  const shownIds = getShownIds();
  const next = [id, ...shownIds.filter((shownId) => shownId !== id)].slice(
    0,
    30
  );

  localStorage.setItem(SHOWN_NOTIFICATIONS_KEY, JSON.stringify(next));
}

// ===========================================================================
// PROVIDER GLOBAL DE TOASTS DE NOTIFICAÇÃO
// ===========================================================================

export default function NotificationToastProvider() {
  const navigate = useNavigate();
  const location = useLocation();

  // ---------------------------------------------------------------------------
  // Estado do toast atual
  // ---------------------------------------------------------------------------
  const [toast, setToast] = useState<api.NotificationData | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [actionLoading, setActionLoading] =
    useState<NotificationAction>(null);

  // ---------------------------------------------------------------------------
  // Controle de timers
  // ---------------------------------------------------------------------------
  const hideTimeoutRef = useRef<number | null>(null);

  // ---------------------------------------------------------------------------
  // Condição para ativar notificações
  // ---------------------------------------------------------------------------
  // Não consulta notificações durante loading, onboarding, autenticação ou rotas públicas.
  // Toasts só ficam ativos dentro das telas reais do app.
  const shouldCheckNotifications =
    api.isLoggedIn() && isToastEnabledRoute(location.pathname);

  // ---------------------------------------------------------------------------
  // Fechamento do toast
  // ---------------------------------------------------------------------------
  // Centraliza o fechamento para sempre limpar estado e timer.
  function closeToast() {
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    setIsVisible(false);
    setActionLoading(null);
    setToast(null);
  }

  // ---------------------------------------------------------------------------
  // Fechamento automático fora das telas reais do app
  // ---------------------------------------------------------------------------
  // Garante que nenhum toast permaneça visível em loading, onboarding ou auth.
  useEffect(() => {
    if (shouldCheckNotifications) return;

    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }

    setIsVisible(false);
    setActionLoading(null);
    setToast(null);
  }, [location.pathname, shouldCheckNotifications]);

  // ---------------------------------------------------------------------------
  // Auto-fechamento do toast
  // ---------------------------------------------------------------------------
  // O timer fica separado do polling para não ser cancelado por troca de rota,
  // foco da aba ou novas consultas de notificações.
  useEffect(() => {
    if (!toast || !isVisible) return;

    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
    }

    hideTimeoutRef.current = window.setTimeout(() => {
      closeToast();
    }, TOAST_HIDE_DELAY_MS);

    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };
  }, [toast?.id, isVisible]);

  // ---------------------------------------------------------------------------
  // Polling de notificações
  // ---------------------------------------------------------------------------
  // Busca notificações alguns segundos depois de entrar no app, depois mantém
  // o polling normal e checa novamente ao voltar para a aba.
  useEffect(() => {
    if (!shouldCheckNotifications) return;

    let interval: number | undefined;
    let entryDelayTimeout: number | undefined;
    let hasPassedEntryDelay = false;
    let cancelled = false;

    async function checkNotifications() {
      try {
        const notifications = await api.getNotifications(5, 0);
        const latestUnread = notifications.find(
          (notification) => notification.status === "unread"
        );

        if (!latestUnread) return;

        // Pedimos a permissão de push assim que existe uma notificação não
        // lida — mesmo que o toast dela já tenha sido exibido antes. Amarrar
        // isto ao toast APARECER faria com que quem já tinha notificação
        // antiga nunca fosse perguntado.
        if (push.isSupported() && !push.hasAsked()) {
          void push.requestPermissionAndRegister();
        }

        const shownIds = getShownIds();

        if (shownIds.includes(latestUnread.id)) return;
        if (cancelled) return;

        saveShownId(latestUnread.id);

        setActionLoading(null);
        setToast(latestUnread);
        setIsVisible(true);
        playNotificationSound();
      } catch {
        // Falhas de polling não devem interromper o uso do app.
      }
    }

    entryDelayTimeout = window.setTimeout(() => {
      if (cancelled) return;

      hasPassedEntryDelay = true;
      checkNotifications();

      interval = window.setInterval(checkNotifications, POLLING_INTERVAL_MS);
    }, TOAST_ROUTE_ENTRY_DELAY_MS);

    const handleVisibility = () => {
      if (!document.hidden && hasPassedEntryDelay) {
        checkNotifications();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;

      if (entryDelayTimeout) {
        window.clearTimeout(entryDelayTimeout);
      }

      if (interval) {
        window.clearInterval(interval);
      }

      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [location.pathname, shouldCheckNotifications]);

  // ---------------------------------------------------------------------------
  // Ações do toast
  // ---------------------------------------------------------------------------
  function openNotifications() {
    closeToast();
    navigate("/dashboard?notifications=open");
  }

  async function handleMarkAsRead() {
    if (!toast) return;

    setActionLoading("read");

    try {
      await api.markNotificationRead(toast.id);

      window.dispatchEvent(new Event("axon:notifications-updated"));

      closeToast();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAccept() {
    if (!toast) return;

    setActionLoading("accept");

    try {
      await api.acceptNotification(toast.id);

      window.dispatchEvent(new Event("axon:notifications-updated"));

      closeToast();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject() {
    if (!toast) return;

    setActionLoading("reject");

    try {
      await api.rejectNotification(toast.id);

      window.dispatchEvent(new Event("axon:notifications-updated"));

      closeToast();
    } finally {
      setActionLoading(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Renderização condicional
  // ---------------------------------------------------------------------------
  if (!toast || !isVisible) return null;

  const isImprovement = toast.type === "improvement";

  return (
    <div className="pointer-events-none fixed left-0 right-0 top-4 z-[200] px-4">
      <div className="pointer-events-auto relative mx-auto w-full max-w-[430px] overflow-hidden rounded-[1.6rem] border border-soft bg-surface-elevated p-4 text-primary shadow-soft backdrop-blur-2xl">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top right, var(--accent-soft), transparent 54%)",
          }}
        />

        <div className="relative flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* Clique no conteúdo abre a central de notificações do Dashboard. */}
            <button
              type="button"
              onClick={openNotifications}
              className="flex w-full min-w-0 items-start gap-3 text-left transition active:scale-[0.99]"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
                <Bell className="h-5 w-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-accent">
                  {isImprovement ? "Nova sugestão" : "Nova notificação"}
                </p>

                <p className="mt-1 line-clamp-1 text-sm font-semibold text-primary">
                  {toast.title}
                </p>

                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                  {toast.body}
                </p>
              </div>
            </button>

            {/* Sugestões têm aceitar/recusar; notificações comuns podem ser lidas. */}
            <div className="mt-3 flex gap-2 pl-14">
              {isImprovement ? (
                <>
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={actionLoading !== null}
                    className="min-h-9 flex-1 rounded-xl bg-[var(--accent-strong)] px-3 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
                  >
                    {actionLoading === "accept" ? "Aceitando..." : "Aceitar"}
                  </button>

                  <button
                    type="button"
                    onClick={handleReject}
                    disabled={actionLoading !== null}
                    className="min-h-9 flex-1 rounded-xl border border-soft bg-surface-muted px-3 text-xs font-semibold text-secondary transition active:scale-[0.98] disabled:opacity-60"
                  >
                    {actionLoading === "reject" ? "Recusando..." : "Recusar"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleMarkAsRead}
                  disabled={actionLoading !== null}
                  className="min-h-9 rounded-xl border border-soft bg-surface-muted px-3 text-xs font-semibold text-secondary transition active:scale-[0.98] disabled:opacity-60"
                >
                  {actionLoading === "read"
                    ? "Marcando..."
                    : "Marcar como lida"}
                </button>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={closeToast}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-soft bg-surface-muted text-muted transition active:scale-[0.96]"
            aria-label="Fechar notificação"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// SOM DO TOAST
// ===========================================================================
// Feedback sonoro curto; falha silenciosamente se o navegador bloquear áudio.
function playNotificationSound() {
  try {
    const AudioContextClass =
      window.AudioContext || (window as any).webkitAudioContext;

    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(720, audioContext.currentTime);

    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioContext.currentTime + 0.22
    );

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.24);
  } catch {
    // Navegador bloqueou áudio ou não suporta Web Audio.
  }
}