"""
Regra do "dia livre" — descanso deliberado no registro diário.

Existe como módulo próprio porque a mesma pergunta ("este dia foi descanso?")
é feita em momentos que não se conhecem: ao salvar o registro, ao migrar dados
antigos e ao analisar. Sem um lugar único, o marcador seria comparado com
string literal em cada um deles e sairiam de sincronia na primeira mudança.

Por que um marcador FIXO e não uma tag de texto livre: marcar dia livre é uma
decisão de cálculo — esses dias saem das médias de desempenho em vez de
contarem como produtividade baixa. Isso exige um valor estável. Antes de o
campo existir, um mesmo usuário registrou "Dia livre", "Dia de descanço" e
"Não fiz nada" em dias diferentes, e o slugify do frontend apaga acentos sem
substituir (o "ç" de descanço sumiu, gerando `custom_dia_de_descano`). Três
grafias, três slugs, nada agrupava.

ONDE O USUÁRIO MARCA: na seção "Quando você foi mais produtivo?", como uma
opção ao lado dos períodos — é ali que a pergunta "e se não teve pico nenhum?"
aparece naturalmente. Mas o dia livre NÃO é um período: não tem faixa de
horário nem posição no ranking, então ele viaja no campo próprio
`is_day_off`, nunca dentro de `peak_periods`. Misturar os dois faria um
"1º Dia livre" empurrar o score de blocos de horário que não existem.

Os dois convivem: marcar dia livre E dizer que rendeu bem de manhã é
informação legítima (folga em que se produziu algo), e a calibração usa os
períodos normalmente.
"""

# O valor canônico do marcador. Espelhado em
# axonweb/src/data/dayReviewTags.DAY_OFF_OPTION — mudar aqui exige mudar lá.
# NÃO entra em models/schemas._VALID_PEAK_PERIODS de propósito: não é período.
DAY_OFF_TAG = "dia_livre"

# Grafias que usuários criaram à mão ANTES de a tag padrão existir. Usadas só
# na migração de dados históricos (scripts/migrate_day_off.py), nunca no fluxo
# normal: daqui em diante a tag padrão é o único caminho.
#
# Deliberadamente NÃO inclui variações de "não fiz nada": essa frase tanto pode
# ser folga planejada quanto frustração com um dia perdido, e é exatamente essa
# diferença que o campo existe para registrar. Marcar por engano introduz o
# viés que queríamos eliminar.
LEGACY_DAY_OFF_SLUGS = frozenset({
    "custom_dia_livre",
    "custom_dia_de_descanso",
    "custom_dia_de_descano",   # slugify removeu o "ç" de "descanço"
    "custom_dia_de_descanco",
    "custom_descanso",
    "custom_folga",
    "custom_dia_de_folga",
})


def strip_day_off(peak_periods: list[str] | None) -> tuple[list[str], bool]:
    """
    Separa o marcador de dia livre dos períodos de pico.

    O frontend mostra "Dia livre" junto dos 7 períodos, porque é ali que a
    pergunta faz sentido para quem responde. Se ele chegar dentro de
    `peak_periods`, tiramos daqui: o validador do schema só aceita períodos
    reais, e a calibração mapearia o marcador para uma lista vazia de blocos,
    inflando silenciosamente o ranking (o que viesse depois viraria 2º lugar
    sem nunca ter sido o 2º na cabeça do usuário).

    Devolve (períodos limpos, era_dia_livre).
    """
    periodos = list(peak_periods or [])
    if DAY_OFF_TAG not in periodos:
        return periodos, False
    return [p for p in periodos if p != DAY_OFF_TAG], True


def resolve_day_off(peak_periods: list[str] | None, explicit: bool) -> bool:
    """
    Valor final de `is_day_off` a partir das entradas que o usuário tem.

    O botão na seção de períodos e o campo explícito são a MESMA informação,
    então qualquer um marcado significa dia livre — não são fontes concorrentes
    que precisem de desempate. Quem marcasse e não visse efeito acharia que o
    app ignorou o clique.
    """
    return bool(explicit) or DAY_OFF_TAG in (peak_periods or [])
