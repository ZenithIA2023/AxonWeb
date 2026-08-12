from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Header

from auth_helper import get_current_user
from models.schemas import (
    RoutineCreate,
    RoutineUpdate,
    RoutinePause,
    RoutineResponse,
    RoutineListItem,
    RoutineItemCreate,
    RoutineItemUpdate,
    RoutineItemResponse,
)
from services import routines_service, user_tz

router = APIRouter(prefix="/routines", tags=["routines"])


def _now(user_id: str, x_timezone: str | None) -> datetime:
    """Instante atual no fuso do usuário (mesmo padrão de daily_log/dashboard)."""
    tz_name = user_tz.resolve(user_id, x_timezone)
    return datetime.now(user_tz.zone(tz_name))


def _today(user_id: str, x_timezone: str | None):
    """Data de hoje no fuso do usuário."""
    return _now(user_id, x_timezone).date()


def _handle(e: ValueError):
    detail = str(e)
    not_found = detail in ("Rotina não encontrada", "Item não encontrado")
    raise HTTPException(status_code=404 if not_found else 400, detail=detail)


# --- Renovação automática ------------------------------------------------

@router.post("/renew-all")
def renew_all(
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Renova o horizonte de geração de todas as rotinas ativas do usuário.
    Chamado pelo app na abertura (ou silenciosamente via GET /routines).
    """
    uid = current_user["id"]
    now = _now(uid, x_timezone)
    renewed = routines_service.renew_routines(uid, now.date(), now=now)
    return {"renewed": renewed}


# --- Rotinas -------------------------------------------------------------

@router.get("", response_model=list[RoutineListItem])
def list_routines(
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    now = _now(current_user["id"], x_timezone)
    return routines_service.list_routines(current_user["id"], now.date(), now=now)


@router.post("", response_model=RoutineResponse, status_code=201)
def create_routine(
    body: RoutineCreate,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        now = _now(current_user["id"], x_timezone)
        return routines_service.create_routine(
            current_user["id"], body.model_dump(), now.date(), now=now
        )
    except ValueError as e:
        _handle(e)


@router.get("/{routine_id}", response_model=RoutineResponse)
def get_routine(
    routine_id: str,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        return routines_service.get_routine(
            current_user["id"], routine_id, _today(current_user["id"], x_timezone)
        )
    except ValueError as e:
        _handle(e)


@router.patch("/{routine_id}", response_model=RoutineResponse)
def update_routine(
    routine_id: str,
    body: RoutineUpdate,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        return routines_service.update_routine(
            current_user["id"],
            routine_id,
            body.model_dump(exclude_unset=True),
            _today(current_user["id"], x_timezone),
        )
    except ValueError as e:
        _handle(e)


@router.post("/{routine_id}/pause", response_model=RoutineResponse)
def pause_routine(
    routine_id: str,
    body: RoutinePause = RoutinePause(),
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        return routines_service.pause_routine(
            current_user["id"], routine_id,
            body.paused_until,
            _today(current_user["id"], x_timezone),
        )
    except ValueError as e:
        _handle(e)


@router.post("/{routine_id}/resume", response_model=RoutineResponse)
def resume_routine(
    routine_id: str,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        now = _now(current_user["id"], x_timezone)
        return routines_service.resume_routine(
            current_user["id"], routine_id, now.date(), now=now
        )
    except ValueError as e:
        _handle(e)


@router.delete("/{routine_id}", status_code=204)
def delete_routine(
    routine_id: str,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        routines_service.delete_routine(
            current_user["id"], routine_id, _today(current_user["id"], x_timezone)
        )
    except ValueError as e:
        _handle(e)


# --- Itens ---------------------------------------------------------------

@router.post("/{routine_id}/items", response_model=RoutineItemResponse, status_code=201)
def add_item(
    routine_id: str,
    body: RoutineItemCreate,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        now = _now(current_user["id"], x_timezone)
        return routines_service.add_item(
            current_user["id"], routine_id, body.model_dump(), now.date(), now=now
        )
    except ValueError as e:
        _handle(e)


@router.patch("/{routine_id}/items/{item_id}", response_model=RoutineItemResponse)
def update_item(
    routine_id: str,
    item_id: str,
    body: RoutineItemUpdate,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        now = _now(current_user["id"], x_timezone)
        return routines_service.update_item(
            current_user["id"], routine_id, item_id, body.model_dump(exclude_unset=True),
            now.date(), now=now,
        )
    except ValueError as e:
        _handle(e)


@router.delete("/{routine_id}/items/{item_id}", status_code=204)
def delete_item(
    routine_id: str,
    item_id: str,
    x_timezone: str | None = Header(default=None),
    current_user: dict = Depends(get_current_user),
):
    try:
        routines_service.delete_item(
            current_user["id"], routine_id, item_id, _today(current_user["id"], x_timezone)
        )
    except ValueError as e:
        _handle(e)
