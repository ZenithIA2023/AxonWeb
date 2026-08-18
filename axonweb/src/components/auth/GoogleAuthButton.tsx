import { openAuthUrl } from "../../lib/nativeAuth";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

type GoogleAuthButtonProps = {
  label: string;
};

export default function GoogleAuthButton({ label }: GoogleAuthButtonProps) {
  function handleClick() {
    // Na web navega na própria aba; no app abre o navegador do sistema, único
    // lugar onde o Google aceita autenticar.
    void openAuthUrl(`${API_URL}/auth/google`);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="group inline-flex min-h-10 w-full items-center justify-center gap-3 rounded-2xl border border-[#7b2cbf]/20 bg-[#fbf8ff] px-6 text-[0.74rem] font-medium text-[#6d28d9] transition active:scale-[0.98] dark:border-white/10 dark:bg-[#191722] dark:text-white/78 lg:hover:-translate-y-0.5 lg:hover:border-[#7b2cbf]/38 lg:hover:bg-[#7b2cbf]/10 lg:hover:text-[#5b21b6] lg:hover:shadow-[0_18px_42px_rgba(123,44,191,0.16)] dark:lg:hover:border-white/16 dark:lg:hover:bg-[#211c2d] dark:lg:hover:text-white"
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-full transition lg:group-hover:bg-white dark:lg:group-hover:bg-white">
        <GoogleIcon />
      </span>

      <span>{label}</span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg
      className="h-[1.05rem] w-[1.05rem] shrink-0"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12Z"
      />
      <path
        fill="#34A853"
        d="M3.5 7.4 6.7 9.8C7.5 7.9 9.5 6.5 12 6.5c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.5 12 2.5c-3.7 0-6.9 2-8.5 4.9Z"
      />
      <path
        fill="#4A90E2"
        d="M12 21.5c2.6 0 4.8-.9 6.4-2.4l-3-2.3c-.8.6-1.9 1-3.4 1-2.6 0-4.8-1.7-5.6-4.1l-3.1 2.4c1.6 3.2 4.9 5.4 8.7 5.4Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 13.7c-.2-.6-.3-1.1-.3-1.7s.1-1.2.3-1.7L3.3 7.9C2.8 9.1 2.5 10.5 2.5 12s.3 2.9.8 4.1l3.1-2.4Z"
      />
    </svg>
  );
}