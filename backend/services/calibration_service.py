"""
Serviço de calibração dos blocos de foco.

Aprende o ritmo real do usuário combinando dois sinais do registro diário:
  1. Horário de acordar  → blocos antes de acordar viram território de sono
  2. Período mais produtivo + rating → booста os blocos declarados pelo usuário

Algoritmo: Exponential Moving Average (EMA) com α = ALPHA.
Perfil inicializado com os scores de energia do cronotipo base.
Após MIN_DATA_POINTS registros, o AXON passa a usar o perfil personalizado.

Nunca levanta exceção — falhas são silenciosas para não interromper o fluxo.
"""

import json
from datetime import datetime, timezone

from database import supabase
from services.chronotype import CHRONOTYPE_BLOCKS, BLOCK_LEVELS

# ── Hiperparâmetros ────────────────────────────────────────────────────────────
ALPHA = 0.12           # taxa de aprendizado (~14 eventos para 85% do estado estável)
MIN_DATA_POINTS = 14   # mínimo de registros diários para usar o perfil personalizado

TARGET_PEAK  = 92.0    # score alvo para blocos declarados como período de pico
TARGET_SLEEP = 12.0    # score alvo para blocos durante o sono (antes de acordar)

# Peso de cada posição no ranking de períodos de pico (Migration 23).
# O usuário escolhe até 3 períodos EM ORDEM; o 1º é o pico de verdade e puxa o
# score cheio, os seguintes puxam menos. Sem isso, ordenar não teria efeito
# nenhum sobre o perfil de energia — seria só enfeite na tela.
# Índice = posição na lista; posições além da 3ª usam o último peso.
PEAK_RANK_WEIGHT = (1.0, 0.75, 0.5)

# ── Mapeamento período → índices de bloco (cada bloco = 90 min) ───────────────
# Bloco 0 = 00:00, bloco 1 = 01:30, ..., bloco 15 = 22:30
PERIOD_TO_BLOCKS: dict[str, list[int]] = {
    "madrugada":    [0, 1, 2, 3],    # 00:00–06:00
    "cedo_manha":   [4, 5],           # 06:00–09:00
    "manha":        [6, 7],           # 09:00–12:00
    "inicio_tarde": [8, 9],           # 12:00–15:00
    "fim_tarde":    [10, 11],         # 15:00–18:00
    "inicio_noite": [12, 13],         # 18:00–21:00
    "noite":        [14, 15],         # 21:00–00:00
}

_CURVE_MAP = {
    "Matutino":  "morning",
    "Vespertino": "evening",
    "Noturno":   "night",
    "Misto":     "intermediate",
    "Bimodal":   "bimodal",
}


# ── Helpers internos ──────────────────────────────────────────────────────────

def _base_scores(chronotype: str) -> list[float]:
    """Retorna os 16 scores de energia base do cronotipo."""
    curve_key = _CURVE_MAP.get(chronotype, "intermediate")
    blocks = CHRONOTYPE_BLOCKS.get(curve_key, CHRONOTYPE_BLOCKS["intermediate"])
    return [float(BLOCK_LEVELS[level]["energy"]) for level, _ in blocks]


def _parse_scores(raw) -> list[float]:
    if isinstance(raw, str):
        return json.loads(raw)
    if isinstance(raw, list):
        return [float(x) for x in raw]
    return raw


def _get_or_create(user_id: str, chronotype: str) -> dict:
    """Busca o perfil ou cria a partir do cronotipo base."""
    res = (
        supabase.table("user_energy_profiles")
        .select("user_id, block_scores, data_points")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if res.data:
        row = res.data[0]
        row["block_scores"] = _parse_scores(row["block_scores"])
        return row

    scores = _base_scores(chronotype)
    supabase.table("user_energy_profiles").insert({
        "user_id": user_id,
        "block_scores": json.dumps(scores),
        "data_points": 0,
    }).execute()
    return {"user_id": user_id, "block_scores": scores, "data_points": 0}


# ── API pública ───────────────────────────────────────────────────────────────

def calibrate_from_log(user_id: str, chronotype: str, log: dict) -> None:
    """
    Atualiza o perfil de energia do usuário com base em um registro diário.
    Chamado imediatamente após cada upsert do daily_log.
    """
    try:
        profile = _get_or_create(user_id, chronotype)
        scores = list(profile["block_scores"])

        # Sinal 1 — horário de acordar
        # Blocos que ocorrem antes de o usuário acordar são puxados para
        # território de sono, corrigindo deslocamentos de cronotipo.
        wake_time = log.get("wake_time")
        if wake_time:
            try:
                wh, wm = map(int, wake_time.split(":"))
                wake_min = wh * 60 + wm
                for i in range(16):
                    if i * 90 < wake_min:
                        scores[i] = (1 - ALPHA) * scores[i] + ALPHA * TARGET_SLEEP
            except Exception:
                pass

        # Sinal 2 — períodos mais produtivos declarados, EM ORDEM
        # O alvo é escalado pelo rating de produtividade do dia (1–5):
        # um dia "em flow" (5) boosta mais do que um dia regular (3).
        #
        # A partir da Migration 23 a lista é um ranking (posição 0 = o mais
        # produtivo), então cada posição puxa o score com força diferente —
        # ver PEAK_RANK_WEIGHT. Antes usávamos um set() e o 2º lugar puxava
        # tanto quanto o 1º, o que apagava justamente a informação que o
        # usuário se deu ao trabalho de ordenar.
        #
        # Um bloco citado em duas posições (períodos vizinhos compartilham
        # blocos) recebe o peso da MELHOR posição, não a soma: aparecer em 1º
        # e 3º não pode render menos que aparecer só em 1º.
        peak_periods = log.get("peak_periods") or []
        prod_rating  = log.get("productivity_rating")
        aprendeu_horario = bool(peak_periods and prod_rating)
        if aprendeu_horario:
            prod_scale = prod_rating / 5.0                     # 0.2 → 1.0
            melhor_peso: dict[int, float] = {}
            for rank, period in enumerate(peak_periods):
                peso = PEAK_RANK_WEIGHT[min(rank, len(PEAK_RANK_WEIGHT) - 1)]
                for i in PERIOD_TO_BLOCKS.get(period, []):
                    if peso > melhor_peso.get(i, 0.0):
                        melhor_peso[i] = peso
            for i, peso in melhor_peso.items():
                alvo_rank = TARGET_PEAK * peso + 60.0 * (1 - peso)
                target    = alvo_rank * prod_scale + 60.0 * (1 - prod_scale)
                scores[i] = (1 - ALPHA) * scores[i] + ALPHA * target

        # data_points conta apenas os dias que ENSINARAM algo sobre horários —
        # ou seja, os que rodaram o Sinal 2. Um registro sem período marcado
        # (ou um dia livre, que zera os períodos por definição) não contribui
        # com informação de horário nenhuma; contá-lo faria o perfil se
        # declarar "calibrado" com muito menos sinal do que os 14 sugerem.
        # O Sinal 1 (horário de acordar) continua sendo aplicado nesses dias,
        # só não conta para o limiar.
        payload = {
            "block_scores":    json.dumps(scores),
            "last_calibrated": datetime.now(timezone.utc).isoformat(),
        }
        if aprendeu_horario:
            payload["data_points"] = profile["data_points"] + 1

        supabase.table("user_energy_profiles").update(payload).eq(
            "user_id", user_id
        ).execute()

    except Exception:
        pass  # calibração nunca interrompe o fluxo principal


def get_block_scores(user_id: str, chronotype: str) -> tuple[list[float], bool, int]:
    """
    Retorna (scores, calibrated, data_points).

    scores       — lista de 16 floats (0–100), um por bloco de 90 min
    calibrated   — True quando está usando o perfil personalizado
    data_points  — quantos registros diários foram processados
    """
    try:
        res = (
            supabase.table("user_energy_profiles")
            .select("block_scores, data_points")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if res.data:
            row         = res.data[0]
            data_points = row.get("data_points") or 0
            scores      = _parse_scores(row["block_scores"])
            if data_points >= MIN_DATA_POINTS:
                return scores, True, data_points
            return _base_scores(chronotype), False, data_points
    except Exception:
        pass
    return _base_scores(chronotype), False, 0
