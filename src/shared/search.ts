// Поиск боковой панели: фраза по всему журналу, атаке и черновику — независимо от режима и фильтров страницы;
// номер — запись с зависимостями. Чистые функции: хост считает, страница поиска показывает.
import { attackFileName, rowAnchor, severityLevel } from "./attack";
import { chosen, disputeKey, effectiveDeps, norm } from "./logic";
import { recordMark } from "./ops";
import type { LinkedRecord, RecordCard, SearchHit, SearchOutcome } from "./protocol";
import type { AttackRow, Draft, Evidence, JournalRecord, ViewPayload } from "./types";

export const NOTES_ANCHOR = "journal-notes";

const SNIPPET_BEFORE = 30;
const SNIPPET_AFTER = 80;

/** Нижний регистр и ё → е, длина строки та же: индекс совпадения годится для исходного текста. */
function fold(s: string): string {
  const lower = s.toLowerCase();
  const same = lower.length === s.length ? lower : s.split("").map((c) => { const l = c.toLowerCase(); return l.length === 1 ? l : c; }).join("");
  return same.replace(/ё/g, "е");
}

type Finder = (folded: string) => { at: number; length: number } | null;

function phraseFinder(query: string): Finder {
  const q = fold(norm(query));
  return (s) => {
    const at = s.indexOf(q);
    return at < 0 ? null : { at, length: q.length };
  };
}

/** Полный номер записи: `F-07` не находит `F-070`, а `F-07.A` находит. */
function idFinder(id: string): Finder {
  const re = new RegExp(`(?<![\\p{L}\\p{N}-])${fold(id)}(?!\\d)`, "u");
  return (s) => {
    const m = re.exec(s);
    return m ? { at: m.index, length: m[0].length } : null;
  };
}

interface Field {
  field: string;
  text: unknown;
}

const evidenceFields = (list: Evidence[], field: string): Field[] => list.flatMap((ev) => [{ field, text: ev.quote }, { field, text: ev.path }]);

function recordFields(rec: JournalRecord, d: Draft): Field[] {
  const own = d.decisions[rec.id];
  return [
    { field: "вопрос", text: rec.question },
    ...rec.options.flatMap((o) => [
      { field: `вариант ${o.letter}`, text: o.text },
      { field: `вариант ${o.letter}, маловероятно`, text: o.unlikely },
      ...evidenceFields(o.evidence, `вариант ${o.letter}, улика`),
    ]),
    ...(d.added[rec.id] ?? []).map((o) => ({ field: `в черновике: вариант ${o.letter}`, text: o.text })),
    { field: "рекомендация", text: rec.recommendation?.why },
    { field: "слово", text: rec.decision?.word },
    { field: "в черновике: слово", text: own?.word },
    { field: "обратимость", text: rec.reversibility?.why },
    { field: "исход", text: rec.outcome?.value },
    { field: "исход", text: rec.outcome?.reason },
    ...rec.parking.flatMap((x) => [{ field: "парковка", text: x.text }, { field: "находка", text: x.finding }]),
    ...(own?.parked ?? []).map((x) => ({ field: "в черновике: парковка", text: x.text })),
    { field: "спор", text: rec.dispute },
    { field: "в черновике: спор", text: d.disputes[rec.id] },
    { field: "следствия", text: rec.consequences },
    { field: "находка", text: rec.finding },
    ...evidenceFields(rec.evidence, "улика"),
  ];
}

function rowFields(path: string, row: AttackRow, d: Draft): Field[] {
  return [
    { field: "утверждение", text: row.claim },
    { field: "раздел", text: row.section },
    { field: "линза", text: row.lens },
    { field: "инвариант", text: row.invariant },
    { field: "тяжесть", text: row.severity },
    { field: "опора", text: row.support },
    { field: "чем закрыть", text: row.fix },
    { field: "в черновике: спор", text: d.attackDisputes[disputeKey(path, row)] },
  ];
}

const plain = (s: string) => s.replace(/`/g, "");

/** Одно попадание на запись: первое совпавшее поле с отрывком и число совпавших полей. */
function firstHit(fields: Field[], find: Finder): Pick<SearchHit, "field" | "before" | "match" | "after" | "count"> | null {
  let hit: ReturnType<typeof firstHit> = null;
  let count = 0;
  for (const { field, text } of fields) {
    const clean = norm(text);
    const found = clean ? find(fold(clean)) : null;
    if (!found) continue;
    count++;
    if (hit) continue;
    const start = Math.max(0, found.at - SNIPPET_BEFORE), end = found.at + found.length;
    const stop = Math.min(clean.length, end + SNIPPET_AFTER);
    hit = {
      field, count: 0,
      before: (start > 0 ? "…" : "") + plain(clean.slice(start, found.at)),
      match: plain(clean.slice(found.at, end)),
      after: plain(clean.slice(end, stop)) + (stop < clean.length ? "…" : ""),
    };
  }
  return hit && { ...hit, count };
}

function collect(p: ViewPayload, d: Draft, find: Finder, skip?: string): { journal: SearchHit[]; attack: SearchHit[] } {
  const journal: SearchHit[] = [];
  const add = (fields: Field[], label: string, id: string) => {
    const hit = firstHit(fields, find);
    if (hit) journal.push({ ...hit, label, target: { id } });
  };
  for (const rec of p.records) if (rec.id !== skip) add(recordFields(rec, d), rec.id, rec.id);
  for (const f of d.newForks) add([{ field: "в черновике: вопрос", text: f.question }, { field: "в черновике: варианты", text: f.options }, { field: "в черновике: слово", text: f.word }], f.id, f.id);
  for (const n of p.notes) add([{ field: n.date, text: n.text }], "заметки", NOTES_ANCHOR);
  add([{ field: "в черновике", text: d.notes }], "заметки", NOTES_ANCHOR);

  const attack: SearchHit[] = [];
  p.attacks.forEach((att, file) => {
    (att.rows ?? []).forEach((row, index) => {
      const hit = firstHit(rowFields(att.path, row, d), find);
      if (hit) attack.push({ ...hit, label: `${attackFileName(att)} · ${row.section}`, level: severityLevel(row.severity), target: { id: rowAnchor(file, index), mode: "attack" } });
    });
  });
  return { journal, attack };
}

/** Номер в любом написании: `F-07`, `f7`, `7`; `а` — та же клавиша в русской раскладке. */
function recordNumber(query: string): number | null {
  const m = /^(?:[fфа]-?)?(\d+)$/i.exec(query.trim());
  return m ? Number(m[1]) : null;
}

const numberOf = (id: string) => Number(/^F-(\d+)$/.exec(id)?.[1] ?? NaN);

function recordCard(p: ViewPayload, d: Draft, rec: JournalRecord): RecordCard {
  const byId = new Map(p.records.map((r) => [r.id, r]));
  const up = new Map(p.records.map((r) => [r.id, effectiveDeps(r, d).filter((x) => x.kind !== "removed").map((x) => x.id)]));
  const down = new Map<string, string[]>();
  for (const [id, deps] of up) for (const dep of deps) down.set(dep, [...(down.get(dep) ?? []), id]);

  const link = (id: string): LinkedRecord => {
    const r = byId.get(id);
    return { id, question: plain(r?.question ?? ""), mark: r ? recordMark(p, d, r) : null };
  };
  /** Прямые и дальние по цепочке; журнальный порядок, чужие записи — в конце. */
  const reach = (edges: Map<string, string[]>) => {
    const direct = new Set(edges.get(rec.id) ?? []);
    const seen = new Set<string>(direct);
    const todo = [...direct];
    while (todo.length) for (const next of edges.get(todo.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); todo.push(next); }
    seen.delete(rec.id);
    direct.delete(rec.id);
    const order = (list: Iterable<string>) => {
      const ids = [...list];
      return [...p.records.map((r) => r.id).filter((id) => ids.includes(id)), ...ids.filter((id) => !byId.has(id))].map(link);
    };
    return { direct: order(direct), chain: order([...seen].filter((id) => !direct.has(id))) };
  };

  const upward = reach(up), downward = reach(down);
  const letter = chosen(p, d, rec.id);
  const text = letter ? [...rec.options, ...(d.added[rec.id] ?? [])].find((o) => o.letter === letter)?.text : undefined;
  return {
    id: rec.id, question: rec.question, kind: rec.kind, mark: recordMark(p, d, rec),
    picked: letter ? { letter, text: text ?? "" } : null,
    dependsOn: upward.direct, dependsOnChain: upward.chain, dependents: downward.direct, dependentsChain: downward.chain,
  };
}

export function search(p: ViewPayload, d: Draft, query: string): SearchOutcome {
  if (!query.trim()) return { kind: "empty" };
  const n = recordNumber(query);
  if (n === null) return { kind: "text", ...collect(p, d, phraseFinder(query)) };
  const rec = p.records.find((r) => numberOf(r.id) === n);
  if (rec) return { kind: "record", card: recordCard(p, d, rec), ...collect(p, d, idFinder(rec.id), rec.id) };
  return { kind: "text", missingRecord: `F-${String(n).padStart(2, "0")}`, ...collect(p, d, phraseFinder(query)) };
}
