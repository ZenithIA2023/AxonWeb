/**
 * Prepara o texto do Axon para ser FALADO em voz alta.
 *
 * O Axon responde em markdown — negrito, listas, títulos. Lido por um
 * sintetizador, isso vira "asterisco asterisco importante asterisco asterisco".
 * O prompt do modo voz já pede texto corrido, mas isto é o cinto e suspensório:
 * o modelo escorrega, e uma resposta antiga do histórico nunca passou por aquele
 * prompt.
 *
 * Também traduz o que se ESCREVE de um jeito e se FALA de outro: "14:30" lido
 * literalmente sai como "quatorze dois pontos trinta".
 */

/** Meses por índice (1-12), para datas ISO. */
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Emoji e símbolos decorativos. Alguns sintetizadores leem o NOME do emoji
 * ("cara sorridente"), o que quebra completamente a naturalidade.
 */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;

/** "14:30" → "14 e 30"; "14:00" → "14 horas". */
function horasPorExtenso(texto: string): string {
  return texto.replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, min: string) => {
    const hora = Number(h);
    const minuto = Number(min);
    if (hora > 23 || minuto > 59) return `${h}:${min}`; // não era hora
    if (minuto === 0) return `${hora} horas`;
    return `${hora} e ${minuto}`;
  });
}

/** "2026-03-15" → "15 de março". */
function datasPorExtenso(texto: string): string {
  return texto.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, _ano: string, mes: string, dia: string) => {
    const idx = Number(mes) - 1;
    if (idx < 0 || idx > 11) return _m;
    return `${Number(dia)} de ${MESES[idx]}`;
  });
}

/**
 * Converte markdown + notação escrita em algo que soe natural falado.
 * Devolve string vazia se não sobrar nada pronunciável.
 */
export function sanitizeForSpeech(texto: string): string {
  if (!texto) return "";

  let t = texto;

  // Blocos de código: o conteúdo não é falável. Substitui por uma menção.
  t = t.replace(/```[\s\S]*?```/g, " (trecho de código) ");
  t = t.replace(/`([^`]+)`/g, "$1");

  // Links markdown: fala o rótulo, descarta a URL.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Títulos, citações e marcadores de lista no início da linha.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  t = t.replace(/^\s{0,3}>\s?/gm, "");
  t = t.replace(/^\s*[-*+]\s+/gm, "");
  // Listas numeradas: "1. Fazer X" → "Fazer X" (o "1." viraria "um ponto").
  t = t.replace(/^\s*\d+[.)]\s+/gm, "");

  // Linha horizontal.
  t = t.replace(/^\s*([-*_]\s*){3,}$/gm, "");

  // Ênfase: **negrito**, *itálico*, __x__, ~~x~~.
  t = t.replace(/(\*\*\*|\*\*|\*|___|__|_|~~)(.*?)\1/g, "$2");
  // Sobras de asterisco/underscore soltos que não formaram par.
  t = t.replace(/[*_]{1,3}/g, "");

  // Barras de tabela viram pausa, senão as células grudam.
  t = t.replace(/\s*\|\s*/g, ", ");

  t = t.replace(EMOJI, "");

  t = horasPorExtenso(t);
  t = datasPorExtenso(t);

  // Parágrafo vira pausa de frase. Sem isto o sintetizador emenda os blocos.
  t = t.replace(/\n{2,}/g, ". ");
  t = t.replace(/\n/g, " ");

  // Limpezas finais de pontuação duplicada pelas substituições acima.
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\s+([,.!?;:])/g, "$1");
  t = t.replace(/([.!?])\s*[.]+/g, "$1");
  t = t.replace(/,\s*([.!?])/g, "$1");
  t = t.replace(/(^|\s)[,;:]+\s*/g, "$1");

  return t.trim();
}

/** True se, depois de limpo, sobrou algo que valha a pena falar. */
export function hasSpeakableContent(texto: string): boolean {
  return /[\p{L}\p{N}]/u.test(sanitizeForSpeech(texto));
}
