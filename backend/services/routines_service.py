"""
Lógica de CRUD de rotinas (tabelas `routines` e `routine_items`) isolada do
router HTTP, seguindo o mesmo padrão de tasks_service.

Todas as funções recebem o `user_id` explicitamente e garantem a posse das
linhas (`.eq("user_id", …)`), pois o cliente Supabase usa service_role e
bypassa RLS — o backend é a fronteira de segurança.

Erros de validação/posse levantam ValueError com mensagem amigável; o router
converte para HTTPException.

Esta fase (2) cobre só o CRUD. A geração de tarefas concretas no calendário a
partir dos items (horário fixo + slot flexível escolhido pelo Axon + detecção
de conflito) é a Fase 3.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from database import supabase
from services import calendar_sync, chronotype, calibration_service

# Quantos dias para trás olhamos ao calcular o streak.
_STREAK_LOOKBACK_DAYS = 90

# Horizonte de geração ao criar/renovar uma rotina (dias à frente).
GENERATION_HORIZON_DAYS = 60

# Cronotipo salvo no perfil (PT ou chave em inglês) -> chave das curvas/blocos.
_CURVE_KEY = {
    "Matutino": "morning", "Vespertino": "evening", "Noturno": "night",
    "Misto": "intermediate", "Bimodal": "bimodal",
    "morning": "morning", "evening": "evening", "night": "night",
    "intermediate": "intermediate", "bimodal": "bimodal",
}

# Minutos em um dia — limite para um slot caber sem cruzar a meia-noite.
_DAY_MINUTES = 24 * 60

_ROUTINE_DATE_FIELDS = ("start_date", "end_date", "paused_until", "generated_until")
_ITEM_TIME_FIELDS = ("start_time", "end_time")


def _serialize_routine(row: dict) -> dict:
    for field in _ROUTINE_DATE_FIELDS:
        if row.get(field) is not None:
            row[field] = str(row[field])
    return row


def _serialize_item(row: dict) -> dict:
    # Postgres devolve `time` como "HH:MM:SS"; o front usa "HH:MM".
    for field in _ITEM_TIME_FIELDS:
        if row.get(field) is not None:
            row[field] = str(row[field])[:5]
    row["days_of_week"] = row.get("days_of_week") or []
    return row


# --- Posse ---------------------------------------------------------------

def _get_owned_routine(user_id: str, routine_id: str) -> dict:
    res = (
        supabase.table("routines")
        .select("*")
        .eq("id", routine_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        raise ValueError("Rotina não encontrada")
    return res.data[0]


def _get_items(routine_id: str) -> list[dict]:
    res = (
        supabase.table("routine_items")
        .select("*")
        .eq("routine_id", routine_id)
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


# --- Streak --------------------------------------------------------------

def _compute_streak(user_id: str, items: list[dict], today: date) -> int:
    """
    Dias consecutivos encerrados ontem em que TODAS as tarefas geradas pela
    rotina naquele dia foram concluídas (status='done').

    - Usa as tasks realmente materializadas no banco — não os days_of_week dos
      itens. Isso torna dias pausados automaticamente neutros (sem tasks = pula).
    - Conta de ontem para trás; hoje não entra (o usuário ainda pode concluir).
    - Dia sem nenhuma task gerada é neutro: não conta nem quebra.
    - Primeiro dia com task não concluída encerra a contagem.
    """
    if not items:
        return 0

    item_ids = [it["id"] for it in items]
    yesterday = today - timedelta(days=1)
    lookback_start = today - timedelta(days=_STREAK_LOOKBACK_DAYS)

    res = (
        supabase.table("tasks")
        .select("scheduled_date, status")
        .eq("user_id", user_id)
        .in_("routine_item_id", item_ids)
        .gte("scheduled_date", str(lookback_start))
        .lte("scheduled_date", str(yesterday))
        .execute()
    )

    # date_str -> [status, ...]
    by_date: dict[str, list[str]] = defaultdict(list)
    for t in res.data or []:
        by_date[str(t["scheduled_date"])].append(t["status"])

    return _streak_from_by_date(by_date, today)


def _streak_from_by_date(by_date: dict[str, list[str]], today: date) -> int:
    """
    Parte pura do streak: percorre de ontem para trás sobre um mapa
    data -> status já carregado. Separada de _compute_streak para que quem
    busca várias rotinas de uma vez (list_routines) reaproveite a lógica sem
    uma consulta por rotina.
    """
    yesterday = today - timedelta(days=1)
    lookback_start = today - timedelta(days=_STREAK_LOOKBACK_DAYS)

    streak = 0
    day = yesterday
    while day >= lookback_start:
        day_statuses = by_date.get(str(day))
        if not day_statuses:
            day -= timedelta(days=1)
            continue  # sem tasks nesse dia (pausa ou item não previsto) → neutro

        if all(s == "done" for s in day_statuses):
            streak += 1
        else:
            break  # dia incompleto encerra a sequência

        day -= timedelta(days=1)

    return streak


# --- Consistência de rotinas (Dashboard / relatórios) ---------------------

def consistency_for_range(user_id: str, start: date, end: date) -> list[dict]:
    """
    Para cada rotina ativa, a consistência no intervalo [start, end]
    (inclusive): quantos dias tiveram tarefas geradas e quantos desses dias
    foram totalmente concluídos.

    Mesma fonte que o streak — tasks materializadas por routine_item_id, não
    os days_of_week dos items — para refletir o que de fato foi gerado (dias
    pausados não geram tasks e ficam de fora naturalmente).

    Rotinas sem nenhuma task gerada no intervalo são omitidas do retorno.
    """
    routines = (
        supabase.table("routines")
        .select("id, name")
        .eq("user_id", user_id)
        .eq("status", "active")
        .execute()
    ).data or []

    if not routines:
        return []

    routine_ids = [r["id"] for r in routines]

    # Três consultas no total, independente do número de rotinas. Antes eram
    # 2 por rotina (itens + tarefas) — com 4 rotinas, 9 idas ao banco de ~105ms
    # cada. O trabalho de agrupar é trivial em memória e não vale uma viagem
    # de rede por rotina.
    items = (
        supabase.table("routine_items")
        .select("id, routine_id")
        .in_("routine_id", routine_ids)
        .execute()
    ).data or []

    if not items:
        return []

    routine_by_item: dict[str, str] = {it["id"]: it["routine_id"] for it in items}

    tasks = (
        supabase.table("tasks")
        .select("scheduled_date, status, routine_item_id")
        .eq("user_id", user_id)
        .in_("routine_item_id", list(routine_by_item.keys()))
        .gte("scheduled_date", str(start))
        .lte("scheduled_date", str(end))
        .execute()
    ).data or []

    # rotina -> data -> [status...]
    by_routine: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for t in tasks:
        rid = routine_by_item.get(t.get("routine_item_id"))
        if rid is None:
            continue
        by_routine[rid][str(t["scheduled_date"])].append(t["status"])

    out = []
    for r in routines:
        by_date = by_routine.get(r["id"])
        if not by_date:
            continue  # nenhuma task gerada no intervalo: omite a rotina

        days_total = len(by_date)
        days_done = sum(1 for statuses in by_date.values() if all(s == "done" for s in statuses))

        out.append({
            "routine_id": r["id"],
            "name": r["name"],
            "days_done": days_done,
            "days_total": days_total,
            "percent": round(days_done / days_total * 100),
        })

    return out


def weekly_consistency(user_id: str, today: date) -> list[dict]:
    """Consistência da semana atual (segunda a `today`, limitado aos dias já decorridos)."""
    week_start = today - timedelta(days=today.weekday())  # segunda-feira
    return consistency_for_range(user_id, week_start, today)


# --- Exclusão de tarefas futuras geradas ---------------------------------

def _delete_future_tasks(user_id: str, item_ids: list[str], today: date) -> None:
    """
    Remove apenas as tarefas geradas a partir dos items informados que ainda
    estão no futuro (scheduled_date >= hoje) e não foram concluídas
    (status != 'done'). Tarefas passadas/concluídas ficam intactas.

    Espelha cada exclusão no Google Agenda (best-effort, em background).
    """
    if not item_ids:
        return

    res = (
        supabase.table("tasks")
        .select("*")
        .eq("user_id", user_id)
        .in_("routine_item_id", item_ids)
        .gte("scheduled_date", str(today))
        .neq("status", "done")
        .execute()
    )
    rows = res.data or []
    if not rows:
        return

    ids = [r["id"] for r in rows]
    supabase.table("tasks").delete().eq("user_id", user_id).in_("id", ids).execute()

    for task in rows:
        calendar_sync.sync_task_async(user_id, task, "delete")


# --- Geração de tarefas (Fase 3) -----------------------------------------
#
# Itens de horário fixo viram tarefas no horário definido. Itens flexíveis
# (só duração) têm o slot escolhido pelo Axon a partir dos blocos de energia
# do cronotipo, evitando conflito com tudo que já está no dia — inclusive as
# tarefas geradas pelos outros itens da mesma rotina no mesmo lote.

def _to_min(t: str) -> int:
    """'HH:MM' ou 'HH:MM:SS' -> minutos desde 00:00."""
    h, m = t[:5].split(":")
    return int(h) * 60 + int(m)


def _min_to_hhmm(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _overlap(s1: int, e1: int, s2: int, e2: int) -> bool:
    """Dois intervalos [s1,e1) e [s2,e2) se sobrepõem?"""
    return s1 < e2 and s2 < e1


def _block_energy(level: str) -> int:
    # .get com fallback: os dados de CHRONOTYPE_BLOCKS têm alguns níveis com
    # typo (ex.: 'Recuperacao') que não existem em BLOCK_LEVELS.
    return chronotype.BLOCK_LEVELS.get(level, {}).get("energy", 0)


def _user_curve(user_id: str) -> tuple[str, str]:
    """
    Retorna (curve_key, chronotype) do usuário.
    curve_key: chave interna das curvas ("morning", "evening", …)
    chronotype: label do cronotipo ("Matutino", "Vespertino", …)
    """
    try:
        res = (
            supabase.table("profiles")
            .select("chronotype")
            .eq("id", user_id)
            .single()
            .execute()
        )
        ct = (res.data or {}).get("chronotype") or "Misto"
    except Exception:
        ct = "Misto"
    return _CURVE_KEY.get(ct, "intermediate"), ct


def _free_slot(
    curve_key: str,
    duration_minutes: int,
    busy: list[tuple[int, int]],
    not_before_min: int | None = None,
    not_after_min: int | None = None,
    personal_scores: list[float] | None = None,
    floor_min: int | None = None,
    allowed_levels: tuple[str, ...] | None = None,
) -> tuple[str, str] | None:
    """
    Melhor slot livre de `duration_minutes` no dia, respeitando opcionalmente
    uma janela [not_before_min, not_after_min).

    `floor_min` é o minuto mais cedo aceitável — usado para o dia de HOJE, onde
    agendar num horário que já passou não faz sentido nenhum. Diferente de
    `not_before`, ele não é preferência do usuário: é um limite físico, e por
    isso vale inclusive no fallback do passo 3.

    `allowed_levels` restringe os níveis de bloco aceitáveis pela prioridade da
    tarefa (ver chronotype.allowed_blocks). Só o passo 1 o respeita: os passos
    2-4 são fallbacks para quando NADA cabe, e ali um horário fraco é melhor
    que devolver None e deixar a tarefa sem horário nenhum. Usado pelo "Axon
    decide"; a geração de rotinas não passa isso, porque lá o horário do item
    é escolha do usuário.

    Nota: hoje `allowed_levels` e a janela `not_before/not_after` nunca chegam
    juntos — a janela só existe em routine_items, que não usa a matriz. Se um
    dia usarem, decida qual vence: a janela é preferência do usuário, a matriz
    é regra do Axon.

    Quando `personal_scores` é fornecido (perfil calibrado do usuário), ordena
    os blocos pelo score pessoal em vez do nível fixo do cronotipo.

    Estratégia em quatro passos:
      1. Melhor bloco de energia dentro da janela (respeita allowed_levels).
      2. Qualquer slot livre dentro da janela (sem filtro de energia).
      3. Fallback sem restrição de janela (mas sempre respeitando floor_min).
      4. Varredura minuto a minuto a partir do piso.
    """
    blocks = chronotype.CHRONOTYPE_BLOCKS.get(
        curve_key, chronotype.CHRONOTYPE_BLOCKS["intermediate"]
    )
    if personal_scores and len(personal_scores) == 16:
        ranked = sorted(range(16), key=lambda i: (-personal_scores[i], i))
    else:
        ranked = sorted(range(len(blocks)), key=lambda i: (-_block_energy(blocks[i][0]), i))

    # O piso de "agora" nunca é relaxado; a janela do usuário pode ser.
    lower_bound = floor_min or 0

    def _free(start: int, end: int) -> bool:
        if end > _DAY_MINUTES or start < lower_bound:
            return False
        return not any(_overlap(start, end, bs, be) for bs, be in busy)

    def _fits(start: int, end: int) -> bool:
        if not_before_min is not None and start < not_before_min:
            return False
        if not_after_min is not None and end > not_after_min:
            return False
        return _free(start, end)

    # Passo 1 — melhor bloco de energia dentro da janela
    for i in ranked:
        if allowed_levels is not None and blocks[i][0] not in allowed_levels:
            continue
        start = i * 90
        end = start + duration_minutes
        if _fits(start, end):
            return _min_to_hhmm(start), _min_to_hhmm(end)

    # Passo 2 — qualquer slot livre dentro da janela (minuto a minuto)
    if not_before_min is not None or not_after_min is not None:
        window_start = max(not_before_min or 0, lower_bound)
        window_end = not_after_min or _DAY_MINUTES
        for start in range(window_start, window_end - duration_minutes + 1):
            if _free(start, start + duration_minutes):
                return _min_to_hhmm(start), _min_to_hhmm(start + duration_minutes)

    # Passo 3 — fallback sem restrição de janela nem de matriz. Aqui nada
    # permitido coube: um horário fraco ainda é melhor que nenhum horário.
    for i in ranked:
        start = i * 90
        if _free(start, start + duration_minutes):
            return _min_to_hhmm(start), _min_to_hhmm(start + duration_minutes)

    # Passo 4 — com piso ativo, os blocos de 90min podem estar todos abaixo dele
    # (ex.: rotina criada às 23h). Tenta a partir do próprio piso antes de desistir.
    if floor_min is not None:
        for start in range(lower_bound, _DAY_MINUTES - duration_minutes + 1):
            if _free(start, start + duration_minutes):
                return _min_to_hhmm(start), _min_to_hhmm(start + duration_minutes)

    return None


def _busy_intervals(user_id: str, day: date) -> list[tuple[int, int]]:
    res = (
        supabase.table("tasks")
        .select("start_time, end_time")
        .eq("user_id", user_id)
        .eq("scheduled_date", str(day))
        .execute()
    )
    out = []
    for t in res.data or []:
        s, e = t.get("start_time"), t.get("end_time")
        if s and e:
            out.append((_to_min(s), _to_min(e)))
    return out


def pick_best_slot(
    user_id: str, day: date, duration_minutes: int, now: datetime | None = None,
    priority: str | None = None, is_key_task: bool = False,
) -> tuple[str, str] | None:
    """
    Melhor horário para uma tarefa flexível de `duration_minutes` em `day`.
    Usa o perfil personalizado quando calibrado (14+ dias); caso contrário,
    usa o cronotipo base.

    Com `now` (instante local do usuário), o slot escolhido para HOJE nunca cai
    num horário que já passou.

    `priority`/`is_key_task` aplicam a matriz de prioridade: o Axon não coloca
    tarefa chave em bloco fraco. Como aqui é o AXON que escolhe o horário, a
    mesma regra das sugestões vale (ver chronotype.allowed_blocks).
    """
    curve_key, chronotype_label = _user_curve(user_id)
    personal, calibrated, _ = calibration_service.get_block_scores(user_id, chronotype_label)
    floor_min = (
        now.hour * 60 + now.minute if now is not None and now.date() == day else None
    )
    return _free_slot(
        curve_key,
        duration_minutes,
        _busy_intervals(user_id, day),
        personal_scores=personal if calibrated else None,
        floor_min=floor_min,
        allowed_levels=chronotype.allowed_blocks(priority, is_key_task),
    )


def _materialize(
    user_id: str,
    items: list[dict],
    from_date: date,
    until_date: date,
    *,
    curve_key: str,
    personal_scores: list[float] | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """
    Cria as tarefas concretas dos `items` no intervalo [from_date, until_date]
    e as insere em lote. Não atualiza generated_until (quem chama decide).

    `now` é o instante local do usuário e existe para uma regra só: o Axon não
    pode agendar nada num horário que já passou. Uma rotina criada às 14h com
    item das 06h gerava a tarefa de hoje às 06h — passada há 8 horas. Com `now`
    definido, no dia de hoje os itens fixos cuja janela já terminou são pulados
    e os flexíveis só recebem slots a partir de agora. Os demais dias do
    intervalo não são afetados.
    """
    if not items or from_date > until_date:
        return []

    today_str = str(now.date()) if now else None
    now_min = (now.hour * 60 + now.minute) if now else 0

    # Pré-carrega os horários já ocupados em todo o intervalo, agrupados por dia.
    existing = (
        supabase.table("tasks")
        .select("scheduled_date, start_time, end_time")
        .eq("user_id", user_id)
        .gte("scheduled_date", str(from_date))
        .lte("scheduled_date", str(until_date))
        .execute()
    )
    busy_by_date: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for t in existing.data or []:
        s, e = t.get("start_time"), t.get("end_time")
        if s and e:
            busy_by_date[str(t["scheduled_date"])].append((_to_min(s), _to_min(e)))

    # Fixos primeiro: garante que os flexíveis enxergam e evitam os horários fixos.
    ordered = sorted(items, key=lambda it: 0 if it.get("start_time") else 1)

    new_tasks: list[dict] = []
    day = from_date
    while day <= until_date:
        weekday = day.weekday()  # 0=Seg … 6=Dom
        dstr = str(day)
        # Só o dia de hoje tem passado; ontem já não é gerado e amanhã é todo futuro.
        floor_min = now_min if dstr == today_str else None

        for it in ordered:
            if weekday not in (it.get("days_of_week") or []):
                continue

            # Rotina sempre materializa como "task" no calendário — seja o
            # item de horário fixo ou flexível (o Axon só decide o slot).
            if it.get("start_time"):
                start_s = str(it["start_time"])[:5]
                end_s = str(it["end_time"])[:5]
                # Item fixo não pode ser remanejado (o horário É a rotina), então
                # a única saída é não gerar hoje. Usa o FIM da janela: uma tarefa
                # das 14h às 15h criada às 14h30 ainda é aproveitável.
                if floor_min is not None and _to_min(end_s) <= floor_min:
                    continue
            else:
                nb = it.get("not_before")
                na = it.get("not_after")
                nb_min = _to_min(str(nb)[:5]) if nb else None
                na_min = _to_min(str(na)[:5]) if na else None
                slot = _free_slot(
                    curve_key, it["duration_minutes"], busy_by_date[dstr],
                    not_before_min=nb_min, not_after_min=na_min,
                    personal_scores=personal_scores,
                    floor_min=floor_min,
                )
                if slot is None:
                    continue  # dia sem janela livre para esse item — pula
                start_s, end_s = slot
            task_type = "task"

            busy_by_date[dstr].append((_to_min(start_s), _to_min(end_s)))
            new_tasks.append({
                "user_id": user_id,
                "title": it["title"],
                "task_type": task_type,
                "status": "todo",
                "priority": "medium",
                "scheduled_date": dstr,
                "start_time": start_s,
                "end_time": end_s,
                "routine_item_id": it["id"],
                "created_by": "agent",
            })
        day += timedelta(days=1)

    if new_tasks:
        supabase.table("tasks").insert(new_tasks).execute()
    return new_tasks


def generate_tasks_for_routine(
    routine_id: str, user_id: str, from_date: date, until_date: date,
    now: datetime | None = None,
) -> list[dict]:
    """
    Gera as tarefas de TODOS os itens da rotina no intervalo e avança
    generated_until para until_date. Usada na criação e na renovação (Fase 5).

    `now` (instante local do usuário) impede que o dia de hoje receba tarefas
    em horários já passados — ver _materialize.
    """
    _get_owned_routine(user_id, routine_id)
    items = _get_items(routine_id)

    curve_key, chronotype_label = _user_curve(user_id)
    personal, calibrated, _ = calibration_service.get_block_scores(user_id, chronotype_label)

    created = _materialize(
        user_id, items, from_date, until_date,
        curve_key=curve_key,
        personal_scores=personal if calibrated else None,
        now=now,
    )

    supabase.table("routines").update(
        {"generated_until": str(until_date)}
    ).eq("id", routine_id).eq("user_id", user_id).execute()

    return created


# --- Renovação automática (Fase 5) ---------------------------------------

def renew_routines(user_id: str, today: date, now: datetime | None = None) -> int:
    """
    Renova automaticamente as rotinas ativas cujo horizonte de geração vence em
    menos de 30 dias. Chamado silenciosamente em list_routines (verificação lazy).

    Para cada rotina elegível:
    - Gera de generated_until+1 até hoje+60.
    - Respeita end_date: não gera além dela; pula se already past.

    Retorna o número de rotinas renovadas.
    """
    threshold = today + timedelta(days=30)

    res = (
        supabase.table("routines")
        .select("id, end_date, generated_until")
        .eq("user_id", user_id)
        .eq("status", "active")
        .lt("generated_until", str(threshold))
        .execute()
    )

    renewed = 0
    for r in res.data or []:
        from_date = date.fromisoformat(str(r["generated_until"])) + timedelta(days=1)
        until_date = today + timedelta(days=GENERATION_HORIZON_DAYS)

        if r.get("end_date"):
            end = date.fromisoformat(str(r["end_date"]))
            if from_date > end:
                continue  # rotina já passou do fim, nada a gerar
            until_date = min(until_date, end)

        if from_date <= until_date:
            generate_tasks_for_routine(r["id"], user_id, from_date, until_date, now=now)
            renewed += 1

    return renewed


# --- CRUD rotinas --------------------------------------------------------

def list_routines(user_id: str, today: date, now: datetime | None = None) -> list[dict]:
    renew_routines(user_id, today, now=now)  # renovação lazy ao abrir o app
    routines = (
        supabase.table("routines")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    ).data or []

    if not routines:
        return []

    # Duas consultas no total (itens + tarefas), não duas POR rotina: com 4
    # rotinas eram 9 idas ao banco de ~105ms cada só para montar esta lista.
    routine_ids = [r["id"] for r in routines]

    items = (
        supabase.table("routine_items")
        .select("id, routine_id")
        .in_("routine_id", routine_ids)
        .execute()
    ).data or []

    items_by_routine: dict[str, list[dict]] = defaultdict(list)
    routine_by_item: dict[str, str] = {}
    for it in items:
        items_by_routine[it["routine_id"]].append(it)
        routine_by_item[it["id"]] = it["routine_id"]

    # Tarefas da janela do streak para TODAS as rotinas de uma vez.
    tasks_by_routine: dict[str, dict[str, list[str]]] = defaultdict(
        lambda: defaultdict(list)
    )
    if routine_by_item:
        yesterday = today - timedelta(days=1)
        lookback_start = today - timedelta(days=_STREAK_LOOKBACK_DAYS)
        tasks = (
            supabase.table("tasks")
            .select("scheduled_date, status, routine_item_id")
            .eq("user_id", user_id)
            .in_("routine_item_id", list(routine_by_item.keys()))
            .gte("scheduled_date", str(lookback_start))
            .lte("scheduled_date", str(yesterday))
            .execute()
        ).data or []
        for t in tasks:
            rid = routine_by_item.get(t.get("routine_item_id"))
            if rid is None:
                continue
            tasks_by_routine[rid][str(t["scheduled_date"])].append(t["status"])

    out = []
    for r in routines:
        rid = r["id"]
        routine_items = items_by_routine.get(rid, [])
        r = _serialize_routine(r)
        r["item_count"] = len(routine_items)
        r["streak"] = (
            _streak_from_by_date(tasks_by_routine.get(rid, {}), today)
            if routine_items
            else 0
        )
        out.append(r)
    return out


def get_routine(user_id: str, routine_id: str, today: date) -> dict:
    routine = _serialize_routine(_get_owned_routine(user_id, routine_id))
    items = _get_items(routine_id)
    routine["streak"] = _compute_streak(user_id, items, today)
    routine["items"] = [_serialize_item(it) for it in items]
    return routine


def create_routine(user_id: str, data: dict, today: date, now: datetime | None = None) -> dict:
    start = data.get("start_date") or today
    payload = {
        "user_id": user_id,
        "name": data["name"],
        "start_date": str(start),
        "end_date": str(data["end_date"]) if data.get("end_date") else None,
        # Nada gerado ainda (Fase 3): generated_until no dia anterior ao início
        # indica que nenhum dia foi materializado no calendário.
        "generated_until": str(start - timedelta(days=1)),
    }
    res = supabase.table("routines").insert(payload).execute()
    if not res.data:
        raise ValueError("Erro ao criar rotina")

    routine_id = res.data[0]["id"]

    # Cria os itens inline (se houver) em lote.
    items_in = data.get("items") or []
    if items_in:
        rows = [{
            "user_id": user_id,
            "routine_id": routine_id,
            "title": it["title"],
            "days_of_week": it["days_of_week"],
            "start_time": it.get("start_time"),
            "end_time": it.get("end_time"),
            "duration_minutes": it.get("duration_minutes"),
            "not_before": it.get("not_before"),
            "not_after": it.get("not_after"),
        } for it in items_in]
        supabase.table("routine_items").insert(rows).execute()

        # Gera as tarefas dos próximos GENERATION_HORIZON_DAYS dias, a partir de
        # hoje ou do início (o que vier depois). Atualiza generated_until.
        gen_from = max(start, today)
        gen_until = gen_from + timedelta(days=GENERATION_HORIZON_DAYS)
        generate_tasks_for_routine(routine_id, user_id, gen_from, gen_until, now=now)

    return get_routine(user_id, routine_id, today)


def update_routine(user_id: str, routine_id: str, data: dict, today: date) -> dict:
    _get_owned_routine(user_id, routine_id)

    payload: dict = {}
    if "name" in data:
        payload["name"] = data["name"]
    if "end_date" in data:
        payload["end_date"] = str(data["end_date"]) if data["end_date"] else None
    if "status" in data:
        payload["status"] = data["status"]

    if not payload:
        raise ValueError("Nenhum campo para atualizar")

    res = (
        supabase.table("routines")
        .update(payload)
        .eq("id", routine_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        raise ValueError("Erro ao atualizar rotina")

    return get_routine(user_id, routine_id, today)


def delete_routine(user_id: str, routine_id: str, today: date) -> None:
    _get_owned_routine(user_id, routine_id)

    items = _get_items(routine_id)
    item_ids = [it["id"] for it in items]
    _delete_future_tasks(user_id, item_ids, today)

    # Cascade em routine_items; tasks.routine_item_id é ON DELETE SET NULL,
    # então as tarefas passadas/concluídas permanecem no calendário sem vínculo.
    supabase.table("routines").delete().eq("id", routine_id).eq("user_id", user_id).execute()


# --- Pausa / Retomada (Fase 4) -------------------------------------------

def pause_routine(
    user_id: str, routine_id: str, paused_until: date | None, today: date
) -> dict:
    routine = _get_owned_routine(user_id, routine_id)
    if routine["status"] == "paused":
        raise ValueError("Rotina já está pausada")

    items = _get_items(routine_id)
    _delete_future_tasks(user_id, [it["id"] for it in items], today)

    supabase.table("routines").update({
        "status": "paused",
        "paused_until": str(paused_until) if paused_until else None,
        # Retrocede generated_until para que o resume saiba que precisa gerar
        # a partir de hoje (sem lacunas nem sobreposição).
        "generated_until": str(today - timedelta(days=1)),
    }).eq("id", routine_id).eq("user_id", user_id).execute()

    return get_routine(user_id, routine_id, today)


def resume_routine(user_id: str, routine_id: str, today: date, now: datetime | None = None) -> dict:
    routine = _get_owned_routine(user_id, routine_id)
    if routine["status"] == "active":
        raise ValueError("Rotina já está ativa")

    # Limpa a pausa e gera as tarefas dos próximos 60 dias.
    supabase.table("routines").update({
        "status": "active",
        "paused_until": None,
    }).eq("id", routine_id).eq("user_id", user_id).execute()

    gen_until = today + timedelta(days=GENERATION_HORIZON_DAYS)
    generate_tasks_for_routine(routine_id, user_id, today, gen_until, now=now)

    return get_routine(user_id, routine_id, today)


# --- CRUD items ----------------------------------------------------------

def add_item(user_id: str, routine_id: str, data: dict, today: date,
             now: datetime | None = None) -> dict:
    routine = _get_owned_routine(user_id, routine_id)

    payload = {
        "user_id": user_id,
        "routine_id": routine_id,
        "title": data["title"],
        "days_of_week": data["days_of_week"],
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "duration_minutes": data.get("duration_minutes"),
        "not_before": data.get("not_before"),
        "not_after": data.get("not_after"),
    }
    res = supabase.table("routine_items").insert(payload).execute()
    if not res.data:
        raise ValueError("Erro ao adicionar item")

    item = res.data[0]

    # Gera as tarefas do novo item de hoje até onde a rotina já está gerada.
    gen_until = date.fromisoformat(str(routine["generated_until"]))
    if gen_until >= today:
        ck, ct = _user_curve(user_id)
        ps, cal, _ = calibration_service.get_block_scores(user_id, ct)
        _materialize(user_id, [item], today, gen_until, curve_key=ck,
                     personal_scores=ps if cal else None, now=now)

    return _serialize_item(item)


def update_item(user_id: str, routine_id: str, item_id: str, data: dict, today: date,
                now: datetime | None = None) -> dict:
    routine = _get_owned_routine(user_id, routine_id)

    existing = (
        supabase.table("routine_items")
        .select("id")
        .eq("id", item_id)
        .eq("routine_id", routine_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise ValueError("Item não encontrado")

    payload = {k: v for k, v in data.items() if k in (
        "title", "days_of_week", "start_time", "end_time", "duration_minutes",
        "not_before", "not_after",
    )}
    if not payload:
        raise ValueError("Nenhum campo para atualizar")

    # Ao trocar de modo (fixo↔flexível), zera o lado oposto para evitar
    # inconsistência onde o item fica com start/end E duration no banco.
    if "duration_minutes" in payload and payload["duration_minutes"] is not None:
        payload.setdefault("start_time", None)
        payload.setdefault("end_time", None)
    elif "start_time" in payload or "end_time" in payload:
        payload.setdefault("duration_minutes", None)

    res = (
        supabase.table("routine_items")
        .update(payload)
        .eq("id", item_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        raise ValueError("Erro ao atualizar item")

    item = res.data[0]

    # Editar afeta só o futuro: apaga as tarefas futuras desse item e regera
    # de hoje até generated_until com o item atualizado. Passadas ficam intactas.
    _delete_future_tasks(user_id, [item_id], today)
    gen_until = date.fromisoformat(str(routine["generated_until"]))
    if gen_until >= today:
        ck, ct = _user_curve(user_id)
        ps, cal, _ = calibration_service.get_block_scores(user_id, ct)
        _materialize(user_id, [item], today, gen_until, curve_key=ck,
                     personal_scores=ps if cal else None, now=now)

    return _serialize_item(item)


def delete_item(user_id: str, routine_id: str, item_id: str, today: date) -> None:
    _get_owned_routine(user_id, routine_id)

    existing = (
        supabase.table("routine_items")
        .select("id")
        .eq("id", item_id)
        .eq("routine_id", routine_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not existing.data:
        raise ValueError("Item não encontrado")

    _delete_future_tasks(user_id, [item_id], today)
    supabase.table("routine_items").delete().eq("id", item_id).eq("user_id", user_id).execute()
