import { useEffect, useMemo, useState, type ElementType, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  Check,
  ChevronRight,
  Download,
  Link2,
  LogOut,
  Mail,
  Moon,
  User,
  Palette,
  Settings as SettingsIcon,
  Shield,
  Sparkles as SparklesIcon,
  Trash2,
  Volume2,
  X,
} from "lucide-react";

import { results, type ChronotypeResultKey } from "../data/results";
import Sidebar from "../components/layout/Sidebar";
import * as api from "../lib/api";
import * as push from "../lib/push";
import { AppBackground } from "../components/layout/AppBackground";
import PageHeader from "../components/layout/PageHeader";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { ThemeToggle } from "../components/theme/ThemeToggle";
import VoiceLab from "../components/settings/VoiceLab";

// ===========================================================================
// TIPOS DA TELA
// ===========================================================================

type SettingRowProps = {
  icon: ElementType;
  title: string;
  description: string;
  value?: string;
  onClick?: () => void;
  danger?: boolean;
};

type ToggleRowProps = {
  icon: ElementType;
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
};

// ===========================================================================
// CRONOTIPO USADO NA SIDEBAR
// ===========================================================================

const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

// ===========================================================================
// PÁGINA DE CONFIGURAÇÕES
// ===========================================================================

export default function Settings() {
  const navigate = useNavigate();

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [notifSettingsOpen, setNotifSettingsOpen] = useState(false);
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);

  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showDeleteFirstModal, setShowDeleteFirstModal] = useState(false);
  const [showDeleteFinalModal, setShowDeleteFinalModal] = useState(false);

  const [silentMode, setSilentMode] = useState(true);
  const [dailyPlanningNotifications, setDailyPlanningNotifications] =
    useState(true);
  const [dailyReviewNotifications, setDailyReviewNotifications] =
    useState(true);
  const [weeklyReviewNotifications, setWeeklyReviewNotifications] =
    useState(true);
  const [axonSuggestionNotifications, setAxonSuggestionNotifications] =
    useState(true);

  // Push do sistema: diferente dos toggles acima, este tem estado REAL — ele
  // reflete a permissão do Android e o registro do aparelho no backend.
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBlocked, setPushBlocked] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushDiag, setPushDiag] = useState("");

  useEffect(() => {
    void push.getStatus().then((st) => {
      setPushSupported(st.supported);
      setPushEnabled(st.registered);
      setPushBlocked(st.permission === "denied");
      setPushDiag(st.diagnostic ?? "");
    });
  }, []);

  async function handleTogglePush() {
    if (pushBusy) return;
    setPushBusy(true);

    try {
      if (pushEnabled) {
        await push.disable();
        setPushEnabled(false);
      } else {
        const ok = await push.requestPermissionAndRegister();
        setPushEnabled(ok);
        const depois = await push.getStatus();
        setPushDiag(depois.diagnostic ?? "");
        // Recusa no diálogo do sistema: o Android não pergunta de novo, então a
        // tela precisa dizer que agora só as configurações do aparelho revertem.
        if (!ok) {
          const st = await push.getStatus();
          setPushBlocked(st.permission === "denied");
        }
      }
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    api
      .getProfile()
      .then((profile) => {
        setUserName(profile.name || "Usuário");
        setUserEmail(profile.email);
      })
      .catch(() => {});
  }, []);

  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, []);

  const result = results[resultKey];

  function handleLogout() {
    api.logout();
    setShowLogoutModal(false);
    navigate("/");
  }

  async function handleDeleteAccount() {
    try {
      await api.deleteAccount();
      api.logout();
      setShowDeleteFinalModal(false);
      navigate("/");
    } catch (error) {
      console.error("Erro ao excluir conta:", error);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-app text-primary">
      <AppBackground />

      <div className="relative z-10 mx-auto min-h-screen w-full max-w-[430px] overflow-x-hidden px-4 pb-6 pt-5 lg:max-w-[1120px] lg:px-8 lg:pt-7">
        <PageHeader
          title="Configurações"
          subtitle="Sistema e privacidade"
          onBack={() => navigate("/dashboard")}
          onMenuClick={() => setIsSidebarOpen(true)}
        />

        <SettingsHero />

        <div className="mt-5 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
          <div className="min-w-0">
            <SettingsSection title="Experiência">
              <SettingRow
                icon={Palette}
                title="Aparência"
                description="Escolha o tema visual da interface."
                value="Configurar"
                onClick={() => setAppearanceModalOpen(true)}
              />
              <SettingRow
                icon={Volume2}
                title="Voz do Axon"
                description="Escolha a voz que lê as respostas em voz alta."
                value="Configurar"
                onClick={() => setVoiceModalOpen(true)}
              />
            </SettingsSection>

            <SettingsSection title="Notificações">
              <SettingRow
                icon={Bell}
                title="Lembretes inteligentes"
                description="Horários, planejamento e alertas importantes."
                value="Configurar"
                onClick={() => setNotifSettingsOpen(true)}
              />

              {pushSupported && (
                <ToggleRow
                  icon={Bell}
                  title="Notificações no aparelho"
                  description={
                    pushBlocked
                      ? "Bloqueado no Android. Libere em Ajustes > Apps > Axon > Notificações."
                      : pushDiag
                        ? pushDiag
                        : "Receber alertas do Axon mesmo com o app fechado."
                  }
                  enabled={pushEnabled}
                  onToggle={handleTogglePush}
                />
              )}

              <ToggleRow
                icon={Moon}
                title="Modo silencioso automático"
                description="Reduz interrupções durante foco ou descanso."
                enabled={silentMode}
                onToggle={() => setSilentMode((prev) => !prev)}
              />
            </SettingsSection>

            <SettingsSection title="Conta">
              <SettingRow
                icon={User}
                title="Conta"
                description="E-mail, senha e segurança de acesso."
                value="Gerenciar"
                onClick={() => setAccountModalOpen(true)}
              />
            </SettingsSection>
          </div>

          <div className="min-w-0">
            <SettingsSection title="Dados e conexões">
              <SettingRow
                icon={Link2}
                title="Integrações"
                description="Calendário, tarefas e ferramentas externas."
                value="Em breve"
              />

              <SettingRow
                icon={Shield}
                title="Privacidade"
                description="Controle como seus dados são usados no Axon."
                value="Gerenciar"
              />

              <SettingRow
                icon={Download}
                title="Exportar dados"
                description="Baixe conversas, rotinas e preferências."
                value="Em breve"
              />
            </SettingsSection>

            <SettingsSection title="Sistema">
              <SettingRow
                icon={SettingsIcon}
                title="Versão do app"
                description="Versão atual do Axon Web."
                value="MVP 0.1"
              />

              <SettingRow
                icon={LogOut}
                title="Sair da conta"
                description="Encerrar sua sessão neste dispositivo."
                danger
                onClick={() => setShowLogoutModal(true)}
              />

              <SettingRow
                icon={Trash2}
                title="Excluir conta"
                description="Excluir permanentemente sua conta e dados."
                danger
                onClick={() => setShowDeleteFirstModal(true)}
              />
            </SettingsSection>

            <p className="pt-1 text-center text-xs leading-5 text-soft lg:text-left">
              Axon Web · versão inicial de desenvolvimento
            </p>
          </div>
        </div>
      </div>

      <SettingsModal
        isOpen={voiceModalOpen}
        title="Voz do Axon"
        description="Ouça as vozes deste aparelho e escolha a que o Axon vai usar."
        icon={Volume2}
        onClose={() => setVoiceModalOpen(false)}
      >
        <VoiceLab />
      </SettingsModal>

      <AppearanceModal
        isOpen={appearanceModalOpen}
        onClose={() => setAppearanceModalOpen(false)}
      />

      <AccountModal
        isOpen={accountModalOpen}
        userName={userName}
        userEmail={userEmail}
        onClose={() => setAccountModalOpen(false)}
      />

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
        userName={userName}
        userEmail={userEmail}
      />

      <ConfirmDialog
        isOpen={showLogoutModal}
        title="Deseja sair da sua conta?"
        description="Você será desconectado do Axon e precisará fazer login novamente para acessar seu ambiente."
        confirmLabel="Sair"
        variant="danger"
        icon={LogOut}
        onConfirm={handleLogout}
        onClose={() => setShowLogoutModal(false)}
      />

      <ConfirmDialog
        isOpen={showDeleteFirstModal}
        title="Excluir sua conta?"
        description="Essa ação é permanente e removerá seu acesso ao Axon."
        confirmLabel="Continuar"
        variant="danger"
        icon={Trash2}
        onConfirm={() => {
          setShowDeleteFirstModal(false);
          setShowDeleteFinalModal(true);
        }}
        onClose={() => setShowDeleteFirstModal(false)}
      />

      <ConfirmDialog
        isOpen={showDeleteFinalModal}
        title="Confirmação final"
        description={
          <>
            <p>
              O e-mail abaixo não poderá ser usado para criar outra conta no
              Axon pelos próximos{" "}
              <span className="font-semibold text-primary">60 dias</span>.
            </p>

            <div className="mt-5 flex items-center gap-3 rounded-[1.35rem] border border-soft bg-surface-muted p-3 text-left">
              <Mail className="h-4 w-4 shrink-0 text-red-600 dark:text-red-200" />
              <p className="min-w-0 truncate text-sm font-semibold text-secondary">
                {userEmail || "E-mail da conta"}
              </p>
            </div>
          </>
        }
        confirmLabel="Sim, excluir"
        variant="danger"
        onConfirm={handleDeleteAccount}
        onClose={() => setShowDeleteFinalModal(false)}
      />

      <NotificationsModal
        isOpen={notifSettingsOpen}
        dailyPlanningEnabled={dailyPlanningNotifications}
        dailyReviewEnabled={dailyReviewNotifications}
        weeklyReviewEnabled={weeklyReviewNotifications}
        axonSuggestionEnabled={axonSuggestionNotifications}
        onToggleDailyPlanning={() =>
          setDailyPlanningNotifications((prev) => !prev)
        }
        onToggleDailyReview={() => setDailyReviewNotifications((prev) => !prev)}
        onToggleWeeklyReview={() =>
          setWeeklyReviewNotifications((prev) => !prev)
        }
        onToggleAxonSuggestion={() =>
          setAxonSuggestionNotifications((prev) => !prev)
        }
        onClose={() => setNotifSettingsOpen(false)}
      />
    </main>
  );
}

// ===========================================================================
// COMPONENTES DA TELA
// ===========================================================================

function SettingsHero() {
  return (
    <section className="mt-5">
      <div className="relative overflow-hidden rounded-[2.15rem] border border-soft bg-surface-elevated p-5 text-primary shadow-card backdrop-blur-2xl lg:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--accent-soft),transparent_54%)]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--accent-muted)] to-transparent" />

        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em] text-accent">
            <SettingsIcon className="h-3 w-3" />
            Central do app
          </div>

          <h1 className="max-w-[34rem] text-[1.75rem] font-black leading-[0.98] tracking-[-0.055em] text-primary sm:text-[2.15rem]">
            Ajustes do Axon, sem misturar com seu perfil.
          </h1>

          <p className="mt-3 max-w-[36rem] text-sm leading-6 text-muted">
            Aqui ficam aparência, notificações, privacidade, integrações e
            ações sensíveis da conta. Informações pessoais e preferências do
            Axon ficam no Perfil.
          </p>
        </div>
      </div>
    </section>
  );
}

function SettingsSection({
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

      <div className="space-y-2">{children}</div>
    </section>
  );
}

function AppearanceModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <SettingsModal
      isOpen={isOpen}
      title="Aparência"
      description="Escolha como a interface do Axon deve aparecer para você."
      icon={Palette}
      onClose={onClose}
    >
      <ThemeToggle showHeader={false} />
    </SettingsModal>
  );
}

function AccountModal({
  isOpen,
  userEmail,
  onClose,
}: {
  isOpen: boolean;
  userName: string;
  userEmail: string;
  onClose: () => void;
}) {
  const [nextEmail, setNextEmail] = useState(userEmail);
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordsMatch =
    nextPassword.length === 0 ||
    confirmPassword.length === 0 ||
    nextPassword === confirmPassword;

  useEffect(() => {
    if (!isOpen) return;

    setNextEmail(userEmail);
    setEmailPassword("");
    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
  }, [isOpen, userEmail]);

  return (
    <SettingsModal
      isOpen={isOpen}
      title="Conta"
      description="Gerencie e-mail, senha e segurança de acesso."
      icon={User}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="rounded-[1.5rem] border border-soft bg-surface-muted p-4">
          <p className="text-xs font-semibold text-muted">E-mail atual</p>
          <div className="mt-2 flex min-w-0 items-center gap-2">
            <Mail className="h-4 w-4 shrink-0 text-accent" />
            <p className="min-w-0 truncate text-sm font-black text-primary">
              {userEmail || "E-mail não encontrado"}
            </p>
          </div>
        </div>

        <div className="space-y-3 rounded-[1.5rem] border border-soft bg-surface-muted p-4">
          <div>
            <p className="text-sm font-black text-primary">Alterar e-mail</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Use um e-mail válido e confirme com sua senha atual.
            </p>
          </div>

          <SettingsInput
            label="Novo e-mail"
            value={nextEmail}
            onChange={setNextEmail}
            placeholder="seuemail@exemplo.com"
            type="email"
          />

          <SettingsInput
            label="Senha atual"
            value={emailPassword}
            onChange={setEmailPassword}
            placeholder="Confirme sua senha"
            type="password"
          />
        </div>

        <div className="space-y-3 rounded-[1.5rem] border border-soft bg-surface-muted p-4">
          <div>
            <p className="text-sm font-black text-primary">Alterar senha</p>
            <p className="mt-1 text-xs leading-5 text-muted">
              Informe sua senha atual e escolha uma nova senha segura.
            </p>
          </div>

          <SettingsInput
            label="Senha atual"
            value={currentPassword}
            onChange={setCurrentPassword}
            placeholder="Digite sua senha atual"
            type="password"
          />

          <SettingsInput
            label="Nova senha"
            value={nextPassword}
            onChange={setNextPassword}
            placeholder="Digite uma nova senha"
            type="password"
          />

          <SettingsInput
            label="Confirmar nova senha"
            value={confirmPassword}
            onChange={setConfirmPassword}
            placeholder="Repita a nova senha"
            type="password"
          />

          {!passwordsMatch && (
            <p className="rounded-xl border border-red-300/20 bg-red-500/10 px-3 py-2 text-[0.7rem] leading-5 text-red-600 dark:text-red-300">
              As senhas não coincidem.
            </p>
          )}
        </div>

        <p className="rounded-[1.25rem] border border-accent-soft bg-accent-soft px-4 py-3 text-[0.7rem] leading-5 text-muted">
          A interface já está preparada. O salvamento real será conectado quando
          o backend disponibilizar as rotas de alteração de e-mail e senha.
        </p>

        <button
          type="button"
          onClick={onClose}
          disabled={!passwordsMatch}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[var(--accent-strong)] px-4 text-sm font-semibold text-white shadow-card transition active:scale-[0.98] disabled:opacity-50"
        >
          <Check className="mr-2 h-4 w-4" />
          Salvar alterações
        </button>
      </div>
    </SettingsModal>
  );
}

function NotificationsModal({
  isOpen,
  dailyPlanningEnabled,
  dailyReviewEnabled,
  weeklyReviewEnabled,
  axonSuggestionEnabled,
  onToggleDailyPlanning,
  onToggleDailyReview,
  onToggleWeeklyReview,
  onToggleAxonSuggestion,
  onClose,
}: {
  isOpen: boolean;
  dailyPlanningEnabled: boolean;
  dailyReviewEnabled: boolean;
  weeklyReviewEnabled: boolean;
  axonSuggestionEnabled: boolean;
  onToggleDailyPlanning: () => void;
  onToggleDailyReview: () => void;
  onToggleWeeklyReview: () => void;
  onToggleAxonSuggestion: () => void;
  onClose: () => void;
}) {
  return (
    <SettingsModal
      isOpen={isOpen}
      title="Lembretes inteligentes"
      description="Escolha quais alertas o Axon pode enviar para você."
      icon={Bell}
      onClose={onClose}
    >
      <div className="space-y-2">
        <ToggleRow
          icon={Bell}
          title="Planejamento diário"
          description="Lembrete para organizar o dia."
          enabled={dailyPlanningEnabled}
          onToggle={onToggleDailyPlanning}
        />

        <ToggleRow
          icon={Moon}
          title="Revisão do dia"
          description="Lembrete para fechar o dia e registrar como foi."
          enabled={dailyReviewEnabled}
          onToggle={onToggleDailyReview}
        />

        <ToggleRow
          icon={SettingsIcon}
          title="Revisão semanal"
          description="Resumo de padrões, progresso e pontos de atenção."
          enabled={weeklyReviewEnabled}
          onToggle={onToggleWeeklyReview}
        />

        <ToggleRow
          icon={SparklesIcon}
          title="Sugestões do Axon"
          description="Alertas quando o Axon identificar um ajuste útil."
          enabled={axonSuggestionEnabled}
          onToggle={onToggleAxonSuggestion}
        />

        <p className="pt-2 text-[0.68rem] leading-5 text-muted">
          Essas preferências estão prontas na interface. A persistência pode ser
          conectada depois ao backend de notificações.
        </p>
      </div>
    </SettingsModal>
  );
}

function SettingsModal({
  isOpen,
  title,
  description,
  icon: Icon,
  children,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  description: string;
  icon: ElementType;
  children: ReactNode;
  onClose: () => void;
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
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.97 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="custom-scrollbar max-h-[88dvh] w-full max-w-[430px] overflow-y-auto rounded-[2rem] border border-soft bg-surface-elevated p-5 text-primary shadow-soft backdrop-blur-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
                  <Icon className="h-5 w-5" />
                </div>

                <div className="min-w-0">
                  <p className="text-sm font-black text-primary">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    {description}
                  </p>
                </div>
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

            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SettingsInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "email" | "password";
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
        className="w-full rounded-2xl border border-soft bg-surface-muted px-4 py-3 text-sm font-medium text-primary outline-none transition placeholder:text-soft focus:border-accent-soft"
      />
    </label>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  value,
  onClick,
  danger = false,
}: SettingRowProps) {
  const content = (
    <>
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
          className={`text-sm font-semibold ${
            danger ? "text-red-600 dark:text-red-100" : "text-primary"
          }`}
        >
          {title}
        </p>

        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>

        {value && (
          <p
            className={`mt-2 truncate text-xs font-medium ${
              danger
                ? "text-red-600/75 dark:text-red-100/70"
                : "text-accent"
            }`}
          >
            {value}
          </p>
        )}
      </div>

      {onClick && (
        <ChevronRight
          className={`h-5 w-5 shrink-0 ${
            danger ? "text-red-500/40 dark:text-red-100/35" : "text-soft"
          }`}
        />
      )}
    </>
  );

  const className = `flex w-full items-center gap-3 rounded-[1.7rem] border p-4 text-left shadow-card backdrop-blur-2xl transition active:scale-[0.99] ${
    danger
      ? "border-red-300/20 bg-red-500/10"
      : "border-soft bg-surface-elevated"
  }`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

function ToggleRow({
  icon: Icon,
  title,
  description,
  enabled,
  onToggle,
}: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 rounded-[1.7rem] border border-soft bg-surface-elevated p-4 text-left shadow-card backdrop-blur-2xl transition active:scale-[0.99]"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-accent-soft bg-accent-soft text-accent">
        <Icon className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-primary">{title}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>

      <div
        className={`flex h-7 w-12 shrink-0 items-center rounded-full border p-1 transition ${
          enabled
            ? "justify-end border-accent-soft bg-accent-soft"
            : "justify-start border-soft bg-surface-muted"
        }`}
      >
        <div
          className={`h-5 w-5 rounded-full shadow-card transition ${
            enabled ? "bg-[var(--accent)]" : "bg-[var(--text-soft)]"
          }`}
        />
      </div>
    </button>
  );
}