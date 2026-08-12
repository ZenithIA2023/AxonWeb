ENERGY_LEVELS = {
    "morning": {
        0: 12, 1: 8,  2: 8,  3: 10, 4: 30, 5: 55,
        6: 72, 7: 85, 8: 92, 9: 95, 10: 90, 11: 82,
        12: 62, 13: 48, 14: 42, 15: 45, 16: 50, 17: 48,
        18: 42, 19: 36, 20: 30, 21: 22, 22: 16, 23: 12,
    },
    # Misto: platô amplo sem pico único. Fallback para cronotipos desconhecidos.
    "intermediate": {
        0: 18, 1: 12, 2: 10, 3: 12, 4: 22, 5: 36,
        6: 52, 7: 64, 8: 72, 9: 78, 10: 80, 11: 80,
        12: 72, 13: 65, 14: 68, 15: 74, 16: 76, 17: 72,
        18: 64, 19: 56, 20: 46, 21: 36, 22: 26, 23: 20,
    },
    "evening": {
        0: 30, 1: 20, 2: 14, 3: 10, 4: 10, 5: 12,
        6: 18, 7: 26, 8: 36, 9: 46, 10: 55, 11: 62,
        12: 64, 13: 62, 14: 60, 15: 72, 16: 82, 17: 90,
        18: 90, 19: 86, 20: 76, 21: 62, 22: 48, 23: 38,
    },
    "night": {
        0: 70, 1: 55, 2: 40, 3: 28, 4: 18, 5: 10,
        6: 10, 7: 14, 8: 20, 9: 28, 10: 34, 11: 40,
        12: 44, 13: 46, 14: 50, 15: 54, 16: 60, 17: 68,
        18: 76, 19: 84, 20: 88, 21: 90, 22: 88, 23: 80,
    },
    # Bimodal: dois picos distintos. Base: Kleitman (1963), Lavie (1986).
    "bimodal": {
        0: 14, 1: 8,  2: 8,  3: 10, 4: 22, 5: 38,
        6: 55, 7: 70, 8: 82, 9: 92, 10: 92, 11: 84,
        12: 65, 13: 48, 14: 46, 15: 58, 16: 80, 17: 90,
        18: 88, 19: 76, 20: 60, 21: 44, 22: 28, 23: 18,
    },
}

CHRONOTYPE_META: dict[str, dict] = {
    "morning": {
        "label": "Perfil Matutino",
        "energy_peak": "entre 7h e 11h",
        "focus_window": "manhã",
        "low_energy": "fim da tarde e noite",
    },
    "intermediate": {
        "label": "Perfil Misto",
        "energy_peak": "entre 10h e 17h (platô amplo)",
        "focus_window": "múltiplas janelas ao longo do dia",
        "low_energy": "depende do dia e contexto",
    },
    "evening": {
        "label": "Perfil Vespertino",
        "energy_peak": "entre 14h e 20h",
        "focus_window": "tarde e início da noite",
        "low_energy": "início da manhã",
    },
    "night": {
        "label": "Perfil Noturno",
        "energy_peak": "entre 20h e 01h",
        "focus_window": "noite",
        "low_energy": "manhã",
    },
    "Matutino": {
        "label": "Perfil Matutino",
        "energy_peak": "entre 7h e 11h",
        "focus_window": "manhã",
        "low_energy": "fim da tarde e noite",
    },
    "Vespertino": {
        "label": "Perfil Vespertino",
        "energy_peak": "entre 14h e 20h",
        "focus_window": "tarde e início da noite",
        "low_energy": "início da manhã",
    },
    "Noturno": {
        "label": "Perfil Noturno",
        "energy_peak": "entre 20h e 01h",
        "focus_window": "noite",
        "low_energy": "manhã",
    },
    "Misto": {
        "label": "Perfil Misto",
        "energy_peak": "entre 9h e 15h (com variabilidade)",
        "focus_window": "múltiplas janelas ao longo do dia",
        "low_energy": "depende do dia",
    },
    "Bimodal": {
        "label": "Perfil Bimodal",
        "energy_peak": "entre 9h–11h e 16h–18h",
        "focus_window": "manhã e fim de tarde",
        "low_energy": "entre 12h e 15h",
    },
    "bimodal": {
        "label": "Perfil Bimodal",
        "energy_peak": "entre 9h–11h e 16h–18h",
        "focus_window": "manhã e fim de tarde",
        "low_energy": "entre 12h e 15h",
    },
}


# ---------------------------------------------------------------------------
# Níveis de bloco — energia e foco associados a cada classificação
# ---------------------------------------------------------------------------

BLOCK_LEVELS: dict[str, dict] = {
    "sono":          {"energy": 10, "focus":  5, "label": "Sono"},
    "recuperacao":   {"energy": 30, "focus": 20, "label": "Recuperação"},
    "foco_leve":     {"energy": 55, "focus": 48, "label": "Foco leve"},
    "foco_moderado": {"energy": 70, "focus": 63, "label": "Foco moderado"},
    "foco_profundo": {"energy": 85, "focus": 78, "label": "Foco profundo"},
    "pico":          {"energy": 95, "focus": 88, "label": "Pico"},
}

# ---------------------------------------------------------------------------
# Onde o Axon PODE colocar uma tarefa, por prioridade
# ---------------------------------------------------------------------------
#
# Vale só para horários escolhidos pelo AXON — sugestões de troca e "Axon
# decide". O que o usuário marca manualmente nunca passa por aqui: ele agenda
# o que quiser, onde quiser.
#
# A matriz é um PISO, não um teto: define o bloco mais fraco aceitável para
# cada prioridade, e qualquer bloco melhor continua permitido. Ou seja, ela
# impede que tarefa chave/alta desça para blocos fracos — não impede tarefa
# simples de aproveitar um pico que está sobrando. Como a busca sempre tenta
# os melhores blocos primeiro, uma tarefa baixa só chega ao foco leve quando
# todo o resto está ocupado.
#
# `sono` e `recuperacao` estão fora de todas as listas: são o gatilho da
# sugestão, nunca o destino.

_ALL_GOOD = ("pico", "foco_profundo", "foco_moderado", "foco_leve")

ALLOWED_BLOCKS: dict[str, tuple[str, ...]] = {
    "key":    ("pico", "foco_profundo"),                    # tarefa chave
    "high":   ("pico", "foco_profundo", "foco_moderado"),
    "medium": _ALL_GOOD,
    "low":    _ALL_GOOD,
}

# Ordem de preferência ao escolher um horário: melhor bloco primeiro.
BLOCK_PREFERENCE: tuple[str, ...] = _ALL_GOOD


def allowed_blocks(priority: str | None, is_key_task: bool = False) -> tuple[str, ...]:
    """
    Blocos em que o Axon pode agendar uma tarefa, do melhor para o pior.

    `is_key_task` tem precedência sobre `priority` (toda tarefa chave é salva
    com priority='high', mas a restrição dela é mais estrita).
    """
    if is_key_task:
        return ALLOWED_BLOCKS["key"]
    return ALLOWED_BLOCKS.get(priority or "medium", _ALL_GOOD)

# ---------------------------------------------------------------------------
# Blocos de 90 minutos — 16 blocos cobrem as 24h do dia.
# Índice → horário de início: 0=00:00, 1=01:30, 2=03:00, 3=04:30, 4=06:00,
# 5=07:30, 6=09:00, 7=10:30, 8=12:00, 9=13:30, 10=15:00, 11=16:30,
# 12=18:00, 13=19:30, 14=21:00, 15=22:30
# Cada entrada: (nível, descrição do que o usuário deveria fazer nesse período).
# Para editar: altere o nível ou a descrição do bloco correspondente.
# ---------------------------------------------------------------------------

CHRONOTYPE_BLOCKS: dict[str, list[tuple[str, str]]] = {
    "morning": [
        ("sono",          "Hora de recarregar. Durante o sono seu cérebro consolida tudo que aprendeu e prepara você para um dia de alta performance."),                                           # 00:00
        ("sono",          "Você está no sono mais reparador da noite. Esse é o momento em que seu corpo recupera energia e sua mente se reorganiza."),                                           # 01:30
        ("sono",          "Seu organismo ainda está em modo de recuperação. Respeitar esse tempo é parte da sua produtividade amanhã."),                                           # 03:00
        ("sono",          "Você está acordando. Beba água, alongue-se, respire. Momento ideal para uma caminhada matinal leve ou organização do dia."),                                                          # 04:30
        ("foco_profundo", "Sua energia está subindo. Use esse bloco para responder mensagens, organizar suas tarefas e começar as tarefas importantes. "),     # 06:00
        ("pico",          "Esse é seu momento de ouro. Seu cérebro está no máximo da capacidade, execute a tarefa mais difícil e mais importante do seu dia. Evite ao máximo distrações nesse período."),      # 07:30
        ("pico",          "Você ainda está no topo. Continue suas tarefas mais complexas.Esse é o bloco também é ideal para decisões importantes, criação e trabalho de alta complexidade."),     # 09:00
        ("pico",          "Ótimo momento para continuar projetos complexos ou iniciar algo que exige concentração, tente terminar suas tarefas mais importante está o final da manhã."),        # 10:30
        ("foco_moderado", "Sua energia está encontrando um ritmo mais tranquilo. Ótimo para almoço, reuniões, consumir conteúdo relevante ou organizar ideias que surgiram ao longo da manhã."),            # 12:00
        ("foco_moderado", "É natural sentir uma queda aqui, é apenas seu corpo pedindo uma pequena pausa. Use esse momento para responder mensagens, organizar arquivos ou fazer tarefas que não exigem muito raciocínio."),             # 13:30
        ("foco_moderado", "Seu organismo está começando a se recuperar. Aproveite para planejar o restante do dia, resolver pendências simples ou começar o restante das tarefas do dia."),     # 15:00
        ("foco_moderado", "Ótimo momento para reuniões ativas, estudos ou terminar as atividades pendentes do dia."),                    # 16:30
        ("foco_moderado", "Seu dia de alta produtividade está se encerrando. Use esse bloco para revisar o que fez, planejar amanhã e terminar tarefas de baixa complexidade que ficaram pendentes."),            # 18:00
        ("foco_leve",     "Seu cérebro precisa descansar.Faça atividades leves,passe tempo com pessoas que você gosta ou algo que te relaxa. Evite trabalho pesado por hoje."),           # 19:30
        ("recuperacao",   "Seu corpo está sinalizando que quer descansar. Diminua a luz, evite telas e crie o ambiente certo para um sono reparador e relaxante."),               # 21:00
        ("sono",          "É hora de desligar. Você deu o seu melhor hoje, agora deixe seu corpo e mente se recuperarem para termos um dia ainda melhor amanhã."),                                      # 22:30
    ],
    "evening": [
        ("foco_leve",     "Sei que você ainda tem energia, mas seu corpo precisa de descanso, comece a desacelerar. Resista à tentação de continuar trabalhando, aproveite essa energia para organizar o que deve ser feito amanhã."),                    # 00:00
        ("sono",          "Preparece para dormir. Seu cérebro vai processar tudo que aconteceu hoje e te preparar para um dia ainda melhor amanhã."),                                             # 01:30
        ("sono",          "Sono profundo ativo. Esse é o momento mais reparador da sua noite, evite ao máximo ficar acordado até esse momento."),                                  # 03:00
        ("sono",          "Ainda em sono. Respeite esse tempo, ele é parte essencial da sua performance no próximo dia."),                           # 04:30
        ("sono",          "Continue descansando, caso precise acrodar nesse horário o use para se prepar para o seu dia, faça uma atividade leve para cordar e beba água."),                     # 06:00
        ("recuperacao",   "Seu corpo está acordando lentamente, mas seu cérebro ainda não está pronto. Hidrate-se, tome seu café e não force decisões importantes agora."),    # 07:30
        ("foco_moderado", "Bom momento para tarefas simples e automáticas. Responda e-mails, organize sua agenda e comece as tarefas mais leves do seu dia."),    # 09:00
        ("foco_moderado", "Sua energia está subindo gradualmente. Use esse bloco para planejamento, WhatsApp e tarefas operacionais, agaurde seu foco para fazer as tarefas mais complexas com maior produtividade."),   # 10:30
        ("foco_moderado", "Você está entrando em ritmo. Bom momento para reuniões ativas, leitura e aprendizado, seu cérebro está entrando em rítmo."),         # 12:00
        ("foco_profundo", "É normal sentir um leve cansaço depois do almoço mas a sua energia segue estável. Aproveite para reuniões, organização de projetos, consumir conteúdo relevante para o seu trabalho ou para começar suas tarefas mais complexas."),                # 13:30
        ("foco_profundo", "Você está aquecido e concentrado. Ótimo momento para atacar projetos importantes e trabalho que exige raciocínio aprofundado evite ao máxim odsitrações nesse período."),    # 15:00
        ("pico",          "Seu pico chegou. É o momento ideal para fazer a suas tarefas mais importantes e desafiadoras do seu dia, seu cérebro está no máximo. Evite ao máximo distroções nesse período."),               # 16:30
        ("pico",          "Ainda no topo. Não se distraia esse é seu segundo bloco de ouro para continuar seu trabalho decisões críticas, criação e demais tarefas de alta complexidade."),         # 18:00
        ("pico",          "Continue em projetos importantes ou finalize o que ficou pendente com qualidade."),    # 19:30
        ("foco_profundo", "Sua energia está desacelerando gradualmente. Bom momento para revisar o dia, planejar amanhã e resolver pendências de menor complexidade."),                    # 21:00
        ("foco_moderado", "Hora de soltar o peso do dia. Tarefas leves, conversas tranquilas, nada que exija raciocínio intenso agora. Use esse momento para hobbies ou ficar com sua família."),                   # 22:30
    ],
    "night": [
        ("foco_profundo", "Sua energia ainda está alta enquanto o mundo dorme. Aproveite esse silêncio para avançar no que mais importa, poucos momentos são tão produtivos para você quanto esse."),            # 00:00
        ("sono",          "Hora de desacelerar. Seu corpo precisa desse descanso para sustentar a performance que você exige dele. Não abra mão do sono, ele é seu maior aliado."),     # 01:30
        ("sono",          "Sono profundo ativo. Seu cérebro está consolidando memória e recuperando energia, deixe esse processo acontecer sem interrupções."),                   # 03:00
        ("sono",          "Ainda em sono. Respeite seu ritmo biológico lembre-se que seu descanso é o seu maior aliado para manter um dia de alta produtividade."),                   # 04:30
        ("sono",          "Seu corpo ainda está em recuperação. Acordar forçado agora vai comprometer toda sua performance ao longo do dia."),                           # 06:00
        ("recuperacao",   "Seu corpo está acordando gradualmente. Mentenha-se descansando para evitar cansoços ao longo do dia "),                                  # 07:30
        ("foco_leve",     "Despertar gradual, seu cérebro está acordando. Café, alongamento, tarefas automáticas, dê tempo para o seu organismo estar totalmente preparado antes de exigir foco profundo."),           # 09:00
        ("foco_leve",     "Use esse momento para e-mails, WhatsApp, planejamento e tarefas simples que não exigem muito raciocínio."),     # 10:30
        ("foco_moderado", "Energia subindo de forma constante. Use esse bloco para organizar sua agenda, almoçar resolver pendências operacionais e se preparar para o restante do dia."),            # 12:00
        ("foco_moderado", "Bom momento para reuniões ativas, aprendizado, estudos e projetos que exigem atenção, agaurde para realizar suas tarefas mais complexas mais tarde"),        # 13:30
        ("foco_moderado", "Sua energia segue crescendo. Aproveite para completar suas tarefas que não exijam muito do seu cérebro, deixe seu cerebro o mais confortável possível e livre de preocupações para o seu pico."),               # 15:00
        ("foco_moderado", "Você está chegando no seu melhor. Ótimo momento para atacar projetos importantes e trabalho complexo, seu cérebro está receptivo e concentrado use esse momento para aproveitar sua família e estudos."),      # 16:30
        ("pico",          "Seu pico chegou. Agora é o momento para fazer as tarefas mais difíceis e complexas do seua dia. Esse é seu momento de máxima capacidade cognitiva. Evite ao máximo distrações nesse momento."),           # 18:00
        ("pico",          "Ainda no topo, não se distraia continue focado na suas tarefas importantes e trabalho de alta complexidade."),                      # 19:30
        ("pico",          "Continue no que é importante ou finalize com qualidade o que ficou pendente, você está no máximo da sua performance nesse momento."),                # 21:00
        ("pico",          "Esse é um dos seus melhores momentos do dia continue seu trbalho e suas tarefas para poder descansar logo mais."),                   # 22:30
    ],
    "bimodal": [
        ("sono",          "Descanse. Seu corpo está trabalhando para você enquanto dorme, esse processo é essencial para sustentar os dois picos de energia que te esperam amanhã."),                           # 00:00
        ("sono",          "Sono profundo ativo. Seu cérebro está consolidando memória e recuperando energia — deixe esse processo acontecer sem interrupções."),                                  # 01:30
        ("sono",          "Ainda em sono. Respeite esse tempo, ele é a base de toda sua performance como bimodal."),                   # 03:00
        ("sono",          "Seu organismo ainda está em recuperação. Aproveite cada minuto restante de descanso antes do seu primeiro pico do dia."),                     # 04:30
        ("recuperacao",   "Você está acordadndo. Hidrate-se, faça atividades leves e use esse momento para planejar o seu dia."),         # 06:00
        ("foco_profundo", "Ótimo momento para começar seus projetos ou atividades mais importantes e trabalho que exige concentração."),        # 07:30
        ("pico",          "Esse é o momento de fazer a tarefa mais importante e mais difícil na do seu dia, seu cérebro está no máximo da capacidade. Evite ao máximo distrações nessse período."),       # 09:00
        ("pico",          "Decisões críticas, criação profunda e trabalho de alta complexidade pertencem são ideais para serem feitos nesse bloco."),        # 10:30
        ("foco_moderado", "Aproveite que seu corpo naturalmente tem uma queda nesse hoprário e se prepare para o almoço e atividades mais leves, um cochilo nesse momento pode salvar o restante do seu dia."),              # 12:00
        ("foco_moderado", "É natural sentir uma queda aqui, é apenas seu corpo pedindo uma pequena pausa. Use esse momento para responder mensagens, organizar arquivos ou fazer tarefas que não exigem muito raciocínio."),     # 13:30
        ("foco_moderado", "Ainda no vale. Não force foco profundo agora, use esse tempo para resolver pendências operacionais, estudar, consumir conteúdos relevantes ou se preparar para o segundo pico que vem logo mais."),                    # 15:00
        ("foco_profundo", "Seu segundo ciclo está começando. A energia está voltando com força, esse é um ótimo momento para retomar projetos importantes e trabalho que exige concentração."),     # 16:30
        ("pico",          "Esse é o momento para terminar as pendências complexas do dia, aproveite que sua energia está em alta para zerar a sua lista de tarefas, evite ao máximo distrações nesse período."),      # 18:00
        ("pico",          "Continue fazendo o que é importante seu pico está chegando no fim, momento ideial para estudos profundo e para terminar de vez com as tarefas pendentes de alta complexidade."),      # 19:30
        ("foco_moderado", "Bom momento para revisar o dia, planejar o amanhã e finalizar pendências com qualidade. Aproveite esse momento para passar um tempo com sua família e praticar hobbies."),               # 21:00
        ("foco_leve",     "Hora de desacelerar. Você teve dois picos hoje, seu corpo merece esse descanso para repetir amanhã. Desligue as telas e prepare o ambiente para uma boa e relaxante noite."),           # 22:30
    ],
    "intermediate": [
        ("sono",          "Descanse. Seu corpo está trabalhando silenciosamente para você, esse sono é o que garante a energia consistente que define seu cronotipo."),                           # 00:00
        ("sono",          "Sono profundo ativo. Seu cérebro está consolidando tudo que aprendeu hoje e se preparando para um novo dia de energia estável."),                                  # 01:30
        ("sono",          "Ainda em sono. Respeite esse tempo, ele é a base da sua consistância ao longo do dia."),                   # 03:00
        ("sono",          "Seu organismo ainda está em recuperação. Aproveite cada minuto restante de descanso antes de começar mais um dia produtivo."),                     # 04:30
        ("recuperacao",   "Seu corpo está acordando naturalmente. Hidrate-se, faça atividades físicas moderadase e não force decisões importantes ainda."),            # 06:00
        ("foco_leve",     "Bom momento para e-mails, WhatsApp, planejamento do dia e para realizar suas tarefas mais simples, você tem uma energia muito consistente aproveite isso com sabedoria ao longo do dia"),             # 07:30
        ("foco_moderado", "Reuniões ativas, aprendizado, organização de projetos agora e suas tarefas imporntes são bem-vindo agora"),          # 09:00
        ("pico",          "Seu melhor momento da manhã. Ataque agora projetos importantes e trabalho que exige concentração, você está no topo da sua curva matinal. Evite ao máximo distrações nesse período"),             # 10:30
        ("foco_moderado", "Ótimo para reuniões, leitura e organização e uma pausa para o almoço. Seu ponto forte é exatamente essa consistência que outros cronotipos não têm nesse horário."),             # 12:00
        ("foco_leve",     "Sentir um aleve queda de energia é natural nesse momento. Use para tarefas operacionais, e-mails e planejamento e até mesmo um breve descanço"),                    # 13:30
        ("foco_profundo", "Aproveite esse momento para dar continuidade as tarefas mais impontes e complexas do sua dia, evite ao máximo distrações nesse período"),             # 15:00
        ("pico",          "Segundo melhor momento do dia. Retome projetos importantes ou finalize o que ficou pendente pela manhã, evite ao máximo distrações nesse período"),       # 16:30
        ("foco_profundo", "Use esse momento para revisar o dia, planejar amanhã, resolver pendências que exigem atenção ou para estudos. Momento ideal para atividades físicas."),        # 18:00
        ("foco_leve",     "Use esse momento para tarefas leves, passar um tempo com sua família, estudos leves ou praticar seus hobbies, tentar forçar produtividade nesse momento pode acabar com o seu dia de amanhã."),      # 19:30
        ("foco_leve",     "Se desconecte. Atividades relaxantes, tempo com pessoas que você gosta ou algo que te renova comece a preparar o terreno para uma boa noite de sono."),           # 21:00
        ("recuperacao",   "Hora de desacelerar. Você teve um dia consistente e produtivo — agora deixe seu corpo e mente se recuperarem para repetir amanhã com a mesma qualidade."),           # 22:30
    ],
}


def get_chronotype_context(chronotype: str, hour: int) -> dict:
    block_idx = (hour * 60) // 90
    blocks = CHRONOTYPE_BLOCKS.get(chronotype, CHRONOTYPE_BLOCKS["intermediate"])
    level, _ = blocks[block_idx]
    level_data = BLOCK_LEVELS[level]
    meta = CHRONOTYPE_META.get(chronotype, CHRONOTYPE_META["intermediate"])
    return {
        "energy": level_data["energy"],
        "focus":  level_data["focus"],
        "level":  level,
        "label":  meta["label"],
        "energy_peak":  meta["energy_peak"],
        "focus_window": meta["focus_window"],
        "low_energy":   meta["low_energy"],
    }


def classify_chronotype(scores: dict) -> str:
    return max(scores, key=lambda k: scores[k])


# --- Bloco 2: classificação completa via respostas do questionário ---

TABELA_PONTOS: dict[str, dict[str, dict[str, int]]] = {
    "P1": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
        "C": {"Matutino": 1, "Vespertino": 1, "Noturno": 0, "Misto": 3, "Bimodal": 1},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P2": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "D": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P3": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "D": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P4": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "D": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P5": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 0},
        "B": {"Matutino": 1, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 2},
        "D": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 1},
    },
    "P6": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 1},
    },
    "P7": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 0},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 2},
        "D": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 1},
    },
    "P8": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 1, "Bimodal": 1},
        "D": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P10": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 2, "Misto": 0, "Bimodal": 2},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P11": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 2, "Misto": 0, "Bimodal": 2},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
        "G": {"Matutino": 0, "Vespertino": 0, "Noturno": 0, "Misto": 3, "Bimodal": 0},
    },
    "P12": {
        "A": {"Matutino": 1, "Vespertino": 1, "Noturno": 1, "Misto": 2, "Bimodal": 1},
        "B": {"Matutino": 1, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 0},
        "C": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "D": {"Matutino": 1, "Vespertino": 2, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "E": {"Matutino": 0, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 1},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 0},
        "G": {"Matutino": 0, "Vespertino": 0, "Noturno": 1, "Misto": 0, "Bimodal": 0},
    },
    "P13": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 2, "Misto": 0, "Bimodal": 2},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
        "G": {"Matutino": 0, "Vespertino": 0, "Noturno": 0, "Misto": 3, "Bimodal": 0},
    },
    "P14": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 2, "Misto": 0, "Bimodal": 2},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P15": {
        "A": {"Matutino": 0, "Vespertino": 1, "Noturno": 3, "Misto": 0, "Bimodal": 0},
        "B": {"Matutino": 2, "Vespertino": 0, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 3, "Vespertino": 2, "Noturno": 0, "Misto": 1, "Bimodal": 0},
        "D": {"Matutino": 1, "Vespertino": 1, "Noturno": 0, "Misto": 2, "Bimodal": 1},
    },
    "P16": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 2, "Misto": 0, "Bimodal": 2},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
    },
    "P17": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 0},
        "B": {"Matutino": 0, "Vespertino": 0, "Noturno": 0, "Misto": 3, "Bimodal": 0},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 2, "Misto": 0, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 3},
    },
    "P18": {
        "A": {"Matutino": 3, "Vespertino": 0, "Noturno": 0, "Misto": 0, "Bimodal": 1},
        "B": {"Matutino": 2, "Vespertino": 1, "Noturno": 0, "Misto": 1, "Bimodal": 2},
        "C": {"Matutino": 0, "Vespertino": 2, "Noturno": 0, "Misto": 2, "Bimodal": 0},
        "D": {"Matutino": 0, "Vespertino": 2, "Noturno": 1, "Misto": 1, "Bimodal": 1},
        "E": {"Matutino": 0, "Vespertino": 0, "Noturno": 2, "Misto": 0, "Bimodal": 2},
        "F": {"Matutino": 0, "Vespertino": 0, "Noturno": 3, "Misto": 0, "Bimodal": 0},
        "G": {"Matutino": 0, "Vespertino": 0, "Noturno": 0, "Misto": 3, "Bimodal": 0},
    },
}

PESOS: dict[str, int] = {
    "P1": 3, "P2": 3, "P3": 3, "P4": 3, "P5": 3, "P7": 3, "P8": 3,
    "P10": 2, "P11": 2, "P14": 2, "P17": 2,
    "P6": 1, "P12": 1, "P13": 1, "P15": 1, "P16": 1, "P18": 1,
}

_CRONOTIPOS = ["Matutino", "Vespertino", "Noturno", "Misto", "Bimodal"]
_DESEMPATE_PERGUNTAS = {"P1", "P4", "P5", "P7", "P8"}


def classificar_cronotipo(respostas: dict) -> tuple[str, dict[str, int]]:
    pontos: dict[str, int] = {c: 0 for c in _CRONOTIPOS}

    if respostas.get("P17") == "E":
        return "Bimodal", pontos

    candidato_misto = respostas.get("P18") == "G"

    for pergunta, alternativa in respostas.items():
        if pergunta == "P9" or pergunta not in TABELA_PONTOS:
            continue
        alternativa_pts = TABELA_PONTOS[pergunta].get(alternativa)
        if alternativa_pts is None:
            continue
        peso = PESOS.get(pergunta, 1)
        for cronotipo, pts in alternativa_pts.items():
            pontos[cronotipo] += pts * peso

    max_pts = max(pontos.values())
    empatados = [c for c in _CRONOTIPOS if pontos[c] == max_pts]

    if len(empatados) == 1:
        vencedor = empatados[0]
    else:
        desempate: dict[str, int] = {c: 0 for c in _CRONOTIPOS}
        for pergunta in _DESEMPATE_PERGUNTAS:
            alternativa = respostas.get(pergunta)
            if not alternativa:
                continue
            alternativa_pts = TABELA_PONTOS.get(pergunta, {}).get(alternativa)
            if alternativa_pts is None:
                continue
            peso = PESOS.get(pergunta, 1)
            for cronotipo, pts in alternativa_pts.items():
                desempate[cronotipo] += pts * peso
        vencedor = max(empatados, key=lambda c: desempate[c])

    if candidato_misto and vencedor != "Misto":
        if pontos[vencedor] - pontos["Misto"] <= 3:
            vencedor = "Misto"

    return vencedor, pontos
