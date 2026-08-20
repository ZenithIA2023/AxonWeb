"""
CRUD e regras de negócio para notificações do Axon.

Gerencia a tabela `notifications` e a coluna `last_notif_analyzed_at`
em `profiles`. Aplica os cooldowns por tipo antes de criar notificações.
"""

from datetime import datetime, timezone, timedelta, date, time
from database import supabase


# ---------------------------------------------------------------------------
# Leitura
# ---------------------------------------------------------------------------

def get_notifications(user_id: str, limit: int = 10, offset: int = 0) -> list[dict]:
    res = (
        supabase.table("notifications")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .offset(offset)
        .execute()
    )
    return res.data or []


def get_unread_count(user_id: str) -> int:
    # expired_at is null cobre todos os tipos (só melhorias expiram; nas demais
    # a coluna é sempre null) — evita que uma melhoria expirada e nunca lida
    # deixe o badge de não-lidas aceso para sempre.
    res = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("status", "unread")
        .is_("expired_at", "null")
        .execute()
    )
    return res.count or 0


def get_recent_notifications(user_id: str, hours: int = 72) -> list[dict]:
    """Retorna notificações recentes para contexto do Claude e verificação de cooldowns."""
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    res = (
        supabase.table("notifications")
        .select("id, type, title, status, created_at")
        .eq("user_id", user_id)
        .gte("created_at", since)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def count_today(user_id: str, notif_type: str) -> int:
    """Conta notificações do tipo informado criadas hoje (UTC)."""
    today = datetime.now(timezone.utc).date().isoformat()
    res = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("type", notif_type)
        .gte("created_at", f"{today}T00:00:00+00:00")
        .execute()
    )
    return res.count or 0


def count_consecutive_rejections(user_id: str) -> int:
    """
    Conta quantas notificações de melhoria consecutivas foram rejeitadas
    (da mais recente para trás, para até encontrar uma aceita ou lida).
    """
    res = (
        supabase.table("notifications")
        .select("status")
        .eq("user_id", user_id)
        .eq("type", "improvement")
        .order("created_at", desc=True)
        .limit(10)
        .execute()
    )
    count = 0
    for row in (res.data or []):
        if row["status"] == "rejected":
            count += 1
        else:
            break
    return count


# ---------------------------------------------------------------------------
# Cooldown de análise
# ---------------------------------------------------------------------------

def should_analyze(user_id: str) -> bool:
    """Retorna True se já passaram 6h desde a última análise."""
    res = (
        supabase.table("profiles")
        .select("last_notif_analyzed_at")
        .eq("id", user_id)
        .single()
        .execute()
    )
    data = res.data or {}
    last = data.get("last_notif_analyzed_at")
    if not last:
        return True
    last_dt = datetime.fromisoformat(last.replace("Z", "+00:00"))
    return datetime.now(timezone.utc) - last_dt >= timedelta(hours=6)


def update_analyzed_at(user_id: str) -> None:
    supabase.table("profiles").update(
        {"last_notif_analyzed_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", user_id).execute()


# ---------------------------------------------------------------------------
# Escrita
# ---------------------------------------------------------------------------

def create_notification(
    user_id: str,
    notif_type: str,
    title: str,
    body: str,
    action: dict | None = None,
) -> dict:
    payload: dict = {
        "user_id": user_id,
        "type": notif_type,
        "title": title,
        "body": body,
        "status": "unread",
    }
    if action:
        payload["action"] = action

    res = supabase.table("notifications").insert(payload).execute()
    created = res.data[0] if res.data else {}

    # Entrega no aparelho. A notificação já está gravada neste ponto: o push é
    # o mensageiro, não o dado. `send_to_user` devolve na hora (o envio real
    # roda em thread), então o scheduler que chama isto em laço não espera rede.
    if created:
        _push(user_id, notif_type, title, body, action)

    return created


def _push(user_id: str, notif_type: str, title: str, body: str,
          action: dict | None) -> None:
    """
    Dispara o push da notificação recém-criada.

    Import local de propósito: `push_service` importa `database`, como este
    módulo, e o import no topo criaria um ciclo. Todo erro é engolido — falha
    de entrega não pode derrubar a criação da notificação.
    """
    try:
        from services import push_service

        # O app usa isto para abrir a tela certa ao tocar na notificação. O
        # tipo vem do envelope da notificação; o `action` carrega o alvo
        # (task_id) quando existe — ele não tem campo "type".
        data = {"type": notif_type}
        if action and action.get("task_id"):
            data["task_id"] = action["task_id"]

        push_service.send_to_user(user_id, title, body, data)
    except Exception as e:
        print(f"[notifications] push falhou (notificação foi criada): {e}", flush=True)


def create_improvement_guarded(
    user_id: str, title: str, body: str, action: dict
) -> dict | None:
    """
    Cria uma notificação de melhoria respeitando a invariante "no máximo uma
    melhoria aberta por usuário", garantida por índice único parcial no banco
    (notifications_one_open_improvement). Se já houver uma aberta, o INSERT
    viola o índice → devolvemos None em vez de estourar.

    É a defesa à prova de corrida: duas análises concorrentes tentam criar,
    o banco deixa só uma passar.
    """
    try:
        return create_notification(user_id, "improvement", title, body, action)
    except Exception as e:
        msg = str(e).lower()
        if "23505" in msg or "duplicate" in msg or "unique" in msg:
            return None
        raise


def has_open_improvement(user_id: str) -> bool:
    """True se existe uma melhoria ainda ABERTA (unread/read e não expirada)."""
    res = (
        supabase.table("notifications")
        .select("id")
        .eq("user_id", user_id)
        .eq("type", "improvement")
        .in_("status", ["unread", "read"])
        .is_("expired_at", "null")
        .limit(1)
        .execute()
    )
    return bool(res.data)


def _improvement_target_dt(action: dict | None, created_at: str | None, tz) -> datetime | None:
    """
    Momento em que a sugestão perde o sentido = horário sugerido (new_start_time
    na new_date), no fuso do usuário. Sem horário explícito, cai no fim do dia
    alvo; sem data, usa a data de criação. É o marco para expirar a melhoria.
    """
    action = action or {}
    nd = action.get("new_date")
    if nd:
        try:
            base_date = date.fromisoformat(nd)
        except (ValueError, TypeError):
            base_date = None
    else:
        base_date = None

    if base_date is None:
        if not created_at:
            return None
        try:
            base_date = datetime.fromisoformat(
                created_at.replace("Z", "+00:00")
            ).astimezone(tz).date()
        except (ValueError, TypeError):
            return None

    hhmm = (action.get("new_start_time") or "23:59")[:5]
    try:
        h, m = map(int, hhmm.split(":"))
    except (ValueError, TypeError):
        h, m = 23, 59
    return datetime.combine(base_date, time(h, m), tzinfo=tz)


def expire_stale_improvements(user_id: str, tz_name: str) -> None:
    """
    Marca como expiradas (expired_at) as melhorias abertas cujo horário sugerido
    já passou — liberando o slot para o Axon voltar a sugerir. Decisão do
    produto: bloquear até o usuário decidir OU até o horário da sugestão passar.
    """
    from services import user_tz  # import local evita ciclo na carga do módulo

    tz = user_tz.zone(tz_name)
    now_local = datetime.now(tz)

    res = (
        supabase.table("notifications")
        .select("id, action, created_at")
        .eq("user_id", user_id)
        .eq("type", "improvement")
        .in_("status", ["unread", "read"])
        .is_("expired_at", "null")
        .execute()
    )
    now_utc = datetime.now(timezone.utc).isoformat()
    for row in res.data or []:
        target = _improvement_target_dt(row.get("action"), row.get("created_at"), tz)
        if target and now_local > target:
            supabase.table("notifications").update({"expired_at": now_utc}).eq(
                "id", row["id"]
            ).eq("user_id", user_id).execute()


def is_improvement_stale(notif: dict, tz_name: str) -> bool:
    """
    True se a melhoria já não faz sentido aceitar: expirada (expired_at) OU o
    horário sugerido já passou AGORA. A checagem em tempo real é o que impede
    aceitar uma sugestão de horário passado quando a expiração preguiçosa do
    analyze ainda não rodou — sem ela, a tarefa seria movida para o passado.
    """
    if notif.get("expired_at"):
        return True
    from services import user_tz

    tz = user_tz.zone(tz_name)
    target = _improvement_target_dt(notif.get("action"), notif.get("created_at"), tz)
    return target is not None and datetime.now(tz) > target


def mark_expired(user_id: str, notif_id: str) -> dict:
    res = (
        supabase.table("notifications")
        .update({"expired_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", notif_id)
        .eq("user_id", user_id)
        .execute()
    )
    return res.data[0] if res.data else {}


def has_planning_reminder_today(user_id: str) -> bool:
    """Verifica se já foi enviado lembrete de planejamento diário hoje (UTC)."""
    today = datetime.now(timezone.utc).date().isoformat()
    res = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("type", "planning_daily")
        .gte("created_at", f"{today}T00:00:00+00:00")
        .execute()
    )
    return (res.count or 0) > 0


def has_planning_reminder_this_week(user_id: str) -> bool:
    """Verifica se já foi enviado lembrete de planejamento semanal esta semana (segunda-feira UTC)."""
    today = datetime.now(timezone.utc).date()
    week_start = today - timedelta(days=today.weekday())
    res = (
        supabase.table("notifications")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("type", "planning_weekly")
        .gte("created_at", f"{week_start.isoformat()}T00:00:00+00:00")
        .execute()
    )
    return (res.count or 0) > 0


def mark_read(user_id: str, notif_id: str) -> dict:
    res = (
        supabase.table("notifications")
        .update({"status": "read", "read_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", notif_id)
        .eq("user_id", user_id)
        .execute()
    )
    return res.data[0] if res.data else {}


def mark_accepted(user_id: str, notif_id: str) -> dict:
    res = (
        supabase.table("notifications")
        .update({"status": "accepted"})
        .eq("id", notif_id)
        .eq("user_id", user_id)
        .eq("type", "improvement")
        .execute()
    )
    return res.data[0] if res.data else {}


def mark_rejected(user_id: str, notif_id: str) -> dict:
    res = (
        supabase.table("notifications")
        .update({"status": "rejected"})
        .eq("id", notif_id)
        .eq("user_id", user_id)
        .eq("type", "improvement")
        .execute()
    )
    return res.data[0] if res.data else {}


def get_notification(user_id: str, notif_id: str) -> dict | None:
    res = (
        supabase.table("notifications")
        .select("*")
        .eq("id", notif_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    return res.data
