"""
Contexto e streaming de uma conversa com o Axon.

Extraído de `routers/chat.py` quando a conversa por voz passou a precisar do
mesmo caminho: carregar o perfil, montar o prompt e streamar a resposta salvando
no banco. A voz não é um segundo agente — é outra porta de entrada para o mesmo,
então nada aqui é duplicado lá.

O código foi movido sem mudança de comportamento; o chat de texto continua
chamando exatamente as mesmas funções.
"""

import json
from datetime import datetime

from database import supabase
from services import (
    calibration_service,
    chronotype as chronotype_service,
    claude_service,
    user_tz,
)

_CURVE_KEY = {
    "Matutino": "morning", "Vespertino": "evening", "Noturno": "night",
    "Misto": "intermediate", "Bimodal": "bimodal",
    "morning": "morning", "evening": "evening", "night": "night",
    "intermediate": "intermediate", "bimodal": "bimodal",
}

# Respostas do questionário que o agente realmente usa para personalizar sugestões
_RELEVANT_ANSWERS = ["P10", "P11", "P13", "P14", "P17", "P18"]

_PERIOD_LABELS = {
    "madrugada":    "Madrugada (00h–06h)",
    "cedo_manha":   "Cedo da manhã (06h–09h)",
    "manha":        "Manhã (09h–12h)",
    "inicio_tarde": "Começo da tarde (12h–15h)",
    "fim_tarde":    "Fim da tarde (15h–18h)",
    "inicio_noite": "Começo da noite (18h–21h)",
    "noite":        "Noite (21h–00h)",
}

_PERIOD_TO_BLOCKS = {
    "madrugada":    [0, 1, 2, 3],
    "cedo_manha":   [4, 5],
    "manha":        [6, 7],
    "inicio_tarde": [8, 9],
    "fim_tarde":    [10, 11],
    "inicio_noite": [12, 13],
    "noite":        [14, 15],
}


def build_personal_profile_context(scores: list[float], data_points: int) -> dict:
    """
    Converte os 16 scores pessoais em descrições legíveis dos períodos de
    maior e menor energia, para incluir no prompt do AXON.
    """
    # Calcula score médio por período
    period_scores = {}
    for period, block_idxs in _PERIOD_TO_BLOCKS.items():
        avg = sum(scores[i] for i in block_idxs) / len(block_idxs)
        period_scores[period] = round(avg)

    sorted_periods = sorted(period_scores.items(), key=lambda x: -x[1])
    peak  = [f"{_PERIOD_LABELS[p]}: {s}" for p, s in sorted_periods[:2]]
    low   = [f"{_PERIOD_LABELS[p]}: {s}" for p, s in sorted_periods[-2:]]

    return {
        "calibrated": True,
        "data_points": data_points,
        "peak_periods": peak,
        "low_periods": low,
    }


def load_perfil(user_id: str, tz_header: str | None = None) -> dict:
    """Carrega o perfil completo do usuário para montar o prompt do agente."""
    profile_res = (
        supabase.table("profiles")
        .select("name, chronotype, qualidade_sono, schedule_type, timezone, axon_direct_onboarding_completed")
        .eq("id", user_id)
        .single()
        .execute()
    )
    profile_data = profile_res.data or {}

    # Fuso efetivo: header do navegador (se válido) tem prioridade; persiste se mudou.
    tz_name = user_tz.resolve(user_id, tz_header, stored=profile_data.get("timezone"))

    answers_res = (
        supabase.table("respostas")
        .select("pergunta, alternativa")
        .eq("user_id", user_id)
        .in_("pergunta", _RELEVANT_ANSWERS)
        .execute()
    )
    respostas = {row["pergunta"]: row["alternativa"] for row in (answers_res.data or [])}

    memories_res = (
        supabase.table("user_memories")
        .select("content")
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .limit(60)
        .execute()
    )
    memories = [row["content"] for row in (memories_res.data or [])]

    chronotype = profile_data.get("chronotype", "intermediate")
    curve_key = _CURVE_KEY.get(chronotype, "intermediate")
    hour = datetime.now(user_tz.zone(tz_name)).hour
    block_idx = (hour * 60) // 90
    blocks = chronotype_service.CHRONOTYPE_BLOCKS.get(
        curve_key, chronotype_service.CHRONOTYPE_BLOCKS["intermediate"]
    )
    level, description = blocks[block_idx]
    level_label = chronotype_service.BLOCK_LEVELS[level]["label"]
    start_min = block_idx * 90
    end_min = (block_idx + 1) * 90
    block_start = f"{start_min // 60:02d}:{start_min % 60:02d}"
    block_end = f"{(end_min % 1440) // 60:02d}:{end_min % 60:02d}"
    current_block = {
        "level": level,
        "level_label": level_label,
        "start": block_start,
        "end": block_end,
        "description": description,
    }

    # Perfil personalizado de energia (quando calibrado, enriquece o prompt)
    personal_scores, calibrated, data_points = calibration_service.get_block_scores(
        user_id, chronotype
    )
    personal_profile = None
    if calibrated:
        personal_profile = build_personal_profile_context(
            personal_scores, data_points
        )

    return {
        "nome": profile_data.get("name"),
        "cronotipo": chronotype,
        "schedule_type": profile_data.get("schedule_type"),
        "qualidade_sono": profile_data.get("qualidade_sono"),
        "respostas": respostas,
        "memories": memories,
        "current_block": current_block,
        "timezone": tz_name,
        "personal_profile": personal_profile,
        "axon_direct_onboarding_completed": profile_data.get("axon_direct_onboarding_completed", False),
    }


def load_conversation_type(conversation_id: str | None, user_id: str) -> str:
    """Descobre o conversation_type da conversa atual (regular por padrão)."""
    if not conversation_id:
        return "regular"
    res = (
        supabase.table("conversations")
        .select("conversation_type")
        .eq("id", conversation_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        return "regular"
    return res.data[0].get("conversation_type") or "regular"


def stream_and_save(
    user_id: str,
    conversation_id: str,
    user_message: str,
    history: list,
    system_prompt,
    tz_name: str | None = None,
    conversation_type: str = "regular",
    *,
    thinking: bool = True,
    voice: bool = False,
):
    """
    Faz o streaming da resposta da Claude e salva as mensagens no banco.

    `thinking=False` é usado pela conversa por voz: o raciocínio adaptativo
    responde melhor, mas atrasa o primeiro token em até alguns segundos — e numa
    conversa falada essa espera é a diferença entre parecer natural e parecer
    travado.

    `voice=True` também vem da conversa por voz: tira as tools de exclusão da
    lista oferecida ao modelo (ver agent_tools.tools_for_conversation).
    """
    response_text = ""
    try:
        for chunk in claude_service.stream_chat_with_tools(
            history, system_prompt, user_id, tz_name, conversation_type,
            thinking=thinking, voice=voice,
        ):
            # chunk é no formato: "data: {\"text\": \"...\"}\n\n" ou "data: [DONE]\n\n"
            yield chunk

            # Extrai o texto para salvar depois
            if chunk.startswith("data: "):
                payload = chunk[6:-2]  # Remove "data: " e "\n\n"
                if payload == "[DONE]":
                    break
                try:
                    data = json.loads(payload)
                    response_text += data.get("text", "")
                except:
                    pass

        # Salva as mensagens após o streaming terminar
        supabase.table("messages").insert([
            {"user_id": user_id, "conversation_id": conversation_id, "role": "user", "content": user_message},
            {"user_id": user_id, "conversation_id": conversation_id, "role": "assistant", "content": response_text},
        ]).execute()
    except Exception as e:
        import traceback
        traceback.print_exc()  # aparece no log do servidor para debug
        yield f"data: {json.dumps({'text': f'\\n\\n⚠️ Erro interno: {e}'})}\n\n"
        yield "data: [DONE]\n\n"
