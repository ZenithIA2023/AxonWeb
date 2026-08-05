"""
Motor de correlações reais entre hábitos e resultados (Descobertas do Axon).

Diferença para insights_service.py: aquele manda os dados crus para o Claude
e pede para "identificar padrões" em texto livre — LLM não é confiável para
fazer aritmética de correlação a partir de uma lista JSON (generaliza ou
inventa magnitude). Aqui o BACKEND calcula as diferenças reais (código
determinístico); o Claude só traduz números já corretos em frases naturais.

Varredura genérica, não hipóteses fixas: todo par (condição binária dos dados
do usuário) × (métrica de resultado) é testado, no mesmo dia e no dia
seguinte (efeito defasado, ex. "sexta com exercício → sábado melhor"). Só
reporta pares com >= MIN_GROUP_SIZE dias em CADA grupo (evita ruído de
amostra pequena) e ranqueia por magnitude da diferença.

Adicionar uma condição ou métrica nova = adicionar ao dicionário; a
combinatória generaliza sozinha, sem escrever um teste por hipótese.
"""

import json
from datetime import date, timedelta

from services import claude_service

# Mínimo de dias em CADA grupo (com/sem a condição) para considerar a
# comparação confiável — evita "1 dia ruim vs 1 dia bom" virar "padrão".
MIN_GROUP_SIZE = 5

# Dia da semana ocorre 1x por semana: exigir MIN_GROUP_SIZE quintas seriam 5
# semanas de registro contínuo. 3 é o mínimo para "recorrente" não ser
# coincidência de duas datas — abaixo disso não afirmamos nada.
MIN_WEEKDAY_OCCURRENCES = 3

# Diferença mínima entre grupos para valer a pena mostrar ao usuário.
MIN_DIFF_RATIO = 0.10   # 10% de variação na métrica
MIN_DIFF_RATING = 0.4   # ou 0.4 pontos em escalas 1-5

# Uma diferença entre médias não significa nada se a variação DENTRO de cada
# grupo for maior que a diferença entre eles (ex.: dias "com" indo de 0 a 8
# tarefas). Exigimos que a diferença seja pelo menos esta fração do desvio
# padrão combinado — é o filtro que separa padrão real de ruído, e é o que
# torna desnecessário um "agente verificador": aqui a checagem é aritmética.
MIN_EFFECT_SIZE = 0.5

# Dia da semana precisa de uma barra MUITO mais alta. Duas razões: o grupo
# "com" é pequeno (1 ocorrência por semana), e testamos 7 dias × 3 métricas =
# 21 chances de o acaso passar. Medido por simulação com dados aleatórios
# (40 rodadas de 8 semanas): o efeito falso máximo observado foi 1.22, com
# mediana 0.64 — em 0.5 o motor reportava 6 "descobertas" para ruído puro.
# 1.2 elimina praticamente todos os falsos e mantém padrões reais, que
# separam bem acima disso.
MIN_EFFECT_SIZE_WEEKDAY = 1.2

# Candidatos que vão para a curadoria. Maior que MAX_CURATED de propósito:
# o modelo precisa de material para descartar redundâncias e escolher as
# mais úteis — curar 4 para mostrar 4 não seria curadoria.
MAX_FINDINGS = 12


# ── Condições binárias (derivadas do daily_log) ─────────────────────────────
# Cada condição é (label, fn(row) -> bool | None). None = dado ausente naquele
# dia (não entra em nenhum dos dois grupos).

def _cond_sleep_lt(hours: float):
    def fn(row):
        h = row.get("hours_slept")
        return None if h is None else h < hours
    return fn


def _cond_rating_le(field: str, threshold: int):
    def fn(row):
        v = row.get(field)
        return None if v is None else v <= threshold
    return fn


def _cond_tag_present(field: str, tag: str):
    def fn(row):
        tags = row.get(field)
        if tags is None:
            return None
        return tag in tags
    return fn


def _cond_weekday(weekday_name: str):
    """É um determinado dia da semana? (`dia_semana` vem de aggregate_daily)."""
    def fn(row):
        d = row.get("dia_semana")
        return None if not d else d == weekday_name
    return fn


def _parse_hhmm(value) -> int | None:
    """'23:30' -> minutos desde 00:00. None se ausente/inválido."""
    if not value or not isinstance(value, str) or len(value) < 4:
        return None
    try:
        return int(value[:2]) * 60 + int(value[3:5])
    except ValueError:
        return None


def _cond_bedtime_after(hhmm: str):
    """
    Dormiu depois de um horário. Horários da madrugada (00:00-04:59) contam
    como "tarde": deitar às 02h é mais tarde que às 23h, mas o número do
    relógio é menor — sem isso a comparação inverteria o significado.
    """
    threshold = _parse_hhmm(hhmm)

    def fn(row):
        m = _parse_hhmm(row.get("dormiu_as"))
        if m is None or threshold is None:
            return None
        # Madrugada até 05h pertence à noite anterior.
        if m < 5 * 60:
            m += 24 * 60
        return m >= threshold
    return fn


def _cond_peak_period(period_label: str):
    def fn(row):
        periods = row.get("periodos_de_pico")
        if periods is None:
            return None
        return period_label in periods
    return fn


_WEEKDAYS_PT = [
    "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"
]


def _base_conditions() -> list[tuple[str, str]]:
    """
    Condições fixas (sempre testadas) — (chave, descrição em pt-BR).
    Cada par é testado só numa direção (ex.: só "não fez exercício", não
    também "fez exercício") — as duas são a mesma comparação de trás para
    frente, e reportar as duas duplicaria a descoberta na lista do usuário.
    """
    return [
        ("sleep_lt6", "dormiu menos de 6 horas"),
        ("sleep_lt7", "dormiu menos de 7 horas"),
        ("sleep_quality_low", "avaliou a qualidade do sono como baixa (nota 1-2)"),
        ("mood_low", "estava com o humor baixo (nota 1-2)"),
        ("no_exercise", "não fez atividade física"),
        ("bedtime_after_23", "foi dormir depois das 23h"),
        ("bedtime_after_00", "foi dormir depois da meia-noite"),
        ("bedtime_after_01", "foi dormir depois da 1h da manhã"),
    ]


def _weekday_conditions() -> list[tuple[str, str]]:
    """
    Um "é tal dia da semana?" por dia. Cobre o padrão mais intuitivo para o
    usuário ("toda quinta eu durmo mal") e que a varredura por hábito não
    alcança. Exige MIN_WEEKDAY_OCCURRENCES ocorrências — ver _split_groups.
    """
    return [(f"weekday:{d}", f"é {d.lower()}-feira" if d not in ("Sábado", "Domingo")
             else f"é {d.lower()}") for d in _WEEKDAYS_PT]


_CONDITION_FNS = {
    "sleep_lt6": _cond_sleep_lt(6),
    "sleep_lt7": _cond_sleep_lt(7),
    "sleep_quality_low": _cond_rating_le("sleep_rating", 2),
    "mood_low": _cond_rating_le("mood_rating", 2),
    "no_exercise": lambda row: None if row.get("exercised") is None else not row["exercised"],
    "bedtime_after_23": _cond_bedtime_after("23:00"),
    "bedtime_after_00": _cond_bedtime_after("00:00"),
    "bedtime_after_01": _cond_bedtime_after("01:00"),
    **{f"weekday:{d}": _cond_weekday(d) for d in _WEEKDAYS_PT},
}


def _dynamic_tag_conditions(rows: list[dict]) -> list[tuple[str, str]]:
    """
    Descobre condições a partir das tags livres que o próprio usuário usou
    (sleep_tags/mood_tags/productivity_tags) — generaliza para qualquer tag
    sem precisar prever o vocabulário de antemão.
    """
    conds: list[tuple[str, str]] = []
    seen: set[str] = set()
    tag_fields = {
        "sleep_tags": "no registro de sono",
        "mood_tags": "no registro de humor",
        "productivity_tags": "no registro de produtividade",
    }
    for field, ctx in tag_fields.items():
        for row in rows:
            for tag in row.get(field) or []:
                key = f"tag:{field}:{tag}"
                if key in seen:
                    continue
                seen.add(key)
                label = f"marcou '{tag}' {ctx}"
                conds.append((key, label))
                _CONDITION_FNS[key] = _cond_tag_present(field, tag)
    return conds


# ── Métricas de resultado ────────────────────────────────────────────────

_METRICS: dict[str, tuple[str, str]] = {
    # chave -> (campo na linha, descrição em pt-BR)
    "tasks_completed": ("tarefas_concluidas", "tarefas concluídas"),
    "productivity_rating": ("produtividade_percebida_1a5", "produtividade percebida (1-5)"),
    "mood_rating": ("humor_1a5", "humor (1-5)"),
}

_RATING_METRICS = {"productivity_rating", "mood_rating"}


def _metric_value(row: dict, metric_key: str) -> float | None:
    field, _ = _METRICS[metric_key]
    v = row.get(field)
    return None if v is None else float(v)


# ── Motor de varredura ──────────────────────────────────────────────────

def _split_groups(
    rows_by_date: dict[date, dict],
    cond_fn,
    metric_key: str,
    lag_days: int,
    min_with: int = MIN_GROUP_SIZE,
) -> tuple[list[float], list[float]] | None:
    """
    Separa os dias em grupo COM a condição e SEM ela, olhando a métrica no
    dia + lag_days (lag_days=0 → mesmo dia; lag_days=1 → dia seguinte).
    Retorna (valores_com, valores_sem) ou None se não há como comparar.

    `min_with` afrouxa só o lado COM a condição, para dia da semana: uma
    quinta-feira ocorre 1x por semana, então exigir 5 quintas significa 5
    semanas de registro. O lado SEM continua em MIN_GROUP_SIZE — é ele que
    dá a base de comparação.
    """
    with_cond: list[float] = []
    without_cond: list[float] = []

    for d, row in rows_by_date.items():
        has = cond_fn(row)
        if has is None:
            continue
        target_row = rows_by_date.get(d + timedelta(days=lag_days))
        if target_row is None:
            continue
        val = _metric_value(target_row, metric_key)
        if val is None:
            continue
        (with_cond if has else without_cond).append(val)

    if len(with_cond) < min_with or len(without_cond) < MIN_GROUP_SIZE:
        return None
    return with_cond, without_cond


def _std_dev(values: list[float]) -> float:
    """Desvio padrão populacional. 0 quando há menos de 2 valores."""
    n = len(values)
    if n < 2:
        return 0.0
    mean = sum(values) / n
    return (sum((v - mean) ** 2 for v in values) / n) ** 0.5


def _effect_size(with_vals: list[float], without_vals: list[float]) -> float:
    """
    Diferença entre as médias em unidades de desvio padrão combinado (Cohen's
    d). Responde "a diferença entre os grupos é grande perto da variação
    natural do usuário?" — sem isso, uma diferença de 20% num usuário cujos
    dias variam de 0 a 8 tarefas seria reportada como padrão.

    Quando os dois grupos são constantes (desvio 0) mas com médias
    diferentes, a separação é perfeita: devolve infinito.
    """
    sd_with = _std_dev(with_vals)
    sd_without = _std_dev(without_vals)
    pooled = ((sd_with ** 2 + sd_without ** 2) / 2) ** 0.5
    diff = abs((sum(with_vals) / len(with_vals)) - (sum(without_vals) / len(without_vals)))
    if pooled == 0:
        return float("inf") if diff > 0 else 0.0
    return diff / pooled


def find_correlations(rows: list[dict]) -> list[dict]:
    """
    Varre todo par (condição × métrica × mesmo-dia/dia-seguinte) nos dados
    já agregados por insights_service.aggregate_daily (que usa chaves em
    pt-BR: 'data', 'tarefas_concluidas', 'produtividade_percebida_1a5', etc.)
    e retorna as descobertas estatisticamente confiáveis, ranqueadas pela
    magnitude da diferença. Pura — sem I/O — testável isoladamente.

    Três filtros em série, do mais barato ao mais caro: tamanho de amostra
    (_split_groups) → magnitude mínima → tamanho de efeito. Só o que passa
    nos três chega ao usuário.
    """
    rows_by_date: dict[date, dict] = {}
    for r in rows:
        try:
            d = date.fromisoformat(r["data"])
        except (KeyError, ValueError, TypeError):
            continue
        rows_by_date[d] = r

    if len(rows_by_date) < MIN_GROUP_SIZE * 2:
        return []

    conditions = (
        _base_conditions()
        + _weekday_conditions()
        + _dynamic_tag_conditions(rows)
    )

    findings = []
    for cond_key, cond_label in conditions:
        cond_fn = _CONDITION_FNS[cond_key]
        is_weekday = cond_key.startswith("weekday:")
        min_with = MIN_WEEKDAY_OCCURRENCES if is_weekday else MIN_GROUP_SIZE

        for metric_key, (_, metric_label) in _METRICS.items():
            for lag_days, lag_label in ((0, "no mesmo dia"), (1, "no dia seguinte")):
                # "Toda quinta → efeito na sexta" é o mesmo que "toda sexta":
                # a defasagem só confunde a leitura, sem trazer informação nova.
                if is_weekday and lag_days != 0:
                    continue

                split = _split_groups(
                    rows_by_date, cond_fn, metric_key, lag_days, min_with
                )
                if not split:
                    continue
                with_vals, without_vals = split

                avg_with = sum(with_vals) / len(with_vals)
                avg_without = sum(without_vals) / len(without_vals)

                if metric_key in _RATING_METRICS:
                    diff_abs = avg_with - avg_without
                    if abs(diff_abs) < MIN_DIFF_RATING:
                        continue
                    diff_pct = None
                else:
                    if avg_without == 0:
                        continue
                    diff_pct = (avg_with - avg_without) / avg_without
                    if abs(diff_pct) < MIN_DIFF_RATIO:
                        continue
                    diff_abs = avg_with - avg_without

                # Filtro de ruído: a diferença precisa ser grande perto da
                # variação natural dos próprios dias do usuário. Dia da
                # semana usa uma barra bem mais alta (ver constante).
                effect = _effect_size(with_vals, without_vals)
                min_effect = (
                    MIN_EFFECT_SIZE_WEEKDAY if is_weekday else MIN_EFFECT_SIZE
                )
                if effect < min_effect:
                    continue

                findings.append({
                    "condition": cond_label,
                    "metric": metric_label,
                    "lag": lag_label,
                    "same_day": lag_days == 0,
                    "is_weekday": is_weekday,
                    "group_with_n": len(with_vals),
                    "group_without_n": len(without_vals),
                    "avg_with": round(avg_with, 2),
                    "avg_without": round(avg_without, 2),
                    "diff_abs": round(diff_abs, 2),
                    "diff_pct": round(diff_pct * 100, 1) if diff_pct is not None else None,
                    "effect_size": round(effect, 2) if effect != float("inf") else None,
                    # Ranking = magnitude × confiança. Uma diferença enorme com
                    # 3 dias não deve vencer uma diferença sólida com 20 dias.
                    "_rank": (
                        (abs(diff_pct) if diff_pct is not None else abs(diff_abs) / 5)
                        * min(1.0, (len(with_vals) + len(without_vals)) / 20)
                    ),
                })

    findings.sort(key=lambda f: f["_rank"], reverse=True)
    for f in findings:
        f.pop("_rank", None)
    return findings[:MAX_FINDINGS]


# ── Tradução para linguagem natural (Claude só escreve, não calcula) ────────

_WRITER_SYSTEM_PROMPT = """Você é o Axon, assistente pessoal de produtividade. Você recebe uma lista de \
descobertas estatísticas JÁ CALCULADAS (o backend fez a matemática) comparando dias em que o usuário \
teve uma condição (ex.: dormiu pouco) contra dias em que não teve, medindo o efeito numa métrica de \
resultado (ex.: tarefas concluídas), no mesmo dia ou no dia seguinte.

Você tem DUAS tarefas, nesta ordem:

1) CURADORIA — escolher quais descobertas merecem ir para o usuário. Todas já são estatisticamente \
válidas, então NÃO julgue se são verdadeiras: julgue se são ÚTEIS. Descarte uma descoberta quando:
   - for redundante com outra já escolhida (ex.: "dormiu menos de 6h" e "dormiu menos de 7h" \
     apontando o mesmo efeito — mantenha só a mais forte);
   - for óbvia a ponto de não ensinar nada (ex.: "nos dias de humor baixo seu humor é menor");
   - não sugerir nada que o usuário possa fazer diferente.
   Prefira as que revelam algo inesperado, as que ligam um hábito a um resultado no DIA SEGUINTE, e \
   as que envolvem coisas sob controle do usuário (horário de dormir, exercício, como ele marcou o dia).

2) ESCRITA — transformar as escolhidas em frases naturais, em primeira pessoa do Axon falando com o \
usuário. Regras estritas:
- NUNCA invente, arredonde de forma enganosa ou altere os números fornecidos. Use exatamente os valores \
  dados (diff_pct ou diff_abs, avg_with, avg_without).
- NUNCA adicione uma causa que não esteja nos dados (ex.: não diga "porque você está estressado" se \
  isso não veio na descoberta). Os dados mostram que duas coisas andam juntas, não que uma causa a outra.
- Português do Brasil, tom de parceiro próximo, sem jargão estatístico (não diga "grupo", "amostra", \
  "n=", "correlação", "desvio" — fale em "dias em que você...").
- "lag"="no dia seguinte" significa que a condição foi num dia e o efeito apareceu no dia seguinte — \
  deixe isso claro na frase (ex.: "quando você ... num dia, no dia seguinte ...").
- Se "is_weekday" for true, a descoberta é sobre um dia da semana recorrente — escreva como padrão \
  ("nas suas quintas...").
- Quando "group_with_n" for pequeno (menos de 6), use linguagem mais cautelosa ("parece que", \
  "os primeiros dados sugerem") — sem citar o número de dias.
- Cada item tem um "title" curto (até ~60 caracteres) e um "detail" de 1 frase com o número real.

Devolva no MÁXIMO 4 descobertas, da mais para a menos relevante. É melhor devolver 2 excelentes do que \
4 medianas. Inclua em cada item o campo "source_index" com o índice (0-based) da descoberta original \
que você usou, para eu recuperar os números certos.

Responda APENAS com JSON válido, sem texto fora dele, neste formato:
[{"source_index": 0, "title": "...", "detail": "..."}]"""

# Teto de descobertas exibidas ao usuário após a curadoria.
MAX_CURATED = 4


def _findings_to_user_message(findings: list[dict]) -> str:
    indexed = [{"index": i, **f} for i, f in enumerate(findings)]
    return (
        f"Aqui estão {len(findings)} descobertas estatísticas reais (já validadas pelo backend; não "
        "altere os números) sobre os hábitos do usuário, ordenadas da mais forte para a mais fraca. "
        "Faça a curadoria e escreva as escolhidas.\n\n"
        + json.dumps(indexed, ensure_ascii=False, indent=2)
    )


def _parse_written_findings(text: str) -> list[dict]:
    if not text:
        return []
    cleaned = text.strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("```", 2)
        cleaned = parts[1] if len(parts) > 1 else text
        if cleaned.lstrip().startswith("json"):
            cleaned = cleaned.lstrip()[4:]
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
    out = []
    for item in data:
        if not isinstance(item, dict):
            continue
        title = (item.get("title") or "").strip()
        detail = (item.get("detail") or "").strip()
        if not (title and detail):
            continue
        idx = item.get("source_index")
        out.append({
            "title": title,
            "detail": detail,
            # None quando o modelo omitiu o índice — write_findings decide o
            # que fazer (cai na ordem original).
            "source_index": idx if isinstance(idx, int) else None,
        })
    return out


def write_findings(findings: list[dict]) -> list[dict]:
    """
    Faz a curadoria e a escrita das descobertas já calculadas por
    find_correlations, via Claude. O modelo escolhe quais mostrar e redige as
    frases; os NÚMEROS vêm sempre do dicionário original — o texto gerado
    nunca substitui um valor.

    O casamento texto→números usa `source_index` (o índice que o modelo
    declara ter usado), não a posição na resposta: numa curadoria o modelo
    devolve um subconjunto fora de ordem, e casar por posição colaria a frase
    de uma descoberta nos números de outra. Índice ausente ou inválido faz o
    item ser descartado, porque não há como garantir a correspondência.
    """
    if not findings:
        return []

    text = claude_service.call_chat(
        messages=[{"role": "user", "content": _findings_to_user_message(findings)}],
        system_prompt=_WRITER_SYSTEM_PROMPT,
    )
    written = _parse_written_findings(text)

    # Fallback: modelo ignorou o source_index em todos os itens. Mantém o
    # comportamento antigo (ordem) em vez de devolver nada ao usuário.
    if written and all(w.get("source_index") is None for w in written):
        return [
            {**{k: v for k, v in w.items() if k != "source_index"}, **findings[i]}
            for i, w in enumerate(written)
            if i < len(findings)
        ][:MAX_CURATED]

    out = []
    used: set[int] = set()
    for w in written:
        idx = w.get("source_index")
        if idx is None or not (0 <= idx < len(findings)) or idx in used:
            continue
        used.add(idx)
        out.append({
            **{k: v for k, v in w.items() if k != "source_index"},
            **findings[idx],
        })
        if len(out) >= MAX_CURATED:
            break
    return out
