// Результаты поиска боковой панели: попадания по разделам или запись по номеру с зависимостями кратким списком.
import type { LinkedRecord, RecordCard, RecordMark, RevealTarget, SearchHit, SearchOutcome } from "../shared/protocol";

const MARK: Record<RecordMark, { text: string; level: string }> = {
  fact: { text: "факт", level: "muted" },
  open: { text: "открыта", level: "accent" },
  parked: { text: "парковка", level: "accent" },
  decided: { text: "решена", level: "muted" },
  changed: { text: "изменена", level: "accent" },
};

type Open = (target: RevealTarget) => void;

function Hit({ hit, onOpen }: { hit: SearchHit; onOpen: Open }) {
  return (
    <button type="button" className="hit" onClick={() => onOpen(hit.target)}>
      <span className="hit-head">
        <span className={`hit-label${hit.level ? ` ${hit.level}` : ""}`}>{hit.label}</span>
        <span className="hit-field">{hit.field}{hit.count > 1 ? ` +${hit.count - 1}` : ""}</span>
      </span>
      <span className="hit-text">{hit.before}<mark>{hit.match}</mark>{hit.after}</span>
    </button>
  );
}

function Hits({ title, hits, onOpen }: { title: string; hits: SearchHit[]; onOpen: Open }) {
  if (!hits.length) return null;
  return (
    <section>
      <h2>{title} · {hits.length}</h2>
      {hits.map((h, i) => <Hit hit={h} onOpen={onOpen} key={`${h.target.id}|${i}`} />)}
    </section>
  );
}

function Link({ link, onOpen }: { link: LinkedRecord; onOpen: Open }) {
  const mark = link.mark ? MARK[link.mark] : { text: "записи нет", level: "signal" };
  return (
    <button type="button" className="dep" title={link.question} disabled={!link.mark} onClick={() => onOpen({ id: link.id })}>
      <span className="hit-label">{link.id}</span>
      <span className={`dep-mark ${mark.level}`}>{mark.text}</span>
      <span className="dep-q">{link.question}</span>
    </button>
  );
}

function Links({ title, direct, chain, onOpen }: { title: string; direct: LinkedRecord[]; chain: LinkedRecord[]; onOpen: Open }) {
  if (!direct.length && !chain.length) return null;
  return (
    <section>
      <h2>{title} · {direct.length}</h2>
      {direct.map((l) => <Link link={l} onOpen={onOpen} key={l.id} />)}
      {chain.length > 0 && (
        <details>
          <summary>по цепочке ещё · {chain.length}</summary>
          {chain.map((l) => <Link link={l} onOpen={onOpen} key={l.id} />)}
        </details>
      )}
    </section>
  );
}

function Card({ card, onOpen }: { card: RecordCard; onOpen: Open }) {
  const noDeps = !card.dependsOn.length && !card.dependents.length && !card.dependsOnChain.length && !card.dependentsChain.length;
  const mark = MARK[card.mark];
  return (
    <>
      <button type="button" className="hit" onClick={() => onOpen({ id: card.id })}>
        <span className="hit-head"><span className="hit-label">{card.id}</span><span className={`hit-field ${mark.level}`}>{mark.text}</span></span>
        <span className="hit-text">{card.question.replace(/`/g, "")}</span>
        {card.picked && <span className="hit-field hit-picked" title={card.picked.text}>выбран {card.picked.letter}. {card.picked.text.replace(/`/g, "")}</span>}
      </button>
      <Links title="Зависит от" direct={card.dependsOn} chain={card.dependsOnChain} onOpen={onOpen} />
      <Links title="От неё зависят" direct={card.dependents} chain={card.dependentsChain} onOpen={onOpen} />
      {noDeps && <div className="hint">зависимостей нет</div>}
    </>
  );
}

export function SearchResults({ outcome, onOpen }: { outcome: SearchOutcome; onOpen: Open }) {
  switch (outcome.kind) {
    case "empty":
      return <div className="hint">Фраза ищется во всём журнале, строках атаки и черновике — независимо от режима и фильтров. Номер (F-07, 7) показывает запись и её зависимости.</div>;
    case "text":
      return (
        <>
          {outcome.missingRecord && <div className="hint">Записи {outcome.missingRecord} нет — ищу как текст.</div>}
          <Hits title="Журнал" hits={outcome.journal} onOpen={onOpen} />
          <Hits title="Атака" hits={outcome.attack} onOpen={onOpen} />
          {!outcome.journal.length && !outcome.attack.length && <div className="hint">Ничего не найдено.</div>}
        </>
      );
    case "record": {
      const mentions = outcome.journal.length + outcome.attack.length;
      return (
        <>
          <Card card={outcome.card} onOpen={onOpen} />
          {mentions > 0 && (
            <details>
              <summary>упоминания · {mentions}</summary>
              <Hits title="Журнал" hits={outcome.journal} onOpen={onOpen} />
              <Hits title="Атака" hits={outcome.attack} onOpen={onOpen} />
            </details>
          )}
        </>
      );
    }
  }
}
