/**
 * Testes das funções puras da voz: `sanitizeForSpeech` e `createSentenceQueue`.
 *
 * São as duas peças mais propensas a bug sutil da feature: um corte de frase
 * errado picota a fala ("Dr." virando duas frases), e um markdown que escapa é
 * lido literalmente em voz alta ("asterisco asterisco importante").
 *
 * O projeto não tem runner de teste configurado, então este arquivo é
 * auto-contido e roda direto, sem instalar nada:
 *
 *     cd axonweb && npx tsx src/lib/voice/voice.test.ts
 */

import { sanitizeForSpeech } from "./sanitize";
import { createSentenceQueue } from "./sentenceQueue";
import type { SpeechEngine } from "./tts";

let ok = 0;
let falhas = 0;

function eq(nome: string, obtido: unknown, esperado: unknown): void {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
    console.log(`  ok  ${nome}`);
  } else {
    falhas++;
    console.log(`FALHA ${nome}\n   obtido:   ${a}\n   esperado: ${b}`);
  }
}

/** Motor de voz falso: registra o que teria sido falado, sem tocar áudio. */
function motorFalso(): { engine: SpeechEngine; ditas: string[] } {
  const ditas: string[] = [];
  return {
    ditas,
    engine: {
      id: "native",
      isAvailable: true,
      speak: (t: string) => {
        ditas.push(t);
        return Promise.resolve();
      },
      cancel: () => {},
      warmup: () => Promise.resolve(),
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

async function main(): Promise<void> {
  console.log("\n— sanitizeForSpeech —");
  eq("negrito", sanitizeForSpeech("Isso é **muito** importante"), "Isso é muito importante");
  eq("lista", sanitizeForSpeech("- Primeiro item\n- Segundo item"), "Primeiro item Segundo item");
  eq("lista numerada", sanitizeForSpeech("1. Fazer isso\n2. Depois aquilo"), "Fazer isso Depois aquilo");
  eq("título", sanitizeForSpeech("## Seu dia\nVamos lá"), "Seu dia Vamos lá");
  eq("hora", sanitizeForSpeech("Marquei para 14:30"), "Marquei para 14 e 30");
  eq("hora cheia", sanitizeForSpeech("Começa 09:00"), "Começa 9 horas");
  eq("data ISO", sanitizeForSpeech("No dia 2026-03-15"), "No dia 15 de março");
  eq("emoji", sanitizeForSpeech("Pronto! 🎉 Tudo certo"), "Pronto! Tudo certo");
  eq("link", sanitizeForSpeech("Veja [o painel](https://x.com/y)"), "Veja o painel");
  eq("código inline", sanitizeForSpeech("Use `npm run dev` aqui"), "Use npm run dev aqui");
  eq("parágrafo vira pausa", sanitizeForSpeech("Primeira ideia.\n\nSegunda ideia."), "Primeira ideia. Segunda ideia.");
  eq("proporção não é hora", sanitizeForSpeech("A proporção é 30:70"), "A proporção é 30:70");
  eq("só emoji não sobra nada", sanitizeForSpeech("🎉"), "");

  console.log("\n— sentenceQueue —");

  let f = motorFalso();
  let q = createSentenceQueue(f.engine);
  q.push("Vamos organizar seu dia com calma. Comece pela tarefa mais pesada agora. ");
  q.flush();
  await tick();
  eq("duas frases num delta", f.ditas, [
    "Vamos organizar seu dia com calma.",
    "Comece pela tarefa mais pesada agora.",
  ]);

  f = motorFalso();
  q = createSentenceQueue(f.engine);
  for (const c of ["Vamos ", "organizar ", "o seu dia ", "de hoje. ", "Depois ", "a gente ", "revisa tudo isso."]) {
    q.push(c);
  }
  q.flush();
  await tick();
  eq("chegando delta a delta (SSE)", f.ditas, [
    "Vamos organizar o seu dia de hoje.",
    "Depois a gente revisa tudo isso.",
  ]);

  f = motorFalso();
  q = createSentenceQueue(f.engine);
  q.push("Sua consulta com o Dr. Silva custa R$ 150.50 no total. ");
  q.flush();
  await tick();
  eq("não corta em abreviação nem decimal", f.ditas, [
    "Sua consulta com o Dr. Silva custa R$ 150.50 no total.",
  ]);

  f = motorFalso();
  q = createSentenceQueue(f.engine);
  q.push("Ok. ");
  await tick();
  eq("fragmento curto espera", f.ditas, []);
  q.push("Vou marcar isso para amanhã de manhã. ");
  q.flush();
  await tick();
  eq("fragmento curto junta com a próxima", f.ditas, ["Ok. Vou marcar isso para amanhã de manhã."]);

  f = motorFalso();
  q = createSentenceQueue(f.engine);
  q.push("Isso é **muito** importante para o seu foco de hoje! ");
  q.flush();
  await tick();
  eq("markdown some antes de falar", f.ditas, ["Isso é muito importante para o seu foco de hoje!"]);

  f = motorFalso();
  q = createSentenceQueue(f.engine);
  q.push("Primeira frase completa aqui agora. ");
  q.cancel();
  q.push("Não deve falar isso nunca mais.");
  q.flush();
  await tick();
  eq("cancel descarta o resto", f.ditas, ["Primeira frase completa aqui agora."]);

  f = motorFalso();
  let idle = 0;
  q = createSentenceQueue(f.engine, { onIdle: () => idle++ });
  q.push("Terminamos por aqui o seu planejamento. ");
  q.flush();
  await new Promise((r) => setTimeout(r, 20));
  eq("onIdle dispara no fim", idle > 0, true);

  f = motorFalso();
  q = createSentenceQueue(f.engine);
  q.push("Quer que eu marque para as nove da manhã? Posso ajustar depois. ");
  q.flush();
  await tick();
  eq("interrogação fecha frase", f.ditas, [
    "Quer que eu marque para as nove da manhã?",
    "Posso ajustar depois.",
  ]);

  console.log(`\n${ok} passaram, ${falhas} falharam`);
  // Sai com código 1 quando algo falha, para servir em CI. `process` só existe
  // no Node (este arquivo não vai para o bundle do navegador) e o projeto não
  // tem @types/node, então o acesso é feito sem depender do tipo global.
  if (falhas > 0) {
    (globalThis as { process?: { exit: (code: number) => void } }).process?.exit(1);
  }
}

void main();
