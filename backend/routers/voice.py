"""
Rotas de voz do Axon.

Síntese (texto → áudio), transcrição (áudio → texto) e a mensagem completa por
voz — que junta as duas pontas com o agente, reusando exatamente o mesmo
caminho do chat de texto (`services/chat_context.py`). A voz não é um segundo
agente: é outra porta de entrada para o mesmo, por isso nada aqui duplica o
que `routers/chat.py` já faz.
"""

import json
import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

from auth_helper import get_current_user
from limiter import chat_limiter
from models.schemas import ChatMessage, TranscribeResponse, TtsRequest
from services import chat_context, claude_service, stt_service, tts_service

router = APIRouter(prefix="/voice", tags=["voice"])

_MAX_HISTORY = 50
_MAX_TRANSCRIPT_LEN = 4_000

# Mesmas funções que `routers/chat.py` usa para a conversa digitada — ver
# services/chat_context.py.
_load_perfil = chat_context.load_perfil
_load_conversation_type = chat_context.load_conversation_type
_stream_and_save = chat_context.stream_and_save


def _voice_thinking() -> bool:
    """
    Desligado por padrão: o raciocínio adaptativo melhora as decisões de
    ferramenta, mas atrasa o primeiro token em até alguns segundos — numa
    conversa falada isso é sentido como travamento (~0,8s de ganho real,
    medido). VOICE_THINKING=1 liga de volta sem precisar de deploy.
    """
    return os.getenv("VOICE_THINKING", "0") == "1"


def _parse_history(raw: str) -> list[dict]:
    """Decodifica o campo `history` (JSON dentro de um form multipart)."""
    try:
        items = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="history inválido (JSON malformado)")
    if not isinstance(items, list):
        raise HTTPException(status_code=422, detail="history inválido (esperado uma lista)")

    parsed = []
    for item in items[-_MAX_HISTORY:]:
        try:
            msg = ChatMessage(**item)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="history inválido")
        parsed.append({"role": msg.role, "content": msg.content})
    return parsed


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
    Transcreve uma gravação do usuário, sem envolver o agente.

    O limite (30/min) é bem mais apertado que o do TTS: lá cada chamada é uma
    frase da resposta do Axon, aqui é uma gravação inteira do usuário.
    """
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=422, detail="Envie um arquivo de áudio.")

    conteudo = await audio.read()

    try:
        resultado = stt_service.transcribe_billed(current_user["id"], conteudo, audio.content_type, language)
    except stt_service.SttQuotaExceeded as e:
        raise HTTPException(status_code=429, detail=str(e))
    except stt_service.SttError as e:
        # 502: quem falhou foi o provedor, não o pedido do usuário.
        raise HTTPException(status_code=502, detail=str(e))

    return resultado


@router.post("/message")
@chat_limiter.limit("30/minute")
async def voice_message(
    request: Request,
    audio: UploadFile = File(...),
    conversation_id: str = Form(...),
    history: str = Form("[]"),
    language: str = Form("pt-BR"),
    current_user: dict = Depends(get_current_user),
):
    """
    Uma gravação inteira vira uma rodada completa da conversa: transcreve,
    manda para o agente (mesmas ferramentas do chat de texto, exceto as de
    exclusão — ver agent_tools.tools_for_conversation) e devolve a resposta em
    streaming. Multipart entra, SSE sai — mesmo formato do `/chat/message`,
    com UM evento a mais na frente.

    Eventos SSE emitidos, nesta ordem:
      - {"transcript": "..."}  o que foi entendido — primeiro evento, para o
                                usuário ver de imediato que foi ouvido direito
      - {"text": "..."}        delta de texto da resposta (igual ao chat)
      - {"tool": ...}          mesmo formato do chat de texto
      - [DONE]
    """
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=422, detail="Envie um arquivo de áudio.")

    user_id = current_user["id"]
    history_msgs = _parse_history(history)
    conteudo = await audio.read()

    try:
        resultado = stt_service.transcribe_billed(user_id, conteudo, audio.content_type, language)
    except stt_service.SttQuotaExceeded as e:
        raise HTTPException(status_code=429, detail=str(e))
    except stt_service.SttError as e:
        raise HTTPException(status_code=502, detail=str(e))

    transcript = resultado["text"].strip()[:_MAX_TRANSCRIPT_LEN]
    if not transcript:
        # Segundos processados e bytes recebidos ajudam a diferenciar "gravou
        # pouco ou nada" (bug de captura, ambos próximos de 0) de "gravou
        # normal, mas não tinha fala reconhecível" (mic mudo, ruído, silêncio).
        raise HTTPException(
            status_code=422,
            detail=(
                "Não entendi nada no áudio. Tente falar de novo, mais perto do microfone. "
                f"(recebido: {len(conteudo)} bytes, {resultado['duration_seconds']}s processados)"
            ),
        )

    perfil = _load_perfil(user_id, request.headers.get("X-Timezone"))
    perfil["conversation_type"] = _load_conversation_type(conversation_id, user_id)
    system_prompt = claude_service.build_agent_prompt(perfil, perfil.get("memories", []), voice=True)

    history_msgs.append({"role": "user", "content": transcript})

    def _stream():
        yield f"data: {json.dumps({'transcript': transcript}, ensure_ascii=False)}\n\n"
        yield from _stream_and_save(
            user_id, conversation_id, transcript, history_msgs, system_prompt,
            perfil.get("timezone"), perfil["conversation_type"],
            thinking=_voice_thinking(), voice=True,
        )

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
