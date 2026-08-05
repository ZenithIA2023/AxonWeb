"""
Insights gerados pelo Axon (Fase 8).

Cruza os dados diários do usuário (sono, humor, produtividade percebida,
exercício) com as tarefas concluídas e pede ao Claude que identifique padrões
acionáveis em linguagem natural. O resultado fica em cache por 24h (tabela
`axon_insights`) para não chamar a API a cada abertura da aba.

As funções de agregação/parse são puras (sem I/O) para permitir testes.
"""

import json
from datetime import datetime, timedelta, date, timezone

from services import claude_service

# Mínimo de dias preenchidos para gerar insights de verdade.
MIN_DATA_POINTS = 7
# Janela de dados considerada.
LOOKBACK_DAYS = 30
# Validade do cache.
CACHE_TTL_HOURS = 24

_WEEKDAY_FULL = [
    "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"
]

SYSTEM_PROMPT = """Você é o Axon, um analista pessoal de cronobiologia e produtividade. Recebe os dados diários de UM usuário das últimas semanas: dia da semana, horário e horas estimadas de sono, qualidade do sono, humor e produtividade percebida (escalas de 1 a 5), se houve exercício, quantas tarefas concluiu por dia, as etiquetas que o usuário escolheu para descrever o sono/humor/produtividade daquele dia (sleep_tags, mood_tags, productivity_tags) e em quais períodos ele se sentiu mais produtivo (periodos_de_pico).

Sua tarefa: identificar de 3 a 5 padrões REAIS, específicos e acionáveis nos dados — de preferência correlações entre hábitos e resultados (ex.: horas de sono × tarefas concluídas, horário de dormir × humor, exercício × produtividade percebida, etiquetas recorrentes × produtividade, dia da semana × qualquer resultado).

Regras importantes:
- Baseie-se EXCLUSIVAMENTE nos dados fornecidos. Nunca invente números nem fatos.
- As etiquetas são as palavras do próprio usuário: cite-as como ele as escreveu, sem traduzir nem reinterpretar.
- Ao apontar um padrão de dia da semana, só faça isso se houver pelo menos 3 ocorrências daquele dia nos dados; caso contrário, não afirme que é recorrente.
- A amostra é pequena: fale em tendências e faixas ("cerca de", "tende a", "nos dias em que"), nunca em estatísticas falsamente precisas.
- Se não houver dados suficientes para uma correlação confiável, faça observações simples e úteis (médias, melhores/piores dias, consistência).
- Português do Brasil, tom de parceiro próximo e encorajador, sem jargão técnico.
- Cada insight tem um "title" curto (até ~60 caracteres) e um "detail" de 1 a 2 frases.

Responda APENAS com JSON válido, sem nenhum texto fora dele, neste formato:
[{"title": "...", "detail": "...", "type": "sleep|productivity|mood|habit|general"}]"""


def _local_date(ts: str | None, tz) -> date | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.astimezone(tz).date()
    except Exception:
        return None


# Períodos de pico do registro diário (slug -> rótulo legível), espelha
# PEAK_PERIODS do frontend.
_PEAK_LABELS = {
    "inicio_manha":  "início da manhã",
    "manha":         "manhã",
    "fim_manha":     "fim da manhã",
    "inicio_tarde":  "início da tarde",
    "tarde":         "tarde",
    "fim_tarde":     "fim da tarde",
    "inicio_noite":  "início da noite",
    "noite":         "noite",
}


def _label_tags(slugs: list[str] | None, labels_by_slug: dict[str, str]) -> list[str]:
    """
    Converte slugs de tag nos rótulos que o usuário vê. Sem isso o Claude
    receberia "custom_insnia"/"tarefas_leves" e escreveria esses termos crus
    de volta para o usuário. Slug desconhecido (tag renomeada ou apagada nas
    Configurações depois do registro) vira uma versão legível do próprio slug,
    em vez de sumir — o dia registrado não perde informação.
    """
    out = []
    for slug in slugs or []:
        label = labels_by_slug.get(slug)
        if label is None:
            label = slug.removeprefix("custom_").replace("_", " ").strip()
        if label:
            out.append(label)
    return out


def aggregate_daily(
    logs: list[dict],
    tasks: list[dict],
    tz,
    tag_labels: dict[str, str] | None = None,
) -> list[dict]:
    """
    Combina registros diários com a contagem de tarefas concluídas por dia.
    Retorna uma linha por dia que tenha registro diário, em ordem cronológica.
    Pura — sem I/O.

    `tag_labels` mapeia slug -> rótulo legível (ver routers/insights.py). As
    tags e os períodos de pico entram nas linhas porque são justamente onde o
    usuário descreve o que aconteceu no dia: sem eles,
    correlations_service._dynamic_tag_conditions() nunca encontrava nada e a
    varredura de tags livres — o motivo de ela ser genérica — não existia na
    prática.
    """
    labels = tag_labels or {}
    # Tarefas concluídas por data local (via completed_at).
    completed_by_day: dict[date, int] = {}
    for t in tasks:
        if t.get("status") == "done":
            cday = _local_date(t.get("completed_at"), tz)
            if cday is not None:
                completed_by_day[cday] = completed_by_day.get(cday, 0) + 1

    rows = []
    for log in logs:
        try:
            d = date.fromisoformat(log["date"])
        except (ValueError, TypeError, KeyError):
            continue
        rows.append({
            "data": log["date"],
            "dia_semana": _WEEKDAY_FULL[d.weekday()],
            "dormiu_as": log.get("sleep_time"),
            "acordou_as": log.get("wake_time"),
            "horas_sono": log.get("hours_slept"),
            "qualidade_sono_1a5": log.get("sleep_rating"),
            "humor_1a5": log.get("mood_rating"),
            "produtividade_percebida_1a5": log.get("productivity_rating"),
            "exercitou": log.get("exercised"),
            "tarefas_concluidas": completed_by_day.get(d, 0),
            # Chaves mantidas em inglês: correlations_service lê estes campos
            # exatamente por estes nomes (_dynamic_tag_conditions).
            "sleep_tags": _label_tags(log.get("sleep_tags"), labels),
            "mood_tags": _label_tags(log.get("mood_tags"), labels),
            "productivity_tags": _label_tags(log.get("productivity_tags"), labels),
            "periodos_de_pico": [
                _PEAK_LABELS.get(p, p.replace("_", " "))
                for p in (log.get("peak_periods") or [])
            ],
        })

    rows.sort(key=lambda r: r["data"])
    return rows


def build_user_message(rows: list[dict]) -> str:
    """Monta a mensagem de usuário enviada ao Claude (dados em JSON)."""
    return (
        f"Aqui estão os dados diários do usuário ({len(rows)} dias registrados), "
        "do mais antigo ao mais recente. Encontre os padrões mais relevantes "
        "e acionáveis seguindo as regras.\n\n"
        + json.dumps(rows, ensure_ascii=False, indent=2)
    )


def parse_insights(text: str) -> list[dict]:
    """
    Extrai a lista de insights do texto retornado pelo Claude.
    Tolerante a cercas ```json ... ``` e a texto antes/depois do array.
    Retorna [] se não conseguir interpretar.
    """
    if not text:
        return []
    cleaned = text.strip()

    # Remove cercas de código.
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```", 2)
        cleaned = cleaned[1] if len(cleaned) > 1 else text
        if cleaned.lstrip().startswith("json"):
            cleaned = cleaned.lstrip()[4:]

    # Recorta do primeiro '[' ao último ']' para ignorar ruído ao redor.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end < start:
        return []

    try:
        data = json.loads(cleaned[start:end + 1])
    except json.JSONDecodeError:
        return []

    if not isinstance(data, list):
        return []

    valid_types = {"sleep", "productivity", "mood", "habit", "general"}
    out = []
    for item in data:
        if not isinstance(item, dict):
            continue
        title = (item.get("title") or "").strip()
        detail = (item.get("detail") or "").strip()
        if not title or not detail:
            continue
        itype = item.get("type")
        if itype not in valid_types:
            itype = "general"
        out.append({"title": title, "detail": detail, "type": itype})

    return out[:5]


def is_fresh(generated_at: str | None, now: datetime, ttl_hours: int = CACHE_TTL_HOURS) -> bool:
    """True se o cache ainda é válido (gerado há menos de ttl_hours)."""
    if not generated_at:
        return False
    try:
        gen = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return False
    if gen.tzinfo is None:
        gen = gen.replace(tzinfo=timezone.utc)
    return (now - gen) < timedelta(hours=ttl_hours)


def generate_insights(rows: list[dict]) -> list[dict]:
    """Chama o Claude e devolve a lista de insights já parseada."""
    user_message = build_user_message(rows)
    text = claude_service.call_chat(
        messages=[{"role": "user", "content": user_message}],
        system_prompt=SYSTEM_PROMPT,
    )
    return parse_insights(text)


def collecting_message(data_points: int, needed: int = MIN_DATA_POINTS) -> str:
    """
    Mensagem do estado "collecting". `needed` é parametrizável porque
    /insights/discoveries exige mais dias que /insights/patterns — com o valor
    fixo, a mensagem de lá anunciava o número errado.
    """
    faltam = max(0, needed - data_points)
    if data_points == 0:
        return (
            "O Axon ainda não tem registros seus. Preencha o registro diário "
            "no fim do dia — em poucos dias ele já consegue mostrar o que "
            "influencia a sua produtividade."
        )
    return (
        f"O Axon está aprendendo com você. Faltam cerca de {faltam} "
        f"{'registro' if faltam == 1 else 'registros'} para revelar seus "
        "primeiros padrões."
    )
