"""
Síntese de voz (texto → áudio) do Axon, com três provedores intercambiáveis.

A voz nativa do aparelho foi testada e reprovada por soar artificial demais, então
a voz do Axon passa a ser gerada no servidor. Como a escolha entre provedores é
de GOSTO (qual voz "combina com o Axon"), os três ficam disponíveis ao mesmo
tempo e a decisão é tomada ouvindo, não no papel.

Cada provedor é a mesma coisa por baixo — um POST que devolve MP3 — então o que
varia é só o corpo do pedido e o cabeçalho de autenticação. Adicionar um quarto
provedor é escrever uma função `_synthesize_*` e registrá-la em `_PROVIDERS`.

Nenhum provedor é obrigatório: quem não tem credencial configurada simplesmente
não aparece na lista. O Google não precisa de chave nova — reusa a service
account do Firebase que o push já usa.
"""

import hashlib
import os
import threading

import httpx

from services import gcp_auth

# A síntese entra no caminho da resposta falada; um provedor lento trava a
# conversa inteira. Melhor falhar e deixar o texto na tela.
_TIMEOUT = 20.0

_MAX_CHARS = 2_000

# Cache em memória: frases como "Pronto, criei a tarefa" repetem muito, e cada
# repetição seria uma cobrança nova. Um dicionário simples resolve — o processo
# é único no VPS e o volume é pequeno. (Se crescer, vira arquivo/Storage.)
_CACHE_MAX_ITEMS = 300
_cache: dict[str, bytes] = {}
_cache_ordem: list[str] = []
_cache_lock = threading.Lock()


class TtsError(RuntimeError):
    """Falha ao sintetizar. O router traduz para HTTP; o app cai no texto."""


# ---------------------------------------------------------------------------
# Catálogo de vozes
# ---------------------------------------------------------------------------
# Vozes pt-BR de cada provedor. A ideia é oferecer poucas e boas para a escolha
# ser possível de fazer ouvindo, em vez de uma lista interminável.

VOICES: list[dict] = [
    # --- Google Cloud TTS (Chirp3-HD: a geração mais natural deles) ----------
    {"id": "google:pt-BR-Chirp3-HD-Aoede",      "provider": "google", "name": "Aoede",   "gender": "feminina", "note": "Chirp3 HD"},
    {"id": "google:pt-BR-Chirp3-HD-Charon",     "provider": "google", "name": "Charon",  "gender": "masculina", "note": "Chirp3 HD"},
    {"id": "google:pt-BR-Chirp3-HD-Kore",       "provider": "google", "name": "Kore",    "gender": "feminina", "note": "Chirp3 HD"},
    {"id": "google:pt-BR-Chirp3-HD-Puck",       "provider": "google", "name": "Puck",    "gender": "masculina", "note": "Chirp3 HD"},
    {"id": "google:pt-BR-Chirp3-HD-Fenrir",     "provider": "google", "name": "Fenrir",  "gender": "masculina", "note": "Chirp3 HD"},
    {"id": "google:pt-BR-Neural2-C",            "provider": "google", "name": "Neural2 C", "gender": "feminina", "note": "mais econômica"},

    # --- ElevenLabs (vozes multilíngues do catálogo padrão) -----------------
    {"id": "elevenlabs:XrExE9yKIg1WjnnlVkGX",   "provider": "elevenlabs", "name": "Matilda", "gender": "feminina", "note": "calorosa"},
    {"id": "elevenlabs:pNInz6obpgDQGcFmaJgB",   "provider": "elevenlabs", "name": "Adam",    "gender": "masculina", "note": "grave"},
    {"id": "elevenlabs:EXAVITQu4vr4xnSDxMaL",   "provider": "elevenlabs", "name": "Sarah",   "gender": "feminina", "note": "suave"},
    {"id": "elevenlabs:TX3LPaxmHKxFdv7VOQHJ",   "provider": "elevenlabs", "name": "Liam",    "gender": "masculina", "note": "jovem"},

    # --- OpenAI -------------------------------------------------------------
    {"id": "openai:nova",    "provider": "openai", "name": "Nova",    "gender": "feminina", "note": "clara"},
    {"id": "openai:shimmer", "provider": "openai", "name": "Shimmer", "gender": "feminina", "note": "leve"},
    {"id": "openai:onyx",    "provider": "openai", "name": "Onyx",    "gender": "masculina", "note": "grave"},
    {"id": "openai:alloy",   "provider": "openai", "name": "Alloy",   "gender": "neutra",   "note": "equilibrada"},
]

DEFAULT_VOICE = "google:pt-BR-Chirp3-HD-Fenrir"

_BY_ID = {v["id"]: v for v in VOICES}


def _has_google() -> bool:
    return gcp_auth.service_account() is not None


def _has_elevenlabs() -> bool:
    return bool(os.getenv("ELEVENLABS_API_KEY"))


def _has_openai() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


_AVAILABILITY = {
    "google": _has_google,
    "elevenlabs": _has_elevenlabs,
    "openai": _has_openai,
}


def available_voices() -> list[dict]:
    """
    Vozes que realmente dá para usar agora — as dos provedores com credencial
    configurada. Sem isto o app ofereceria uma voz que sempre falha.
    """
    return [
        {k: v for k, v in voz.items()}
        for voz in VOICES
        if _AVAILABILITY[voz["provider"]]()
    ]


def is_configured() -> bool:
    """True se pelo menos um provedor pode sintetizar."""
    return any(check() for check in _AVAILABILITY.values())


# ---------------------------------------------------------------------------
# Provedores
# ---------------------------------------------------------------------------

def _synthesize_google(texto: str, voice_name: str, speed: float) -> bytes:
    cred = gcp_auth.service_account()
    if not cred:
        raise TtsError("Google TTS sem credencial configurada")
    token = gcp_auth.access_token(cred, gcp_auth.SCOPE_CLOUD_PLATFORM)
    if not token:
        raise TtsError("Google TTS: falha ao obter access token")

    corpo = {
        "input": {"text": texto},
        "voice": {"languageCode": "pt-BR", "name": voice_name},
        "audioConfig": {"audioEncoding": "MP3", "speakingRate": speed},
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        r = client.post(
            "https://texttospeech.googleapis.com/v1/text:synthesize",
            headers={"Authorization": f"Bearer {token}"},
            json=corpo,
        )
    if r.status_code >= 400:
        raise TtsError(f"Google TTS {r.status_code}: {r.text[:200]}")

    import base64
    conteudo = r.json().get("audioContent")
    if not conteudo:
        raise TtsError("Google TTS não devolveu áudio")
    return base64.b64decode(conteudo)


def _synthesize_elevenlabs(texto: str, voice_id: str, speed: float) -> bytes:
    chave = os.getenv("ELEVENLABS_API_KEY")
    if not chave:
        raise TtsError("ElevenLabs sem ELEVENLABS_API_KEY")

    # Flash v2.5: o modelo de menor latência deles, que é o que importa numa
    # conversa falada. `eleven_multilingual_v2` soa um pouco melhor mas é lento.
    modelo = os.getenv("ELEVENLABS_MODEL", "eleven_flash_v2_5")
    corpo = {
        "text": texto,
        "model_id": modelo,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "speed": speed},
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        r = client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            headers={"xi-api-key": chave, "accept": "audio/mpeg"},
            json=corpo,
        )
    if r.status_code >= 400:
        raise TtsError(f"ElevenLabs {r.status_code}: {r.text[:200]}")
    return r.content


def _synthesize_openai(texto: str, voice: str, speed: float) -> bytes:
    chave = os.getenv("OPENAI_API_KEY")
    if not chave:
        raise TtsError("OpenAI sem OPENAI_API_KEY")

    corpo = {
        "model": os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
        "input": texto,
        "voice": voice,
        "response_format": "mp3",
        "speed": speed,
        # A OpenAI aceita instrução de estilo — útil para a voz não soar como
        # locutor de propaganda lendo um roteiro.
        "instructions": "Fale em português do Brasil, em tom natural e conversacional, como um amigo prestativo.",
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        r = client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {chave}"},
            json=corpo,
        )
    if r.status_code >= 400:
        raise TtsError(f"OpenAI TTS {r.status_code}: {r.text[:200]}")
    return r.content


_PROVIDERS = {
    "google": _synthesize_google,
    "elevenlabs": _synthesize_elevenlabs,
    "openai": _synthesize_openai,
}


# ---------------------------------------------------------------------------
# Entrada pública
# ---------------------------------------------------------------------------

def _cache_get(chave: str) -> bytes | None:
    with _cache_lock:
        return _cache.get(chave)


def _cache_put(chave: str, audio: bytes) -> None:
    with _cache_lock:
        if chave in _cache:
            return
        _cache[chave] = audio
        _cache_ordem.append(chave)
        # Descarta o mais antigo quando encher (FIFO simples).
        while len(_cache_ordem) > _CACHE_MAX_ITEMS:
            _cache.pop(_cache_ordem.pop(0), None)


def synthesize(texto: str, voice_id: str | None = None, speed: float = 1.0) -> tuple[bytes, bool]:
    """
    Sintetiza `texto` e devolve `(audio_mp3, veio_do_cache)`.

    Levanta `TtsError` quando o provedor falha ou não está configurado — quem
    chama decide o que fazer (o app cai para o texto na tela, sem quebrar).
    """
    texto = (texto or "").strip()
    if not texto:
        raise TtsError("texto vazio")
    if len(texto) > _MAX_CHARS:
        raise TtsError(f"texto acima de {_MAX_CHARS} caracteres")

    voz = _BY_ID.get(voice_id or DEFAULT_VOICE)
    if not voz:
        raise TtsError(f"voz desconhecida: {voice_id}")
    if not _AVAILABILITY[voz["provider"]]():
        raise TtsError(f"provedor {voz['provider']} não está configurado")

    speed = max(0.5, min(2.0, speed))

    chave = hashlib.sha1(
        f"{voz['id']}|{speed:.2f}|{texto}".encode("utf-8")
    ).hexdigest()

    em_cache = _cache_get(chave)
    if em_cache is not None:
        return em_cache, True

    # O id carrega o provedor no prefixo ("google:pt-BR-..."), então o nome real
    # da voz é o que vem depois dos dois-pontos.
    nome_na_api = voz["id"].split(":", 1)[1]
    audio = _PROVIDERS[voz["provider"]](texto, nome_na_api, speed)

    if not audio:
        raise TtsError(f"{voz['provider']} devolveu áudio vazio")

    _cache_put(chave, audio)
    return audio, False
