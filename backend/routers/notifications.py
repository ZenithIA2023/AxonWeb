from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks, Request, Header
from models.schemas import (
    NotificationResponse,
    NotificationCountResponse,
    NotificationAnalyzeResponse,
)
from auth_helper import get_current_user
from services import notification_service, notification_analyzer, tasks_service, user_tz

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationResponse])
def list_notifications(
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(get_current_user),
):
    return notification_service.get_notifications(current_user["id"], limit, offset)


@router.get("/unread-count", response_model=NotificationCountResponse)
def unread_count(current_user: dict = Depends(get_current_user)):
    count = notification_service.get_unread_count(current_user["id"])
    return NotificationCountResponse(unread=count)


def _run_analysis_safe(user_id: str, tz_header: str | None) -> None:
    """Executa a análise em background, nunca propaga exceção."""
    try:
        notification_analyzer.analyze_and_notify(user_id, tz_header)
    except Exception:
        pass


@router.post("/analyze", response_model=NotificationAnalyzeResponse)
def trigger_analysis(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Disparado pelo frontend ao abrir o app ou voltar à tela.

    A análise chama o Claude (~9s), então roda em BACKGROUND para o endpoint
    responder imediatamente — evita timeout do proxy/navegador (ERR_FAILED).
    A notificação, se criada, aparece no banco; o frontend a pega no próximo
    fetch de unread-count / lista.

    Os lembretes de planejamento (planning_daily / planning_weekly) são
    gerenciados pelo APScheduler e não dependem desta chamada.
    """
    background_tasks.add_task(
        _run_analysis_safe, current_user["id"], request.headers.get("X-Timezone")
    )
    return NotificationAnalyzeResponse(analyzed=True)


@router.patch("/{notification_id}/read", response_model=NotificationResponse)
def mark_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    result = notification_service.mark_read(current_user["id"], notification_id)
    if not result:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    return result


@router.post("/{notification_id}/accept", response_model=NotificationAnalyzeResponse)
def accept_notification(
    notification_id: str,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Aceita uma notificação de melhoria:
    1. Executa a alteração na tarefa
    2. Marca como aceita
    3. Gera change notification explicando o que mudou
    """
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)

    notif = notification_service.get_notification(user_id, notification_id)
    if not notif:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    if notif["type"] != "improvement":
        raise HTTPException(status_code=400, detail="Apenas notificações de melhoria podem ser aceitas")
    if notif["status"] not in ("unread", "read"):
        raise HTTPException(status_code=400, detail="Notificação já foi respondida")
    # Checagem em tempo real: se o horário sugerido já passou, não movemos a
    # tarefa para o passado. Marca como expirada para liberar o slot também.
    if notification_service.is_improvement_stale(notif, tz_name):
        notification_service.mark_expired(user_id, notification_id)
        raise HTTPException(status_code=400, detail="Esta sugestão expirou — o horário sugerido já passou")

    action = notif.get("action") or {}
    task_id = action.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="Notificação sem ação definida")

    # Busca dados da tarefa para gerar change notification
    try:
        tasks = tasks_service.list_tasks(user_id)
        task = next((t for t in tasks if t["id"] == task_id), None)
        old_time = task.get("start_time", "")[:5] if task else ""
        task_title = task["title"] if task else "tarefa"
    except Exception:
        old_time = ""
        task_title = "tarefa"

    # Executa a alteração
    update_data = {}
    if action.get("new_date"):
        update_data["scheduled_date"] = action["new_date"]
    if action.get("new_start_time"):
        update_data["start_time"] = action["new_start_time"]
    if action.get("new_end_time"):
        update_data["end_time"] = action["new_end_time"]

    # Rede de segurança: revalida no aceite (o estado pode ter mudado desde a
    # sugestão). Se o horário ficou ocupado, não sobrepõe tarefas — expira a
    # sugestão e o Axon proporá um novo horário no próximo ciclo (que pode ser
    # no dia seguinte, quando o dia atual já não tem espaço bom livre).
    #
    # Recusar é deliberado: mover a tarefa para "algum outro horário" aqui
    # entregaria ao usuário algo diferente do que ele leu e aceitou.
    new_start = update_data.get("start_time")
    if new_start:
        target_date = update_data.get("scheduled_date") or (task or {}).get("scheduled_date")
        if target_date:
            conflict = tasks_service.find_conflicting_task(
                user_id, target_date, new_start, update_data.get("end_time"), exclude_id=task_id
            )
            if conflict:
                notification_service.mark_expired(user_id, notification_id)
                raise HTTPException(
                    status_code=409,
                    detail=f"O horário sugerido conflita com '{conflict.get('title', 'outra tarefa')}'. O Axon vai sugerir um novo horário.",
                )

    if update_data:
        try:
            tasks_service.update_task(user_id, task_id, update_data)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    # Marca como aceita
    notification_service.mark_accepted(user_id, notification_id)

    # Cria change notification
    change_notif = notification_analyzer.generate_change_notification(
        user_id=user_id,
        task_title=task_title,
        old_time=old_time,
        new_time=action.get("new_start_time"),
        reason=action.get("reason"),
    )

    return NotificationAnalyzeResponse(analyzed=True, notification=change_notif)


@router.post("/{notification_id}/reject", response_model=NotificationResponse)
def reject_notification(
    notification_id: str,
    current_user: dict = Depends(get_current_user),
):
    notif = notification_service.get_notification(current_user["id"], notification_id)
    if not notif:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    if notif["type"] != "improvement":
        raise HTTPException(status_code=400, detail="Apenas notificações de melhoria podem ser rejeitadas")
    if notif["status"] not in ("unread", "read"):
        raise HTTPException(status_code=400, detail="Notificação já foi respondida")

    result = notification_service.mark_rejected(current_user["id"], notification_id)
    if not result:
        raise HTTPException(status_code=404, detail="Notificação não encontrada")
    return result
