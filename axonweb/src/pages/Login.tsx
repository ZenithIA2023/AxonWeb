import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";

import GoogleAuthButton from "../components/auth/GoogleAuthButton";
import * as api from "../lib/api";

type InputFieldProps = {
  icon: React.ElementType;
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

function InputField({
  icon: Icon,
  label,
  type = "text",
  placeholder,
  value,
  onChange,
}: InputFieldProps) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>

      <div className="flex min-h-10 items-center gap-3 rounded-2xl border border-[#7b2cbf]/20 bg-[#fbf8ff] px-3.5 dark:border-white/10 dark:bg-[#191722] text-[#5b21b6] dark:text-white/78 transition focus-within:border-[#7b2cbf]/45 focus-within:bg-white dark:focus-within:border-[#a855f7]/45 dark:focus-within:bg-[#211c2d]">
        <Icon className="h-4 w-4 shrink-0 text-[#7b2cbf] dark:text-[#d8b4fe]/85" />

        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required
          className="auth-input w-full bg-transparent text-[0.72rem] font-medium text-[#4c1d95] outline-none placeholder:text-[#7b2cbf]/42 dark:text-white/82 dark:placeholder:text-white/38"
        />
      </div>
    </label>
  );
}

type PasswordFieldProps = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
};

function PasswordField({ label, placeholder, value, onChange }: PasswordFieldProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <label className="block">
      <span className="sr-only">{label}</span>

      <div className="flex min-h-10 items-center gap-3 rounded-2xl border border-[#7b2cbf]/20 bg-[#fbf8ff] px-3.5 dark:border-white/10 dark:bg-[#191722] text-[#5b21b6] dark:text-white/78 transition focus-within:border-[#7b2cbf]/45 focus-within:bg-white dark:focus-within:border-[#a855f7]/45 dark:focus-within:bg-[#211c2d]">
        <Lock className="h-4 w-4 shrink-0 text-[#7b2cbf] dark:text-[#d8b4fe]/85" />

        <input
          type={showPassword ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          required
          className="auth-input w-full bg-transparent text-[0.72rem] font-medium text-[#4c1d95] outline-none placeholder:text-[#7b2cbf]/42 dark:text-white/82 dark:placeholder:text-white/38"
        />

        <button
          type="button"
          onClick={() => setShowPassword((prev) => !prev)}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#7b2cbf] dark:text-[#d8b4fe]/70 transition hover:bg-[#7b2cbf]/10 hover:text-[#6d28d9] dark:text-[#d8b4fe] active:scale-[0.96]"
          aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
        >
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  // Erros do OAuth chegam por query (?error=...), inclusive vindos do deep link
  // no app. useSearchParams lê a query do router, que no HashRouter fica depois
  // do "#" — onde o location.search do navegador não enxergaria.
  useEffect(() => {
    const urlError = searchParams.get("error");

    if (urlError) {
      setError(decodeURIComponent(urlError));
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await api.login(email, password);
      api.saveSession(res, rememberMe);

      if (res.has_chronotype) {
        navigate("/app-loading");
      } else {
        navigate("/questionnaire-intro");
      }
    } catch (err: unknown) {
      setError(
        (err as Error).message ?? "Erro ao entrar. Verifique suas credenciais."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#2d0850] px-4 py-8 text-white">
      <AuthGlow />

      <div className="relative z-10 w-full max-w-[340px]">
        <LoginLogo />

        <motion.section
          initial={{ opacity: 0, y: 22, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.48, ease: "easeOut" }}
          className="overflow-hidden rounded-[1.65rem] border border-white/90 bg-white dark:border-white/10 dark:bg-[#11101a]/94 px-5 pb-7 pt-6 text-[#4c1d95] dark:text-white shadow-[0_28px_90px_rgba(0,0,0,0.26)] dark:text-white dark:shadow-[0_28px_90px_rgba(0,0,0,0.48)]"
        >
          <div className="mb-7 text-center">
            <h1 className="text-[1.65rem] font-black leading-none tracking-[-0.045em] text-[#4c1d95] dark:text-white">
              Login
            </h1>

            <p className="mx-auto mt-4 max-w-[16.5rem] text-[0.68rem] font-medium leading-5 text-[#6d28d9] dark:text-[#d8b4fe]/62 dark:text-white/62">
              Acesse seu ambiente inteligente de produtividade e foco
            </p>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <InputField
              icon={Mail}
              label="E-mail"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <PasswordField
              label="Senha"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="flex min-w-0 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="peer sr-only"
                />

                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[0.35rem] border border-[#7b2cbf]/30 bg-white dark:border-white/16 dark:bg-[#191722] transition peer-checked:border-[#7b2cbf] peer-checked:bg-[#7b2cbf]" />

                <span className="truncate text-[0.64rem] font-medium text-[#6d28d9] dark:text-[#d8b4fe]/68 dark:text-white/62">
                  Manter-me conectado
                </span>
              </label>

              <Link
                to="/forgotpassword"
                className="shrink-0 text-[0.64rem] font-black text-[#6d28d9] dark:text-[#d8b4fe] transition hover:text-[#7b2cbf] dark:text-[#d8b4fe]"
              >
                Esqueci minha senha
              </Link>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-2xl border border-red-400/20 dark:border-red-300/20 bg-red-500/10 dark:bg-red-500/14 px-4 py-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-200" />
                <p className="text-xs text-red-600 dark:text-red-200">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex min-h-10 w-full items-center justify-center rounded-2xl bg-[#7b2cbf] px-6 text-sm font-medium text-white shadow-[0_18px_42px_rgba(123,44,191,0.22)] transition hover:bg-[#8d31dd] dark:bg-[#a855f7] dark:hover:bg-[#b968ff] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Entrando..." : "Login"}
              {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
            </button>

            <div className="py-3.5">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[#7b2cbf]/28 dark:bg-white/18" />
                <span className="text-[0.68rem] font-medium text-[#6d28d9] dark:text-[#d8b4fe]/62 dark:text-white/62">
                  ou
                </span>
                <div className="h-px flex-1 bg-[#7b2cbf]/28 dark:bg-white/18" />
              </div>
            </div>

            <GoogleAuthButton label="Continuar com o Google" />
          </form>

          <p className="mt-7 text-center text-[0.68rem] text-[#6d28d9] dark:text-[#d8b4fe]/62 dark:text-white/62">
            Ainda não tem conta?{" "}
            <Link
              to="/signup"
              className="font-black text-[#6d28d9] dark:text-[#d8b4fe] transition hover:text-[#7b2cbf] dark:text-[#d8b4fe]"
            >
              Criar conta
            </Link>
          </p>
        </motion.section>
      </div>
    </main>
  );
}

function LoginLogo() {
  return (
    <div className="mb-6 flex justify-center">
      <Link
        to="/"
        aria-label="Voltar para a landing page"
        className="flex h-12 w-12 rotate-45 items-center justify-center rounded-2xl border border-white/18 bg-white/10 shadow-[0_20px_60px_rgba(168,85,247,0.35)] backdrop-blur-2xl transition active:scale-[0.96]"
      >
        <img
          src="/axon-logo.svg"
          alt="Axon"
          className="h-12 w-12 -rotate-45 object-contain"
        />
      </Link>
    </div>
  );
}

function AuthGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/60 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/32 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/22 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />
    </div>
  );
}