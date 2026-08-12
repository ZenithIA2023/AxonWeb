import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2,
  ChevronDown,
  Menu,
  Pause,
  Play,
  RotateCcw,
  Target,
  X,
} from "lucide-react";

import { results, type ChronotypeResultKey } from "../data/results";
import Sidebar from "../components/layout/Sidebar";
import * as api from "../lib/api";
import type { Task, TaskStatus } from "../lib/api";

type FocusStatus = "ready" | "running" | "paused";

const validKeys: ChronotypeResultKey[] = [
  "Matutino",
  "Vespertino",
  "Noturno",
  "Misto",
  "Bimodal",
];

const focusDurations = [25, 45, 90];
const UI_IDLE_TIMEOUT_MS = 4200;

// ===========================================================================
// FOCUS — AMBIENTE CINEMATOGRÁFICO
// ===========================================================================
// Sem cards. A tela é um ambiente de concentração:
// fundo imersivo, hora atual, tarefa do momento e cronômetro.
// Depois de alguns segundos sem interação, controles e navegação somem.
// Ao tocar/clicar/mover na tela, eles voltam.

export default function Focus() {
  const navigate = useNavigate();
  const idleTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastAutoDurationTaskIdRef = useRef<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [status, setStatus] = useState<FocusStatus>("ready");
  const [selectedMinutes, setSelectedMinutes] = useState(45);
  const [secondsLeft, setSecondsLeft] = useState(selectedMinutes * 60);
  const [showEndModal, setShowEndModal] = useState(false);
  const [showCompleteTaskModal, setShowCompleteTaskModal] = useState(false);
  const [showInterface, setShowInterface] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [lockedFocusTaskId, setLockedFocusTaskId] = useState<string | null>(null);
  const [isTaskSelectorOpen, setIsTaskSelectorOpen] = useState(false);

  const resultKey = useMemo<ChronotypeResultKey>(() => {
    const stored = localStorage.getItem("axon_chronotype");

    if (stored && validKeys.includes(stored as ChronotypeResultKey)) {
      return stored as ChronotypeResultKey;
    }

    return "Misto";
  }, []);

  const result = results[resultKey];

  const totalSeconds = selectedMinutes * 60;
  const elapsedSeconds = Math.max(totalSeconds - secondsLeft, 0);
  const progress =
    totalSeconds === 0 ? 0 : Math.round((elapsedSeconds / totalSeconds) * 100);

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const compactMode = !showInterface && isRunning;
  const todayTasks = useMemo(() => getTodaySelectableTasks(tasks, now), [tasks, now]);
  const momentTask = useMemo(() => getCurrentMomentTask(tasks, now), [tasks, now]);
  const selectedTask = useMemo(
    () => todayTasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, todayTasks]
  );
  const lockedFocusTask = useMemo(
    () =>
      tasks.find(
        (task) => task.id === lockedFocusTaskId && task.status !== "done"
      ) ?? null,
    [lockedFocusTaskId, tasks]
  );
  const currentTask = lockedFocusTask ?? selectedTask ?? momentTask;
  const canChangeTask = showInterface && !isRunning;
  const taskDurationMinutes = useMemo(
    () => getTaskDurationMinutes(currentTask),
    [currentTask]
  );
  const isTimeExpired = secondsLeft === 0;

  useEffect(() => {
    if (
      selectedTaskId &&
      !todayTasks.some((task) => task.id === selectedTaskId)
    ) {
      setSelectedTaskId(null);
    }

    if (
      lockedFocusTaskId &&
      !tasks.some(
        (task) => task.id === lockedFocusTaskId && task.status !== "done"
      )
    ) {
      setLockedFocusTaskId(null);
    }
  }, [lockedFocusTaskId, selectedTaskId, tasks, todayTasks]);

  useEffect(() => {
    if (isRunning) return;

    const taskId = currentTask?.id ?? null;

    if (lastAutoDurationTaskIdRef.current === taskId) return;

    lastAutoDurationTaskIdRef.current = taskId;

    if (!taskDurationMinutes) return;

    setSelectedMinutes(taskDurationMinutes);
    setSecondsLeft(taskDurationMinutes * 60);
    setStatus("ready");
  }, [currentTask?.id, isRunning, taskDurationMinutes]);

  useEffect(() => {
    api
      .getTasks()
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isRunning) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          playFocusFinishedSignal();
          setStatus("ready");
          setShowInterface(true);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning || isSidebarOpen || showEndModal || showCompleteTaskModal || isTaskSelectorOpen) {
      clearIdleTimer();
      setShowInterface(true);
      return;
    }

    if (showInterface) {
      startIdleTimer();
    }

    return clearIdleTimer;
  }, [isRunning, isSidebarOpen, isTaskSelectorOpen, showCompleteTaskModal, showEndModal, showInterface]);

  function clearIdleTimer() {
    if (idleTimerRef.current) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }

  function startIdleTimer() {
    clearIdleTimer();

    idleTimerRef.current = window.setTimeout(() => {
      setShowInterface(false);
    }, UI_IDLE_TIMEOUT_MS);
  }

  function revealInterface() {
    setShowInterface(true);

    if (isRunning && !isSidebarOpen && !showEndModal && !showCompleteTaskModal && !isTaskSelectorOpen) {
      startIdleTimer();
    } else {
      clearIdleTimer();
    }
  }

  function getFocusAudioContext() {
    if (typeof window === "undefined") return null;

    const AudioContextClass =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    return audioContextRef.current;
  }

  function unlockFocusSound() {
    const context = getFocusAudioContext();
    if (!context) return;

    void context.resume();

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    gain.gain.value = 0.0001;
    oscillator.frequency.value = 440;
    oscillator.connect(gain);
    gain.connect(context.destination);

    oscillator.start();
    oscillator.stop(context.currentTime + 0.03);
  }

  function playFocusFinishedSignal() {
    const context = getFocusAudioContext();

    if (!context) return;

    void context.resume();

    const startAt = context.currentTime + 0.02;
    const notes = [659.25, 783.99, 987.77];

    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + index * 0.16;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, noteStart);

      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(0.12, noteStart + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.42);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(noteStart);
      oscillator.stop(noteStart + 0.46);
    });

    if ("vibrate" in navigator) {
      navigator.vibrate?.([90, 45, 90]);
    }
  }

  function playTaskCompletedSignal() {
    const context = getFocusAudioContext();

    if (!context) return;

    void context.resume();

    const startAt = context.currentTime + 0.02;

    const bufferSize = Math.floor(context.sampleRate * 0.1);
    const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);

    for (let index = 0; index < bufferSize; index += 1) {
      const fade = 1 - index / bufferSize;
      data[index] = (Math.random() * 2 - 1) * fade * 0.22;
    }

    const noise = context.createBufferSource();
    const noiseFilter = context.createBiquadFilter();
    const noiseGain = context.createGain();

    noise.buffer = noiseBuffer;
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(900, startAt);

    noiseGain.gain.setValueAtTime(0.0001, startAt);
    noiseGain.gain.exponentialRampToValueAtTime(0.026, startAt + 0.01);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.1);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(context.destination);

    const notes = [
      { frequency: 880, start: 0, duration: 0.18, gain: 0.058 },
      { frequency: 1174.66, start: 0.1, duration: 0.22, gain: 0.052 },
      { frequency: 1567.98, start: 0.22, duration: 0.28, gain: 0.044 },
    ];

    notes.forEach((note) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const noteStart = startAt + note.start;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);

      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(note.gain, noteStart + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + note.duration);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(noteStart);
      oscillator.stop(noteStart + note.duration + 0.04);
    });

    noise.start(startAt);
    noise.stop(startAt + 0.12);

    if ("vibrate" in navigator) {
      navigator.vibrate?.([35, 18, 35]);
    }
  }

  function openTaskSelector() {
    if (isRunning) return;

    setIsTaskSelectorOpen(true);
    setShowInterface(true);
    revealInterface();
  }

  function handleSelectTask(taskId: string) {
    if (isRunning) return;

    setSelectedTaskId(taskId);
    setLockedFocusTaskId(null);
    setIsTaskSelectorOpen(false);
    setShowInterface(true);
    revealInterface();
  }

  function handleDurationChange(minutes: number) {
    if (isRunning) return;

    setSelectedMinutes(minutes);
    setSecondsLeft(minutes * 60);
    setStatus("ready");
    revealInterface();
  }

  function handleStartPause() {
    if (isRunning) {
      setStatus("paused");
      revealInterface();
      return;
    }

    if (!currentTask) {
      if (todayTasks.length > 0) {
        setIsTaskSelectorOpen(true);
      }

      setShowInterface(true);
      revealInterface();
      return;
    }

    unlockFocusSound();
    setLockedFocusTaskId(currentTask.id);
    setStatus("running");
    revealInterface();
  }

  function handleReset() {
    setStatus("ready");
    setLockedFocusTaskId(null);
    setSecondsLeft(selectedMinutes * 60);
    revealInterface();
  }

  function handleFinish() {
    setStatus("ready");
    setLockedFocusTaskId(null);
    setSecondsLeft(selectedMinutes * 60);
    setShowEndModal(false);
    revealInterface();
  }

  function requestCompleteCurrentTask() {
    if (!currentTask) {
      revealInterface();
      return;
    }

    setShowCompleteTaskModal(true);
    setShowInterface(true);
    revealInterface();
  }

  async function handleCompleteCurrentTask() {
    unlockFocusSound();

    if (!currentTask) {
      setShowCompleteTaskModal(false);
      revealInterface();
      return;
    }

    try {
      await api.updateTask(currentTask.id, {
        status: "done" as TaskStatus,
        progress: 100,
      });

      setTasks((current) =>
        current.map((task) =>
          task.id === currentTask.id
            ? {
                ...task,
                status: "done" as TaskStatus,
                progress: 100,
              }
            : task
        )
      );

      playTaskCompletedSignal();
      setStatus("ready");
      setSelectedTaskId(null);
      setLockedFocusTaskId(null);
      setShowCompleteTaskModal(false);
      setSecondsLeft(selectedMinutes * 60);
      revealInterface();
    } catch {
      revealInterface();
    }
  }

  return (
    <main
      className="relative h-[100dvh] overflow-hidden bg-[#030208] text-white"
      onPointerDown={revealInterface}
      onMouseMove={revealInterface}
      onKeyDown={revealInterface}
      tabIndex={-1}
    >
      <FocusAtmosphere isRunning={isRunning} progress={progress} />

      <div className="relative z-10 flex h-full flex-col px-4 pb-5 pt-5 sm:px-6 lg:px-8 lg:pb-7 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:px-4 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:pb-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:pt-3">
        <header
          className={`mx-auto mb-3 flex w-full max-w-[1280px] shrink-0 items-center justify-between transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mb-1 ${
            showInterface
              ? "translate-y-0 opacity-100"
              : "pointer-events-none -translate-y-4 opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="group flex min-w-0 items-center gap-3 text-left transition active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] shadow-[0_18px_42px_rgba(0,0,0,0.32)] backdrop-blur-2xl transition group-active:scale-[0.96]">
              <img
                src="/axon-logo.svg"
                alt="Axon"
                className="h-8 w-8 object-contain"
              />
            </div>

            <div className="min-w-0">
              <p className="truncate text-sm font-black text-white">Focus</p>
              <p className="truncate text-xs text-white/38">modo silêncio</p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-white/72 shadow-[0_18px_42px_rgba(0,0,0,0.28)] backdrop-blur-2xl transition active:scale-[0.96]"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        </header>

        <section className="relative mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col items-center justify-center text-center [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:grid [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:grid-cols-[minmax(150px,0.72fr)_minmax(260px,1fr)_minmax(145px,0.68fr)] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:gap-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-left">
          <div
            className={`flex w-full flex-1 flex-col items-center justify-center transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:contents ${
              compactMode ? "gap-8 pb-12 sm:gap-9" : "gap-0"
            }`}
          >
            <TaskMomentNotification
              compact={compactMode}
              task={currentTask}
              canChangeTask={canChangeTask}
              onChangeTask={openTaskSelector}
            />

            <CinematicTimer
              secondsLeft={secondsLeft}
              currentTime={formatClock(now)}
              dateLabel={formatDateLabel(now)}
              compactMode={compactMode}
              isRunning={isRunning}
              isPaused={isPaused}
              selectedMinutes={selectedMinutes}
            />

            <MiniTimer
              visible={compactMode}
              secondsLeft={secondsLeft}
              progress={progress}
            />
          </div>

          <FocusControls
            visible={showInterface}
            status={status}
            selectedMinutes={selectedMinutes}
            taskDurationMinutes={taskDurationMinutes}
            isTimeExpired={isTimeExpired}
            hasCurrentTask={Boolean(currentTask)}
            disabled={isRunning}
            canStart={Boolean(currentTask)}
            onDurationChange={handleDurationChange}
            onStartPause={handleStartPause}
            onReset={handleReset}
            onCompleteTask={requestCompleteCurrentTask}
          />
        </section>

        <div
          className={`pointer-events-none fixed inset-x-0 bottom-8 z-20 text-center text-[0.52rem] font-black uppercase tracking-[0.22em] text-white/12 transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:bottom-3 ${
            compactMode
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          }`}
        >
          toque para mostrar controles
        </div>
      </div>

      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        chronotypeLabel={result.label}
        energyPeak={result.energyPeak}
      />

      <TaskSelectorModal
        isOpen={isTaskSelectorOpen}
        tasks={todayTasks}
        selectedTaskId={currentTask?.id ?? null}
        onClose={() => {
          setIsTaskSelectorOpen(false);
          revealInterface();
        }}
        onSelect={handleSelectTask}
      />

      <EndFocusModal
        isOpen={showEndModal}
        progress={progress}
        onClose={() => {
          setShowEndModal(false);
          revealInterface();
        }}
        onConfirm={handleFinish}
      />

      <CompleteTaskModal
        isOpen={showCompleteTaskModal}
        taskTitle={currentTask?.title}
        onClose={() => {
          setShowCompleteTaskModal(false);
          revealInterface();
        }}
        onConfirm={handleCompleteCurrentTask}
      />
    </main>
  );
}

// ===========================================================================
// Atmosfera
// ===========================================================================

function FocusAtmosphere({
  isRunning,
  progress,
}: {
  isRunning: boolean;
  progress: number;
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(123,44,191,0.20),transparent_32%),linear-gradient(180deg,#070611_0%,#04030a_54%,#020106_100%)]" />

      <div
        className={`absolute left-1/2 top-[34%] h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/14 blur-[140px] transition-opacity duration-700 ${
          isRunning ? "opacity-100" : "opacity-70"
        }`}
      />

      <div className="absolute -left-32 bottom-[-12rem] h-[28rem] w-[28rem] rounded-full bg-[#3b82f6]/8 blur-[130px]" />
      <div className="absolute -right-32 bottom-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#a855f7]/10 blur-[140px]" />

      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:64px_64px] opacity-[0.14]" />

      <div
        className="absolute left-1/2 top-1/2 h-px w-[88vw] -translate-x-1/2 bg-gradient-to-r from-transparent via-white/14 to-transparent"
        style={{ opacity: 0.32 + progress / 180 }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_42%,rgba(0,0,0,0.72)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-[32%] bg-[linear-gradient(to_top,rgba(3,2,8,0.98),transparent)]" />
    </div>
  );
}

// ===========================================================================
// Timer
// ===========================================================================

function CinematicTimer({
  secondsLeft,
  currentTime,
  dateLabel,
  compactMode,
  isRunning,
  isPaused,
  selectedMinutes,
}: {
  secondsLeft: number;
  currentTime: string;
  dateLabel: string;
  compactMode: boolean;
  isRunning: boolean;
  isPaused: boolean;
  selectedMinutes: number;
}) {
  return (
    <div
      className={`relative flex w-full flex-col items-center justify-center transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:max-w-[22rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:justify-self-center lg:max-w-[42rem] ${
        compactMode ? "max-w-[36rem]" : "max-w-[34rem]"
      }`}
    >
      <div
        className={`pointer-events-none absolute left-1/2 top-1/2 h-40 w-[72vw] max-w-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#7b2cbf]/14 blur-[120px] transition-opacity duration-700 ${
          isRunning ? "opacity-100" : "opacity-64"
        }`}
      />

      <div className="relative text-center">
        <p
          className={`font-black leading-none text-white transition-all duration-700 ${
            compactMode
              ? "text-[5.85rem] tracking-[-0.12em] sm:text-[8.4rem] lg:text-[11rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-[4.7rem]"
              : "text-[4.55rem] tracking-[-0.105em] sm:text-[7.1rem] lg:text-[9.6rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-[4.55rem]"
          }`}
        >
          {compactMode ? currentTime : formatFocusTime(secondsLeft)}
        </p>

        <p className="mt-4 text-[0.66rem] font-black uppercase tracking-[0.28em] text-white/24 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mt-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-[0.64rem]">
          {compactMode
            ? dateLabel
            : isRunning
            ? "respire e execute"
            : isPaused
            ? "bloco pausado"
            : `${selectedMinutes} minutos`}
        </p>
      </div>
    </div>
  );
}

function MiniTimer({
  visible,
  secondsLeft,
  progress,
}: {
  visible: boolean;
  secondsLeft: number;
  progress: number;
}) {
  return (
    <div
      className={`w-full max-w-[13.5rem] transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:max-w-[8.75rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:justify-self-center [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-center ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none hidden -translate-y-2 opacity-0"
      }`}
    >
      <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/[0.028] px-3.5 py-2 text-white/42 backdrop-blur-xl [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:px-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:py-2">
        <span className="text-[0.52rem] font-black uppercase tracking-[0.18em] text-white/22 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:hidden">
          cronômetro
        </span>

        <span className="text-sm font-black leading-none tracking-[-0.04em] text-white/58 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-[1.2rem]">
          {formatFocusTime(secondsLeft)}
        </span>
      </div>

      <div className="mx-auto mt-2 h-[2px] w-24 overflow-hidden rounded-full bg-white/7 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:w-20">
        <div
          className="h-full rounded-full bg-[#a855f7]/60"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// ===========================================================================
// Tarefa atual como notificação
// ===========================================================================

function TaskMomentNotification({
  compact,
  task,
  canChangeTask,
  onChangeTask,
}: {
  compact: boolean;
  task: Task | null;
  canChangeTask: boolean;
  onChangeTask: () => void;
}) {
  if (compact) {
    return (
      <div className="w-full max-w-[27rem] transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:max-w-[15rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:justify-self-start">
        <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-white/8 bg-white/[0.03] px-3.5 py-2 text-left shadow-[0_18px_70px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#a855f7] shadow-[0_0_14px_rgba(168,85,247,0.75)]" />

          <p className="min-w-0 truncate text-xs font-black leading-5 text-white/58 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:max-w-[12rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-sm">
            {task?.title ?? "Nenhuma tarefa selecionada"}
          </p>
        </div>
      </div>
    );
  }

  const hasTask = Boolean(task);
  const title = task?.title ?? "Selecione uma tarefa para iniciar";
  const description = task
    ? "Tarefa detectada pelo horário atual. Toque para escolher outra do dia."
    : "Nenhuma tarefa está marcada para este horário. Escolha uma tarefa do dia para começar.";

  const content = (
    <>
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#7b2cbf]/16 text-[#d8b4fe]">
        <div className="absolute inset-0 rounded-2xl border border-[#a855f7]/18" />
        <Target className="relative h-4.5 w-4.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full shadow-[0_0_16px_rgba(168,85,247,0.85)] ${
              hasTask ? "bg-[#a855f7]" : "bg-white/24"
            }`}
          />

          <p className="text-[0.55rem] font-black uppercase tracking-[0.18em] text-white/30">
            tarefa atual
          </p>
        </div>

        <p className="truncate text-[1rem] font-black leading-5 tracking-[-0.025em] text-white sm:text-[1.08rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-[1.12rem]">
          {title}
        </p>

        <p className="mt-1 truncate text-xs font-semibold text-white/34">
          {task ? getTaskTimeLabel(task) : description}
        </p>
      </div>

      {canChangeTask ? (
        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-[#a855f7]/18 bg-[#7b2cbf]/14 px-3 py-2 text-[0.58rem] font-black uppercase tracking-[0.14em] text-[#d8b4fe]/78 sm:flex">
          {hasTask ? "Selecionar outra" : "Escolher tarefa"}
          <ChevronDown className="h-3.5 w-3.5" />
        </div>
      ) : null}
    </>
  );

  return (
    <div className="mb-8 w-full max-w-[34rem] scale-100 opacity-100 transition-all duration-700 sm:mb-9 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mb-0 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:max-w-[15.5rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:justify-self-start">
      {canChangeTask ? (
        <button
          type="button"
          onClick={onChangeTask}
          className={`mx-auto flex w-full items-center gap-3 rounded-[1.7rem] border px-3 py-3 text-left shadow-[0_22px_76px_rgba(0,0,0,0.2)] backdrop-blur-2xl transition hover:border-[#a855f7]/28 hover:bg-white/[0.055] active:scale-[0.99] sm:px-4 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:rounded-[1.45rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:px-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:py-2.5 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:shadow-[0_16px_54px_rgba(0,0,0,0.18)] ${
            hasTask
              ? "border-white/8 bg-white/[0.038]"
              : "border-[#a855f7]/26 bg-[#7b2cbf]/10"
          }`}
        >
          {content}
        </button>
      ) : (
        <div className="mx-auto flex items-center gap-3 rounded-[1.7rem] border border-white/8 bg-white/[0.038] px-3 py-3 text-left shadow-[0_22px_76px_rgba(0,0,0,0.2)] backdrop-blur-2xl sm:px-4 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:rounded-[1.45rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:px-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:py-2.5 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:shadow-[0_16px_54px_rgba(0,0,0,0.18)]">
          {content}
        </div>
      )}

      {canChangeTask ? (
        <button
          type="button"
          onClick={onChangeTask}
          className="mx-auto mt-3 inline-flex min-h-9 items-center justify-center gap-2 rounded-full border border-white/8 bg-white/[0.035] px-4 text-xs font-black text-white/52 shadow-[0_14px_46px_rgba(0,0,0,0.18)] backdrop-blur-2xl transition active:scale-[0.98] sm:hidden"
        >
          {hasTask ? "Selecionar outra tarefa" : "Escolher tarefa do dia"}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

// ===========================================================================
// Controles
// ===========================================================================

function FocusControls({
  visible,
  status,
  selectedMinutes,
  taskDurationMinutes,
  isTimeExpired,
  hasCurrentTask,
  disabled,
  canStart,
  onDurationChange,
  onStartPause,
  onReset,
  onCompleteTask,
}: {
  visible: boolean;
  status: FocusStatus;
  selectedMinutes: number;
  taskDurationMinutes: number | null;
  isTimeExpired: boolean;
  hasCurrentTask: boolean;
  disabled: boolean;
  canStart: boolean;
  onDurationChange: (minutes: number) => void;
  onStartPause: () => void;
  onReset: () => void;
  onCompleteTask: () => void;
}) {
  const isRunning = status === "running";
  const shouldShowCompleteTask = isTimeExpired && hasCurrentTask;

  return (
    <div
      className={`mt-8 w-full max-w-[26rem] transition-all duration-700 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mt-0 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:max-w-[15.5rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:justify-self-end lg:max-w-[28rem] ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none hidden translate-y-5 opacity-0"
      }`}
    >
      <div className="rounded-[1.85rem] border border-white/8 bg-black/16 p-3 shadow-[0_22px_76px_rgba(0,0,0,0.24)] backdrop-blur-2xl [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:rounded-[1.55rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:p-2.5 lg:p-4">
        {shouldShowCompleteTask ? (
          <div>
            <div className="mb-3 rounded-[1.25rem] border border-[#a855f7]/18 bg-[#7b2cbf]/10 px-3 py-2 text-left">
              <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-[#c084fc]/70">
                tempo finalizado
              </p>
              <p className="mt-1 text-xs font-semibold leading-5 text-white/44">
                Conclua a tarefa ou ajuste o tempo para continuar.
              </p>
            </div>

            <div className="grid grid-cols-[1fr_3.2rem] gap-2">
              <button
                type="button"
                onClick={onCompleteTask}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#7b2cbf] px-5 text-sm font-black text-white shadow-[0_18px_46px_rgba(123,44,191,0.38)] transition hover:bg-[#8d31dd] active:scale-[0.98]"
              >
                Concluir tarefa
                <CheckCircle2 className="ml-2 h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onReset}
                className="flex min-h-12 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/52 transition active:scale-[0.96]"
                aria-label="Resetar foco"
              >
                <RotateCcw className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <DurationSlider
              selectedMinutes={selectedMinutes}
              taskDurationMinutes={taskDurationMinutes}
              disabled={disabled}
              onChange={onDurationChange}
            />

            <div
              className={`mt-3 grid gap-2 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mt-2 ${
                hasCurrentTask
                  ? "grid-cols-[1fr_3.2rem_3.2rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:grid-cols-[1fr_2.9rem_2.9rem]"
                  : "grid-cols-[1fr_3.2rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:grid-cols-[1fr_2.9rem]"
              }`}
            >
              <button
                type="button"
                onClick={onStartPause}
                disabled={!canStart && !isRunning}
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#7b2cbf] px-5 text-sm font-black text-white shadow-[0_18px_46px_rgba(123,44,191,0.38)] transition hover:bg-[#8d31dd] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.06] disabled:text-white/28 disabled:shadow-none"
              >
                {isRunning ? (
                  <>
                    Pausar
                    <Pause className="ml-2 h-4 w-4" />
                  </>
                ) : !canStart ? (
                  <>
                    Selecione uma tarefa
                    <Target className="ml-2 h-4 w-4" />
                  </>
                ) : (
                  <>
                    {status === "paused" ? "Retomar" : "Iniciar"}
                    <Play className="ml-2 h-4 w-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onReset}
                className="flex min-h-12 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/52 transition active:scale-[0.96]"
                aria-label="Resetar foco"
              >
                <RotateCcw className="h-4.5 w-4.5" />
              </button>

              {hasCurrentTask ? (
                <button
                  type="button"
                  onClick={onCompleteTask}
                  className="flex min-h-12 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/52 transition active:scale-[0.96]"
                  aria-label="Concluir tarefa atual"
                >
                  <CheckCircle2 className="h-4.5 w-4.5" />
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DurationSlider({
  selectedMinutes,
  taskDurationMinutes,
  disabled,
  onChange,
}: {
  selectedMinutes: number;
  taskDurationMinutes: number | null;
  disabled: boolean;
  onChange: (minutes: number) => void;
}) {
  const sliderValue = Math.min(Math.max(selectedMinutes, 1), 180);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 px-1 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mb-1.5">
        <div className="text-left">
          <p className="text-[0.58rem] font-black uppercase tracking-[0.16em] text-white/26">
            duração
          </p>

          <p className="mt-1 text-xs font-semibold text-white/42 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:hidden">
            {taskDurationMinutes
              ? `Tarefa prevista: ${formatDurationLabel(taskDurationMinutes)}`
              : "Defina um bloco confortável"}
          </p>
        </div>

        <p className="shrink-0 text-lg font-black tracking-[-0.045em] text-white [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:text-base">
          {formatDurationLabel(selectedMinutes)}
        </p>
      </div>

      <div className="rounded-[1.35rem] border border-white/8 bg-white/[0.03] px-3 py-3 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:rounded-[1.15rem] [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:py-2.5">
        <input
          type="range"
          min={1}
          max={180}
          step={1}
          value={sliderValue}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-3 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#a855f7] disabled:cursor-not-allowed disabled:opacity-45 [&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:w-8 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[6px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[#7b2cbf] [&::-webkit-slider-thumb]:shadow-[0_8px_28px_rgba(123,44,191,0.45)]"
        />

        <div className="mt-3 grid grid-cols-3 gap-2 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:mt-2 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:gap-1.5">
          {focusDurations.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => onChange(minutes)}
              disabled={disabled}
              className={`min-h-8 rounded-xl border text-[0.68rem] font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 [@media(orientation:landscape)_and_(max-height:560px)_and_(max-width:950px)]:min-h-9 ${
                selectedMinutes === minutes
                  ? "border-[#a855f7]/40 bg-[#7b2cbf]/24 text-white"
                  : "border-white/8 bg-black/10 text-white/34"
              }`}
            >
              {minutes}min
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Modal de finalização
// ===========================================================================

function CompleteTaskModal({
  isOpen,
  taskTitle,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  taskTitle?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-[410px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#101018]/95 p-5 text-white shadow-[0_30px_120px_rgba(0,0,0,0.58)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(123,44,191,0.22),transparent_52%)]" />

        <div className="relative">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#a855f7]/22 bg-[#7b2cbf]/14 text-[#c084fc]">
              <CheckCircle2 className="h-5 w-5" />
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-white/45 transition active:scale-[0.96]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h2 className="text-[1.72rem] font-black leading-[1.02] tracking-[-0.055em] text-white">
            Marcar tarefa como concluída?
          </h2>

          <p className="mt-3 text-sm leading-6 text-white/48">
            {taskTitle
              ? `Isso vai concluir “${taskTitle}” também no planejamento e nas outras telas.`
              : "Isso vai concluir a tarefa atual também no planejamento e nas outras telas."}
          </p>

          <button
            type="button"
            onClick={onConfirm}
            className="mt-6 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#7b2cbf] px-6 text-sm font-black text-white shadow-[0_18px_46px_rgba(123,44,191,0.34)] transition hover:bg-[#8d31dd] active:scale-[0.98]"
          >
            Sim, concluir
            <CheckCircle2 className="ml-2 h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-6 text-sm font-semibold text-white/62 transition active:scale-[0.98]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskSelectorModal({
  isOpen,
  tasks,
  selectedTaskId,
  onClose,
  onSelect,
}: {
  isOpen: boolean;
  tasks: Task[];
  selectedTaskId: string | null;
  onClose: () => void;
  onSelect: (taskId: string) => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/72 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-[430px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#101018]/95 p-4 text-white shadow-[0_30px_120px_rgba(0,0,0,0.58)] backdrop-blur-2xl sm:p-5">
        <div className="pointer-events-none absolute -right-24 -top-24 h-52 w-52 rounded-full bg-[#7b2cbf]/18 blur-[90px]" />

        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.6rem] font-black uppercase tracking-[0.18em] text-[#c084fc]/70">
              foco manual
            </p>

            <h2 className="mt-2 text-xl font-black tracking-[-0.045em] text-white">
              Escolha uma tarefa de hoje
            </h2>

            <p className="mt-1 text-sm font-semibold leading-6 text-white/42">
              Use quando quiser focar em algo fora do horário marcado.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-white/46 transition active:scale-[0.96]"
            aria-label="Fechar seletor de tarefa"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        <div className="relative mt-5 max-h-[50dvh] space-y-2 overflow-y-auto pr-1">
          {tasks.length > 0 ? (
            tasks.map((task) => {
              const isSelected = task.id === selectedTaskId;

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onSelect(task.id)}
                  className={`flex w-full items-center gap-3 rounded-[1.25rem] border px-3 py-3 text-left transition active:scale-[0.99] ${
                    isSelected
                      ? "border-[#a855f7]/42 bg-[#7b2cbf]/18"
                      : "border-white/8 bg-white/[0.035] hover:border-white/14 hover:bg-white/[0.055]"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${
                      isSelected
                        ? "bg-[#7b2cbf]/28 text-[#e9d5ff]"
                        : "bg-white/[0.05] text-white/38"
                    }`}
                  >
                    <Target className="h-4 w-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black tracking-[-0.02em] text-white">
                      {task.title}
                    </span>

                    <span className="mt-0.5 block truncate text-xs font-semibold text-white/34">
                      {getTaskTimeLabel(task)}
                    </span>
                  </span>

                  {isSelected ? (
                    <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-[#d8b4fe]" />
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="rounded-[1.45rem] border border-white/8 bg-white/[0.035] px-4 py-6 text-center">
              <p className="text-sm font-black text-white/68">
                Nenhuma tarefa encontrada para hoje.
              </p>

              <p className="mt-1 text-xs font-semibold leading-5 text-white/34">
                Quando houver tarefas no planejamento do dia, elas aparecerão
                aqui.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EndFocusModal({
  isOpen,
  progress,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  progress: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/70 px-3 pb-3 backdrop-blur-md sm:items-center sm:p-4">
      <div className="relative w-full max-w-[430px] overflow-hidden rounded-[2rem] border border-white/10 bg-[#11101a]/95 p-5 text-white shadow-[0_30px_120px_rgba(0,0,0,0.58)] backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(123,44,191,0.24),transparent_52%)]" />

        <div className="relative">
          <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-white/12 sm:hidden" />

          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#a855f7]/24 bg-[#7b2cbf]/16 text-[#c084fc]">
              <CheckCircle2 className="h-5 w-5" />
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.045] text-white/45 transition active:scale-[0.96]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h2 className="text-[1.75rem] font-black leading-[1.02] tracking-[-0.055em] text-white">
            Encerrar este bloco?
          </h2>

          <p className="mt-3 text-sm leading-6 text-white/48">
            Você avançou {progress}% da sessão. Finalize para voltar ao ritmo
            normal ou continue focando por mais alguns minutos.
          </p>

          <button
            type="button"
            onClick={onConfirm}
            className="mt-6 inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-[#7b2cbf] px-6 text-sm font-black text-white shadow-[0_18px_46px_rgba(123,44,191,0.34)] transition hover:bg-[#8d31dd] active:scale-[0.98]"
          >
            Sim, finalizar
            <CheckCircle2 className="ml-2 h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-6 text-sm font-semibold text-white/62 transition active:scale-[0.98]"
          >
            Continuar focando
          </button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Helpers
// ===========================================================================

function formatFocusTime(totalSeconds: number) {
  const safeSeconds = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0"
  )}`;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateLabel(date: Date) {
  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const months = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];

  return `${weekdays[date.getDay()]}, ${date.getDate()} de ${
    months[date.getMonth()]
  }`;
}

function toISODate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function hhmm(value?: string | null) {
  return value ? value.slice(0, 5) : undefined;
}

function normalizeISODate(value?: string | null) {
  return value ? value.slice(0, 10) : null;
}

function getTaskStartDate(task: Task) {
  return normalizeISODate(task.scheduled_date);
}

function getTaskEndDate(task: Task) {
  return normalizeISODate((task as Task & { end_date?: string | null }).end_date);
}

function isTaskOnDate(task: Task, isoDate: string) {
  const startDate = getTaskStartDate(task);

  if (!startDate) return false;

  const endDate = getTaskEndDate(task);

  if (task.task_type === "event" && endDate) {
    return isoDate >= startDate && isoDate <= endDate;
  }

  return startDate === isoDate;
}

function getTodaySelectableTasks(tasks: Task[], now: Date) {
  const todayIso = toISODate(now);

  return tasks
    .filter((task) => task.status !== "done" && isTaskOnDate(task, todayIso))
    .sort(sortFocusTasks);
}

function sortFocusTasks(a: Task, b: Task) {
  const aTime = timeToMinutes(a.start_time) ?? 9999;
  const bTime = timeToMinutes(b.start_time) ?? 9999;

  if (aTime !== bTime) return aTime - bTime;

  if (!!a.is_key_task !== !!b.is_key_task) {
    return a.is_key_task ? -1 : 1;
  }

  return a.title.localeCompare(b.title);
}

function getCurrentMomentTask(tasks: Task[], now: Date) {
  const todayIso = toISODate(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return tasks
    .filter((task) => task.status !== "done" && isTaskOnDate(task, todayIso))
    .find((task) => {
      const start = timeToMinutes(task.start_time);
      const end = timeToMinutes(task.end_time);

      if (start === null || end === null) return false;

      return currentMinutes >= start && currentMinutes <= end;
    }) ?? null;
}

function timeToMinutes(value?: string | null) {
  const time = hhmm(value);
  if (!time) return null;

  const [hours, minutes] = time.split(":").map(Number);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function getTaskDurationMinutes(task: Task | null) {
  if (!task) return null;

  const start = timeToMinutes(task.start_time);
  const end = timeToMinutes(task.end_time);

  if (start === null || end === null || end <= start) {
    return null;
  }

  return end - start;
}

function formatDurationLabel(minutes: number) {
  if (minutes < 60) return `${minutes}min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (rest === 0) return `${hours}h`;

  return `${hours}h${String(rest).padStart(2, "0")}`;
}

function getTaskTimeLabel(task: Task) {
  const start = hhmm(task.start_time);
  const end = hhmm(task.end_time);

  if (start && end) return `${start} — ${end}`;
  if (start) return `A partir de ${start}`;

  if (task.is_key_task) {
    return "Tarefa-chave do dia";
  }

  return "Tarefa do momento";
}