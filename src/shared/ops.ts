// Правки черновика человеком и счётчики: чистые функции, прежний объект не меняется — React сравнивает записи по ссылке.
import { chosen, isHumanOption, nextLetter } from "./logic";
import type { RecordFilter } from "./protocol";
import type { DecisionDraft, Draft, Evidence, JournalRecord, ViewPayload } from "./types";

const decision = (d: Draft, id: string): DecisionDraft => d.decisions[id] ?? { choice: null, word: "", parked: [] };
const withDecision = (d: Draft, id: string, patch: Partial<DecisionDraft>): Draft =>
  ({ ...d, decisions: { ...d.decisions, [id]: { ...decision(d, id), ...patch } } });

/** Вариант, уже стоящий в журнале, — не локальный выбор: промпту нечего вносить. */
export const choose = (d: Draft, rec: JournalRecord, letter: string): Draft =>
  withDecision(d, rec.id, { choice: letter === rec.decision?.option ? null : letter });

export const clearChoice = (d: Draft, id: string): Draft => withDecision(d, id, { choice: null });
export const setWord = (d: Draft, id: string, word: string): Draft => withDecision(d, id, { word });
export const setDispute = (d: Draft, id: string, text: string): Draft => ({ ...d, disputes: { ...d.disputes, [id]: text } });
export const setNotes = (d: Draft, notes: string): Draft => ({ ...d, notes });

export function addOption(d: Draft, rec: JournalRecord, text: string): Draft {
  const clean = text.trim();
  const letter = nextLetter(rec, d);
  if (!clean || !letter) return d;
  return { ...d, added: { ...d.added, [rec.id]: [...(d.added[rec.id] ?? []), { letter, text: clean }] } };
}

export function removeAddedOption(d: Draft, id: string, letter: string): Draft {
  const cur = decision(d, id);
  const next = { ...d, added: { ...d.added, [id]: (d.added[id] ?? []).filter((o) => o.letter !== letter) } };
  return cur.choice === letter ? withDecision(next, id, { choice: null }) : next;
}

export const park = (d: Draft, id: string, text: string, addressee: string): Draft =>
  withDecision(d, id, { parked: [...decision(d, id).parked, { text, addressee }] });

export const unpark = (d: Draft, id: string, index: number): Draft =>
  withDecision(d, id, { parked: decision(d, id).parked.filter((_, i) => i !== index) });

const deps = (d: Draft, id: string) => d.deps[id] ?? { add: [], remove: [] };
const withDeps = (d: Draft, id: string, value: { add: string[]; remove: string[] }): Draft => ({ ...d, deps: { ...d.deps, [id]: value } });

export function addDep(p: ViewPayload, d: Draft, id: string, input: string): { draft: Draft } | { error: string } {
  const dep = input.trim().toUpperCase().replace(/^F(\d)/, "F-$1");
  const rec = p.records.find((r) => r.id === id);
  if (!p.records.some((r) => r.id === dep)) return { error: `нет записи ${dep || "(пусто)"}` };
  if (dep === id) return { error: "запись не может зависеть от себя" };
  const u = deps(d, id);
  if (rec?.depends_on.includes(dep)) return { draft: withDeps(d, id, { ...u, remove: u.remove.filter((x) => x !== dep) }) };
  return { draft: u.add.includes(dep) ? d : withDeps(d, id, { ...u, add: [...u.add, dep] }) };
}

/** Своя добавленная зависимость снимается без следа; зависимость журнала помечается снятой — это уйдёт в промпт. */
export function removeDep(d: Draft, rec: JournalRecord, dep: string): Draft {
  const u = deps(d, rec.id);
  if (u.add.includes(dep)) return withDeps(d, rec.id, { ...u, add: u.add.filter((x) => x !== dep) });
  return u.remove.includes(dep) ? d : withDeps(d, rec.id, { ...u, remove: [...u.remove, dep] });
}

export const restoreDep = (d: Draft, id: string, dep: string): Draft => {
  const u = deps(d, id);
  return withDeps(d, id, { ...u, remove: u.remove.filter((x) => x !== dep) });
};

export function addNewFork(d: Draft, question: string, options: string, word: string): Draft {
  const q = question.trim();
  if (!q) return d;
  const taken = d.newForks.map((f) => parseInt(f.id.slice(3), 10) || 0);
  const id = `F-N${Math.max(0, ...taken) + 1}`;
  return { ...d, newForks: [...d.newForks, { id, question: q, options: options.trim(), word: word.trim() }] };
}

export const removeNewFork = (d: Draft, id: string): Draft => ({ ...d, newForks: d.newForks.filter((f) => f.id !== id) });

export { isHumanOption };

/** Уровень цвета улики (Р21). «Корня нет» — особенность запуска, не находка; «не проверить» — файл не текст. */
export function evidenceLevel(ev: Evidence): "muted" | "signal" {
  if (ev.found !== false) return "muted";
  return ev.verdict === "корня для пути нет" ? "muted" : "signal";
}

const evidenceOf = (rec: JournalRecord): Evidence[] => [...rec.evidence, ...rec.options.flatMap((o) => o.evidence)];

export interface Stats {
  forks: number;
  decided: number;
  changed: number;
  open: number;
  parked: number;
  facts: number;
  disputed: number;
  newForks: number;
  quoteMissing: number;
}

export function stats(p: ViewPayload, d: Draft): Stats {
  const forks = p.records.filter((r) => r.kind !== "факт");
  const decided = forks.filter((r) => chosen(p, d, r.id)).length;
  return {
    forks: forks.length,
    decided,
    changed: forks.filter((r) => { const c = d.decisions[r.id]?.choice; return c && r.decision && c !== r.decision.option; }).length,
    open: forks.length - decided,
    parked: forks.filter((r) => r.parking.length || d.decisions[r.id]?.parked.length).length,
    facts: p.records.length - forks.length,
    disputed: Object.values(d.disputes).filter((v) => v.trim()).length,
    newForks: d.newForks.length,
    quoteMissing: p.records.flatMap(evidenceOf).filter((ev) => evidenceLevel(ev) === "signal").length,
  };
}

export type RecordMark = "fact" | "open" | "parked" | "decided" | "changed";

/** Метка записи в оглавлении: черновик учитывается, как и в карточке. */
export function recordMark(p: ViewPayload, d: Draft, rec: JournalRecord): RecordMark {
  if (rec.kind === "факт") return "fact";
  const local = d.decisions[rec.id]?.choice;
  if (local && rec.decision && local !== rec.decision.option) return "changed";
  if (chosen(p, d, rec.id)) return "decided";
  return rec.parking.length || d.decisions[rec.id]?.parked.length ? "parked" : "open";
}

/** Фильтр режима «решения»: развилка без выбора открыта и с учётом черновика, как в карточке. */
/** Связан ли журнал со схемой: `nodes: []` работает как нет поля (F-86). */
export const hasNodes = (p: ViewPayload) => p.records.some((r) => (r.nodes ?? []).length > 0);
/** Сравнение дословное (F-87). */
export const inNode = (rec: JournalRecord, id: string) => (rec.nodes ?? []).includes(id);

export function matchesRecordFilter(p: ViewPayload, d: Draft, rec: JournalRecord, f: RecordFilter): boolean {
  switch (f) {
    case "all": return true;
    case "facts": return rec.kind === "факт";
    case "forks": return rec.kind !== "факт";
    case "open": return rec.kind !== "факт" && !chosen(p, d, rec.id);
  }
}

const PROMPT_MIN_HEIGHT = 48;
/** Шапка страницы и строка панели возврата: они видны при любой высоте промпта; то же число — в style.css. */
const PROMPT_RESERVED_HEIGHT = 170;

export function clampPromptHeight(height: number, viewport: number): number {
  return Math.max(PROMPT_MIN_HEIGHT, Math.min(height, viewport - PROMPT_RESERVED_HEIGHT));
}

export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
