"""
Transcrição de voz (áudio → texto) do Axon.

A síntese (texto → áudio) já mora em `tts_service`; aqui é o caminho inverso,
usando o Google Speech-to-Text v2 com a MESMA credencial de service account
que o `gcp_auth` já troca por token para o TTS — nenhuma chave nova.

Diferente do TTS, aqui existe um único provedor: é o Google quem abre a
"entrada" da voz (ouvir o usuário), e a escolha entre Google/ElevenLabs para a
"saída" (o Axon falando) não afeta isto — as duas pontas são independentes.

O recognizer usado é o "_" (auto, sem recurso dedicado no console) na região
"global": não exige criar nem manter nada além de habilitar a API.
"""

import base64
import os
from datetime import datetime, timezone

import httpx

from database import supabase
from services import gcp_auth

# A transcrição entra no caminho da conversa falada — um provedor lento trava
# a resposta do Axon antes mesmo dela começar.
_TIMEOUT = 15.0

# O recorder da Fase 3 corta em 60s / 2MB; a Fase 2 já aplica o mesmo teto
# aqui, para que um curl direto não vire uma cobrança fora de controle.
_MAX_BYTES = 2 * 1024 * 1024

_RECOGNIZE_URL = (
    "https://speech.googleapis.com/v2/projects/{project}/locations/global/"
    "recognizers/_:recognize"
)

_DEFAULT_MONTHLY_LIMIT_SECONDS = 3600  # 1h de áudio/mês por usuário


class SttError(RuntimeError):
    """Falha ao transcrever. O router traduz para HTTP; o app avisa o usuário."""


class SttQuotaExceeded(RuntimeError):
    """Usuário estourou o limite mensal de segundos transcritos."""


def is_configured() -> bool:
    return gcp_auth.service_account() is not None


def _parse_offset(value: str | None) -> float:
    """'12.340s' -> 12.34. Formato de Duration da API do Google em JSON."""
    if not value:
        return 0.0
    try:
        return float(value.rstrip("s"))
    except (TypeError, ValueError):
        return 0.0


def transcribe(
    audio: bytes,
    mime: str,
    language: str = "pt-BR",
    hints: list[str] | None = None,
) -> dict:
    """
    Transcreve `audio` e devolve {"text", "confidence", "duration_seconds"}.

    `hints` são palavras que o reconhecedor deve favorecer quando a fala for
    ambígua (ex.: "Axon", nomes de tarefas do usuário) — sem custo se vier
    vazio.

    `duration_seconds` vem do `resultEndOffset` do último resultado: é o
    próprio Google dizendo até onde no áudio ele reconheceu fala. Não dá para
    confiar no tamanho em bytes para isso — varia com silêncio, ruído e taxa
    de bits do aparelho — e é este valor que alimenta o contador de uso.
    """
    if not audio:
        raise SttError("áudio vazio")
    if len(audio) > _MAX_BYTES:
        raise SttError(f"áudio acima de {_MAX_BYTES // 1024 // 1024}MB")

    cred = gcp_auth.service_account()
    if not cred:
        raise SttError("Google Speech-to-Text sem credencial configurada")
    token = gcp_auth.access_token(cred, gcp_auth.SCOPE_CLOUD_PLATFORM)
    if not token:
        raise SttError("Google Speech-to-Text: falha ao obter access token")

    project = gcp_auth.project_id(cred)
    if not project:
        raise SttError("Google Speech-to-Text: projeto GCP não identificado")

    config: dict = {
        # Detecta o formato pelo cabeçalho do próprio arquivo (WebM/Opus do
        # navegador, mas serve para qualquer container suportado) — evita ter
        # que acertar sampleRateHertz/encoding na mão para cada aparelho.
        "autoDecodingConfig": {},
        "languageCodes": [language],
        "model": "long",
        "features": {"enableAutomaticPunctuation": True},
    }
    if hints:
        config["adaptation"] = {
            "phraseSets": [
                {
                    "inlinePhraseSet": {
                        "phrases": [{"value": h, "boost": 10} for h in hints]
                    }
                }
            ]
        }

    corpo = {"config": config, "content": base64.b64encode(audio).decode("ascii")}

    with httpx.Client(timeout=_TIMEOUT) as client:
        r = client.post(
            _RECOGNIZE_URL.format(project=project),
            headers={"Authorization": f"Bearer {token}"},
            json=corpo,
        )
    if r.status_code >= 400:
        raise SttError(f"Google STT {r.status_code}: {r.text[:200]}")

    resultados = r.json().get("results") or []
    if not resultados:
        return {"text": "", "confidence": 0.0, "duration_seconds": 0.0}

    trechos: list[str] = []
    confidencias: list[float] = []
    duracao = 0.0
    for resultado in resultados:
        alternativas = resultado.get("alternatives") or []
        if not alternativas:
            continue
        melhor = alternativas[0]
        texto = (melhor.get("transcript") or "").strip()
        if texto:
            trechos.append(texto)
        if "confidence" in melhor:
            confidencias.append(melhor["confidence"])
        duracao = max(duracao, _parse_offset(resultado.get("resultEndOffset")))

    return {
        "text": " ".join(trechos).strip(),
        "confidence": (sum(confidencias) / len(confidencias)) if confidencias else 0.0,
        "duration_seconds": round(duracao, 2),
    }


# ---------------------------------------------------------------------------
# Contador de uso mensal
# ---------------------------------------------------------------------------
# "Antes de abrir para usuários, senão o custo só aparece na fatura" — o teto
# é por usuário/mês, não por request: o risco real é alguém esquecendo o
# microfone gravando, não uma frase isolada de vez em quando.

def _monthly_limit_seconds() -> int:
    return int(
        os.getenv("VOICE_STT_MONTHLY_LIMIT_SECONDS", _DEFAULT_MONTHLY_LIMIT_SECONDS)
    )


def _year_month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def seconds_used_this_month(user_id: str) -> int:
    res = (
        supabase.table("voice_stt_usage")
        .select("seconds_used")
        .eq("user_id", user_id)
        .eq("year_month", _year_month())
        .execute()
    )
    linhas = res.data or []
    return linhas[0]["seconds_used"] if linhas else 0


def check_quota(user_id: str) -> None:
    """
    Levanta `SttQuotaExceeded` se o usuário já estourou o teto do mês.

    Limite <= 0 desliga o teto (útil em desenvolvimento, onde não faz sentido
    contar).
    """
    limite = _monthly_limit_seconds()
    if limite <= 0:
        return
    if seconds_used_this_month(user_id) >= limite:
        raise SttQuotaExceeded(f"limite mensal de {limite}s de transcrição atingido")


def record_usage(user_id: str, seconds: float) -> None:
    """Soma `seconds` ao contador do mês corrente. Idempotente pela PK composta."""
    if seconds <= 0:
        return
    mes = _year_month()
    usado = seconds_used_this_month(user_id)
    supabase.table("voice_stt_usage").upsert(
        {
            "user_id": user_id,
            "year_month": mes,
            "seconds_used": usado + round(seconds),
        },
        on_conflict="user_id,year_month",
    ).execute()
