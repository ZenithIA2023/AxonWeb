from datetime import datetime, date, timedelta, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from auth_helper import get_current_user
from database import supabase
from models.schemas import DailyLogCreate, DailyLogDraft, DailyLogResponse
from services import memory_service, user_tz, calibration_service, daily_rest, streak_service

router = APIRouter(prefix="/daily-log", tags=["daily-log"])


def _calc_hours_slept(sleep_time: str, wake_time: str) -> float | None:
    """Calcula horas dormidas a partir dos horários no formato HH:MM.
    Se wake_time <= sleep_time, assume que acordou no dia seguinte."""
    try:
        sh, sm = map(int, sleep_time.split(":"))
        wh, wm = map(int, wake_time.split(":"))
        sleep_min = sh * 60 + sm
        wake_min  = wh * 60 + wm
        if wake_min <= sleep_min:
            wake_min += 24 * 60
        return round((wake_min - sleep_min) / 60, 1)
    except Exception:
        return None


def _serialize(row: dict) -> dict:
    """Garante que campos array/jsonb viram listas e não None."""
    for field in ("sleep_tags", "mood_tags", "productivity_tags", "peak_periods"):
        row[field] = row.get(field) or []
    return row


@router.post("/", response_model=DailyLogResponse)
def upsert_daily_log(
    body: DailyLogCreate,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    now_date = datetime.now(user_tz.zone(tz_name)).date()

    # Registro retroativo: só ontem é aceito. A checagem mora aqui (e não no
    # schema) porque "ontem" depende do fuso do usuário — ver DailyLogCreate.
    if body.date:
        target = date.fromisoformat(body.date)
        if target != now_date - timedelta(days=1):
            raise HTTPException(
                status_code=400, detail="só é permitido registrar ontem"
            )
        today = body.date
    else:
        today = str(now_date)

    hours_slept = None
    if body.sleep_time and body.wake_time:
        hours_slept = _calc_hours_slept(body.sleep_time, body.wake_time)

    payload = {
        "user_id":             user_id,
        "date":                today,
        "sleep_time":          body.sleep_time,
        "wake_time":           body.wake_time,
        "hours_slept":         hours_slept,
        "sleep_rating":        body.sleep_rating,
        "sleep_tags":          body.sleep_tags,
        "mood_rating":         body.mood_rating,
        "mood_tags":           body.mood_tags,
        "productivity_rating": body.productivity_rating,
        "productivity_tags":   body.productivity_tags,
        "peak_periods":        body.peak_periods,
        "exercised":           body.exercised,
        # "Dia livre" é marcado na seção dos períodos de pico, mas não é um
        # período: o schema já o tirou de body.peak_periods, então aqui só
        # resta o campo explícito. Ver services/daily_rest.
        "is_day_off":          body.is_day_off,
        "notes":               body.notes,
    }

    result = (
        supabase.table("daily_logs")
        .upsert(payload, on_conflict="user_id,date")
        .execute()
    )

    # Sincroniza a nota como memória do agente: editar atualiza a mesma
    # memória, apagar a nota a remove — uma única memória por dia.
    prefix = f"Registro do dia {today}:"
    note = body.notes.strip() if body.notes else None
    memory_service.sync_dated_memory(
        user_id, prefix, f"{prefix} {note}" if note else None
    )

    # Calibra o perfil de energia personalizado do usuário (falha silenciosa).
    profile_res = supabase.table("profiles").select("chronotype").eq("id", user_id).single().execute()
    chronotype = (profile_res.data or {}).get("chronotype") or "Misto"
    calibration_service.calibrate_from_log(user_id, chronotype, result.data[0])

    # O registro virou definitivo: o rascunho daquele dia perdeu a razão de
    # existir. Sem isso, reabrir mostraria o rascunho antigo por cima do salvo.
    try:
        (
            supabase.table("daily_log_drafts")
            .delete()
            .eq("user_id", user_id)
            .eq("date", today)
            .execute()
        )
    except Exception:
        pass  # rascunho órfão não impede o registro de ser salvo

    return _serialize(result.data[0])


@router.get("/today", response_model=DailyLogResponse | None)
def get_today(
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    today   = str(datetime.now(user_tz.zone(tz_name)).date())

    result = (
        supabase.table("daily_logs")
        .select("*")
        .eq("user_id", user_id)
        .eq("date", today)
        .limit(1)
        .execute()
    )

    if not result.data:
        return None

    return _serialize(result.data[0])


@router.get("/yesterday", response_model=DailyLogResponse | None)
def get_yesterday(
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Registro de ontem (no fuso do usuário) ou None se ainda não preenchido."""
    user_id   = current_user["id"]
    tz_name   = user_tz.resolve(user_id, x_timezone)
    yesterday = str(datetime.now(user_tz.zone(tz_name)).date() - timedelta(days=1))

    result = (
        supabase.table("daily_logs")
        .select("*")
        .eq("user_id", user_id)
        .eq("date", yesterday)
        .limit(1)
        .execute()
    )

    if not result.data:
        return None

    return _serialize(result.data[0])


@router.get("/history", response_model=list[DailyLogResponse])
def get_history(
    days: int = Query(default=30, ge=7, le=90),
    # Intervalo explícito, para gráficos que navegam por janelas passadas.
    # Quando vem, manda em `days` — que só sabe olhar para trás a partir de hoje.
    start: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    end: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    user_id  = current_user["id"]
    tz_name  = user_tz.resolve(user_id, x_timezone)
    today    = datetime.now(user_tz.zone(tz_name)).date()

    query = (
        supabase.table("daily_logs")
        .select("*")
        .eq("user_id", user_id)
    )

    if start and end:
        query = query.gte("date", start).lte("date", end)
    else:
        query = query.gte("date", str(today - timedelta(days=days - 1)))

    result = query.order("date", desc=False).execute()

    return [_serialize(row) for row in (result.data or [])]


@router.get("/week")
def get_week(
    # Semanas para trás: 0 = semana atual, 1 = anterior, e assim por diante.
    offset: int = Query(default=0, ge=0, le=520),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Registros de uma semana do calendário (domingo→sábado), para o gráfico de
    sono navegável. Devolve também os limites da semana: o frontend precisa
    deles para montar os 7 dias, inclusive os que não têm registro — e a
    semana é calculada aqui, no fuso do usuário, igual à do card de tarefas.
    """
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    today = datetime.now(user_tz.zone(tz_name)).date()

    # Domingo→sábado (weekday() é 0=segunda; +1 % 7 = dias desde o domingo).
    start = today - timedelta(days=(today.weekday() + 1) % 7, weeks=offset)
    end = start + timedelta(days=6)

    result = (
        supabase.table("daily_logs")
        .select("*")
        .eq("user_id", user_id)
        .gte("date", str(start))
        .lte("date", str(end))
        .order("date", desc=False)
        .execute()
    )

    return {
        "start": str(start),
        "end": str(end),
        "offset": offset,
        "logs": [_serialize(row) for row in (result.data or [])],
    }


# ---------------------------------------------------------------------------
# Rascunho do registro (tabela daily_log_drafts — ver Migration 20)
# Guarda o preenchimento parcial para o usuário não recomeçar do zero. Fica
# fora de daily_logs para não contar como "dia registrado" nos insights nem
# disparar calibração/memória com dados pela metade.
# ---------------------------------------------------------------------------


def _draft_date(body_date: str | None, tz_name: str) -> str:
    """Data alvo do rascunho: a informada (só ontem) ou hoje, no fuso do usuário."""
    now_date = datetime.now(user_tz.zone(tz_name)).date()
    if not body_date:
        return str(now_date)
    target = date.fromisoformat(body_date)
    # Mesma regra do POST: rascunho só faz sentido para hoje ou ontem.
    if target not in (now_date, now_date - timedelta(days=1)):
        raise HTTPException(
            status_code=400, detail="rascunho permitido apenas para hoje ou ontem"
        )
    return str(target)


@router.get("/draft")
def get_draft(
    log_date: str | None = Query(default=None, alias="date"),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Rascunho salvo para a data (hoje por padrão), ou None se não houver."""
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    target = _draft_date(log_date, tz_name)

    result = (
        supabase.table("daily_log_drafts")
        .select("data, updated_at")
        .eq("user_id", user_id)
        .eq("date", target)
        .limit(1)
        .execute()
    )

    if not result.data:
        return None
    return result.data[0]


@router.put("/draft")
def save_draft(
    body: DailyLogDraft,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Cria/atualiza o rascunho do dia. Um por usuário/data (upsert)."""
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    target = _draft_date(body.date, tz_name)

    supabase.table("daily_log_drafts").upsert(
        {
            "user_id": user_id,
            "date": target,
            "data": body.data,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
        on_conflict="user_id,date",
    ).execute()

    return {"status": "ok", "date": target}


@router.delete("/draft", status_code=204)
def delete_draft(
    log_date: str | None = Query(default=None, alias="date"),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Descarta o rascunho (usuário limpou o formulário)."""
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    target = _draft_date(log_date, tz_name)

    (
        supabase.table("daily_log_drafts")
        .delete()
        .eq("user_id", user_id)
        .eq("date", target)
        .execute()
    )
    return None


@router.post("/forfeit-streak", status_code=204)
def forfeit_streak(
    body: dict | None = None,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    O usuário confirmou que não vai registrar o dia pendente e aceita perder a
    ofensiva. O dia deixa de contar mesmo que ele registre depois.

    Só aceita hoje ou ontem — as mesmas datas que o registro aceita. Sem essa
    checagem, a API permitiria "desistir" de um dia qualquer do passado ou do
    futuro, o que não corresponde a nenhuma ação possível na tela.
    """
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    hoje = datetime.now(user_tz.zone(tz_name)).date()

    alvo = hoje
    if body and body.get("date"):
        try:
            alvo = date.fromisoformat(str(body["date"]))
        except ValueError:
            raise HTTPException(status_code=400, detail="date deve ser YYYY-MM-DD")

    if alvo not in (hoje, hoje - timedelta(days=1)):
        raise HTTPException(
            status_code=400, detail="só é possível abrir mão de hoje ou de ontem"
        )

    streak_service.forfeit_day(user_id, alvo)
