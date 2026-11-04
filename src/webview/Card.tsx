// Карточка записи в режиме «решения». Показано всё: варианты с «маловероятно» и причиной, рекомендация под списком,
// антиподы, зависимости, парковки, улики — убрать вариант значило бы решить за человека.
import { memo, useContext, useState } from "react";
import { ownLink } from "../shared/links";
import { allOptions, antipodesOf, chosen, chosenAntipodes, effectiveDeps, WORD_NEEDED_TEXT, wordMissing } from "../shared/logic";
import { addDep, addOption, choose, clearChoice, evidenceLevel, isHumanOption, park, removeAddedOption, removeDep, restoreDep, setDispute, setWord, unpark } from "../shared/ops";
import { ADDRESSEES, type DecisionDraft, type Draft, type Evidence, type JournalRecord, type ViewPayload } from "../shared/types";
import { FileLink, LinksContext, Text } from "./Text";

const ONE_WAY = "в одну сторону";
const PARK_HINT = "Парковка — дополнительный вопрос, который нельзя закрыть сейчас: он уходит адресату. «материалы» — ответ ищет агент, в файлах или пробой (исследование), «человек» — нужно решение человека, «ИБ» — проверка по чек-листу безопасности. Решение по самой развилке парковка не снимает.";

function verdictText(ev: Evidence): string {
  if (ev.found === true) return "сверено";
  if (ev.found === false) return `не найдено: ${ev.verdict ?? ""}`;
  return /^не проверить/.test(ev.verdict ?? "") ? ev.verdict! : `не проверить: ${ev.verdict ?? "файл не текст"}`;
}

export const EvidenceLine = ({ ev }: { ev: Evidence }) => {
  const { links } = useContext(LinksContext);
  const shown = <code>{ev.line ? `${ev.path}:${ev.line}` : ev.path}</code>;
  return (
    <span className="ev">
      улика: {ownLink(links, ev.path) !== null ? <FileLink link={{ key: ev.path, line: ev.line ?? null }}>{shown}</FileLink> : shown} «{ev.quote}» <b className={evidenceLevel(ev)}>{verdictText(ev)}</b>
    </span>
  );
};

export interface CardContext {
  payload: ViewPayload;
  getDraft(): Draft;
  update(fn: (d: Draft) => Draft): void;
}

export interface CardProps {
  rec: JournalRecord;
  ctx: CardContext;
  /** Части черновика этой записи и строка `links` — признаки перерисовки для memo; сами значения читаются через ctx. */
  entry?: DecisionDraft;
  added?: { letter: string; text: string }[];
  deps?: { add: string[]; remove: string[] };
  dispute?: string;
  links: string;
  /** Узлы записи, которых нет в схеме: запись остаётся в списке, подсказка говорит об этом (F-06). */
  missingNodes?: string;
}

function Status({ rec, draft, payload }: { rec: JournalRecord; draft: Draft; payload: ViewPayload }) {
  if (rec.kind === "факт") return <span className="badge muted">факт · закрыт уликами</span>;
  const local = draft.decisions[rec.id]?.choice ?? null;
  const journal = rec.decision?.option ?? null;
  if (local && journal && local !== journal) return <span className="badge accent">изменено: {journal} → {local}</span>;
  if (local) return <span className="badge plain">решено здесь: {local}</span>;
  if (chosen(payload, draft, rec.id)) return <span className="badge muted">решено в журнале: {journal}</span>;
  return <span className="badge accent">открыто</span>;
}

function Dependencies({ rec, ctx, setMsg }: { rec: JournalRecord; ctx: CardContext; setMsg(m: string): void }) {
  const [text, setText] = useState("");
  const draft = ctx.getDraft();
  const deps = effectiveDeps(rec, draft);
  // Факт закрыт уликами, выбирать в нём нечего: предпосылкой ждём только развилку.
  const isFact = (id: string) => ctx.payload.records.find((r) => r.id === id)?.kind === "факт";
  const waiting = deps.filter((x) => x.kind !== "removed" && !isFact(x.id) && !chosen(ctx.payload, draft, x.id)).map((x) => x.id);
  const add = () => {
    const r = addDep(ctx.payload, ctx.getDraft(), rec.id, text);
    if ("error" in r) return setMsg(r.error);
    setMsg("");
    setText("");
    ctx.update(() => r.draft);
  };
  return (
    <>
      <div className="meta">
        <span>зависит от:</span>
        {deps.length === 0 && <span>—</span>}
        {deps.map((x) => (
          <span className={`chip ${x.kind}`} key={x.id}>
            <a href={`#${x.id}`}>{x.id}</a>
            {x.kind === "removed"
              ? <button type="button" title="вернуть" onClick={() => ctx.update((d) => restoreDep(d, rec.id, x.id))}>↺</button>
              : <button type="button" title="снять зависимость" onClick={() => ctx.update((d) => removeDep(d, rec, x.id))}>×</button>}
          </span>
        ))}
        <input type="text" className="dep-input" placeholder="F-NN" title="добавить зависимость" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button type="button" className="small" onClick={add}>+ зависимость</button>
      </div>
      {waiting.length > 0 && <div className="note accent">предпосылка не решена: {waiting.join(", ")} — выбирать можно, но ответ до неё — догадка</div>}
    </>
  );
}

function Parkings({ rec, ctx, setMsg }: { rec: JournalRecord; ctx: CardContext; setMsg(m: string): void }) {
  const [text, setText] = useState("");
  const [addressee, setAddressee] = useState<string>(ADDRESSEES[0]);
  const local = ctx.getDraft().decisions[rec.id]?.parked ?? [];
  const total = rec.parking.length + local.length;
  const add = () => {
    if (!text.trim()) return setMsg("парковка без вопроса — нечего адресовать");
    setMsg("");
    ctx.update((d) => park(d, rec.id, text.trim(), addressee));
    setText("");
  };
  return (
    <details className="park" open={total > 0}>
      <summary title={PARK_HINT}>парковка — дополнительный вопрос с адресатом ({total})</summary>
      <div className="hint">{PARK_HINT}</div>
      {rec.parking.map((p, i) => (
        <div className="parkitem" key={`j${i}`}>
          <span className="who">→ {p.addressee} · в журнале</span>
          <span>
            <Text s={p.text} />
            {p.finding && <span className="finding"> находка: <Text s={p.finding} /></span>}
          </span>
        </div>
      ))}
      {local.map((p, i) => (
        <div className="parkitem" key={`d${i}`}>
          <span className="who">→ {p.addressee}</span>
          <span><Text s={p.text} /></span>
          <button type="button" className="small" onClick={() => ctx.update((d) => unpark(d, rec.id, i))}>снять</button>
        </div>
      ))}
      <div className="row">
        <input type="text" placeholder="что именно надо узнать или решить отдельно" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <select title={PARK_HINT} value={addressee} onChange={(e) => setAddressee(e.target.value)}>
          {ADDRESSEES.map((a) => <option key={a}>{a}</option>)}
        </select>
        <button type="button" className="small" onClick={add}>припарковать</button>
      </div>
    </details>
  );
}

function Fork({ rec, ctx }: { rec: JournalRecord; ctx: CardContext }) {
  const [msg, setMsg] = useState("");
  const [optionText, setOptionText] = useState("");
  const draft = ctx.getDraft();
  const entry = draft.decisions[rec.id];
  const cur = chosen(ctx.payload, draft, rec.id);
  const journal = rec.decision?.option ?? null;
  const pick = (letter: string) => {
    setMsg("");
    ctx.update((d) => choose(d, rec, letter));
  };
  const addOwn = () => {
    ctx.update((d) => addOption(d, rec, optionText));
    setOptionText("");
  };
  return (
    <>
      <Dependencies rec={rec} ctx={ctx} setMsg={setMsg} />
      {rec.evidence.length > 0 && <div className="note"><b>улики записи</b>{rec.evidence.map((ev, i) => <EvidenceLine ev={ev} key={i} />)}</div>}
      {rec.finding && <div className="note"><b>находка:</b> <Text s={rec.finding} /></div>}
      {allOptions(rec, draft).map((o) => {
        const paired = chosenAntipodes(ctx.payload, draft, rec.id, o.letter);
        const anti = antipodesOf(ctx.payload.records, rec.id, o.letter);
        return (
          <label className={`opt${cur === o.letter ? " chosen" : ""}`} key={o.letter}>
            <input type="radio" name={rec.id} value={o.letter} checked={cur === o.letter} onChange={() => pick(o.letter)} />
            <div className="opt-body">
              <span className="letter">{o.letter}.</span> <Text s={o.text} />
              {rec.recommendation?.option === o.letter && <span className="tag plain">рекомендация</span>}
              {journal === o.letter && <span className="tag muted">в журнале</span>}
              {o.unlikely && <span className="tag muted">маловероятно</span>}
              {isHumanOption(o) && <span className="tag plain">добавлен человеком</span>}
              {o.deviation && <span className="tag accent">отступление от {o.deviation}</span>}
              {anti.length > 0 && <span className="tag accent" title={`нельзя вместе с: ${anti.join(", ")}`}>антипод {anti.join(", ")}</span>}
              {o.local && <button type="button" className="small tag-button" onClick={(e) => { e.preventDefault(); ctx.update((d) => removeAddedOption(d, rec.id, o.letter)); }}>убрать</button>}
              {o.unlikely && <span className="ev">маловероятно: <Text s={o.unlikely} /></span>}
              {paired.length > 0 && <span className="note accent">антипод уже выбран: {paired.join(", ")}. Выбрать можно, но вместе они станут строкой атаки.</span>}
              {o.evidence.map((ev, i) => <EvidenceLine ev={ev} key={i} />)}
            </div>
          </label>
        );
      })}
      {entry?.choice && <button type="button" className="small clear-choice" onClick={() => ctx.update((d) => clearChoice(d, rec.id))}>снять выбор {entry.choice}</button>}
      {rec.recommendation && (
        <div className="rec">рекомендация: <b>{rec.recommendation.option}</b> — <Text s={rec.recommendation.why} /></div>
      )}
      {rec.decision?.word && <div className="note"><b>слово в журнале ({rec.decision.date}):</b> «<Text s={rec.decision.word} />»</div>}
      {msg && <div className="note signal">{msg}</div>}
      {wordMissing(ctx.payload, draft, rec) && <div className="note signal" data-word-needed={rec.id}>{WORD_NEEDED_TEXT}</div>}
      <div className="row">
        <textarea rows={2} placeholder="слово человека дословно — почему так (или что изменить в решении из журнала)" value={entry?.word ?? ""} onChange={(e) => ctx.update((d) => setWord(d, rec.id, e.target.value))} />
      </div>
      <div className="row">
        <input type="text" placeholder="вариант, которого здесь нет" value={optionText} onChange={(e) => setOptionText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addOwn(); }} />
        <button type="button" className="small" onClick={addOwn}>добавить вариант</button>
      </div>
      <Parkings rec={rec} ctx={ctx} setMsg={setMsg} />
      {rec.outcome && <div className="cons">исход ({rec.outcome.kind}): {rec.outcome.value}{rec.outcome.reason ? ` — ${rec.outcome.reason}` : ""}</div>}
      <div className="cons">следствия: <Text s={rec.consequences || "—"} /></div>
    </>
  );
}

function Fact({ rec, ctx }: { rec: JournalRecord; ctx: CardContext }) {
  return (
    <>
      {rec.evidence.map((ev, i) => <EvidenceLine ev={ev} key={i} />)}
      {rec.dispute && <div className="note"><b>спор в журнале:</b> <Text s={rec.dispute} /></div>}
      <div className="cons">следствия: <Text s={rec.consequences || "—"} /></div>
      <div className="row">
        <textarea rows={2} placeholder="оспорить факт: что не так и чем это подтверждается" value={ctx.getDraft().disputes[rec.id] ?? ""} onChange={(e) => ctx.update((d) => setDispute(d, rec.id, e.target.value))} />
      </div>
    </>
  );
}

export const Card = memo(function Card({ rec, ctx, missingNodes }: CardProps) {
  const draft = ctx.getDraft();
  const isFact = rec.kind === "факт";
  const parked = rec.parking.length + (draft.decisions[rec.id]?.parked.length ?? 0);
  const level = rec.reversibility?.level;
  return (
    <article className={`card${isFact ? " fact" : ""}`} id={rec.id}>
      <header className="card-head">
        <span className="rid">{rec.id}</span>
        <Status rec={rec} draft={draft} payload={ctx.payload} />
        {parked > 0 && <span className="badge plain">парковка: {parked}</span>}
        {rec.delivery && <span className="badge muted">{rec.delivery}</span>}
        {rec.addressee && <span className="badge muted">адресат: {rec.addressee}</span>}
        {level && <span className={`badge ${level === ONE_WAY ? "accent" : "muted"}`} title={rec.reversibility!.why}>{level}</span>}
      </header>
      <h3 className="q"><Text s={rec.question} /></h3>
      {missingNodes && <div className="note accent">узел не найден: {missingNodes}</div>}
      {rec.reversibility?.why && <div className="cons">обратимость: <Text s={rec.reversibility.why} /></div>}
      {isFact ? <Fact rec={rec} ctx={ctx} /> : <Fork rec={rec} ctx={ctx} />}
    </article>
  );
});
