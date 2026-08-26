"""
Ofensiva (foguinho) — dias consecutivos com registro diário feito.

REGRA: nenhum dia pode ficar sem registro. A ofensiva é uma sequência SEM
buracos — um único dia fechado em branco a encerra.

O que dá folga ao usuário não é um perdão, é a janela de retroatividade: o app
aceita registrar hoje OU ontem, então dá para passar um dia inteiro longe do
app (descanso completo, sem abrir nada) e ainda manter a ofensiva registrando
aquele dia no dia seguinte. Quem deixa o prazo vencer perde a sequência.

Por que contar por `daily_logs.date` e nunca por `created_at`: registrar ontem é
o padrão real de uso — a maioria dos registros é criada no dia seguinte ao dia
que descreve. Usar a data de criação zeraria a ofensiva de quem registra
religiosamente toda manhã.

Por que CALCULAR em vez de armazenar: uma ofensiva guardada em coluna precisa de
um job diário rodando no fuso de cada usuário; se ele falhar uma noite, a
ofensiva de todos zera sem ter havido falta, e o dado é irrecuperável. Calculada
a partir dos registros, ela é sempre verdadeira e reconstruível.

Dia livre (`is_day_off`) conta como dia registrado: a ofensiva mede o hábito de
registrar, não de produzir.
"""

from datetime import date, timedelta

# Janela de busca. Cobre ofensivas longas sem varrer a tabela inteira; uma
# ofensiva maior que isso é truncada aqui (aceitável: o número segue subindo,
# só não conseguimos provar o começo dela).
LOOKBACK_DAYS = 400

def compute_streak(
    dates: set[str],
    today: date,
    forfeits: set[str] | None = None,
) -> dict:
    """
    Calcula a ofensiva a partir do conjunto de datas registradas (ISO).

    Pura — sem I/O — para que todos os casos de borda sejam testáveis sem banco.

    SEMÂNTICA DE "HOJE": o dia corrente ainda está em aberto e nunca encerra a
    sequência — o usuário tem até a virada para registrar. O primeiro dia que
    pode estar em branco é ONTEM.

    "Ontem" é um caso especial e não um dia comum: ele ainda é registrável (o
    app aceita hoje ou ontem), então ontem em branco deixa a ofensiva CONGELADA,
    não quebrada — é a dívida que o usuário ainda pode pagar hoje. De anteontem
    para trás, um dia em branco encerra a sequência de vez: o prazo dele venceu.

    Retorna:
      current          — dias consecutivos registrados
      longest          — maior sequência da janela
      frozen           — ontem está em branco e ainda dá tempo de registrar;
                         sem isso hoje, a ofensiva se perde
      registered_today — se hoje já foi registrado
      at_risk          — hoje em aberto com ofensiva viva
      pending_date     — o dia que precisa ser registrado para salvar a
                         ofensiva (ISO), ou None
    """
    # Dias em que o usuário confirmou que não ia registrar. Valem como buraco
    # mesmo que um registro apareça depois: ele abriu mão conscientemente, e
    # deixar o registro tardio salvar a ofensiva tornaria a confirmação
    # inofensiva — o aviso perderia o sentido.
    perdidos = forfeits or set()
    registrado = lambda d: str(d) in dates and str(d) not in perdidos

    registered_today = registrado(today)
    ontem = today - timedelta(days=1)
    ontem_registrado = registrado(ontem)

    # A varredura começa no dia mais recente que JÁ conta como obrigatório.
    # Hoje só entra se registrado (senão continua em aberto); ontem só entra se
    # registrado (senão é a dívida em aberto, tratada abaixo como congelamento).
    if registered_today:
        cursor = today
    elif ontem_registrado:
        cursor = ontem
    elif str(ontem) in perdidos:
        # Desistiu de ontem: a sequência anterior morreu ali. Só o que vier de
        # hoje em diante conta, e hoje ainda não foi registrado — logo, zero.
        # Sem este ramo o cursor pularia para anteontem e a sequência antiga
        # continuaria sendo exibida como viva.
        cursor = today + timedelta(days=1)  # nunca entra no laço
    else:
        cursor = today - timedelta(days=2)

    current = 0
    limite = today - timedelta(days=LOOKBACK_DAYS)
    while cursor >= limite and registrado(cursor):
        current += 1
        cursor -= timedelta(days=1)

    # Ontem em branco: a sequência anterior está viva mas pendente. Só faz
    # sentido enquanto hoje não foi registrado — se ele registrou hoje e pulou
    # ontem, o prazo de ontem venceu junto com o dia, e a contagem acima já
    # começou em hoje, valendo 1.
    # Desistir de ontem encerra a chance: não há mais o que congelar.
    frozen = (
        not registered_today
        and not ontem_registrado
        and str(ontem) not in perdidos
        and current > 0
    )

    pending = None
    if frozen:
        pending = str(ontem)
    elif not registered_today:
        pending = str(today)

    return {
        "current": current,
        "longest": _longest(dates - perdidos, today),
        "frozen": frozen,
        "registered_today": registered_today,
        "at_risk": not registered_today and current > 0,
        "pending_date": pending,
    }


def _longest(dates: set[str], today: date) -> int:
    """
    Maior sequência sem buracos da janela.

    Percorre do dia mais antigo ao mais recente uma vez só; qualquer dia em
    branco zera a contagem corrente.
    """
    if not dates:
        return 0

    dia = date.fromisoformat(min(dates))
    fim = date.fromisoformat(min(max(dates), str(today)))

    melhor = atual = 0
    while dia <= fim:
        atual = atual + 1 if str(dia) in dates else 0
        melhor = max(melhor, atual)
        dia += timedelta(days=1)

    return melhor


def get_streak(user_id: str, today: date) -> dict:
    """Busca os registros da janela e devolve a ofensiva do usuário."""
    from database import supabase

    inicio = str(today - timedelta(days=LOOKBACK_DAYS))
    rows = (
        supabase.table("daily_logs")
        .select("date")
        .eq("user_id", user_id)
        .gte("date", inicio)
        .lte("date", str(today))
        .execute()
        .data
    ) or []

    # Falha silenciosa por escolha: se a tabela de desistências estiver
    # indisponível, mostrar a ofensiva sem elas é melhor que derrubar o
    # dashboard inteiro. O erro é para mais, nunca para menos.
    try:
        fr = (
            supabase.table("streak_forfeits")
            .select("date")
            .eq("user_id", user_id)
            .gte("date", inicio)
            .lte("date", str(today))
            .execute()
            .data
        ) or []
        forfeits = {str(f["date"]) for f in fr}
    except Exception:
        forfeits = set()

    return compute_streak({str(r["date"]) for r in rows}, today, forfeits)


def forfeit_day(user_id: str, day: date) -> None:
    """
    Registra que o usuário abriu mão da ofensiva naquele dia.

    Idempotente pela PK composta (user_id, date): confirmar duas vezes o mesmo
    dia não cria linha duplicada nem levanta erro.
    """
    from database import supabase

    supabase.table("streak_forfeits").upsert(
        {"user_id": user_id, "date": str(day)},
        on_conflict="user_id,date",
    ).execute()
