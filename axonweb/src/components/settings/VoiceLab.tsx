/**
 * Painel para ESCOLHER e COMPARAR a voz do Axon.
 *
 * A voz nativa do aparelho foi testada e reprovada por soar artificial, então a
 * escolha agora é entre provedores de voz neural — Google, ElevenLabs e OpenAI.
 * Como é uma decisão de gosto ("qual voz combina com o Axon"), o painel toca
 * todas com a MESMA frase para a comparação ser justa.
 *
 * Só aparecem as vozes dos provedores com credencial configurada no servidor;
 * uma voz que não pode falar não é oferecida.
 */

import { useEffect, useState } from "react";
import { Loader2, Play, Volume2, VolumeX } from "lucide-react";

import * as api from "../../lib/api";
import { ensureVoices, listPortugueseVoices } from "../../lib/voice/nativeEngine";
import {
  DEFAULT_PREFS,
  getEngine,
  loadVoicePrefs,
  saveVoicePrefs,
  type VoicePrefs,
} from "../../lib/voice/tts";

/**
 * Frase de teste com o vocabulário real do Axon: nome próprio, horário e uma
 * pergunta — os três casos em que uma voz ruim se denuncia.
 */
const FRASE_TESTE =
  "Oi! Aqui é o Axon. Seu pico de foco começa às 9 e 30 da manhã. " +
  "Quer que eu reserve esse horário para a sua tarefa mais importante?";

const NOME_PROVEDOR: Record<string, string> = {
  google: "Google",
  elevenlabs: "ElevenLabs",
  openai: "OpenAI",
};

/** Uma opção de voz, já normalizada entre nuvem e aparelho. */
interface Opcao {
  id: string;
  nome: string;
  detalhe: string;
  grupo: string;
}

export default function VoiceLab() {
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const [opcoes, setOpcoes] = useState<Opcao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [tocando, setTocando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semProvedor, setSemProvedor] = useState(false);

  const naNuvem = prefs.engine === "cloud";

  // Recarrega a lista ao alternar entre nuvem e aparelho: as duas fontes de voz
  // não têm nada em comum.
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro(null);

    async function carregar() {
      if (naNuvem) {
        try {
          const catalogo = await api.getVoices();
          if (!vivo) return;
          setSemProvedor(!catalogo.configured);
          setOpcoes(
            catalogo.voices.map((v) => ({
              id: v.id,
              nome: v.name,
              detalhe: [v.gender, v.note].filter(Boolean).join(" · "),
              grupo: NOME_PROVEDOR[v.provider] ?? v.provider,
            })),
          );
        } catch (e) {
          if (!vivo) return;
          setErro(e instanceof Error ? e.message : "Não foi possível carregar as vozes");
          setOpcoes([]);
        }
      } else {
        const todas = await ensureVoices();
        if (!vivo) return;
        setSemProvedor(false);
        setOpcoes(
          listPortugueseVoices(todas).map((v) => ({
            id: v.voiceURI,
            nome: v.name,
            detalhe: `${v.lang}${v.localService ? " · do aparelho" : " · da nuvem"}`,
            grupo: "Deste aparelho",
          })),
        );
      }
      if (vivo) setCarregando(false);
    }

    void carregar();
    return () => {
      vivo = false;
    };
  }, [naNuvem]);

  useEffect(() => () => getEngine().cancel(), []);

  function atualizar(patch: Partial<VoicePrefs>) {
    const novo = { ...prefs, ...patch };
    setPrefs(novo);
    saveVoicePrefs(novo);
  }

  async function testar(voiceId?: string) {
    setErro(null);
    const alvo = voiceId ?? prefs.voiceURI ?? opcoes[0]?.id;
    if (!alvo) return;

    // Salvar antes de falar: o motor lê a preferência na hora de sintetizar.
    if (alvo !== prefs.voiceURI) atualizar({ voiceURI: alvo });

    const engine = getEngine();
    engine.cancel();
    setTocando(alvo);
    try {
      await engine.warmup();
      await engine.speak(FRASE_TESTE);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível tocar a voz");
    } finally {
      setTocando(null);
    }
  }

  const grupos = opcoes.reduce<Record<string, Opcao[]>>((acc, o) => {
    (acc[o.grupo] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Escolha da fonte da voz. */}
      <div className="flex gap-2">
        {(
          [
            { id: "cloud", rotulo: "Voz natural", dica: "Gerada no servidor" },
            { id: "native", rotulo: "Voz do aparelho", dica: "Offline e grátis" },
          ] as const
        ).map((op) => {
          const ativo = prefs.engine === op.id;
          return (
            <button
              key={op.id}
              type="button"
              onClick={() => {
                getEngine().cancel();
                // A voz escolhida não vale para o outro motor: os catálogos são
                // completamente diferentes.
                atualizar({ engine: op.id, voiceURI: undefined });
              }}
              className={`flex-1 rounded-2xl border p-3 text-left transition active:scale-[0.98] ${
                ativo ? "border-accent-soft bg-accent-soft" : "border-soft bg-surface-muted"
              }`}
            >
              <span className={`block text-sm font-black ${ativo ? "text-accent" : "text-primary"}`}>
                {op.rotulo}
              </span>
              <span className="block text-[0.68rem] text-muted">{op.dica}</span>
            </button>
          );
        })}
      </div>

      {erro && (
        <p className="rounded-2xl border border-soft bg-surface-muted p-3 text-xs text-secondary">
          {erro}
        </p>
      )}

      {carregando ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Procurando vozes…
        </p>
      ) : semProvedor ? (
        <div className="rounded-2xl border border-soft bg-surface-muted p-4">
          <div className="mb-2 flex items-center gap-2 text-secondary">
            <VolumeX className="h-4 w-4" />
            <p className="text-sm font-black">Nenhum provedor configurado</p>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            O servidor não tem credencial de nenhum serviço de voz. Enquanto isso,
            use a voz do aparelho.
          </p>
        </div>
      ) : opcoes.length === 0 ? (
        <div className="rounded-2xl border border-soft bg-surface-muted p-4">
          <div className="mb-2 flex items-center gap-2 text-secondary">
            <VolumeX className="h-4 w-4" />
            <p className="text-sm font-black">Nenhuma voz em português</p>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Este aparelho não tem um pacote de voz em português instalado. No
            Android isso se resolve em Configurações → Idiomas → Saída de texto
            para voz, baixando o português do Brasil.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Todas falam a mesma frase — toque para comparar.
            </p>
            <button
              type="button"
              onClick={() => void testar()}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-black text-accent transition active:scale-[0.96]"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Ouvir atual
            </button>
          </div>

          {Object.entries(grupos).map(([grupo, itens]) => (
            <div key={grupo} className="space-y-2">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.1em] text-muted">
                {grupo}
              </p>
              <ul className="space-y-2">
                {itens.map((o) => {
                  const selecionada = prefs.voiceURI
                    ? o.id === prefs.voiceURI
                    : o.id === opcoes[0]?.id;
                  return (
                    <li key={o.id}>
                      <button
                        type="button"
                        onClick={() => void testar(o.id)}
                        className={`flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99] ${
                          selecionada
                            ? "border-accent-soft bg-accent-soft"
                            : "border-soft bg-surface-muted"
                        }`}
                      >
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-sm font-black ${
                              selecionada ? "text-accent" : "text-primary"
                            }`}
                          >
                            {o.nome}
                          </span>
                          <span className="block truncate text-[0.68rem] text-muted">
                            {o.detalhe}
                          </span>
                        </span>
                        {tocando === o.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                        ) : (
                          <Play className="h-4 w-4 shrink-0 text-muted" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}

      <div className="space-y-3 rounded-2xl border border-soft bg-surface-muted p-4">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-black text-secondary">
            Velocidade <span className="text-muted">{prefs.rate.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min={0.7}
            max={1.5}
            step={0.05}
            value={prefs.rate}
            onChange={(e) => atualizar({ rate: Number(e.target.value) })}
            className="w-full accent-[color:var(--accent)]"
          />
        </label>

        {/* O tom só existe na voz do aparelho; os provedores neurais não expõem. */}
        {!naNuvem && (
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs font-black text-secondary">
              Tom <span className="text-muted">{prefs.pitch.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.05}
              value={prefs.pitch}
              onChange={(e) => atualizar({ pitch: Number(e.target.value) })}
              className="w-full accent-[color:var(--accent)]"
            />
          </label>
        )}

        <button
          type="button"
          onClick={() =>
            atualizar({ rate: DEFAULT_PREFS.rate, pitch: DEFAULT_PREFS.pitch })
          }
          className="text-xs font-black text-muted underline underline-offset-2"
        >
          Restaurar padrão
        </button>
      </div>
    </div>
  );
}
