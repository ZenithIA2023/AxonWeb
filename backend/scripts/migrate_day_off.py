"""
Migra registros diários antigos marcados com tags de descanso feitas à mão
para o campo estrutural `daily_logs.is_day_off` (Migration 23).

Contexto: antes de a tag padrão `dia_livre` existir, quem quisesse marcar uma
folga criava uma tag de texto livre. O slugify do frontend apaga acentos sem
substituir, então "Dia de descanço" virou `custom_dia_de_descano` — grafias
diferentes geravam slugs diferentes e nada os agrupava. As análises liam esses
dias como produtividade baixa em vez de descanso planejado.

Só migra slugs INEQUÍVOCOS (services/daily_rest.LEGACY_DAY_OFF_SLUGS). Frases
ambíguas como "não fiz nada" ficam de fora de propósito: podem ser folga ou
frustração, e marcar por engano cria justamente o viés que o campo evita. Elas
são listadas no fim como revisão manual.

Uso:
    python scripts/migrate_day_off.py                 # dry-run (padrão)
    python scripts/migrate_day_off.py --apply         # aplica
    python scripts/migrate_day_off.py --user <uuid>   # restringe a um usuário
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from database import supabase                        # noqa: E402
from services.daily_rest import (                    # noqa: E402
    DAY_OFF_TAG,
    LEGACY_DAY_OFF_SLUGS,
)

# Marcadores de dias vazios que NÃO são prova de descanso deliberado.
# Listados para revisão humana, nunca migrados automaticamente.
AMBIGUOUS_SLUGS = frozenset({
    "custom_no_fiz_nada",      # "Não fiz nada" — o "ã" foi apagado pelo slugify
    "custom_nao_fiz_nada",
    "custom_nada",
    "custom_dia_perdido",
})


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="grava as alterações (sem isto é só simulação)")
    ap.add_argument("--user", help="restringe a um user_id")
    args = ap.parse_args()

    q = supabase.table("daily_logs").select(
        "id, user_id, date, productivity_tags, is_day_off, productivity_rating"
    )
    if args.user:
        q = q.eq("user_id", args.user)
    logs = q.execute().data or []

    migrar, ambiguos, ja_ok = [], [], []
    for log in logs:
        tags = log.get("productivity_tags") or []
        legado = [t for t in tags if t in LEGACY_DAY_OFF_SLUGS]
        duvida = [t for t in tags if t in AMBIGUOUS_SLUGS]

        if legado:
            (ja_ok if log.get("is_day_off") else migrar).append((log, legado))
        elif duvida and not log.get("is_day_off"):
            ambiguos.append((log, duvida))

    modo = "APLICANDO" if args.apply else "SIMULAÇÃO (use --apply para gravar)"
    escopo = f"usuário {args.user}" if args.user else "TODOS os usuários"
    print(f"=== Migração de dia livre — {modo} ===")
    print(f"escopo: {escopo} | {len(logs)} registros analisados\n")

    if ja_ok:
        print(f"[já migrados] {len(ja_ok)} registros — nada a fazer\n")

    if not migrar:
        print("Nenhum registro a migrar.")
    else:
        print(f"[migrar] {len(migrar)} registros:")
        for log, legado in sorted(migrar, key=lambda x: str(x[0]["date"])):
            print(f"   {log['date']}  prod={log.get('productivity_rating')}  "
                  f"tags={legado}  ->  is_day_off=true (tags antigas removidas)")
        print()

    if ambiguos:
        print(f"[REVISAR À MÃO] {len(ambiguos)} registros com tag ambígua "
              f"(NÃO serão migrados):")
        for log, duvida in sorted(ambiguos, key=lambda x: str(x[0]["date"])):
            print(f"   {log['date']}  prod={log.get('productivity_rating')}  "
                  f"tags={duvida}")
        print("   -> 'não fiz nada' pode ser folga ou dia perdido: só o usuário sabe.\n")

    if not args.apply:
        print("Nada foi alterado.")
        return 0

    alterados = 0
    for log, legado in migrar:
        # Remove os slugs antigos: a informação agora vive em is_day_off, e o
        # "dia livre" deixou de ser tag de produtividade — é uma opção da seção
        # de períodos de pico. Mantê-los deixaria uma tag órfã na tela (ela já
        # não existe na lista de tags do usuário).
        tags = log.get("productivity_tags") or []
        novas = [t for t in tags if t not in LEGACY_DAY_OFF_SLUGS]
        try:
            (supabase.table("daily_logs")
             .update({"is_day_off": True, "productivity_tags": novas})
             .eq("id", log["id"]).execute())
            alterados += 1
        except Exception as e:
            print(f"   ERRO em {log['date']}: {e}")

    print(f"{alterados}/{len(migrar)} registros atualizados.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
