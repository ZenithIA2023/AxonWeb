import os
import json
import anthropic

# Reexportado por compatibilidade: a montagem do prompt agora vive em services/prompts.py
from services.prompts import build_agent_prompt
from services import agent_tools

_MODEL = "claude-sonnet-4-6"
# Teto de rodadas de tool use numa mesma requisição, para evitar laço infinito.
_MAX_TOOL_ROUNDS = 5


def _text_from_content(content) -> str:
    """Concatena todos os blocos de texto da resposta (ignora thinking/tool_use)."""
    return "".join(b.text for b in content if getattr(b, "type", None) == "text")


def call_chat(
    messages: list[dict],
    system_prompt,
    *,
    thinking: bool = True,
    max_tokens: int = 4096,
) -> str:
    """
    Chamada simples ao Claude, devolvendo só o texto.

    `thinking=False` desliga o raciocínio adaptativo. Existe para as chamadas
    que só produzem JSON estruturado a partir de dados já calculados, onde o
    raciocínio custava caro sem melhorar o resultado: nos insights ele consumia
    ~14k tokens e devolvia MENOS padrões que a versão sem thinking (10 contra
    14), porque o orçamento de tokens é compartilhado entre pensar e escrever —
    o raciocínio chegava a esgotá-lo antes da resposta começar, e a aba exibia
    "não foi possível gerar insights". O chat mantém o padrão (thinking ligado).
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    kwargs = {"thinking": {"type": "adaptive"}} if thinking else {}
    response = client.messages.create(
        model=_MODEL,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=messages,
        **kwargs,
    )
    if response.stop_reason == "refusal":
        return "Desculpe, não consigo ajudar com esse pedido específico. Podemos tentar outra coisa?"

    text = _text_from_content(response.content)
    # Sem esta checagem, um corte por max_tokens vira string vazia silenciosa: o
    # parse devolve [], o endpoint mostra "não foi possível gerar" e nada indica
    # a causa. Foi assim que o bug dos insights passou despercebido.
    if not text and response.stop_reason == "max_tokens":
        raise RuntimeError(
            f"Resposta cortada por max_tokens ({max_tokens}) antes de gerar texto "
            f"— aumente max_tokens ou desligue o thinking nesta chamada."
        )
    return text


def stream_chat(messages: list[dict], system_prompt: str):
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    with client.messages.stream(
        model=_MODEL,
        max_tokens=512,
        system=system_prompt,
        messages=messages,
    ) as stream:
        for text in stream.text_stream:
            yield f"data: {json.dumps({'text': text})}\n\n"
    yield "data: [DONE]\n\n"


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def stream_chat_with_tools(
    messages: list[dict],
    system_prompt: str,
    user_id: str,
    tz_name: str | None = None,
    conversation_type: str = "regular",
    *,
    thinking: bool = True,
):
    """
    Streaming SSE com o loop de tool use do Anthropic.

    A cada rodada: faz streaming do texto; se o modelo pediu ferramentas
    (stop_reason == "tool_use"), executa cada uma via agent_tools.execute_tool
    (respeitando o user_id), devolve os tool_results e continua o loop até o
    modelo dar uma resposta final em texto.

    `thinking=False` desliga o raciocínio adaptativo — mesmo parâmetro que
    `call_chat` já expõe. Existe para a conversa por voz: o raciocínio melhora as
    decisões de ferramenta, mas atrasa o primeiro token, e numa conversa falada
    esse atraso é sentido como travamento. Ver VOICE_THINKING em routers/voice.py.

    Eventos SSE emitidos:
      - {"text": "..."}                              delta de texto
      - {"tool": name, "status": "running", "label", "input"}
      - {"tool": name, "status": "done", "ok": bool, "mutating": bool}
      - [DONE]
    """
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    convo = list(messages)
    tools = agent_tools.tools_for_conversation(conversation_type)
    thinking_kwargs = {"thinking": {"type": "adaptive"}} if thinking else {}

    for _ in range(_MAX_TOOL_ROUNDS):
        with client.messages.stream(
            model=_MODEL,
            max_tokens=8192,
            system=system_prompt,
            tools=tools,
            messages=convo,
            **thinking_kwargs,
        ) as stream:
            for text in stream.text_stream:
                yield _sse({"text": text})
            final = stream.get_final_message()

        # Se max_tokens foi atingido, a geração foi cortada. Pode ter acontecido
        # no meio de um bloco tool_use (a ferramenta nunca seria chamada) ou no
        # meio do texto de resposta. Avisa o usuário explicitamente em vez de
        # fingir que tudo correu bem.
        if final.stop_reason == "max_tokens":
            yield _sse({"text": "\n\n⚠️ Resposta interrompida (limite de tokens atingido). Por favor, repita seu pedido."})
            break

        # Classificadores de segurança podem recusar o pedido (HTTP 200 com
        # stop_reason "refusal"). Avisamos o usuário em vez de encerrar em silêncio.
        if final.stop_reason == "refusal":
            yield _sse({"text": "\n\nDesculpe, não consigo ajudar com esse pedido específico. Podemos tentar outra coisa?"})
            break

        if final.stop_reason != "tool_use":
            break

        # Serializa os blocos para dicts limpos — o SDK adiciona campos extras
        # (ex.: "caller", "citations") que a API rejeita quando reenviados.
        content_dicts = []
        for b in final.content:
            if b.type == "text":
                content_dicts.append({"type": "text", "text": b.text})
            elif b.type == "thinking":
                # Com thinking ligado, os blocos de raciocínio precisam ser
                # reenviados sem alteração (com a assinatura) numa rodada de tool use.
                content_dicts.append({
                    "type": "thinking",
                    "thinking": b.thinking,
                    "signature": b.signature,
                })
            elif b.type == "redacted_thinking":
                content_dicts.append({"type": "redacted_thinking", "data": b.data})
            elif b.type == "tool_use":
                content_dicts.append({
                    "type": "tool_use",
                    "id": b.id,
                    "name": b.name,
                    "input": b.input,
                })

        convo.append({"role": "assistant", "content": content_dicts})

        tool_results = []
        for block in final.content:
            if block.type != "tool_use":
                continue

            yield _sse({
                "tool": block.name,
                "status": "running",
                "label": agent_tools.TOOL_LABELS.get(block.name, block.name),
                "input": block.input,
            })

            out = agent_tools.execute_tool(block.name, block.input, user_id, tz_name)

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(out, ensure_ascii=False),
            })

            done_event: dict = {
                "tool": block.name,
                "status": "done",
                "ok": out.get("ok", False),
                "mutating": block.name in agent_tools.MUTATING_TOOLS,
            }
            # Para tools de memória, inclui o conteúdo para exibir ao usuário.
            if block.name in ("salvar_memoria", "atualizar_memoria") and out.get("ok"):
                done_event["summary"] = out.get("memory", {}).get("content")
            yield _sse(done_event)

        convo.append({"role": "user", "content": tool_results})

    yield "data: [DONE]\n\n"
