from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from auth_helper import get_current_user
from database import supabase
from services import chronotype as chronotype_service, calibration_service, routines_service
from services import user_tz as user_tz_service

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# (Havia aqui um _TZ fixo em America/Sao_Paulo. Removido: saudação, curva de
# energia e "hoje" agora saem do fuso do próprio usuário — ver user_tz.)

# Cronotipos em português (vindos do questionário) -> chave das curvas de energia.
_CURVE_KEY = {
    "Matutino": "morning",
    "Vespertino": "evening",
    "Noturno": "night",
    "Misto": "intermediate",
    "Bimodal": "bimodal",
    "morning": "morning",
    "evening": "evening",
    "night": "night",
    "intermediate": "intermediate",
    "bimodal": "bimodal",
}

# Chave de ritmo que o frontend usa (night/morning/evening senão "Estável").
_RHYTHM_KEY = {
    "Matutino": "morning",
    "Vespertino": "evening",
    "Noturno": "night",
    "morning": "morning",
    "evening": "evening",
    "night": "night",
}


def _greeting(hour: int) -> str:
    if hour < 12:
        return "Bom dia"
    if hour < 18:
        return "Boa tarde"
    return "Boa noite"


@router.get("/")
def get_dashboard(
    current_user: dict = Depends(get_current_user),
    x_timezone: str | None = Header(None, alias="X-Timezone"),
):
    user_id = current_user["id"]

    profile = (
        supabase.table("profiles")
        .select("name, chronotype")
        .eq("id", user_id)
        .single()
        .execute()
    )
    data = profile.data or {}
    chronotype = data.get("chronotype")

    meta = chronotype_service.CHRONOTYPE_META.get(
        chronotype or "intermediate",
        chronotype_service.CHRONOTYPE_META["intermediate"],
    )
    curve_key = _CURVE_KEY.get(chronotype or "intermediate", "intermediate")

    # Fuso do usuário, não do servidor: com _TZ fixo (São Paulo) a saudação e
    # a curva de energia saíam erradas para quem está em outro fuso.
    tz = user_tz_service.zone(user_tz_service.resolve(user_id, x_timezone))
    now = datetime.now(tz)
    hour = now.hour
    ctx = chronotype_service.get_chronotype_context(curve_key, hour)

    # Substitui energy_percent pelo score pessoal quando calibrado
    personal_scores, calibrated, _ = calibration_service.get_block_scores(
        user_id, chronotype or "Misto"
    )
    if calibrated:
        block_idx = (hour * 60) // 90
        ctx = {**ctx, "energy": round(personal_scores[block_idx])}

    # Busca todas as tarefas de hoje com horário definido — usadas para enriquecer
    # os blocos de foco com as tarefas reais que o usuário deveria estar fazendo.
    # "Hoje" no fuso do USUÁRIO: com date.today() (UTC do servidor), quem está
    # em UTC-3 via as tarefas do dia seguinte já às 21h.
    todays_tasks = _fetch_tasks_with_times(user_id, str(now.date()))

    return {
        "greeting": f"{_greeting(hour)}, {data['name']}" if data.get("name") else _greeting(hour),
        "chronotype_label": meta["label"],
        "chronotype_key": _RHYTHM_KEY.get(chronotype or "", "intermediate"),
        "energy_percent": ctx["energy"],
        "focus_percent": ctx["focus"],
        "energy_peak": meta["energy_peak"],
        "focus_window": meta["focus_window"],
        "low_energy": meta["low_energy"],
        "recommendation": (
            "Aproveite sua janela de foco para a tarefa mais importante do dia."
        ),
        "next_focus": _next_focus_block(curve_key, hour),
        "current_block": _get_block(curve_key, hour, offset=0, tasks=todays_tasks),
        "next_block": _get_block(curve_key, hour, offset=1, tasks=todays_tasks),
        "day_blocks": _today_blocks(curve_key, todays_tasks),
        "routine_consistency": routines_service.weekly_consistency(user_id, now.date()),
    }


@router.get("/routine-consistency")
def get_routine_consistency(
    current_user: dict = Depends(get_current_user),
    x_timezone: str | None = Header(None, alias="X-Timezone"),
):
    """
    Só a consistência das rotinas da semana. Existe porque a aba Insights
    precisa apenas deste dado e chamava `GET /dashboard/` inteiro para obtê-lo
    — pagando por perfil, calibração, tarefas do dia e blocos de foco que ela
    descarta.
    """
    user_id = current_user["id"]
    tz = user_tz_service.zone(user_tz_service.resolve(user_id, x_timezone))
    today = datetime.now(tz).date()
    return {"routine_consistency": routines_service.weekly_consistency(user_id, today)}


def _latest_unseen_report(user_id: str, period_type: str) -> dict | None:
    """
    Relatório mais recente do tipo que o usuário ainda NÃO viu. Substitui a
    antiga janela de 16h: o card fica no Dashboard até ser visto, e depois
    permanece para sempre no histórico (GET /dashboard/reports/history).
    """
    res = (
        supabase.table("weekly_reports")
        .select("id, period_type, period_start, period_end, data, narrative, created_at")
        .eq("user_id", user_id)
        .eq("period_type", period_type)
        .is_("seen_at", "null")
        .order("period_start", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


@router.get("/reports")
def get_dashboard_reports(current_user: dict = Depends(get_current_user)):
    """
    Relatório semanal e mensal ainda NÃO VISTOS (gerados pelo
    planning_scheduler). Cada campo vem `null` quando não há relatório novo —
    o frontend só exibe o card quando presente. Depois de visto (POST
    /dashboard/reports/{id}/seen) o relatório sai daqui e fica no histórico.
    """
    user_id = current_user["id"]
    return {
        "weekly": _latest_unseen_report(user_id, "weekly"),
        "monthly": _latest_unseen_report(user_id, "monthly"),
    }


@router.get("/reports/history")
def get_reports_history(
    period_type: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """
    Histórico permanente de relatórios, do mais recente para o mais antigo.
    `period_type` opcional filtra por 'weekly' ou 'monthly'. Inclui os já
    vistos — é o acervo que o usuário usa para comparar semanas e meses.
    """
    user_id = current_user["id"]

    if period_type not in (None, "weekly", "monthly"):
        raise HTTPException(
            status_code=422, detail="period_type deve ser 'weekly' ou 'monthly'"
        )

    query = (
        supabase.table("weekly_reports")
        .select(
            "id, period_type, period_start, period_end, data, narrative, "
            "created_at, seen_at"
        )
        .eq("user_id", user_id)
    )
    if period_type:
        query = query.eq("period_type", period_type)

    res = query.order("period_start", desc=True).execute()
    return res.data or []


@router.post("/reports/{report_id}/seen")
def mark_report_seen(report_id: str, current_user: dict = Depends(get_current_user)):
    """
    Marca o relatório como visto: ele sai do Dashboard e passa a existir só
    no histórico. Idempotente — marcar de novo não muda o seen_at original,
    para preservar quando o usuário realmente viu.
    """
    user_id = current_user["id"]

    res = (
        supabase.table("weekly_reports")
        .update({"seen_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", report_id)
        .eq("user_id", user_id)  # garante a posse da linha
        .is_("seen_at", "null")  # idempotência: não sobrescreve marcação anterior
        .execute()
    )

    # Sem linha atualizada: ou já estava visto, ou o id não é do usuário.
    if not res.data:
        exists = (
            supabase.table("weekly_reports")
            .select("id")
            .eq("id", report_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not exists.data:
            raise HTTPException(status_code=404, detail="relatório não encontrado")

    return {"status": "ok"}


# Níveis que qualificam como "janela de foco recomendada" no card do dashboard.
_FOCUS_LEVELS = {"foco_moderado", "foco_profundo", "pico"}


def _block_idx_for_time(time_str: str) -> int:
    """Converte 'HH:MM' ou 'HH:MM:SS' para o índice do bloco de 90 min."""
    parts = time_str[:5].split(":")
    minutes = int(parts[0]) * 60 + int(parts[1])
    return min(minutes // 90, 15)


def _fetch_tasks_with_times(user_id: str, today: str) -> list[dict]:
    """Busca as tarefas de hoje que têm start_time, para distribuir nos blocos."""
    res = (
        supabase.table("tasks")
        .select("id, title, status, task_type, start_time, end_time, is_key_task, priority, objectives(title)")
        .eq("user_id", user_id)
        .eq("scheduled_date", today)
        .not_.is_("start_time", "null")
        .neq("status", "done")
        .order("start_time", desc=False)
        .execute()
    )
    rows = res.data or []
    for r in rows:
        obj = r.pop("objectives", None)
        r["objective_title"] = (obj or {}).get("title") if isinstance(obj, dict) else None
    return rows


# Peso de ordenação por prioridade: menor = aparece primeiro.
_PRIORITY_WEIGHT = {"high": 0, "medium": 1, "low": 2}


def _task_sort_key(t: dict) -> tuple:
    """Tarefa chave → Alta → Média → Baixa → mesmo nível: por start_time."""
    return (
        0 if t.get("is_key_task") else 1,
        _PRIORITY_WEIGHT.get(t.get("priority") or "medium", 1),
        t.get("start_time") or "",
    )


def _tasks_for_block(tasks: list[dict], block_idx: int) -> list[dict]:
    """Filtra e ordena as tarefas que pertencem ao bloco de índice block_idx."""
    result = []
    for t in tasks:
        st = t.get("start_time")
        if st and _block_idx_for_time(str(st)) == block_idx:
            result.append({
                "id": t["id"],
                "title": t["title"],
                "status": t["status"],
                "task_type": t.get("task_type", "task"),
                "start_time": str(st)[:5] if st else None,
                "end_time": str(t["end_time"])[:5] if t.get("end_time") else None,
                "is_key_task": bool(t.get("is_key_task")),
                "priority": t.get("priority"),
            })
    return sorted(result, key=_task_sort_key)


def _get_block(curve_key: str, current_hour: int, offset: int = 0,
               tasks: list[dict] | None = None) -> dict:
    """Retorna o bloco atual (offset=0) ou o próximo (offset=1) com suas tarefas."""
    blocks = chronotype_service.CHRONOTYPE_BLOCKS.get(
        curve_key, chronotype_service.CHRONOTYPE_BLOCKS["intermediate"]
    )
    idx = ((current_hour * 60) // 90 + offset) % 16
    level, description = blocks[idx]
    start, end = _block_times(idx)
    return {
        "index": idx,
        "start": start,
        "end": end,
        "level": level,
        "level_label": chronotype_service.BLOCK_LEVELS[level]["label"],
        "description": description,
        "tasks": _tasks_for_block(tasks or [], idx),
    }


def _block_times(idx: int) -> tuple[str, str]:
    start_min = idx * 90
    end_min = (idx + 1) * 90
    start = f"{start_min // 60:02d}:{start_min % 60:02d}"
    end = f"{(end_min % 1440) // 60:02d}:{end_min % 60:02d}"
    return start, end


def _next_focus_block(curve_key: str, current_hour: int) -> dict | None:
    """
    Retorna a janela de foco ativa ou a próxima, com base nos 16 blocos de 90 min
    do cronotipo do usuário. O bloco atual é ativo se seu nível for foco_moderado,
    foco_profundo ou pico; caso contrário, avança para encontrar o próximo.
    """
    blocks = chronotype_service.CHRONOTYPE_BLOCKS.get(
        curve_key, chronotype_service.CHRONOTYPE_BLOCKS["intermediate"]
    )
    current_idx = (current_hour * 60) // 90

    # Bloco atual é uma janela de foco?
    level, desc = blocks[current_idx]
    if level in _FOCUS_LEVELS:
        start, end = _block_times(current_idx)
        return {"start": start, "end": end, "label": desc, "status": "active", "hours_until": 0}

    # Próximo bloco de foco ainda hoje.
    for i in range(current_idx + 1, 16):
        level, desc = blocks[i]
        if level in _FOCUS_LEVELS:
            start, end = _block_times(i)
            hours_until = max(1, round((i * 90 - current_hour * 60) / 60))
            return {"start": start, "end": end, "label": desc, "status": "upcoming", "hours_until": hours_until}

    # Nenhum hoje — primeiro bloco de foco de amanhã.
    for i in range(0, 16):
        level, desc = blocks[i]
        if level in _FOCUS_LEVELS:
            start, end = _block_times(i)
            hours_until = round(((16 - current_idx) * 90 + i * 90) / 60)
            return {"start": start, "end": end, "label": desc, "status": "tomorrow", "hours_until": hours_until}

    return None


def _today_blocks(curve_key: str, tasks: list[dict]) -> list[dict]:
    """
    Agrupa as tarefas de hoje por bloco de foco (90 min). Retorna apenas os blocos
    que têm pelo menos uma tarefa, em ordem cronológica. Cada bloco inclui o nível
    de energia para o frontend diferenciar visualmente pico vs. recuperação.
    """
    blocks_meta = chronotype_service.CHRONOTYPE_BLOCKS.get(
        curve_key, chronotype_service.CHRONOTYPE_BLOCKS["intermediate"]
    )

    # Agrupa índice → lista de tarefas
    by_idx: dict[int, list[dict]] = {}
    for t in tasks:
        idx = _block_idx_for_time(str(t["start_time"]))
        by_idx.setdefault(idx, []).append({
            "id": t["id"],
            "title": t["title"],
            "status": t["status"],
            "task_type": t.get("task_type", "task"),
            "start_time": str(t["start_time"])[:5],
            "end_time": str(t["end_time"])[:5] if t.get("end_time") else None,
            "is_key_task": bool(t.get("is_key_task")),
            "priority": t.get("priority"),
        })

    result = []
    for idx in sorted(by_idx.keys()):
        start, end = _block_times(idx)
        level, _ = blocks_meta[idx]
        result.append({
            "start": start,
            "end": end,
            "level": level,
            "level_label": chronotype_service.BLOCK_LEVELS[level]["label"],
            "tasks": sorted(by_idx[idx], key=_task_sort_key),
        })
    return result
