"""
Rotas de voz do Axon.

Por ora só a síntese (texto → áudio): a voz nativa do aparelho foi reprovada por
soar artificial, então a fala passa a ser gerada no servidor. A transcrição
(áudio → texto) e o `POST /voice/message` entram aqui na sequência.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from auth_helper import get_current_user
from limiter import chat_limiter
from models.schemas import TtsRequest
from services import tts_service

router = APIRouter(prefix="/voice", tags=["voice"])


@router.get("/voices")
def list_voices(current_user: dict = Depends(get_current_user)):
    """
    Vozes que podem ser usadas agora — só as dos provedores com credencial.
    O app usa isto para montar o seletor; uma voz que não pode falar não aparece.
    """
    return {
        "voices": tts_service.available_voices(),
        "default": tts_service.DEFAULT_VOICE,
        "configured": tts_service.is_configured(),
    }


@router.post("/tts")
@chat_limiter.limit("120/minute")
def synthesize(
    request: Request,
    body: TtsRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Devolve o áudio MP3 da frase.

    O limite é generoso (120/min) porque a fala é cortada em FRASES: uma única
    resposta do Axon vira várias chamadas seguidas, e é isso que permite a voz
    começar antes de a resposta terminar.
    """
    try:
        audio, do_cache = tts_service.synthesize(body.text, body.voice_id, body.speed)
    except tts_service.TtsError as e:
        # 502: quem falhou foi o provedor, não o pedido do usuário. O app trata
        # isso caindo para o texto na tela em vez de quebrar a conversa.
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            # A mesma frase com a mesma voz é sempre o mesmo áudio: o navegador
            # pode guardar sem risco, e isso evita cobrança repetida.
            "Cache-Control": "private, max-age=86400",
            "X-Tts-Cache": "hit" if do_cache else "miss",
        },
    )
