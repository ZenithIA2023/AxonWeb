"""
Rotas de voz do Axon.

Síntese (texto → áudio) e transcrição (áudio → texto). O `POST /voice/message`
— que junta as duas pontas com o agente, na Fase 3 — entra aqui na sequência.
"""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response

from auth_helper import get_current_user
from limiter import chat_limiter
from models.schemas import TranscribeResponse, TtsRequest
from services import stt_service, tts_service

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


@router.post("/transcribe", response_model=TranscribeResponse)
@chat_limiter.limit("30/minute")
async def transcribe(
    request: Request,
    audio: UploadFile = File(...),
    language: str = Form("pt-BR"),
    current_user: dict = Depends(get_current_user),
):
    """
    Transcreve uma gravação do usuário.

    O limite (30/min) é bem mais apertado que o do TTS: lá cada chamada é uma
    frase da resposta do Axon, aqui é uma gravação inteira do usuário.
    """
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=422, detail="Envie um arquivo de áudio.")

    user_id = current_user["id"]

    try:
        stt_service.check_quota(user_id)
    except stt_service.SttQuotaExceeded as e:
        raise HTTPException(status_code=429, detail=str(e))

    conteudo = await audio.read()

    try:
        resultado = stt_service.transcribe(conteudo, audio.content_type, language)
    except stt_service.SttError as e:
        # 502: quem falhou foi o provedor, não o pedido do usuário.
        raise HTTPException(status_code=502, detail=str(e))

    # Registrado mesmo se o resultado vier vazio (silêncio, ruído): o Google já
    # cobrou pelo tempo de áudio processado, quer tenha reconhecido fala ou não.
    stt_service.record_usage(user_id, resultado["duration_seconds"])

    return resultado
