"""
Relatórios narrativos periódicos (semanal/mensal).

Coleta métricas já calculadas do período (daily_task_stats, consistência de
rotinas, tarefas chave) e pede ao Claude só a tradução em uma narrativa em
texto — mesma filosofia do correlations_service: o backend faz a
matemática, o Claude só escreve. Salva em `weekly_reports` (Migration 19),
com no máximo um relatório por usuário/tipo/período (índice único + upsert
idempotente).

Disparado pelo planning_scheduler: todo domingo 20h local (semanal, cobre a
própria semana que está terminando, segunda a domingo) e todo último dia do
mês 20h local (mensal, cobre o próprio mês que está terminando, dia 1 até o
último dia). Em ambos os casos o ÚLTIMO dia do período é o dia da geração —
ainda não tem snapshot congelado (isso só acontece à meia-noite), então é
calculado ao vivo (ver `daily_stats_service.live_day_stats`).

Visibilidade: o relatório aparece no Dashboard (`GET /dashboard/reports`)
desde a geração até o usuário vê-lo (`POST /dashboard/reports/{id}/seen`
grava `seen_at`). Depois disso ele sai do Dashboard mas continua acessível
para sempre em `GET /dashboard/reports/history`, que alimenta o histórico no
Perfil — é lá que o usuário compara semanas e meses.
"""

import json
from datetime import date, datetime, timedelta

from database import supabase
from services import claude_service, daily_stats_service, routines_service
from services import user_tz as user_tz_service

_NARRATOR_SYSTEM_PROMPT = """Você é o Axon, assistente pessoal de produtividade. Você recebe um resumo \
JÁ CALCULADO (o backend fez a matemática) do desempenho do usuário num período encerrado (semana ou mês).

Sua ÚNICA tarefa é escrever UM parágrafo corrido (3 a 5 frases), em português do Brasil, tom de parceiro \
próximo e direto, primeira pessoa do Axon falando com o usuário — resumindo o período e destacando o que \
mais se destacou (positivo ou a melhorar). Regras estritas:
- NUNCA invente ou altere números; use exatamente os valores fornecidos.
- NÃO liste os dados como lista/bullets — escreva em prosa, um parágrafo só.
- NÃO use jargão técnico (não diga "score", "rate", "array", "json" etc.).
- Se algum dado vier vazio, nulo ou zerado (ex.: sem rotinas ativas, sem tarefa chave definida), \
simplesmente não mencione esse ponto — não force um comentário sobre ele.

Responda APENAS com o parágrafo, sem título, sem aspas, sem markdown."""


def _period_summary_message(data: dict) -> str:
    return (
        "Aqui está o resumo do período (já calculado, não altere os números). "
        "Escreva a narrativa a partir dele.\n\n"
        + json.dumps(data, ensure_ascii=False, indent=2)
    )


def _most_productive_day(snapshots: list[dict]) -> dict | None:
    if not snapshots:
        return None
    top = max(snapshots, key=lambda s: (s["completion_rate"], s["completed_tasks"]))
    return {"date": top["date"], "completion_rate": top["completion_rate"]}


def _key_task_stats(user_id: str, start: date, end: date) -> dict:
    res = (
        supabase.table("tasks")
        .select("status")
        .eq("user_id", user_id)
        .eq("is_key_task", True)
        .gte("scheduled_date", str(start))
        .lte("scheduled_date", str(end))
        .execute()
    )
    rows = res.data or []
    done = sum(1 for row in rows if row.get("status") == "done")
    return {"defined": len(rows), "done": done}


def _collect_period_data(user_id: str, start: date, end: date, tz_name: str) -> dict:
    # No disparo pontual (20h do último dia), `end` é HOJE e ainda não tem
    # snapshot congelado — os dias anteriores vêm do snapshot e `end` é
    # calculado ao vivo, entrando na média só se tiver algo agendado (mesma
    # regra que snapshot_days usa para não congelar dias vazios).
    # Num catch-up (período já encerrado), `end` está no passado e JÁ tem
    # snapshot: usar live_day_stats aqui traria os números de hoje rotulados
    # como se fossem do último dia do período.
    today = datetime.now(user_tz_service.zone(tz_name)).date()
    end_is_today = end >= today

    frozen_end = end - timedelta(days=1) if end_is_today else end
    snapshots = (
        daily_stats_service.get_range(user_id, str(start), str(frozen_end))
        if frozen_end >= start else []
    )

    if end_is_today:
        live_today = daily_stats_service.live_day_stats(user_id, end, tz_name)
        if live_today["total"] > 0:
            snapshots = snapshots + [live_today]

    avg_completion_rate = (
        round(sum(s["completion_rate"] for s in snapshots) / len(snapshots))
        if snapshots else 0
    )

    return {
        "period_start": str(start),
        "period_end": str(end),
        "avg_completion_rate": avg_completion_rate,
        "most_productive_day": _most_productive_day(snapshots),
        "routine_consistency": routines_service.consistency_for_range(user_id, start, end),
        "key_tasks": _key_task_stats(user_id, start, end),
    }


def _generate_report(user_id: str, period_type: str, start: date, end: date, tz_name: str) -> dict:
    data = _collect_period_data(user_id, start, end, tz_name)

    narrative = claude_service.call_chat(
        messages=[{"role": "user", "content": _period_summary_message(data)}],
        system_prompt=_NARRATOR_SYSTEM_PROMPT,
    ).strip()

    payload = {
        "user_id": user_id,
        "period_type": period_type,
        "period_start": str(start),
        "period_end": str(end),
        "data": data,
        "narrative": narrative,
    }

    res = (
        supabase.table("weekly_reports")
        .upsert(payload, on_conflict="user_id,period_type,period_start")
        .execute()
    )
    return (res.data or [payload])[0]


def weekly_period_for(day: date) -> tuple[date, date]:
    """Semana (segunda→domingo) à qual `day` pertence."""
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=6)


def monthly_period_for(day: date) -> tuple[date, date]:
    """Mês calendário ao qual `day` pertence."""
    start = day.replace(day=1)
    next_month = (start + timedelta(days=32)).replace(day=1)
    return start, next_month - timedelta(days=1)


def generate_weekly_report(user_id: str, tz_name: str, period_start: date | None = None) -> dict:
    """
    Relatório semanal. Sem `period_start`, gera a semana que termina hoje
    (disparo pontual de domingo 20h). Com ele, gera aquela semana — usado
    pelo catch-up para períodos já encerrados.
    """
    if period_start is None:
        today = datetime.now(user_tz_service.zone(tz_name)).date()
        period_start = today - timedelta(days=today.weekday())
        period_end = today
    else:
        period_start, period_end = weekly_period_for(period_start)
    return _generate_report(user_id, "weekly", period_start, period_end, tz_name)


def generate_monthly_report(user_id: str, tz_name: str, period_start: date | None = None) -> dict:
    """
    Relatório mensal. Sem `period_start`, gera o mês que termina hoje
    (disparo pontual do último dia 20h). Com ele, gera aquele mês — usado
    pelo catch-up para períodos já encerrados.
    """
    if period_start is not None:
        period_start, period_end = monthly_period_for(period_start)
        return _generate_report(user_id, "monthly", period_start, period_end, tz_name)

    today = datetime.now(user_tz_service.zone(tz_name)).date()
    period_start = today.replace(day=1)
    period_end = today
    return _generate_report(user_id, "monthly", period_start, period_end, tz_name)


# Quantos períodos encerrados o catch-up olha para trás. 1 = só o último.
# Manter baixo de propósito: cada relatório gerado é uma chamada paga ao
# Claude, e ressuscitar meses antigos de uma vez seria caro e pouco útil.
_CATCHUP_LOOKBACK = 1


def _has_report(user_id: str, period_type: str, period_start: date) -> bool:
    res = (
        supabase.table("weekly_reports")
        .select("id")
        .eq("user_id", user_id)
        .eq("period_type", period_type)
        .eq("period_start", str(period_start))
        .limit(1)
        .execute()
    )
    return bool(res.data)


def catch_up(user_id: str, tz_name: str) -> list[str]:
    """
    Gera relatórios de períodos JÁ ENCERRADOS que não foram gerados no
    horário — tipicamente porque o servidor estava fora do ar às 20h do
    último dia (o disparo pontual compara o minuto exato, sem recuperação).

    Só considera períodos completamente encerrados: a semana/mês corrente
    fica de fora, senão o relatório sairia com dados parciais e o índice
    único impediria a versão completa depois.

    Idempotente: períodos que já têm relatório são pulados, então rodar
    todo dia não regenera nem duplica nada.

    Devolve a lista de períodos gerados, para log.
    """
    today = datetime.now(user_tz_service.zone(tz_name)).date()
    generated: list[str] = []

    # --- semanais encerrados ---
    current_week_start, _ = weekly_period_for(today)
    for i in range(1, _CATCHUP_LOOKBACK + 1):
        wk_start = current_week_start - timedelta(weeks=i)
        if _has_report(user_id, "weekly", wk_start):
            continue
        generate_weekly_report(user_id, tz_name, period_start=wk_start)
        generated.append(f"weekly:{wk_start}")

    # --- mensais encerrados ---
    current_month_start, _ = monthly_period_for(today)
    ref = current_month_start
    for _ in range(_CATCHUP_LOOKBACK):
        ref = (ref - timedelta(days=1)).replace(day=1)  # mês anterior
        if _has_report(user_id, "monthly", ref):
            continue
        generate_monthly_report(user_id, tz_name, period_start=ref)
        generated.append(f"monthly:{ref}")

    return generated


