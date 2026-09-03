/**
 * "Falar com o Axon" — a conversa por voz.
 *
 * Aqui falar é o modo principal e o texto existe só para confirmar o que foi
 * entendido: sem balões, sem avatar, sem horário. Sua fala fica à direita em
 * tom apagado (você já sabe o que disse), a do Axon à esquerda em branco cheio.
 * Turnos antigos encolhem e recuam em vez de sumir — a conversa ganha
 * profundidade sem virar uma lista para rolar.
 *
 * A tela é escura sempre, independente do tema do app: a orb é feita de luz e
 * precisa de escuridão em volta para funcionar. É escolha de design, não bug.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Keyboard, Square, X } from "lucide-react";

import * as api from "../lib/api";
import { AxonOrb, type OrbState } from "../components/voice/AxonOrb";
import { VoiceOrbButton } from "../components/voice/VoiceOrbButton";
import { useVoiceSession, type UseVoiceSession } from "../lib/voice/useVoiceSession";
import { useSpeech } from "../lib/voice/useSpeech";
import { resolveVoiceConversation } from "../lib/voice/voiceConversation";
import { splitSentences } from "../lib/voice/sentenceQueue";
import { sanitizeForSpeech } from "../lib/voice/sanitize";
import type { VoiceRecording } from "../lib/voice/recorder";

// ===========================================================================
// TIPOS
// ===========================================================================

interface Turn {
  id: number;
  sender: "user" | "axon";
  text: string;
  /** Quando a mensagem foi criada. Ausente nos turnos desta sessão. */
  em?: string;
}

// Tamanho do canvas da orb. Fixo: o modo registro encolhe por `transform`, que
// anima na GPU, em vez de redesenhar o canvas num tamanho novo.
const ORB_TAMANHO = 280;
// A referência do artefato usa 116px para a orb do registro — 0.41 de 280.
const ORB_ESCALA_REGISTRO = 0.41;
// Alturas do contêiner = o canvas escalado, e nada além disso. O canvas é
// desenhado a partir do centro, então reservar exatamente a altura que ele
// ocupa deixa o brilho transbordar de leve para os dois lados, que é o
// comportamento certo: a luz não tem borda.
const ORB_ALTURA_NORMAL = ORB_TAMANHO;
const ORB_ALTURA_REGISTRO = Math.round(ORB_TAMANHO * ORB_ESCALA_REGISTRO);

// Limiares de rolagem, em px de distância até o fim da conversa.
// A folga entre eles é maior que os ~168px que a orb devolve ao encolher, que
// é o que impede o modo de ligar e desligar sozinho.
const ENTRADA_FIM_PX = 48; // considerado "no fim" para o auto-scroll
const ENTRADA_REGISTRO_PX = 220; // rolou o bastante para cima: encolhe a orb
const SAIDA_FIM_PX = 40; // voltou de fato ao fim: a orb cresce de novo

// O recuo do passado é lento de propósito: rápido demais vira um pisca-pisca
// a cada turno, e a ideia é que a conversa "afunde", não que ela salte.
const TRANSICAO_RECUO = "opacity 0.5s ease, transform 0.5s ease";

/**
 * "hoje · 9:41", "ontem · 18:02" ou "12 de agosto · 14:30" — a marca que separa
 * os blocos da conversa no modo registro.
 */
function marcaDeDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = new Date();
  const mesmoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (mesmoDia(d, hoje)) return `hoje · ${hora}`;

  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (mesmoDia(d, ontem)) return `ontem · ${hora}`;

  const dia = d.toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
  return `${dia} · ${hora}`;
}

/** Duas datas ISO caem no mesmo dia? `undefined` conta como dia diferente. */
function mesmoDiaQue(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return da.toDateString() === db.toDateString();
}

/** Formata segundos como 0:07. */
function mmss(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// ===========================================================================
// PÁGINA
// ===========================================================================

export default function VoiceChat() {
  const navigate = useNavigate();

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  // Frase que o TTS está falando neste instante — usada para destacar o trecho
  // vivo da resposta. Vem do onSentenceStart, já sanitizada.
  const [fraseAtual, setFraseAtual] = useState<string | null>(null);
  // Label da ferramenta rodando ("Criando tarefa…"). Sem isso a tela fica
  // parada em "pensando" enquanto o Axon de fato executa o que foi pedido.
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);

  // Id do turno do Axon que está recebendo texto agora. Precisa ser state, e
  // não ref: é ele que decide qual turno mostra o destaque de frase, e um ref
  // mudando não re-renderiza nada.
  const [streamingId, setStreamingId] = useState<number | null>(null);

  const historyRef = useRef<api.ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fimRef = useRef<HTMLDivElement>(null);
  // Quem rolou para cima está lendo o histórico; puxar a tela de volta no meio
  // da leitura é hostil. Só voltamos a seguir quando a pessoa retorna ao fim.
  const grudadoNoFimRef = useRef(true);
  const primeiraRolagemRef = useRef(true);

  // "Modo registro": ao rolar para ler o histórico, a orb encolhe e devolve a
  // tela ao texto. Volta ao normal ao chegar no fim da conversa ou ao falar.
  const [modoRegistro, setModoRegistro] = useState(false);
  // Há uma dependência circular aqui: a sessão de voz precisa do callback de
  // envio, e o callback precisa avisar a sessão que terminou. O ref quebra o
  // ciclo — é preenchido logo abaixo, assim que a sessão existe.
  const voiceSessionRef = useRef<UseVoiceSession | null>(null);

  const speech = useSpeech({
    onSentenceStart: (frase) => setFraseAtual(frase),
  });

  // -------------------------------------------------------------------------
  // ENVIO
  // -------------------------------------------------------------------------

  const enviarGravacao = useCallback(
    (recording: VoiceRecording) => {
      if (!conversationId) {
        voiceSessionRef.current?.finishProcessing();
        return;
      }

      const history = historyRef.current;
      const axonId = Date.now() + 1;
      let userTurnId: number | null = null;

      setErro(null);
      setToolLabel(null);
      setFraseAtual(null);
      // Falar é um ato deliberado: mesmo relendo o histórico, quem gravou quer
      // ver a resposta chegando — a tela volta ao normal e acompanha o fim.
      grudadoNoFimRef.current = true;
      setModoRegistro(false);
      // Força a fala mesmo com o toggle de leitura desligado: nesta página
      // ouvir de volta é o ponto inteiro.
      speech.begin(true);

      const ext = recording.mimeType.includes("mp4")
        ? "m4a"
        : recording.mimeType.includes("ogg")
        ? "ogg"
        : "webm";

      api.streamVoiceMessage(
        recording.blob,
        `voz.${ext}`,
        history,
        conversationId,
        (transcript) => {
          // O transcript é o primeiro evento do stream: antes dele não há o que
          // mostrar, por isso os dois turnos nascem juntos aqui.
          userTurnId = Date.now();
          setStreamingId(axonId);
          setTurns((prev) => [
            ...prev,
            { id: userTurnId!, sender: "user", text: transcript },
            { id: axonId, sender: "axon", text: "" },
          ]);
        },
        (chunk) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === axonId ? { ...t, text: t.text + chunk } : t))
          );
          speech.push(chunk);
        },
        () => {
          speech.finish();
          setStreamingId(null);
          setToolLabel(null);
          voiceSessionRef.current?.finishProcessing();

          setTurns((prev) => {
            const userTurn = prev.find((t) => t.id === userTurnId);
            const axonTurn = prev.find((t) => t.id === axonId);
            if (userTurn && axonTurn) {
              historyRef.current = [
                ...history,
                { role: "user", content: userTurn.text },
                { role: "assistant", content: axonTurn.text },
              ];
            }
            return prev;
          });
        },
        (err) => {
          const mensagem = err.message || "Não consegui processar o áudio. Tente de novo.";
          speech.stop();
          setStreamingId(null);
          setToolLabel(null);
          voiceSessionRef.current?.finishProcessing();
          setErro(mensagem);

          setTurns((prev) => {
            // Erro antes até de transcrever (quota, provedor fora do ar): não
            // há turnos ainda, então cria só o do Axon com o erro.
            if (userTurnId === null) {
              return [...prev, { id: axonId, sender: "axon", text: mensagem }];
            }
            return prev.map((t) =>
              t.id === axonId ? { ...t, text: t.text || mensagem } : t
            );
          });

          // Numa página de voz um erro só escrito passa despercebido de quem
          // não está olhando para a tela — ele precisa ser dito.
          speech.begin(true);
          speech.push(mensagem);
          speech.finish();
        },
        (event) => {
          setToolLabel(event.status === "running" ? event.label ?? null : null);
        }
      );
    },
    [conversationId, speech]
  );

  const voiceSession = useVoiceSession({
    onRecordingReady: enviarGravacao,
    onError: (mensagem) => setErro(mensagem),
  });

  voiceSessionRef.current = voiceSession;

  // -------------------------------------------------------------------------
  // CARGA INICIAL
  // -------------------------------------------------------------------------

  useEffect(() => {
    let ativo = true;

    resolveVoiceConversation()
      .then(({ id, messages }) => {
        if (!ativo) return;
        setConversationId(id);
        historyRef.current = messages.map((m) => ({ role: m.role, content: m.content }));
        setTurns(
          messages.map((m, i) => ({
            id: i,
            sender: m.role === "user" ? "user" : "axon",
            text: m.content,
            em: m.created_at,
          }))
        );
        setCarregando(false);
      })
      .catch(() => {
        if (!ativo) return;
        setErro("Não consegui abrir a conversa. Verifique sua conexão.");
        setCarregando(false);
      });

    return () => {
      ativo = false;
    };
  }, []);

  // -------------------------------------------------------------------------
  // ESTADO DA TELA
  // -------------------------------------------------------------------------

  const estado: OrbState = useMemo(() => {
    if (voiceSession.status === "recording") return "listening";
    if (voiceSession.status === "processing") {
      // Enquanto o Axon ainda não começou a falar é "pensando"; assim que a voz
      // sai, é "falando" — mesmo que o stream continue chegando.
      return speech.speaking ? "speaking" : "thinking";
    }
    return speech.speaking ? "speaking" : "idle";
  }, [voiceSession.status, speech.speaking]);

  // Contador de gravação. O recorder já corta sozinho em 60s; isto é só o que
  // aparece no selo.
  useEffect(() => {
    if (estado !== "listening") {
      setSegundos(0);
      return;
    }
    const t = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [estado]);

  // Segue o fim da conversa conforme o texto chega — mas só se o usuário não
  // tiver rolado para cima para reler algo.
  useEffect(() => {
    if (!grudadoNoFimRef.current) return;
    // Ao abrir a página o histórico inteiro já está lá: rolar suavemente por
    // ele seria uma animação longa e sem propósito. Salta direto para o fim na
    // primeira vez e só depois passa a acompanhar com suavidade.
    const comportamento = primeiraRolagemRef.current ? "auto" : "smooth";
    primeiraRolagemRef.current = false;
    fimRef.current?.scrollIntoView({ block: "end", behavior: comportamento });
  }, [turns, estado]);

  // A orb voltando ao tamanho cheio rouba ~168px da área de texto e empurraria
  // a última mensagem para fora de vista. Reancora no fim quando isso acontece.
  useEffect(() => {
    if (modoRegistro || !grudadoNoFimRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    // Depois da transição de altura terminar, senão a posição é calculada com a
    // orb ainda no meio do caminho.
    const t = window.setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, 460);
    return () => window.clearTimeout(t);
  }, [modoRegistro]);

  // Descobre se a pessoa está no fim da lista. A folga de 48px evita que um
  // arredondamento de sub-pixel conte como "rolou para cima".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const aoRolar = () => {
      const distanciaDoFim = el.scrollHeight - el.scrollTop - el.clientHeight;
      grudadoNoFimRef.current = distanciaDoFim < ENTRADA_FIM_PX;

      // Só faz sentido encolher a orb se houver histórico de verdade acima.
      const temHistorico = el.scrollHeight - el.clientHeight > 80;

      // Histerese: os limiares de entrar e sair são diferentes de propósito.
      // Encolher a orb devolve ~168px ao texto, o que muda a altura da área e
      // reposiciona o fim — com um limiar só, sair do modo faria o mesmo
      // scrollTop deixar de ser "o fim", religando o modo num pisca-pisca.
      setModoRegistro((atual) => {
        if (!temHistorico) return false;
        return atual ? distanciaDoFim > SAIDA_FIM_PX : distanciaDoFim > ENTRADA_REGISTRO_PX;
      });
    };
    el.addEventListener("scroll", aoRolar, { passive: true });
    return () => el.removeEventListener("scroll", aoRolar);
  }, []);

  const textos = useMemo(() => {
    switch (estado) {
      case "listening":
        return {
          topo: "gravando",
          pill: `Ouvindo · ${mmss(segundos)}`,
          dica: "Solte para enviar · deslize para cancelar",
        };
      case "thinking":
        return {
          topo: "processando",
          pill: toolLabel ?? "Transcrevendo e pensando…",
          dica: "Isso leva alguns segundos",
        };
      case "speaking":
        return {
          topo: "falando",
          pill: toolLabel ?? "Axon está falando",
          dica: "Segure para responder",
        };
      default:
        return {
          // Lendo o histórico, o topo diz o que a tela é agora — e a dica para
          // de mandar segurar o botão, que não é o que a pessoa está fazendo.
          topo: carregando
            ? "abrindo a conversa…"
            : modoRegistro
            ? "conversa inteira"
            : "pronto para ouvir",
          pill: "Segure para falar",
          dica: modoRegistro ? "Role para voltar à conversa" : "Segure o botão para falar",
        };
    }
  }, [estado, segundos, toolLabel, carregando, modoRegistro]);

  // Enquanto o usuário fala ou o Axon responde, o que já passou recua para o
  // fundo: some do caminho para o turno atual ocupar a tela sozinho. Parado, a
  // conversa volta a ficar legível para ser lida e rolada.
  const emAtividade = estado !== "idle";
  // Gravando ou transcrevendo, o turno novo ainda não existe na lista — deixar
  // o par anterior aceso daria destaque à conversa errada.
  const tudoRecua = estado === "listening" || (estado === "thinking" && streamingId === null);

  const abrirNoChat = () => {
    if (conversationId) navigate(`/chat/${conversationId}`);
    else navigate("/chat");
  };

  const botaoDireito = () => {
    // Falando, o botão vira "interromper" — quem quer cortar o Axon no meio não
    // deveria precisar sair da página para isso.
    if (speech.speaking) speech.stop();
    else navigate("/dashboard");
  };

  return (
    <main
      className="relative flex h-[100dvh] flex-col overflow-hidden text-white"
      style={{ background: "#07060c", isolation: "isolate" }}
    >
      {/* Aurora: respira em 18s e muda de intensidade conforme o estado. */}
      <div
        aria-hidden="true"
        className="voice-aurora pointer-events-none absolute"
        style={{
          inset: "-30% -20% auto -20%",
          height: "90%",
          zIndex: -2,
          background:
            "radial-gradient(46% 40% at 30% 40%, rgba(99, 102, 241, 0.5), transparent 70%), radial-gradient(50% 44% at 72% 30%, rgba(168, 85, 247, 0.52), transparent 72%), radial-gradient(40% 34% at 52% 62%, rgba(232, 121, 249, 0.34), transparent 70%)",
          filter: "blur(46px)",
          opacity: estado === "listening" ? 0.9 : estado === "speaking" ? 0.82 : estado === "thinking" ? 0.62 : 0.55,
          transition: "opacity 0.9s ease",
        }}
      />
      {/* Vinheta: segura o olho no centro. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          zIndex: -1,
          background:
            "radial-gradient(120% 78% at 50% 42%, transparent 38%, rgba(4, 3, 8, 0.72) 100%)",
        }}
      />

      {/* ---------------- topo ---------------- */}
      <div className="flex items-center justify-between gap-2.5 px-4 pt-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Voltar"
          className="grid h-9.5 w-9.5 place-items-center rounded-2xl border backdrop-blur-lg"
          style={{
            borderColor: "rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.72)",
          }}
        >
          <ChevronLeft className="h-4.5 w-4.5" />
        </button>

        <div className="text-center">
          <b
            className="block text-[0.78rem] font-extrabold uppercase tracking-[0.24em]"
            style={{
              background: "linear-gradient(92deg, #fff, #e9d5ff)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Axon
          </b>
          <span className="text-[0.625rem]" style={{ color: "rgba(255,255,255,0.46)" }}>
            {textos.topo}
          </span>
        </div>

        <button
          type="button"
          onClick={abrirNoChat}
          aria-label="Ver a conversa inteira em texto"
          className="grid h-9.5 w-9.5 place-items-center rounded-2xl border backdrop-blur-lg"
          style={{
            borderColor: "rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.06)",
            color: "rgba(255,255,255,0.72)",
          }}
        >
          <Keyboard className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* ---------------- a orb ---------------- */}
      {/* O contêiner encolhe junto com a orb: só o `transform` do canvas não
          libera altura nenhuma no layout, e o objetivo do modo registro é
          exatamente devolver essa altura ao texto. */}
      <div
        className="relative grid shrink-0 place-items-center"
        style={{
          height: modoRegistro ? ORB_ALTURA_REGISTRO : ORB_ALTURA_NORMAL,
          transition: "height 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          aria-hidden="true"
          className="absolute h-[210px] w-[210px] rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(168,85,247,0.42), transparent 68%)",
            filter: "blur(26px)",
            opacity: estado === "thinking" ? 0.7 : 1,
            transform: `scale(${
              modoRegistro ? ORB_ESCALA_REGISTRO : estado === "listening" ? 1.16 : 1
            })`,
            transition:
              "opacity 0.5s ease, transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />

        <AxonOrb
          state={estado}
          level={voiceSession.level}
          size={ORB_TAMANHO}
          scale={modoRegistro ? ORB_ESCALA_REGISTRO : 1}
        />

        {/* Selo de status. Gravando, ele desce para longe da orb — a bola fica
            sozinha no alto, sem nada competindo com o movimento dela. No modo
            registro ele sai de cena: ali a tela é do texto. */}
        <span
          hidden={modoRegistro}
          className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-4 py-[7px] text-[0.72rem] font-bold tracking-[0.03em] backdrop-blur-md ${
            estado === "listening" ? "relative mt-2" : "absolute bottom-1.5"
          }`}
          style={{
            borderColor:
              estado === "listening" ? "rgba(251, 113, 133, 0.44)" : "rgba(255,255,255,0.1)",
            background: "rgba(7, 6, 12, 0.6)",
            color: estado === "listening" ? "#fff" : "rgba(255,255,255,0.72)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <i
            className={`h-[7px] w-[7px] rounded-full ${estado === "listening" ? "voice-blink" : ""}`}
            style={{ background: estado === "listening" ? "#fb7185" : "#e879f9" }}
          />
          {textos.pill}
        </span>
      </div>

      {/* ---------------- transcrição ---------------- */}
      {/* Rola de verdade: a conversa inteira está aqui, e o histórico fica a um
          gesto de distância. O que chega de novo é levado ao fim sozinho. */}
      <div
        ref={scrollRef}
        className="voice-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 pt-5"
        style={{
          maskImage: "linear-gradient(180deg, transparent 0, #000 34px)",
          WebkitMaskImage: "linear-gradient(180deg, transparent 0, #000 34px)",
        }}
      >
        {/* Empurra a conversa para baixo quando ela é curta demais para encher
            a área: sem isto as primeiras mensagens ficariam coladas na orb. O
            -mb-5 cancela o `gap-5` que este espaçador criaria sozinho. */}
        <div className="-mb-5 mt-auto shrink-0" />

        {turns.map((turn, i) => {
          // O turno atual é o último par da conversa; o resto é passado.
          const passado = i < turns.length - 2;
          const streaming = turn.id === streamingId;
          // O que recua enquanto a conversa acontece. Gravando ou transcrevendo
          // ainda não há nada de novo na tela: o "último par" é a troca
          // ANTERIOR, então tudo recua e a tela fica limpa para o que vem. Já
          // com o Axon falando, o par atual é o que importa e só ele fica.
          const recuado = tudoRecua || (passado && emAtividade);

          // Marca de dia: só no modo registro, e só quando o dia vira. Serve
          // para ancorar a leitura de um histórico longo.
          const marca =
            modoRegistro && turn.em && !mesmoDiaQue(turns[i - 1]?.em, turn.em)
              ? marcaDeDia(turn.em)
              : null;

          const conteudo =
            turn.sender === "user" ? (
              <div
                key={turn.id}
                className="max-w-[80%] self-end text-right"
                style={{
                  opacity: recuado ? 0.22 : 1,
                  transform: recuado ? "scale(0.94)" : "scale(1)",
                  transformOrigin: "right center",
                  transition: TRANSICAO_RECUO,
                }}
              >
                <p
                  className="m-0 font-bold"
                  style={{
                    fontSize: passado ? "0.845rem" : "0.9375rem",
                    lineHeight: 1.45,
                    letterSpacing: "-0.012em",
                    color: passado ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.46)",
                    textWrap: "pretty",
                  }}
                >
                  {turn.text}
                </p>
              </div>
            ) : (
              <div
                key={turn.id}
                className="max-w-[80%] self-start"
                style={{
                  opacity: recuado ? 0.22 : 1,
                  transform: recuado ? "scale(0.94)" : "scale(1)",
                  transformOrigin: "left center",
                  transition: TRANSICAO_RECUO,
                }}
              >
                <AxonTurnText
                  text={turn.text}
                  passado={passado}
                  // O destaque de frase só faz sentido no turno que está sendo
                  // falado agora; num turno antigo seria ruído.
                  fraseAtual={streaming ? fraseAtual : null}
                />
              </div>
            );

          if (!marca) return conteudo;

          return (
            <Fragment key={`b${turn.id}`}>
              <span
                className="self-center text-[0.5625rem] font-medium uppercase tracking-[0.2em]"
                style={{ color: "rgba(255,255,255,0.2)" }}
              >
                {marca}
              </span>
              {conteudo}
            </Fragment>
          );
        })}

        {/* Âncora do auto-scroll. */}
        <div ref={fimRef} className="h-px shrink-0" />
      </div>

      {/* ---------------- controles ---------------- */}
      <div className="grid justify-items-center gap-3.5 px-6 pb-7 pt-2.5">
        <p
          className="min-h-[1.2em] text-center text-[0.72rem]"
          style={{ color: erro ? "#fb7185" : "rgba(255,255,255,0.46)" }}
        >
          {erro ?? textos.dica}
        </p>

        <div className="grid w-full grid-cols-[46px_1fr_46px] items-center gap-4.5">
          <button
            type="button"
            onClick={abrirNoChat}
            aria-label="Escrever em vez de falar"
            className="grid h-[46px] w-[46px] place-items-center rounded-2xl border backdrop-blur-lg"
            style={{
              borderColor: "rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.055)",
              color: "rgba(255,255,255,0.72)",
            }}
          >
            <Keyboard className="h-5 w-5" />
          </button>

          <div className="justify-self-center">
            <VoiceOrbButton
              session={voiceSession}
              onWarmup={() => {
                speech.warmup();
                // Ao encostar no microfone a tela já volta ao normal: esperar a
                // gravação terminar deixaria a orb pequena durante toda a fala.
                grudadoNoFimRef.current = true;
                setModoRegistro(false);
              }}
              disabled={carregando || !conversationId}
            />
          </div>

          <button
            type="button"
            onClick={botaoDireito}
            aria-label={speech.speaking ? "Interromper o Axon" : "Encerrar conversa"}
            className="grid h-[46px] w-[46px] place-items-center rounded-2xl border backdrop-blur-lg"
            style={{
              borderColor: speech.speaking
                ? "rgba(168, 85, 247, 0.32)"
                : "rgba(255,255,255,0.1)",
              background: speech.speaking
                ? "rgba(168, 85, 247, 0.16)"
                : "rgba(255,255,255,0.055)",
              color: speech.speaking ? "#f0abfc" : "rgba(255,255,255,0.72)",
            }}
          >
            {speech.speaking ? <Square className="h-4 w-4" /> : <X className="h-4.5 w-4.5" />}
          </button>
        </div>
      </div>
    </main>
  );
}

// ===========================================================================
// TEXTO DO AXON, COM A FRASE FALADA EM DESTAQUE
// ===========================================================================

/**
 * A frase que o TTS está dizendo agora cresce; as já ditas encolhem e recuam.
 *
 * O casamento com o áudio é por POSIÇÃO, não por texto: `onSentenceStart`
 * entrega a frase já sanitizada (markdown removido, "14:30" virou "14 e 30"),
 * então comparar com o texto exibido caractere a caractere não funcionaria.
 * Contamos quantas frases já foram faladas e destacamos a n-ésima do texto na
 * tela — as duas listas têm a mesma ordem, que é o que importa.
 */
function AxonTurnText({
  text,
  passado,
  fraseAtual,
}: {
  text: string;
  passado: boolean;
  fraseAtual: string | null;
}) {
  const frases = useMemo(() => splitSentences(text), [text]);

  // Qual das frases da tela é a que está tocando. `splitSentences` corta igual
  // à fila, então basta passar cada frase pela mesma sanitização e comparar —
  // sem contador nem estado, que sairiam de sincronia numa remontagem.
  const atual = useMemo(() => {
    if (fraseAtual === null) return -1;
    return frases.findIndex((f) => sanitizeForSpeech(f) === fraseAtual);
  }, [frases, fraseAtual]);

  // Sem destaque: turno antigo, fala encerrada, uma frase só, ou a frase falada
  // não bateu com nenhuma da tela (nesse caso texto corrido é melhor que
  // destacar a errada).
  if (passado || fraseAtual === null || frases.length <= 1 || atual < 0) {
    return (
      <p
        className="m-0 font-bold"
        style={{
          fontSize: passado ? "0.875rem" : "1rem",
          lineHeight: 1.45,
          letterSpacing: "-0.015em",
          color: passado ? "rgba(255,255,255,0.38)" : "#fff",
          textWrap: "pretty",
        }}
      >
        {text}
      </p>
    );
  }

  return (
    <p className="m-0" style={{ textWrap: "pretty" }}>
      {frases.map((frase, i) => {
        const jaDita = i < atual;
        const agora = i === atual;
        return (
          <span
            key={i}
            className="block"
            style={{
              marginTop: i > 0 ? "0.5rem" : 0,
              fontSize: agora ? "1.3125rem" : "0.78rem",
              lineHeight: agora ? 1.34 : 1.4,
              fontWeight: agora ? 800 : 600,
              letterSpacing: agora ? "-0.026em" : 0,
              color: agora
                ? "#fff"
                : jaDita
                ? "rgba(255,255,255,0.28)"
                : "rgba(255,255,255,0.12)",
              textShadow: agora ? "0 0 30px rgba(216, 180, 254, 0.55)" : "none",
              transition: "color 0.35s ease, font-size 0.35s ease, text-shadow 0.35s ease",
            }}
          >
            {frase}
          </span>
        );
      })}
    </p>
  );
}
