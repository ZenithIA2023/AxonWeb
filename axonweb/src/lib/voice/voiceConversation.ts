/**
 * A conversa por voz é uma só, contínua: você abre a página de voz e continua
 * de onde parou, sem escolher nada. O id fica no localStorage e a conversa em
 * si é uma conversa normal — aparece na lista do /chat como qualquer outra, e
 * dá para ler o fio por lá.
 */

import * as api from "../api";

const KEY = "axon_voice_conversation_id";
const TITULO = "Conversa por voz";

function lerId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function guardarId(id: string) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Sem localStorage a página ainda funciona; só cria uma conversa nova a
    // cada visita, o que é degradação aceitável.
  }
}

export interface VoiceConversation {
  id: string;
  messages: api.StoredMessage[];
}

/**
 * Devolve a conversa de voz e as mensagens dela, criando-a se necessário.
 *
 * O id guardado pode apontar para uma conversa que o usuário apagou no /chat —
 * por isso ele é validado buscando as mensagens antes de ser usado. Um id morto
 * não pode deixar a página de voz inutilizável.
 */
export async function resolveVoiceConversation(): Promise<VoiceConversation> {
  const guardado = lerId();

  if (guardado) {
    try {
      const messages = await api.getConversationMessages(guardado);
      return { id: guardado, messages };
    } catch {
      // Apagada, ou de outra conta: cai para a criação abaixo.
    }
  }

  const criada = await api.createConversation(TITULO, "general");
  guardarId(criada.id);
  return { id: criada.id, messages: [] };
}
