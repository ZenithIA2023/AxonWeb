/**
 * Painel para ESCOLHER e AVALIAR a voz do Axon.
 *
 * Existe para responder a uma pergunta de produto: a voz nativa do aparelho é
 * boa o bastante, ou vale pagar por uma voz neural? Aqui dá para ouvir cada voz
 * instalada com a mesma frase e comparar lado a lado.
 *
 * A diferença entre a voz local e a remota do Google costuma ser grande, e o
 * padrão do sistema quase nunca é a melhor — por isso a lista mostra todas.
 */

import { useEffect, useState } from "react";
import { Play, Volume2, VolumeX } from "lucide-react";

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
 * pergunta — os três casos em que as vozes ruins se denunciam.
 */
const FRASE_TESTE =
  "Oi! Aqui é o Axon. Seu pico de foco começa às 9 e 30 da manhã. " +
  "Quer que eu reserve esse horário para a sua tarefa mais importante?";

export default function VoiceLab() {
  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([]);
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const [carregando, setCarregando] = useState(true);
  const [tocando, setTocando] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void ensureVoices().then((todas) => {
      if (!vivo) return;
      setVozes(listPortugueseVoices(todas));
      setCarregando(false);
    });
    return () => {
      vivo = false;
      getEngine().cancel();
    };
  }, []);

  function atualizar(patch: Partial<VoicePrefs>) {
    const novo = { ...prefs, ...patch };
    setPrefs(novo);
    saveVoicePrefs(novo);
  }

  function testar(voiceURI?: string) {
    const engine = getEngine();
    engine.cancel();
    // Salva antes de falar: o motor lê a preferência na hora de falar.
    if (voiceURI && voiceURI !== prefs.voiceURI) atualizar({ voiceURI });
    setTocando(voiceURI ?? "atual");
    void engine.warmup().then(() =>
      engine.speak(FRASE_TESTE).finally(() => setTocando(null)),
    );
  }

  if (carregando) {
    return <p className="text-sm text-muted">Procurando vozes disponíveis…</p>;
  }

  if (vozes.length === 0) {
    return (
      <div className="rounded-2xl border border-soft bg-surface-muted p-4">
        <div className="mb-2 flex items-center gap-2 text-secondary">
          <VolumeX className="h-4 w-4" />
          <p className="text-sm font-black">Nenhuma voz em português</p>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Este aparelho não tem um pacote de voz em português instalado, então o
          Axon não consegue falar. No Android, isso se resolve em Configurações →
          Idiomas → Saída de texto para voz, baixando o português do Brasil.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-primary">Voz do Axon</p>
          <p className="text-xs text-muted">
            {vozes.length} {vozes.length === 1 ? "voz encontrada" : "vozes encontradas"} neste aparelho
          </p>
        </div>
        <button
          type="button"
          onClick={() => testar()}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent-soft bg-accent-soft px-3 py-1.5 text-xs font-black text-accent transition active:scale-[0.96]"
        >
          <Volume2 className="h-3.5 w-3.5" />
          Ouvir
        </button>
      </div>

      <ul className="space-y-2">
        {vozes.map((v) => {
          const selecionada = prefs.voiceURI
            ? v.voiceURI === prefs.voiceURI
            : v === vozes[0];
          return (
            <li key={v.voiceURI}>
              <button
                type="button"
                onClick={() => testar(v.voiceURI)}
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
                    {v.name}
                  </span>
                  <span className="block truncate text-[0.68rem] text-muted">
                    {v.lang}
                    {v.localService ? " · do aparelho" : " · da nuvem (melhor qualidade)"}
                  </span>
                </span>
                <Play
                  className={`h-4 w-4 shrink-0 ${
                    tocando === v.voiceURI ? "animate-pulse text-accent" : "text-muted"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 rounded-2xl border border-soft bg-surface-muted p-4">
        <label className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-black text-secondary">
            Velocidade <span className="text-muted">{prefs.rate.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min={0.6}
            max={1.6}
            step={0.05}
            value={prefs.rate}
            onChange={(e) => atualizar({ rate: Number(e.target.value) })}
            className="w-full accent-[color:var(--accent)]"
          />
        </label>

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

        <button
          type="button"
          onClick={() => {
            setPrefs({ ...DEFAULT_PREFS, voiceURI: prefs.voiceURI });
            saveVoicePrefs({ ...DEFAULT_PREFS, voiceURI: prefs.voiceURI });
          }}
          className="text-xs font-black text-muted underline underline-offset-2"
        >
          Restaurar padrão
        </button>
      </div>
    </div>
  );
}
