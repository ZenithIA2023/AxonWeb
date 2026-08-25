# DayReview: 3 períodos ordenados + Dia livre

> **STATUS (2026-08-25): JÁ IMPLEMENTADO — nada a fazer.**
>
> Você implementou este documento com "Dia livre" como tag na seção de
> produtividade. Depois disso o Bernardo mudou o lugar: ele fica na seção
> **"Quando você foi mais produtivo?"**, junto dos períodos. Eu apliquei esse
> ajuste no seu `DayReview.tsx` (`tsc --noEmit` limpo) preservando tudo o mais
> que você fez — badges numerados, ordenação, restauração de rascunho.
>
> **O que mudou no seu código:** o botão saiu da própria `<Section>` e foi para
> dentro da seção dos períodos; a sincronia tag↔toggle (`handleDayOffToggle`,
> `toggleProdTag`) foi removida, porque "Dia livre" deixou de ser tag —
> `resolveDayOff` agora lê `peak_periods`, e `stripDayOff` impede que o marcador
> vire um período selecionado.
>
> O texto abaixo fica como registro do desenho final. Vale a leitura da seção 3,
> que explica por que o marcador viaja dentro de `peak_periods` sem ser um
> período.

---

## 1. `api.ts` — novo campo no tipo

Em `interface DailyLog` e em `DailyLogPayload` (por volta das linhas 1029 e 1046),
ao lado de `peak_periods`, adicione:

```ts
is_day_off: boolean;   // em DailyLog
is_day_off?: boolean;  // em DailyLogPayload
```

Nada mais muda no `api.ts`. `PEAK_PERIODS` continua com os mesmos 7 períodos.

---

## 2. Períodos de pico: de 2 para 3, agora ORDENADOS

O backend passou a tratar a **ordem do array como significado**: posição 0 é o
período mais produtivo do dia, 1 é o segundo, 2 é o terceiro. Isso alimenta a
calibração do perfil de energia (o 1º puxa o score com peso 1.0, o 2º com 0.75,
o 3º com 0.5), então a ordem precisa refletir a intenção do usuário.

**A boa notícia:** o array já preserva a ordem de clique. O estado atual
(`peakPeriods`) não muda de tipo — continua `string[]`.

### 2.1 `togglePeakPeriod` (linha ~243)

Só o limite muda, de 2 para 3:

```ts
// Até 3 períodos, na ORDEM em que o usuário clica: o 1º clique é o período
// mais produtivo do dia. O backend usa essa ordem para pesar a calibração,
// então remover um item do meio precisa reordenar os seguintes — o filter
// abaixo já faz isso naturalmente.
function togglePeakPeriod(slug: string) {
  if (peakPeriods.includes(slug)) {
    setPeakPeriods(peakPeriods.filter((p) => p !== slug));
  } else if (peakPeriods.length < 3) {
    setPeakPeriods([...peakPeriods, slug]);
  }
}
```

### 2.2 Mostrar a posição no botão (linha ~491)

Esta é a parte que importa: **se a ordem não aparece na tela, o usuário não tem
como saber que ela existe** — e vai clicar em qualquer sequência. Cada botão
selecionado precisa exibir seu número.

Dentro do `.map()`, troque `isSelected`/`atLimit` por:

```tsx
{PEAK_PERIODS.map((p) => {
  const rank = peakPeriods.indexOf(p.slug);   // -1 = não selecionado
  const isSelected = rank >= 0;
  const atLimit = !isSelected && peakPeriods.length >= 3;
  return (
    <button
      key={p.slug}
      type="button"
      onClick={() => togglePeakPeriod(p.slug)}
      disabled={atLimit}
      className={/* mesmas classes de hoje */}
    >
      {/* Badge com a posição — some quando não está selecionado */}
      {isSelected && (
        <span
          className="mb-1 inline-flex h-5 w-5 items-center justify-center
                     rounded-full bg-accent text-[0.6rem] font-bold text-white"
          aria-hidden="true"
        >
          {rank + 1}
        </span>
      )}
      <span className="text-xs font-semibold">{p.label}</span>
      <span className={`text-[0.62rem] ${isSelected ? "text-accent" : "text-soft"}`}>
        {p.hours}
      </span>
    </button>
  );
})}
```

**Acessibilidade:** o número é visual, então quem usa leitor de tela precisa da
mesma informação no rótulo. Adicione no `<button>`:

```tsx
aria-label={
  isSelected
    ? `${p.label}, ${p.hours}, ${rank + 1}º período mais produtivo. Toque para remover.`
    : `${p.label}, ${p.hours}. Toque para marcar.`
}
```

### 2.3 Título e texto de ajuda

O título atual não comunica que há ordem. Sugestão:

```tsx
<Section icon={Zap} title="Quando você foi mais produtivo? (opcional)">
  <p className="mb-3 text-xs text-soft">
    Toque em até 3 períodos, começando pelo mais produtivo.
  </p>
```

E troque o aviso de limite (linha ~520):

```tsx
{peakPeriods.length >= 3 && (
  <p className="mt-2 text-xs text-soft">
    Máximo de 3 períodos. Toque em um selecionado para remover.
  </p>
)}
```

---

## 3. Campo novo: Dia livre

Um dia de descanso deliberado hoje é indistinguível de um dia perdido — ambos
aparecem como produtividade 1 e zero tarefas. Os insights vinham lendo folgas
como "seu ponto mais baixo da semana". Com esse campo, o AXON passa a excluir
esses dias das análises de desempenho.

**Onde fica:** dentro da seção "Quando você foi mais produtivo?", junto dos 7
períodos — é ali que a pergunta "e se não teve pico nenhum?" aparece
naturalmente para quem responde.

**Mas não é um período.** Não tem faixa de horário nem posição no ranking, então
ele NÃO recebe badge numerado e NÃO conta para o limite de 3. Você pode mandá-lo
dentro de `peak_periods` que o backend separa sozinho (o schema tira o marcador
e liga `is_day_off`), ou mandar `is_day_off: true` direto — os dois funcionam.
Recomendo mandar no array, é menos estado para gerenciar na tela.

**Os dois convivem:** marcar "Dia livre" E apontar que rendeu bem de manhã é
uma resposta legítima (folga em que se produziu algo). Não zere os períodos nem
desabilite os botões — decisão do Bernardo.

### 3.1 Estado

```ts
const DAY_OFF = "dia_livre";
const [isDayOff, setIsDayOff] = useState<boolean>(existing?.is_day_off ?? false);
```

Adicione nos pontos onde o estado é restaurado/enviado, senão o campo se perde:
- reset ao abrir (linha ~109): `setIsDayOff(existing?.is_day_off ?? false);`
- restauração do rascunho (linha ~152): `if (typeof d.is_day_off === "boolean") setIsDayOff(d.is_day_off);`
- reset do segundo ponto (linha ~269): mesma linha do reset.
- payload do autosave (~191) e do submit (~350): `is_day_off: isDayOff,`
- dependências do `useEffect` do autosave (~215): incluir `isDayOff`.

### 3.2 O botão, dentro da seção de períodos

Logo ACIMA do `<div>` que faz o `.map()` dos `PEAK_PERIODS`:

```tsx
{/* Dia livre: não é um período (sem horário, sem posição no ranking), por
    isso fica destacado acima e não recebe badge numerado. Convive com os
    períodos: dá para ter folga e ainda assim ter rendido bem de manhã. */}
<button
  type="button"
  onClick={() => setIsDayOff(!isDayOff)}
  aria-pressed={isDayOff}
  className={`mb-3 flex w-full items-center gap-2 rounded-2xl border px-3.5 py-2.5
              text-xs font-semibold transition active:scale-[0.98] ${
    isDayOff
      ? "border-accent-soft bg-accent-soft text-accent"
      : "border-soft bg-surface-muted text-secondary"
  }`}
>
  <Coffee className="h-4 w-4" />
  <span>Dia livre — foi dia de descanso</span>
</button>
{isDayOff && (
  <p className="mb-3 text-xs text-soft">
    O Axon não vai contar este dia como queda de produtividade.
  </p>
)}
```

`Coffee` vem do `lucide-react` (mesmo pacote de `Dumbbell`/`Zap`). Qualquer
outro ícone serve — só não reutilize o `Zap`, que já aparece duas vezes no modal.

### 3.3 Enviar junto dos períodos

No payload (autosave e submit), mande o marcador no array:

```ts
peak_periods: isDayOff ? [DAY_OFF, ...peakPeriods] : peakPeriods,
is_day_off: isDayOff,
```

O backend aceita as duas formas e nunca duplica: o schema tira `dia_livre` do
array antes de validar os períodos, então `["dia_livre","manha","noite"]` vira
`peak_periods=["manha","noite"]` + `is_day_off=true`. Mandar os dois campos é
redundante de propósito — se um dia o array mudar de forma, o booleano segura.

### 3.4 Ao restaurar (rascunho ou registro existente)

Se `peak_periods` vier com `dia_livre` de um rascunho antigo, filtre ao carregar
para o marcador não virar um "período" selecionado na tela:

```ts
const restored = (d.peak_periods ?? []).filter((p) => p !== DAY_OFF);
setPeakPeriods(restored);
if (d.peak_periods?.includes(DAY_OFF)) setIsDayOff(true);
```

### 3.5 Decisão em aberto (confirme com o Bernardo)

Quando `isDayOff` está marcado, **as outras seções continuam visíveis?**
Minha recomendação: **sim**. Esconder faria perder o registro de sono, útil
justamente na folga. O botão muda como o AXON interpreta o dia, não o que ele
pode registrar.

---

## 4. O que NÃO muda

- Nenhuma migração de dados no frontend. Registros antigos com 1 ou 2 períodos
  continuam funcionando — só não usam a 3ª posição.
- `canSave` não muda: períodos de pico e dia livre continuam opcionais.
- Nenhuma outra tela lê `peak_periods` diretamente.
