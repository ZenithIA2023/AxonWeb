"""
Credencial de conta de serviço do Google Cloud e troca por access token OAuth2.

Extraído de `push_service` quando o Speech-to-Text passou a precisar da MESMA
credencial (a chave do Firebase é uma service account do projeto GCP, então
serve para qualquer API do Google, bastando trocar o escopo).

O cache de token é POR ESCOPO: o token do FCM e o do Cloud Platform são
credenciais distintas e não podem se sobrescrever — era o risco de simplesmente
reaproveitar o cache de valor único que existia antes.
"""

import json
import os
import threading
import time

import httpx

_TOKEN_URI = "https://oauth2.googleapis.com/token"

# Escopos usados no projeto. O do FCM é restrito de propósito (princípio do
# menor privilégio); o cloud-platform é o que o Speech-to-Text exige.
SCOPE_FCM = "https://www.googleapis.com/auth/firebase.messaging"
SCOPE_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform"

# Curto de propósito: o caminho do push roda a partir de um scheduler que
# dispara a cada minuto, e o padrão do httpx (5s) já seria demais num laço.
_TIMEOUT = 4.0

# O access token vale 1h; renovamos antes para não usar um token que expira no
# meio do voo.
_TOKEN_TTL_MARGIN = 300

# {escopo: {"value": str, "exp": float}}
_token_cache: dict[str, dict] = {}
_token_lock = threading.Lock()


def service_account() -> dict | None:
    """
    Credencial da conta de serviço do Firebase/GCP. Aceita duas formas:

    - FIREBASE_CREDENTIALS_JSON: o próprio JSON em uma variável (útil onde não
      há arquivo para subir)
    - FIREBASE_CREDENTIALS_PATH: caminho de um arquivo JSON no disco

    Devolve None quando nada está configurado — quem chama trata isso como
    "recurso desligado", nunca como erro.
    """
    raw = os.getenv("FIREBASE_CREDENTIALS_JSON")
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            print("[gcp] FIREBASE_CREDENTIALS_JSON não é um JSON válido", flush=True)
            return None

    path = os.getenv("FIREBASE_CREDENTIALS_PATH")
    if path and os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, json.JSONDecodeError) as e:
            print(f"[gcp] falha ao ler {path}: {e}", flush=True)
            return None

    return None


def project_id(cred: dict | None = None) -> str | None:
    """
    ID do projeto GCP. Vem da credencial; GCP_PROJECT_ID sobrescreve para o caso
    de o Speech-to-Text morar em outro projeto que não o do Firebase.
    """
    explicit = os.getenv("GCP_PROJECT_ID")
    if explicit:
        return explicit
    cred = cred if cred is not None else service_account()
    return (cred or {}).get("project_id")


def access_token(cred: dict, scope: str = SCOPE_FCM) -> str | None:
    """
    Troca a chave da conta de serviço por um access token OAuth2, com cache
    por escopo.

    Usa JWT assinado com a chave privada (fluxo padrão de service account). O
    `python-jose` já é dependência do projeto, então não entra biblioteca nova.
    """
    now = time.time()
    with _token_lock:
        cached = _token_cache.get(scope)
        if cached and cached["value"] and now < cached["exp"]:
            return cached["value"]

    try:
        from jose import jwt

        iat = int(now)
        claim = {
            "iss": cred["client_email"],
            "scope": scope,
            "aud": _TOKEN_URI,
            "iat": iat,
            "exp": iat + 3600,
        }
        assertion = jwt.encode(claim, cred["private_key"], algorithm="RS256")

        with httpx.Client(timeout=_TIMEOUT) as client:
            resp = client.post(
                _TOKEN_URI,
                data={
                    "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                    "assertion": assertion,
                },
            )
        resp.raise_for_status()
        token = resp.json()["access_token"]

        with _token_lock:
            _token_cache[scope] = {
                "value": token,
                "exp": now + 3600 - _TOKEN_TTL_MARGIN,
            }
        return token
    except Exception as e:
        print(f"[gcp] falha ao obter access token ({scope}): {e}", flush=True)
        return None
