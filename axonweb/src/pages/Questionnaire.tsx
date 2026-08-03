import { useEffect, useState, type ElementType } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../lib/api";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
  Brain,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Moon,
  Sparkles,
  SlidersHorizontal,
  Sun,
  Sunrise,
  Zap,
} from "lucide-react";

// ===========================================================================
// TIPOS DO QUESTIONÁRIO
// ===========================================================================
type Option = {
  id: string;
  label: string;
};

type Question = {
  id: string;
  category: string;
  title: string;
  icon: ElementType;
  options: Option[];
};

// ===========================================================================
// PERGUNTAS DO MAPEAMENTO INICIAL
// ===========================================================================
// Questionário cronobiológico usado para estimar ritmo, foco e tipo de rotina.
const questions: Question[] = [
  {
    id: "P1",
    category: "Sono e despertar",
    title: "Você acha fácil acordar pela manhã?",
    icon: Sunrise,
    options: [
      { id: "A", label: "Muito fácil." },
      { id: "B", label: "Moderadamente fácil." },
      { id: "C", label: "Normal." },
      { id: "D", label: "Difícil." },
      { id: "E", label: "Muito difícil." },
    ],
  },
  {
    id: "P2",
    category: "Sono e despertar",
    title: "Você se sente alerta durante a primeira meia hora depois de acordar?",
    icon: Zap,
    options: [
      { id: "A", label: "Totalmente alerta." },
      { id: "B", label: "Moderadamente alerta." },
      { id: "C", label: "Pouco alerta." },
      { id: "D", label: "Não me sinto alerta." },
    ],
  },
  {
    id: "P3",
    category: "Manhã",
    title: "Como é o seu apetite durante a primeira hora depois de acordar?",
    icon: Sun,
    options: [
      { id: "A", label: "Tenho bastante apetite." },
      { id: "B", label: "Apetite moderado." },
      { id: "C", label: "Pouco apetite." },
      { id: "D", label: "Sem apetite." },
    ],
  },
  {
    id: "P4",
    category: "Sono e despertar",
    title: "Pela manhã, você depende do despertador para acordar?",
    icon: Clock3,
    options: [
      { id: "A", label: "Não, acordo espontaneamente." },
      { id: "B", label: "Sim, mas sem dificuldades." },
      { id: "C", label: "Sim, às vezes com dificuldades." },
      {
        id: "D",
        label: "Sim, preciso de vários alarmes para conseguir acordar.",
      },
    ],
  },
  {
    id: "P5",
    category: "Horário ideal de dormir",
    title:
      "Caso não tivesse compromisso na manhã seguinte, a que horas gostaria de deitar?",
    icon: Moon,
    options: [
      { id: "A", label: "Entre 21h e 22h." },
      { id: "B", label: "Entre 22h e 23h." },
      { id: "C", label: "Entre 23h e 00h30." },
      { id: "D", label: "Depois da 1h da manhã." },
    ],
  },
  {
    id: "P6",
    category: "Energia física",
    title:
      "Em qual horário você se sente fisicamente mais disposto e com mais energia no corpo?",
    icon: Zap,
    options: [
      { id: "A", label: "De manhã cedo, antes das 8h." },
      { id: "B", label: "No período da manhã, entre 8h e 12h." },
      { id: "C", label: "No início da tarde, entre 12h e 15h." },
      { id: "D", label: "No final da tarde, entre 15h e 20h." },
      { id: "E", label: "À noite, depois das 20h." },
    ],
  },
  {
    id: "P7",
    category: "Cansaço noturno",
    title:
      "À noite, entre 20h e 3h, a que horas você costuma se sentir cansado e com vontade de dormir?",
    icon: Moon,
    options: [
      { id: "A", label: "Entre 20h e 21h." },
      { id: "B", label: "Entre 21h e 22h30." },
      { id: "C", label: "Entre 22h30 e 00h30." },
      { id: "D", label: "Entre 00h30 e 3h." },
    ],
  },
  {
    id: "P8",
    category: "Horário ideal de acordar",
    title: "Se você tivesse total liberdade para planejar seu dia, a que horas preferiria acordar?",
    icon: Sunrise,
    options: [
      { id: "A", label: "Antes das 6h30." },
      { id: "B", label: "Entre 6h30 e 8h." },
      { id: "C", label: "Entre 8h e 9h30." },
      { id: "D", label: "Após 9h30." },
    ],
  },
  {
    id: "P9",
    category: "Qualidade do sono",
    title: "Como você descreveria a qualidade do seu sono atualmente?",
    icon: Moon,
    options: [
      { id: "A", label: "Durmo direto e acordo me sentindo 100% disposto." },
      {
        id: "B",
        label: "Acordo poucas vezes durante a noite, mas acordo me sentindo bem.",
      },
      { id: "C", label: "Tenho dificuldade em pegar no sono, mas depois durmo bem." },
      {
        id: "D",
        label: "Acordo várias vezes durante a noite e tenho o sono leve.",
      },
      {
        id: "E",
        label: "Sinto que durmo bem, mas acordo cansado e sem energia.",
      },
      { id: "F", label: "Outro." },
    ],
  },
  {
    id: "P10",
    category: "Pico mental",
    title:
      "Em qual horário você estaria no máximo de sua forma para um teste de esforço mental?",
    icon: Brain,
    options: [
      { id: "A", label: "Antes das 10h." },
      { id: "B", label: "Entre 10h e 12h." },
      { id: "C", label: "Entre 13h30 e 16h." },
      { id: "D", label: "Entre 16h e 21h." },
      { id: "E", label: "Entre 21h e 00h." },
      { id: "F", label: "Depois das 00h." },
    ],
  },
  {
    id: "P11",
    category: "Produtividade",
    title:
      "Em qual período do dia você geralmente se sente mais produtivo para tarefas que exigem concentração?",
    icon: Brain,
    options: [
      { id: "A", label: "Nas primeiras horas da manhã (5h às 9h)." },
      { id: "B", label: "No final da manhã (9h às 12h)." },
      { id: "C", label: "No início da tarde (12h às 15h)." },
      { id: "D", label: "No final da tarde (15h às 18h)." },
      { id: "E", label: "À noite (18h às 22h)." },
      { id: "F", label: "Tarde da noite (após as 22h)." },
      {
        id: "G",
        label: "Não tenho um pico claro — cada dia é diferente.",
      },
    ],
  },
  {
    id: "P12",
    category: "Queda de energia",
    title: "Você sente uma queda de energia em algum momento específico do dia?",
    icon: Zap,
    options: [
      { id: "A", label: "Não, sinto-me energizado o dia todo." },
      { id: "B", label: "Sim, no fim da manhã (10h às 12h)." },
      { id: "C", label: "Sim, no início da tarde (12h às 15h)." },
      { id: "D", label: "Sim, no meio da tarde (15h às 17h)." },
      { id: "E", label: "Sim, no final da tarde (17h às 20h)." },
      { id: "F", label: "Sim, no começo da noite (20h às 23h)." },
      { id: "G", label: "Sim, apenas de madrugada (após as 23h)." },
    ],
  },
  {
    id: "P13",
    category: "Criatividade",
    title:
      "Você consegue realizar tarefas criativas ou de resolução de problemas melhor em algum horário específico?",
    icon: Sparkles,
    options: [
      { id: "A", label: "Nas primeiras horas da manhã (antes das 09h)." },
      { id: "B", label: "No final da manhã (09h às 12h)." },
      { id: "C", label: "Durante a tarde (12h às 16h)." },
      { id: "D", label: "Final da tarde (16h às 19h)." },
      { id: "E", label: "Noite (19h às 22h)." },
      { id: "F", label: "Tarde da noite (depois das 22h)." },
      { id: "G", label: "Não tenho um pico definido." },
    ],
  },
  {
    id: "P14",
    category: "Execução",
    title:
      "Se tivesse que realizar uma tarefa importante e desafiadora, em qual horário você escolheria?",
    icon: Brain,
    options: [
      { id: "A", label: "Antes das 10h." },
      { id: "B", label: "Das 10h às 13h." },
      { id: "C", label: "Das 13h às 16h." },
      { id: "D", label: "Das 16h às 19h." },
      { id: "E", label: "Das 19h às 22h." },
      { id: "F", label: "Após as 22h." },
    ],
  },
  {
    id: "P15",
    category: "Turno menos produtivo",
    title:
      "Se você tivesse que descartar um turno do dia por considerá-lo menos produtivo, qual seria?",
    icon: Clock3,
    options: [
      { id: "A", label: "Manhã (antes das 12h)." },
      { id: "B", label: "Tarde (12h às 18h)." },
      { id: "C", label: "Noite (18h às 00h)." },
      { id: "D", label: "Madrugada (depois das 00h)." },
    ],
  },
  {
    id: "P16",
    category: "Melhor turno cognitivo",
    title: "Qual é o seu melhor turno para tarefas cognitivas exigentes?",
    icon: Brain,
    options: [
      { id: "A", label: "Manhã cedo, antes das 8h." },
      { id: "B", label: "Manhã, entre 8h e 12h." },
      { id: "C", label: "Começo da tarde, entre 12h e 16h." },
      { id: "D", label: "Final da tarde, entre 16h e 20h." },
      { id: "E", label: "Noite, entre 20h e 00h." },
      { id: "F", label: "Madrugada, depois das 00h." },
    ],
  },
  {
    id: "P17",
    category: "Ritmo de produtividade",
    title: "Como você descreveria sua produtividade ao longo do dia?",
    icon: Zap,
    options: [
      { id: "A", label: "Alta pela manhã e vai diminuindo ao longo do dia." },
      {
        id: "B",
        label: "Consistente ao longo de todo o dia, com pequenos picos.",
      },
      { id: "C", label: "Baixa pela manhã, aumentando durante a tarde e a noite." },
      { id: "D", label: "Alta somente à noite." },
      { id: "E", label: "Tenho dois picos: um de manhã e outro à noite." },
    ],
  },
  {
    id: "P18",
    category: "Concentração",
    title:
      "Você sente que sua capacidade de se concentrar aumenta em algum horário específico do dia?",
    icon: Sparkles,
    options: [
      { id: "A", label: "Nas primeiras horas da manhã." },
      { id: "B", label: "No meio da manhã." },
      { id: "C", label: "No começo da tarde." },
      { id: "D", label: "No final da tarde." },
      { id: "E", label: "No início da noite." },
      { id: "F", label: "De madrugada." },
      { id: "G", label: "Em horários alternados, dependendo do dia." },
    ],
  },
  {
    id: "SCHED",
    category: "Sua rotina",
    title: "Como são seus horários de trabalho ou estudo atualmente?",
    icon: Briefcase,
    options: [
      {
        id: "flexible",
        label: "Tenho horários flexíveis — posso organizar meu dia do meu jeito.",
      },
      {
        id: "fixed",
        label: "Tenho horários fixos — trabalho ou estudo em horários determinados.",
      },
    ],
  },
];

const QUESTIONNAIRE_PROGRESS_KEY = "axon_questionnaire_progress_v1";

type QuestionnaireProgress = {
  currentIndex: number;
  answers: Record<string, string>;
  updatedAt: number;
};

function loadQuestionnaireProgress(): QuestionnaireProgress | null {
  try {
    const stored = localStorage.getItem(QUESTIONNAIRE_PROGRESS_KEY);

    if (!stored) return null;

    const parsed = JSON.parse(stored) as QuestionnaireProgress;

    const isValidIndex =
      Number.isInteger(parsed.currentIndex) &&
      parsed.currentIndex >= 0 &&
      parsed.currentIndex < questions.length;

    const hasValidAnswers =
      parsed.answers &&
      typeof parsed.answers === "object" &&
      !Array.isArray(parsed.answers);

    if (!isValidIndex || !hasValidAnswers) {
      localStorage.removeItem(QUESTIONNAIRE_PROGRESS_KEY);
      return null;
    }

    return parsed;
  } catch {
    localStorage.removeItem(QUESTIONNAIRE_PROGRESS_KEY);
    return null;
  }
}

function saveQuestionnaireProgress(
  currentIndex: number,
  answers: Record<string, string>
) {
  const progress: QuestionnaireProgress = {
    currentIndex,
    answers,
    updatedAt: Date.now(),
  };

  localStorage.setItem(QUESTIONNAIRE_PROGRESS_KEY, JSON.stringify(progress));
}

function clearQuestionnaireProgress() {
  localStorage.removeItem(QUESTIONNAIRE_PROGRESS_KEY);
}

// ===========================================================================
// COMPONENTES VISUAIS AUXILIARES
// ===========================================================================

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[#7b2cbf]/14 dark:bg-white/12">
      <motion.div
        className="h-full rounded-full bg-[#7b2cbf] shadow-[0_0_18px_rgba(123,44,191,0.28)] dark:bg-[#a855f7]"
        initial={{ width: 0 }}
        animate={{ width: `${progress}%` }}
        transition={{ duration: 0.35, ease: "easeOut" }}
      />
    </div>
  );
}

// ===========================================================================
// PÁGINA DO QUESTIONÁRIO
// ===========================================================================

export default function Questionnaire() {
  const navigate = useNavigate();

  const savedProgress = loadQuestionnaireProgress();

  const [currentIndex, setCurrentIndex] = useState(
    savedProgress?.currentIndex ?? 0
  );

  const [answers, setAnswers] = useState<Record<string, string>>(
    savedProgress?.answers ?? {}
  );
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (submitted) return;

    saveQuestionnaireProgress(currentIndex, answers);
  }, [currentIndex, answers, submitted]);

  const currentQuestion = questions[currentIndex];
  const selectedAnswer = answers[currentQuestion?.id];
  const progress = ((currentIndex + 1) / questions.length) * 100;
  const isLastQuestion = currentIndex === questions.length - 1;

  function selectAnswer(optionId: string) {
    if (submitted) return;

    setAnswers((prev) => ({
      ...prev,
      [currentQuestion.id]: optionId,
    }));
  }

  async function handleFinish(finalAnswers: Record<string, string>) {
    const {
      P9: qualidade_sono = "F",
      SCHED: schedule_type,
      ...respostas
    } = finalAnswers;

    const logged = api.isLoggedIn();

    console.log(
      "[questionario] isLoggedIn:",
      logged,
      "| respostas:",
      respostas,
      "| sono:",
      qualidade_sono,
      "| sched:",
      schedule_type
    );

    try {
      const result = logged
        ? await api.classifyAndSave(respostas, qualidade_sono, schedule_type)
        : await api.classify(respostas, qualidade_sono, schedule_type);

      console.log(
        "[questionario] salvo com sucesso. cronotipo:",
        result.cronotipo
      );

      localStorage.setItem("axon_chronotype", result.cronotipo);

      if (schedule_type) {
        localStorage.setItem("axon_schedule_type", schedule_type);
      }

      clearQuestionnaireProgress();

      navigate("/analyzing");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[questionario] ERRO ao salvar:", msg, err);

      setSubmitted(false);

      if (!logged) {
        alert(
          "Você não está logado — o questionário não pôde ser salvo no banco. Faça login e refaça o questionário."
        );
      } else {
        alert("Erro ao salvar o questionário: " + msg);
      }
    }
  }

  function goNext() {
    if (!selectedAnswer || submitted) return;

    if (isLastQuestion) {
      setSubmitted(true);
      const finalAnswers = { ...answers, [currentQuestion.id]: selectedAnswer };
      handleFinish(finalAnswers);
      return;
    }

    setCurrentIndex((prev) => prev + 1);
  }

  function goBack() {
    if (submitted || currentIndex === 0) return;
    setCurrentIndex((prev) => prev - 1);
  }

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#2d0850] px-4 py-5 text-white">
      <QuestionnaireBackground />

      <div className="relative z-10 mx-auto flex min-h-[calc(100vh-40px)] w-full max-w-[430px] flex-col">
        <Header />

        <section className="flex flex-1 flex-col justify-center py-6">
          {/*
            A transição fica dentro do card (ver QuestionCard), como na tela de
            introdução: a moldura e a pilha de trás continuam fixas e só o
            conteúdo da pergunta desliza.
          */}
          <QuestionCard
            question={currentQuestion}
            currentIndex={currentIndex}
            progress={progress}
            selectedAnswer={selectedAnswer}
            submitted={submitted}
            isLastQuestion={isLastQuestion}
            onSelectAnswer={selectAnswer}
            onNext={goNext}
            onBack={goBack}
          />
        </section>
      </div>
    </main>
  );
}

// ===========================================================================
// ESTRUTURA VISUAL
// ===========================================================================

function Header() {
  return (
    <header className="flex items-center justify-between">
      <Link to="/" className="flex items-center gap-2">
        <img
          src="/axon-logo-inverted.svg"
          alt="Axon"
          className="h-8 w-8 object-contain"
        />

        <span className="text-sm font-semibold tracking-[-0.02em] text-white">
          AXON
        </span>
      </Link>
    </header>
  );
}

// Transição do conteúdo da pergunta — mesmos valores usados na tela de
// introdução. Os dois blocos animados (cabeçalho e corpo) compartilham a
// configuração para entrarem e saírem em sincronia.
const QUESTION_CONTENT_MOTION = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.28, ease: "easeOut" },
} as const;

function QuestionCard({
  question,
  currentIndex,
  progress,
  selectedAnswer,
  submitted,
  isLastQuestion,
  onSelectAnswer,
  onNext,
  onBack,
}: {
  question: Question;
  currentIndex: number;
  progress: number;
  selectedAnswer?: string;
  submitted: boolean;
  isLastQuestion: boolean;
  onSelectAnswer: (optionId: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const Icon = question.icon;

  return (
    <div className="relative mx-auto w-full max-w-[350px]">
      <DecorativeStack />

      <div className="relative z-10 overflow-hidden rounded-[2.2rem] border border-white/90 bg-white px-5 pb-5 pt-6 text-[#4c1d95] shadow-[0_28px_90px_rgba(0,0,0,0.24)] dark:border-white/10 dark:bg-[#11101a]/94 dark:text-white dark:shadow-[0_28px_90px_rgba(0,0,0,0.48)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${question.id}-cabecalho`}
            {...QUESTION_CONTENT_MOTION}
            className="mb-4 flex items-center justify-between gap-3"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#7b2cbf]/20 bg-[#7b2cbf]/10 text-[#7b2cbf] dark:border-white/10 dark:bg-[#191722] dark:text-white/78">
              <Icon className="h-4 w-4" />
            </div>

            <span className="rounded-xl border border-[#7b2cbf]/20 bg-[#fbf8ff] px-3 py-1 text-[0.62rem] font-semibold text-[#6d28d9]/72 dark:border-white/10 dark:bg-[#191722] dark:text-white/62">
              {question.category}
            </span>
          </motion.div>
        </AnimatePresence>

        {/*
          A barra e a porcentagem ficam fora da transição — são o indicador de
          progresso da sequência inteira, como os dots da introdução. Assim a
          barra cresce continuamente de uma pergunta para a outra em vez de
          reiniciar do zero a cada troca.
        */}
        <ProgressBar progress={progress} />

        <div className="mt-2 flex items-center justify-end">
          <p className="text-[0.7rem] font-black text-[#4c1d95] dark:text-white/86">
            {Math.round(progress)}%
          </p>
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={question.id} {...QUESTION_CONTENT_MOTION}>
            <h1 className="mx-auto mt-5 max-w-[17.5rem] text-center text-[1.25rem] font-black leading-[1.02] tracking-[-0.04em] text-[#4c1d95] dark:text-white">
              {question.title}
            </h1>

            <div className="mt-6 space-y-2">
              {question.options.map((option) => (
                <AnswerOption
                  key={option.id}
                  questionId={question.id}
                  option={option}
                  selected={selectedAnswer === option.id}
                  disabled={submitted}
                  onSelect={onSelectAnswer}
                />
              ))}
            </div>

            <QuestionActions
              currentIndex={currentIndex}
              isLastQuestion={isLastQuestion}
              selectedAnswer={selectedAnswer}
              submitted={submitted}
              onNext={onNext}
              onBack={onBack}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function AnswerOption({
  questionId,
  option,
  selected,
  disabled,
  onSelect,
}: {
  questionId: string;
  option: Option;
  selected: boolean;
  disabled: boolean;
  onSelect: (optionId: string) => void;
}) {
  const ScheduleIcon =
    questionId === "SCHED"
      ? option.id === "flexible"
        ? SlidersHorizontal
        : CalendarClock
      : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(option.id)}
      disabled={disabled}
      className={`flex min-h-9 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${
        selected
          ? "border-[#7b2cbf]/48 bg-[#7b2cbf]/10 shadow-[0_12px_28px_rgba(123,44,191,0.1)] dark:border-[#a855f7]/55 dark:bg-[#a855f7]/14"
          : "border-[#7b2cbf]/18 bg-[#fbf8ff] hover:border-[#7b2cbf]/30 hover:bg-white dark:border-white/10 dark:bg-[#191722] dark:hover:border-white/18 dark:hover:bg-[#211c2d]"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border text-[0.58rem] font-black transition ${
          selected
            ? "border-[#7b2cbf] bg-[#7b2cbf] text-white dark:border-[#a855f7] dark:bg-[#a855f7]"
            : "border-[#7b2cbf]/20 bg-white text-[#6d28d9]/72 dark:border-white/12 dark:bg-[#11101a] dark:text-white/54"
        }`}
      >
        {selected ? (
          <Check className="h-3.5 w-3.5" />
        ) : ScheduleIcon ? (
          <ScheduleIcon className="h-3.5 w-3.5" />
        ) : (
          option.id
        )}
      </span>

      <span className="text-[0.76rem] font-medium leading-4 text-[#4c1d95] dark:text-white/82">
        {option.label}
      </span>
    </button>
  );
}

function QuestionActions({
  currentIndex,
  isLastQuestion,
  selectedAnswer,
  submitted,
  onNext,
  onBack,
}: {
  currentIndex: number;
  isLastQuestion: boolean;
  selectedAnswer?: string;
  submitted: boolean;
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <footer className="mt-6 flex items-center justify-between">
      {currentIndex > 0 ? (
        <button
          type="button"
          onClick={onBack}
          disabled={submitted}
          aria-label="Voltar pergunta"
          className="group flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[#7b2cbf]/24 bg-[#fbf8ff] text-[#6d28d9] shadow-[0_12px_28px_rgba(45,8,80,0.08)] transition hover:-translate-y-0.5 hover:border-[#7b2cbf]/38 hover:bg-white hover:shadow-[0_18px_38px_rgba(123,44,191,0.14)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-[#191722] dark:text-white/70 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] dark:hover:border-white/18 dark:hover:bg-[#211c2d] dark:hover:text-white"
        >
          <ChevronLeft className="h-5 w-5 transition group-hover:-translate-x-0.5" />
        </button>
      ) : (
        <div className="h-11 w-11" aria-hidden="true" />
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={!selectedAnswer || submitted}
        aria-label={isLastQuestion ? "Analisar perfil" : "Avançar pergunta"}
        className={`group flex h-11 shrink-0 items-center justify-center rounded-2xl bg-[#7b2cbf] text-white shadow-[0_18px_42px_rgba(123,44,191,0.22)] transition hover:-translate-y-0.5 hover:bg-[#8d31dd] hover:shadow-[0_22px_48px_rgba(123,44,191,0.28)] active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-[#7b2cbf]/28 disabled:text-white/48 disabled:shadow-none dark:bg-[#a855f7] dark:hover:bg-[#b968ff] dark:disabled:bg-white/10 ${
          isLastQuestion ? "w-[9.6rem] px-4 text-xs font-semibold" : "w-11"
        }`}
      >
        {submitted ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isLastQuestion ? (
          "Analisar perfil"
        ) : (
          <ChevronRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
        )}
      </button>
    </footer>
  );
}

// ===========================================================================
// ELEMENTOS VISUAIS
// ===========================================================================

// Camadas que representam as próximas perguntas da sequência. Todas giram para
// o mesmo lado, com rotação decrescente da mais distante para a mais próxima,
// para dar a leitura de uma pilha enfileirada e não de cartas espalhadas.
// A superfície acompanha a do card da frente (branco no claro, #11101a no
// escuro), apenas mais recuada, para que a pilha tenha volume.
// Ordem do array = ordem de pintura: do card mais distante para o mais próximo.
// Mantido em sincronia com o mesmo bloco de QuestionnaireIntro.jsx.
const UPCOMING_CARD_LAYERS = [
  "translate-x-[0.00rem] translate-y-[0.10rem] rotate-[5deg] scale-[1.02] border-white/42 bg-white/30 shadow-[0_16px_44px_rgba(45,8,80,0.16)] dark:border-white/10 dark:bg-[#11101a]/45 dark:shadow-[0_16px_44px_rgba(0,0,0,0.34)]",
  "translate-x-[0.00rem] translate-y-[0.08rem] rotate-[3deg] scale-[1.01] border-white/62 bg-white/55 shadow-[0_18px_48px_rgba(45,8,80,0.18)] dark:border-white/14 dark:bg-[#11101a]/50 dark:shadow-[0_18px_48px_rgba(0,0,0,0.38)]",
];

function DecorativeStack() {
  return (
    <>
      {UPCOMING_CARD_LAYERS.map((layerClassName, index) => (
        <div
          key={`upcoming-card-${index}`}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 -z-10 rounded-[2.2rem] border ${layerClassName}`}
        />
      ))}
    </>
  );
}

function QuestionnaireBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-14rem] h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-[#7b2cbf]/60 blur-[120px]" />
      <div className="absolute bottom-[-18rem] left-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/32 blur-[120px]" />
      <div className="absolute bottom-[-16rem] right-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#7b2cbf]/22 blur-[120px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:22px_22px] opacity-[0.1]" />
    </div>
  );
}