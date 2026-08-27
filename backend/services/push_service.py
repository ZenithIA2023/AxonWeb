"""
Entrega de push notifications via FCM (Firebase Cloud Messaging) HTTP v1.

Camada de ENTREGA apenas: o que notificar e quando já é decidido por
`notification_service` e `notification_analyzer`. Aqui só levamos até o
aparelho o que já foi gravado no banco.

Princípio que orienta o módulo: a notificação no banco é o dado real, o push é
só o mensageiro. Nenhuma falha daqui pode impedir uma notificação de existir,
nem atrasar quem a criou — por isso o envio roda em thread separada e todas as
exceções morrem aqui dentro.
"""

import threading

import httpx

from database import supabase
from services import gcp_auth

# Curto de propósito: isto roda a partir de um scheduler que dispara a cada
# minuto. O padrão do httpx (5s) já seria demais num laço por usuário.
_TIMEOUT = 4.0


# ---------------------------------------------------------------------------
# Credenciais
# ---------------------------------------------------------------------------
# A leitura da credencial e a troca por access token vivem em `gcp_auth`: a
# chave do Firebase é uma service account do projeto GCP, então o Speech-to-Text
# usa exatamente a mesma, mudando só o escopo.

def _service_account() -> dict | None:
    return gcp_auth.service_account()


def is_configured() -> bool:
    """True se há credencial do Firebase. Sem isso, todo envio vira no-op."""
    return _service_account() is not None


def _project_id(cred: dict) -> str | None:
    return cred.get("project_id")


def _access_token(cred: dict) -> str | None:
    return gcp_auth.access_token(cred, gcp_auth.SCOPE_FCM)


# ---------------------------------------------------------------------------
# Tokens de aparelho
# ---------------------------------------------------------------------------

def register_token(user_id: str, token: str, platform: str = "android") -> None:
    """
    Guarda (ou reatribui) o token deste aparelho.

    O token é único por instalação do app. Se ele já existia para OUTRO usuário
    — celular emprestado, conta de teste no mesmo aparelho — o dono passa a ser
    quem acabou de logar; sem isso o usuário anterior continuaria recebendo os
    push desta instalação.
    """
    if not token:
        return
    try:
        supabase.table("device_tokens").upsert(
            {
                "user_id": user_id,
                "token": token,
                "platform": platform,
                "last_seen_at": "now()",
            },
            on_conflict="token",
        ).execute()
    except Exception as e:
        print(f"[push] falha ao registrar token: {e}", flush=True)


def remove_token(token: str, user_id: str | None = None) -> None:
    """
    Remove um token.

    `user_id` restringe a remoção ao dono — é o que o endpoint de logout usa,
    para que um usuário não consiga apagar o aparelho de outro conhecendo o
    token. A limpeza interna (FCM respondeu que o token morreu) chama sem
    user_id, porque aí a ordem vem do próprio Google.
    """
    if not token:
        return
    try:
        q = supabase.table("device_tokens").delete().eq("token", token)
        if user_id:
            q = q.eq("user_id", user_id)
        q.execute()
    except Exception as e:
        print(f"[push] falha ao remover token: {e}", flush=True)


def _tokens_for(user_id: str) -> list[str]:
    try:
        res = (
            supabase.table("device_tokens")
            .select("token")
            .eq("user_id", user_id)
            .execute()
        )
        return [r["token"] for r in (res.data or []) if r.get("token")]
    except Exception as e:
        print(f"[push] falha ao buscar tokens de {user_id}: {e}", flush=True)
        return []


# ---------------------------------------------------------------------------
# Envio
# ---------------------------------------------------------------------------

def _send_one(access: str, project: str, token: str, title: str, body: str,
              data: dict | None) -> None:
    """
    Envia para um aparelho. Token que o FCM recusa como inexistente é apagado —
    é assim que a tabela se mantém limpa sem uma rotina de manutenção.
    """
    payload = {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            # Os dados vão como strings: o FCM rejeita outros tipos aqui.
            "data": {k: str(v) for k, v in (data or {}).items()},
            "android": {"priority": "high"},
        }
    }

    try:
        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(
                f"https://fcm.googleapis.com/v1/projects/{project}/messages:send",
                headers={"Authorization": f"Bearer {access}"},
                json=payload,
            )
    except Exception as e:
        print(f"[push] erro de rede ao enviar: {e}", flush=True)
        return

    if resp.status_code == 200:
        return

    # 404 = token não existe mais (app desinstalado); 403 = token não pertence a
    # este projeto. Nos dois casos ele nunca mais vai funcionar.
    if resp.status_code in (403, 404):
        remove_token(token)
        return

    print(f"[push] FCM devolveu {resp.status_code}: {resp.text[:200]}", flush=True)


def _deliver(user_id: str, title: str, body: str, data: dict | None) -> None:
    """Trabalho de rede propriamente dito — sempre roda fora do caminho crítico."""
    cred = _service_account()
    if cred is None:
        return

    project = _project_id(cred)
    if not project:
        print("[push] credencial do Firebase sem project_id", flush=True)
        return

    tokens = _tokens_for(user_id)
    if not tokens:
        return

    access = _access_token(cred)
    if not access:
        return

    for token in tokens:
        _send_one(access, project, token, title, body, data)


def send_to_user(user_id: str, title: str, body: str,
                 data: dict | None = None) -> None:
    """
    Dispara o push SEM bloquear quem chamou.

    Isto é chamado de dentro de `create_notification`, que por sua vez roda no
    scheduler que dispara a cada minuto e percorre todos os usuários em série.
    Fazer a chamada de rede ali dentro faria um FCM lento atrasar o job inteiro
    — e um job que passa de um minuto começa a concorrer com a própria execução
    seguinte. Por isso: thread daemon, e nunca propagar exceção.
    """
    if not is_configured():
        return

    threading.Thread(
        target=_deliver,
        args=(user_id, title, body, data),
        daemon=True,
    ).start()
