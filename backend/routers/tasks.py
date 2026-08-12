from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from models.schemas import TaskCreate, TaskUpdate, TaskResponse
from auth_helper import get_current_user
from services import tasks_service, daily_stats_service, user_tz
from typing import Optional

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
def list_tasks(
    scheduled_date: Optional[str] = Query(None, description="YYYY-MM-DD"),
    status: Optional[str] = Query(None),
    task_type: Optional[str] = Query(None),
    objective_id: Optional[str] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    return tasks_service.list_tasks(
        current_user["id"],
        scheduled_date=scheduled_date,
        status=status,
        task_type=task_type,
        objective_id=objective_id,
    )


@router.post("", response_model=TaskResponse, status_code=201)
def create_task(
    body: TaskCreate,
    x_timezone: Optional[str] = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        # O fuso só importa para "Axon decide": sem ele, o slot escolhido para
        # hoje poderia cair num horário já passado.
        tz_name = user_tz.resolve(current_user["id"], x_timezone)
        return tasks_service.create_task(
            current_user["id"], body.model_dump(exclude_none=True),
            now=datetime.now(user_tz.zone(tz_name)),
        )
    except ValueError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: str,
    body: TaskUpdate,
    current_user: dict = Depends(get_current_user),
):
    try:
        return tasks_service.update_task(
            current_user["id"], task_id, body.model_dump(exclude_none=True)
        )
    except ValueError as e:
        detail = str(e)
        status_code = 404 if detail == "Tarefa não encontrada" else 400
        raise HTTPException(status_code=status_code, detail=detail)


@router.delete("/{task_id}", status_code=204)
def delete_task(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        tasks_service.delete_task(current_user["id"], task_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/carry-forward", response_model=list[TaskResponse])
def carry_forward(
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Fallback idempotente do gancho de fim de dia: congela snapshots dos dias
    passados ainda não congelados e carrega as pendentes para hoje (no fuso
    do usuário). O disparo primário é o scheduler; este endpoint garante o
    resultado mesmo se o job tiver perdido a virada.
    """
    user_id = current_user["id"]
    tz_name = user_tz.resolve(user_id, x_timezone)
    local_today = datetime.now(user_tz.zone(tz_name)).date()
    return daily_stats_service.reconcile(user_id, tz_name, local_today)


@router.get("/daily-stats")
def daily_stats(
    start: str = Query(..., description="YYYY-MM-DD (inclusivo)"),
    end: str = Query(..., description="YYYY-MM-DD (inclusivo)"),
    current_user: dict = Depends(get_current_user),
):
    """
    Estatísticas de conclusão CONGELADAS por dia no intervalo. Use para os
    dias passados; "hoje" continua sendo calculado ao vivo no frontend. Um
    dia sem linha = nenhuma tarefa naquele dia (tratar como 0/0).
    """
    return daily_stats_service.get_range(current_user["id"], start, end)


@router.get("/{task_id}/subtasks", response_model=list[TaskResponse])
def list_subtasks(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    return tasks_service.list_subtasks(current_user["id"], task_id)
