import os
import time
import secrets
from urllib.parse import urlencode
import httpx

SCOPES = " ".join([
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar.events",
])

_STATE_TTL = 600    # 10 min para o usuário completar o login no Google
_SESSION_TTL = 300  # 5 min para o frontend trocar o código pelos tokens

_pending_states: dict[str, tuple[str, float]] = {}       # state -> (plataforma, timestamp)
_pending_sessions: dict[str, tuple[dict, float]] = {}    # code -> (dados, timestamp)
_pending_connects: dict[str, tuple[str, str, float]] = {}  # state -> (user_id, plataforma, timestamp)

_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events"


def _cleanup(store: dict, ttl: float) -> None:
    # O timestamp é sempre o ÚLTIMO elemento da tupla — as tuplas têm tamanhos
    # diferentes entre os stores (2 ou 3 campos), então indexar por posição fixa
    # quebraria silenciosamente ao adicionar um campo novo.
    now = time.time()
    expired = [k for k, v in list(store.items()) if now - (v[-1] if isinstance(v, tuple) else v) > ttl]
    for k in expired:
        del store[k]


# Plataformas de origem do fluxo OAuth. Decide para onde o callback redireciona
# no final: a web volta para uma URL http(s), o app para um deep link.
PLATFORM_WEB = "web"
PLATFORM_MOBILE = "mobile"


def _normalize_platform(platform: str | None) -> str:
    """Só 'mobile' é aceito como alternativa; qualquer outra coisa é web."""
    return PLATFORM_MOBILE if platform == PLATFORM_MOBILE else PLATFORM_WEB


def generate_and_store_state(platform: str | None = None) -> str:
    """
    Gera o state do OAuth e guarda, no servidor, de qual plataforma o fluxo
    partiu. A plataforma NÃO viaja dentro da string do state: quem volta do
    Google só apresenta um identificador opaco, e o destino do redirect é
    decidido pelo que guardamos aqui. Assim ninguém consegue forjar um callback
    que redirecione a sessão para outro lugar.
    """
    _cleanup(_pending_states, _STATE_TTL)
    state = secrets.token_urlsafe(16)
    _pending_states[state] = (_normalize_platform(platform), time.time())
    return state


def verify_and_consume_state(state: str) -> str | None:
    """
    Valida o state de login e devolve a plataforma de origem ('web'/'mobile'),
    ou None se o state for inválido/expirado.
    """
    entry = _pending_states.pop(state, None)
    if entry is None:
        return None
    platform, ts = entry
    if (time.time() - ts) > _STATE_TTL:
        return None
    return platform


def store_connect_state(user_id: str, platform: str | None = None) -> str:
    """Gera um state amarrado ao user_id logado, para o fluxo 'conectar agenda'."""
    _cleanup(_pending_connects, _STATE_TTL)
    state = "connect_" + secrets.token_urlsafe(16)
    _pending_connects[state] = (user_id, _normalize_platform(platform), time.time())
    return state


def consume_connect_state(state: str) -> tuple[str, str] | None:
    """
    Valida o state de connect e devolve (user_id, plataforma), ou None se
    inválido/expirado.
    """
    entry = _pending_connects.pop(state, None)
    if entry is None:
        return None
    user_id, platform, ts = entry
    if (time.time() - ts) > _STATE_TTL:
        return None
    return user_id, platform


def store_session(data: dict) -> str:
    _cleanup(_pending_sessions, _SESSION_TTL)
    code = secrets.token_urlsafe(32)
    _pending_sessions[code] = (data, time.time())
    return code


# Janela de "graça" após o primeiro consumo: o React em modo dev (StrictMode)
# dispara o efeito 2x, então o código é trocado duas vezes em sequência. Permitir
# reler por alguns segundos evita o falso "código inválido" sem deixar o código
# reutilizável de verdade (após a graça, ele é descartado).
_SESSION_GRACE = 20

_consumed_sessions: dict[str, tuple[dict, float]] = {}  # code -> (dados, consumed_ts)


def consume_session(code: str) -> dict | None:
    _cleanup(_consumed_sessions, _SESSION_GRACE)

    # Já consumido recentemente? Devolve de novo dentro da janela de graça.
    consumed = _consumed_sessions.get(code)
    if consumed is not None:
        data, consumed_ts = consumed
        if (time.time() - consumed_ts) <= _SESSION_GRACE:
            return data
        _consumed_sessions.pop(code, None)
        return None

    entry = _pending_sessions.pop(code, None)
    if entry is None:
        return None
    data, ts = entry
    if (time.time() - ts) > _SESSION_TTL:
        return None

    # Marca como consumido e mantém disponível pela janela de graça.
    _consumed_sessions[code] = (data, time.time())
    return data


def _client_id() -> str:
    return os.getenv("GOOGLE_CLIENT_ID", "")


def _client_secret() -> str:
    return os.getenv("GOOGLE_CLIENT_SECRET", "")


def _redirect_uri() -> str:
    return os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")


def build_auth_url(state: str) -> str:
    params = {
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
    }
    return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)


def exchange_code(code: str) -> dict:
    with httpx.Client() as client:
        resp = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
    resp.raise_for_status()
    return resp.json()


def get_user_info(access_token: str) -> dict:
    with httpx.Client() as client:
        resp = client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Google Calendar API
# ---------------------------------------------------------------------------

def refresh_access_token(refresh_token: str) -> str:
    """Troca o refresh_token por um access_token novo (válido ~1h)."""
    with httpx.Client() as client:
        resp = client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    resp.raise_for_status()
    return resp.json()["access_token"]


def create_calendar_event(access_token: str, event_body: dict) -> str:
    """Cria um evento na agenda primária e retorna o id do evento."""
    with httpx.Client() as client:
        resp = client.post(
            _CALENDAR_BASE,
            headers={"Authorization": f"Bearer {access_token}"},
            json=event_body,
        )
    resp.raise_for_status()
    return resp.json()["id"]


def update_calendar_event(access_token: str, event_id: str, event_body: dict) -> None:
    with httpx.Client() as client:
        resp = client.patch(
            f"{_CALENDAR_BASE}/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=event_body,
        )
    resp.raise_for_status()


def delete_calendar_event(access_token: str, event_id: str) -> None:
    with httpx.Client() as client:
        resp = client.delete(
            f"{_CALENDAR_BASE}/{event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    # 410 = já removido; tratamos como sucesso
    if resp.status_code not in (200, 204, 410):
        resp.raise_for_status()
