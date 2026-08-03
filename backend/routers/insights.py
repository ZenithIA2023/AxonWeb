from datetime import datetime, timedelta, date

from fastapi import APIRouter, Depends, Header, Query
from auth_helper import get_current_user
from database import supabase
from services import user_tz, insights_service
from services.chronotype import CHRONOTYPE_BLOCKS, BLOCK_LEVELS
from services import calibration_service
from services import daily_stats_service
from services import correlations_service

router = APIRouter(prefix="/insights", tags=["insights"])

_WEEKDAY_ABBR = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]
_WEEKDAY_FULL = [
    "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"
]

_PERIOD_DAYS = {"week": 7, "month": 30}


def _local_date(ts: str | None, tz) -> date | None:
    """Converte um timestamptz ISO (UTC) para a data local do usuário."""
    if not ts:
        return None
    try:
        # Suporta sufixo 'Z' e offsets; normaliza para datetime aware.
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return dt.astimezone(tz).date()
    except Exception:
        return None


def build_task_metrics(
    tasks: list[dict], tz, today: date, days: int, snapshots: dict | None = None
) -> dict:
    """
    Agrega tarefas em métricas diárias. Função pura — sem I/O — para testar.

    Para dias PASSADOS usa o snapshot congelado (daily_task_stats) quando
    disponível — sem ele a % daria falso 100%, porque o carry-forward tira as
    pendentes do dia (elas viram scheduled_date de hoje). Só "hoje" e os dias
    sem snapshot são calculados ao vivo:
      - completed: tarefas concluídas naquele dia (por completed_at, preciso)
      - total:     concluídas + ainda pendentes agendadas para aquele dia
      - completion_rate: completed / total * 100
      - carried_forward: tarefas naquele dia que já foram adiadas (carry_count > 0)
    """
    snapshots = snapshots or {}
    now = datetime.now(tz)
    window = [today - timedelta(days=i) for i in range(days - 1, -1, -1)]
    buckets = {
        d: {"completed": 0, "pending": 0, "carried_forward": 0} for d in window
    }
    window_set = set(window)

    for t in tasks:
        status = t.get("status")

        # Eventos: contam como concluídos quando status 'done' OU já passaram do
        # horário de término (mesma regra do Planning/daily_stats_service), no
        # dia em que estão agendados. Sem esse ramo, um evento que aconteceu mas
        # nunca virou 'done' caía como "pendente" e não entrava na % de hoje.
        if t.get("task_type") == "event":
            sched = t.get("scheduled_date")
            if not sched:
                continue
            try:
                sday = date.fromisoformat(sched)
            except (ValueError, TypeError):
                continue
            if sday not in window_set:
                continue
            if daily_stats_service.event_completed(t, now, tz):
                buckets[sday]["completed"] += 1
            else:
                buckets[sday]["pending"] += 1
            if (t.get("carry_count") or 0) > 0:
                buckets[sday]["carried_forward"] += 1
            continue

        # Concluídas: contam no dia em que foram concluídas (completed_at).
        if status == "done":
            cday = _local_date(t.get("completed_at"), tz)
            if cday in window_set:
                buckets[cday]["completed"] += 1
            continue

        # Pendentes: contam no dia para o qual estão agendadas (snapshot atual).
        sched = t.get("scheduled_date")
        if sched:
            try:
                sday = date.fromisoformat(sched)
            except (ValueError, TypeError):
                continue
            if sday in window_set:
                buckets[sday]["pending"] += 1
                if (t.get("carry_count") or 0) > 0:
                    buckets[sday]["carried_forward"] += 1

    days_out = []
    weekday_completed = [0] * 7
    total_completed = 0
    total_carried = 0
    rate_sum = 0
    rate_count = 0

    for d in window:
        snap = snapshots.get(str(d))
        if snap is not None and d < today:
            # Dia passado congelado — fonte da verdade histórica.
            # completed = itens concluídos incluindo eventos que já terminaram
            # (completed_items), igual ao anel de adesão do Planning. Assim a
            # barra roxa e a % batem com o Planning: um evento que aconteceu
            # conta como concluído. (completed_tasks exclui eventos de propósito
            # — é usado só no "dia mais produtivo por esforço", não aqui.)
            completed = snap["completed_items"]
            total     = snap["total"]
            rate      = snap["completion_rate"]
            carried   = snap.get("carried_forward", 0)
        else:
            # Hoje (ou dia sem snapshot) — ao vivo.
            b = buckets[d]
            completed = b["completed"]
            total     = b["completed"] + b["pending"]
            rate      = round(completed / total * 100) if total else 0
            carried   = b["carried_forward"]

        days_out.append({
            "date": str(d),
            "weekday": _WEEKDAY_ABBR[d.weekday()],
            "completed": completed,
            "total": total,
            "completion_rate": rate,
            "carried_forward": carried,
        })
        weekday_completed[d.weekday()] += completed
        total_completed += completed
        total_carried += carried
        if total:
            rate_sum += rate
            rate_count += 1

    best_idx = max(range(7), key=lambda i: weekday_completed[i])
    has_best = weekday_completed[best_idx] > 0
    best_weekday = _WEEKDAY_FULL[best_idx] if has_best else None

    return {
        "days": days_out,
        "summary": {
            "total_completed": total_completed,
            "avg_completion_rate": round(rate_sum / rate_count) if rate_count else 0,
            "best_weekday": best_weekday,
            # Conclusões NO dia mais produtivo (soma das ocorrências daquele dia
            # da semana na janela). É o número correto para a frase do card —
            # antes ela mostrava total_completed (o total do período todo).
            "best_weekday_completed": weekday_completed[best_idx] if has_best else 0,
            "carry_forward_total": total_carried,
        },
    }


@router.get("/tasks")
def get_task_insights(
    period: str = Query(default="week", pattern="^(week|month)$"),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    days = _PERIOD_DAYS[period]
    tz = user_tz.zone(user_tz.resolve(user_id, x_timezone))
    today = datetime.now(tz).date()
    since = str(today - timedelta(days=days - 1))
    since_iso = f"{since}T00:00:00+00:00"

    # Concluídas na janela (por completed_at) + pendentes agendadas na janela.
    # task_type/start_time/end_time/end_date entram para o cálculo ao vivo de
    # eventos (contam como concluídos quando o horário já passou — ver
    # build_task_metrics).
    _cols = (
        "id, status, task_type, scheduled_date, end_date, "
        "start_time, end_time, completed_at, carry_count"
    )
    completed = (
        supabase.table("tasks")
        .select(_cols)
        .eq("user_id", user_id)
        .eq("status", "done")
        .gte("completed_at", since_iso)
        .execute()
    )
    scheduled = (
        supabase.table("tasks")
        .select(_cols)
        .eq("user_id", user_id)
        .neq("status", "done")
        .gte("scheduled_date", since)
        .execute()
    )

    # Une por id (sem sobrepor) — uma tarefa não está nos dois conjuntos.
    merged = {row["id"]: row for row in (completed.data or [])}
    for row in (scheduled.data or []):
        merged.setdefault(row["id"], row)

    # Dias passados vêm dos snapshots congelados (evita falso 100%).
    snapshots = {
        s["date"]: s
        for s in daily_stats_service.get_range(user_id, since, str(today))
    }

    result = build_task_metrics(list(merged.values()), tz, today, days, snapshots)
    result["period"] = period
    return result


@router.get("/patterns")
def get_pattern_insights(
    refresh: bool = Query(default=False),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Insights em linguagem natural gerados pelo Axon a partir dos últimos 30 dias
    de registros diários + tarefas. Cache de 24h por usuário (refresh=true força
    nova geração). Usuários com poucos dados recebem o estado "collecting".
    """
    user_id = current_user["id"]
    tz = user_tz.zone(user_tz.resolve(user_id, x_timezone))
    now = datetime.now(tz)
    today = now.date()
    since = str(today - timedelta(days=insights_service.LOOKBACK_DAYS - 1))
    since_iso = f"{since}T00:00:00+00:00"

    logs = (
        supabase.table("daily_logs")
        .select("*")
        .eq("user_id", user_id)
        .gte("date", since)
        .order("date", desc=False)
        .execute()
    ).data or []

    data_points = len(logs)

    # Estado de coleta: poucos dados para padrões confiáveis.
    if data_points < insights_service.MIN_DATA_POINTS:
        return {
            "status": "collecting",
            "data_points": data_points,
            "days_needed": insights_service.MIN_DATA_POINTS,
            "message": insights_service.collecting_message(data_points),
        }

    # Cache válido? (a menos que refresh forçado)
    cached = (
        supabase.table("axon_insights")
        .select("insights, data_points, generated_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    ).data
    cached_row = cached[0] if cached else None

    if (
        not refresh
        and cached_row
        and insights_service.is_fresh(cached_row.get("generated_at"), now)
    ):
        return {
            "status": "ready",
            "insights": cached_row.get("insights") or [],
            "generated_at": cached_row.get("generated_at"),
            "data_points": cached_row.get("data_points", data_points),
            "cached": True,
        }

    # Gera novos insights.
    tasks = (
        supabase.table("tasks")
        .select("status, completed_at")
        .eq("user_id", user_id)
        .eq("status", "done")
        .gte("completed_at", since_iso)
        .execute()
    ).data or []

    rows = insights_service.aggregate_daily(logs, tasks, tz)
    insights = insights_service.generate_insights(rows)

    # Se a geração falhou (parse vazio), não grava cache ruim — devolve o último
    # cache válido, se houver, senão lista vazia com aviso.
    if not insights:
        if cached_row and cached_row.get("insights"):
            return {
                "status": "ready",
                "insights": cached_row["insights"],
                "generated_at": cached_row.get("generated_at"),
                "data_points": cached_row.get("data_points", data_points),
                "cached": True,
            }
        return {
            "status": "ready",
            "insights": [],
            "generated_at": now.isoformat(),
            "data_points": data_points,
            "message": "Não foi possível gerar insights agora. Tente novamente em instantes.",
        }

    generated_at = now.isoformat()
    supabase.table("axon_insights").upsert(
        {
            "user_id": user_id,
            "insights": insights,
            "data_points": data_points,
            "generated_at": generated_at,
        },
        on_conflict="user_id",
    ).execute()

    return {
        "status": "ready",
        "insights": insights,
        "generated_at": generated_at,
        "data_points": data_points,
        "cached": False,
    }


# Cache mais longo que /patterns: correlação estatística não muda de um dia
# para o outro — só faz sentido recalcular quando dados novos se acumularam.
_DISCOVERIES_CACHE_TTL_HOURS = 24 * 7
_DISCOVERIES_MIN_DATA_POINTS = correlations_service.MIN_GROUP_SIZE * 2


@router.get("/discoveries")
def get_discoveries(
    refresh: bool = Query(default=False),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    "O que você talvez não tenha percebido": correlações reais entre hábitos
    (sono, exercício, humor, tags livres) e resultados (tarefas concluídas,
    produtividade, humor), no mesmo dia e no dia seguinte. O BACKEND calcula
    as diferenças (correlations_service.find_correlations); o Claude só
    traduz os números já corretos em frases — nunca inventa magnitude.
    Cache de 7 dias (refresh=true força recálculo).
    """
    user_id = current_user["id"]
    tz = user_tz.zone(user_tz.resolve(user_id, x_timezone))
    now = datetime.now(tz)
    today = now.date()
    since = str(today - timedelta(days=insights_service.LOOKBACK_DAYS - 1))
    since_iso = f"{since}T00:00:00+00:00"

    logs = (
        supabase.table("daily_logs")
        .select("*")
        .eq("user_id", user_id)
        .gte("date", since)
        .order("date", desc=False)
        .execute()
    ).data or []

    data_points = len(logs)

    if data_points < _DISCOVERIES_MIN_DATA_POINTS:
        return {
            "status": "collecting",
            "data_points": data_points,
            "days_needed": _DISCOVERIES_MIN_DATA_POINTS,
            "message": insights_service.collecting_message(
                data_points, _DISCOVERIES_MIN_DATA_POINTS
            ),
        }

    cached = (
        supabase.table("axon_discoveries")
        .select("findings, data_points, generated_at")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    ).data
    cached_row = cached[0] if cached else None

    if (
        not refresh
        and cached_row
        and insights_service.is_fresh(
            cached_row.get("generated_at"), now, ttl_hours=_DISCOVERIES_CACHE_TTL_HOURS
        )
    ):
        return {
            "status": "ready",
            "findings": cached_row.get("findings") or [],
            "generated_at": cached_row.get("generated_at"),
            "data_points": cached_row.get("data_points", data_points),
            "cached": True,
        }

    tasks = (
        supabase.table("tasks")
        .select("status, completed_at")
        .eq("user_id", user_id)
        .eq("status", "done")
        .gte("completed_at", since_iso)
        .execute()
    ).data or []

    rows = insights_service.aggregate_daily(logs, tasks, tz)
    raw_findings = correlations_service.find_correlations(rows)
    findings = correlations_service.write_findings(raw_findings)

    if not findings:
        if cached_row and cached_row.get("findings"):
            return {
                "status": "ready",
                "findings": cached_row["findings"],
                "generated_at": cached_row.get("generated_at"),
                "data_points": cached_row.get("data_points", data_points),
                "cached": True,
            }
        return {
            "status": "ready",
            "findings": [],
            "generated_at": now.isoformat(),
            "data_points": data_points,
            "message": "O Axon ainda não encontrou um padrão forte o suficiente nos seus dados. Continue registrando os dias — quanto mais dados, melhores as descobertas.",
        }

    generated_at = now.isoformat()
    supabase.table("axon_discoveries").upsert(
        {
            "user_id": user_id,
            "findings": findings,
            "data_points": data_points,
            "generated_at": generated_at,
        },
        on_conflict="user_id",
    ).execute()

    return {
        "status": "ready",
        "findings": findings,
        "generated_at": generated_at,
        "data_points": data_points,
        "cached": False,
    }


_CURVE_MAP = {
    "Matutino": "morning",
    "Vespertino": "evening",
    "Noturno": "night",
    "Misto": "intermediate",
    "Bimodal": "bimodal",
}


@router.get("/blocks")
def get_focus_blocks(current_user: dict = Depends(get_current_user)):
    """
    Retorna os 16 blocos de foco (90 min cada) com scores de energia.
    Quando o usuário tem 14+ registros diários, usa o perfil personalizado;
    caso contrário usa o cronotipo base.

    Campos extras de calibração:
      calibrated       — True quando usando perfil pessoal
      data_points      — registros processados até agora
      min_data_points  — mínimo para ativar personalização (14)
    """
    user_id = current_user["id"]
    profile_res = (
        supabase.table("profiles")
        .select("chronotype")
        .eq("id", user_id)
        .single()
        .execute()
    )
    chronotype = (profile_res.data or {}).get("chronotype") or "Misto"
    curve_key  = _CURVE_MAP.get(chronotype, "intermediate")
    raw_blocks = CHRONOTYPE_BLOCKS.get(curve_key, CHRONOTYPE_BLOCKS["intermediate"])

    # Scores personalizados (ou base se ainda sem dados suficientes)
    personal_scores, calibrated, data_points = calibration_service.get_block_scores(
        user_id, chronotype
    )

    blocks = []
    for idx, (level, description) in enumerate(raw_blocks):
        start_min = idx * 90
        end_min   = start_min + 90
        energy    = round(personal_scores[idx]) if calibrated else BLOCK_LEVELS[level]["energy"]
        blocks.append({
            "idx":        idx,
            "level":      level,
            "label":      BLOCK_LEVELS[level]["label"],
            "energy":     energy,
            "focus":      BLOCK_LEVELS[level]["focus"],
            "description": description,
            "start_time": f"{start_min // 60:02d}:{start_min % 60:02d}",
            "end_time":   f"{(end_min // 60) % 24:02d}:{end_min % 60:02d}",
        })

    return {
        "chronotype":      chronotype,
        "calibrated":      calibrated,
        "data_points":     data_points,
        "min_data_points": calibration_service.MIN_DATA_POINTS,
        "blocks":          blocks,
    }
