// Правила просмотрщика без DOM и vscode: выбор, антиподы, зависимости, очистка внесённого, промпт возврата.
// Строки промпта пишутся по грамматике `journal_apply.parse_answers`; контракт держит test/unit/contract.test.ts.
import type { DecisionDraft, Draft, JournalOption, JournalRecord, ViewPayload } from "./types";

export const ADDED_MARK = "(добавлен человеком";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const EMPTY_LINE = "(нового нет — решения из журнала остаются как есть, молчание по открытой развилке оставляет её открытой)";

export const norm = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();
const shorten = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const withoutMark = (text: string) => norm(text.split(ADDED_MARK)[0]);

export const emptyDraft = (): Draft => ({ decisions: {}, added: {}, newForks: [], disputes: {}, deps: {}, notes: "", attackDisputes: {} });

const isObject = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

function stringMap(v: unknown): Record<string, string> {
  if (!isObject(v)) return {};
  return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>;
}

/** Черновик из файла: то, что не по форме, заменяется умолчанием; форму файла могли поправить руками. */
export function normalizeDraft(raw: unknown): Draft {
  const out = emptyDraft();
  if (!isObject(raw)) return out;
  if (isObject(raw.decisions)) {
    for (const [id, d] of Object.entries(raw.decisions)) {
      if (!isObject(d)) continue;
      out.decisions[id] = {
        choice: typeof d.choice === "string" ? d.choice : null,
        word: typeof d.word === "string" ? d.word : "",
        parked: Array.isArray(d.parked) ? d.parked.filter((p) => isObject(p) && typeof p.text === "string" && typeof p.addressee === "string") : [],
      };
    }
  }
  if (isObject(raw.added)) {
    for (const [id, list] of Object.entries(raw.added)) {
      if (Array.isArray(list)) out.added[id] = list.filter((o) => isObject(o) && typeof o.letter === "string" && typeof o.text === "string");
    }
  }
  if (Array.isArray(raw.newForks)) {
    out.newForks = raw.newForks.filter((f) => isObject(f) && typeof f.question === "string")
      .map((f, i) => ({ id: typeof f.id === "string" ? f.id : `F-N${i + 1}`, question: f.question, options: String(f.options ?? ""), word: String(f.word ?? "") }));
  }
  if (isObject(raw.deps)) {
    for (const [id, u] of Object.entries(raw.deps)) if (isObject(u)) out.deps[id] = { add: strings(u.add), remove: strings(u.remove) };
  }
  out.disputes = stringMap(raw.disputes);
  out.attackDisputes = stringMap(raw.attackDisputes);
  if (typeof raw.notes === "string") out.notes = raw.notes;
  return out;
}

const journalChoice = (rec: JournalRecord | undefined) => rec?.decision?.option ?? null;

export function chosen(p: ViewPayload, d: Draft, id: string): string | null {
  return d.decisions[id]?.choice ?? journalChoice(p.records.find((r) => r.id === id));
}

export function effectiveDeps(rec: JournalRecord, d: Draft): { id: string; kind: "journal" | "removed" | "added" }[] {
  const u = d.deps[rec.id] ?? { add: [], remove: [] };
  return [
    ...rec.depends_on.map((id) => ({ id, kind: u.remove.includes(id) ? "removed" as const : "journal" as const })),
    ...u.add.map((id) => ({ id, kind: "added" as const })),
  ];
}

export function allOptions(rec: JournalRecord, d: Draft): (JournalOption & { local?: boolean })[] {
  return [...rec.options, ...(d.added[rec.id] ?? []).map((o) => ({ ...o, added: true, unlikely: null, evidence: [], local: true }))];
}

export function nextLetter(rec: JournalRecord, d: Draft): string | null {
  const used = allOptions(rec, d).map((o) => o.letter);
  return [...LETTERS].find((l) => !used.includes(l)) ?? null;
}

/** Антиподы варианта с обеих сторон: запись называет чужой вариант, и чужая запись называет этот. */
export function antipodesOf(records: JournalRecord[], id: string, letter: string): string[] {
  const out = new Set<string>();
  for (const a of records.find((r) => r.id === id)?.antipodes ?? []) if (a.option === letter) out.add(a.other);
  for (const r of records) for (const a of r.antipodes) if (a.other === `${id}.${letter}`) out.add(`${r.id}.${a.option}`);
  return [...out];
}

export function chosenAntipodes(p: ViewPayload, d: Draft, id: string, letter: string): string[] {
  return antipodesOf(p.records, id, letter).filter((k) => {
    const [other, l] = k.split(".");
    return chosen(p, d, other) === l;
  });
}

/** `apply` дописывает новое слово к прежнему, поэтому внесённое — вхождение в слово решения, а не равенство. */
function wordIngested(journalWord: unknown, word: unknown): boolean {
  const w = norm(word);
  return w !== "" && norm(journalWord).includes(w);
}

/** Ключ спора — файл, раздел и утверждение: при повторной атаке спор остаётся у той же строки, а не у того же номера. */
export const disputeKey = (path: string, r: { section: string; claim: string }) => `${path}|${r.section}|${r.claim}`;

/** Вычищает из черновика то, что уже стоит в журнале. Ничего не изменилось — возвращает тот же объект. */
export function cleanupIngested(p: ViewPayload, d: Draft): Draft {
  const out: Draft = {
    ...d, decisions: { ...d.decisions }, added: { ...d.added }, disputes: { ...d.disputes }, deps: { ...d.deps }, attackDisputes: { ...d.attackDisputes },
  };
  for (const rec of p.records) {
    const added = out.added[rec.id];
    if (added) {
      const left = added.filter((o) => !rec.options.some((x) => x.letter === o.letter && withoutMark(x.text) === norm(o.text)));
      if (left.length === 0) delete out.added[rec.id];
      else out.added[rec.id] = left;
    }
    const u = out.deps[rec.id];
    if (u) {
      const left = { add: u.add.filter((x) => !rec.depends_on.includes(x)), remove: u.remove.filter((x) => rec.depends_on.includes(x)) };
      out.deps[rec.id] = left;
    }
    const sp = norm(out.disputes[rec.id]);
    if (sp && norm(rec.dispute).includes(sp)) delete out.disputes[rec.id];
    const cur = out.decisions[rec.id];
    if (cur) out.decisions[rec.id] = cleanDecision(rec, cur);
  }
  const questions = new Set(p.records.map((r) => norm(r.question)));
  out.newForks = d.newForks.filter((f) => !questions.has(norm(f.question)));
  const noteTexts = p.notes.map((n) => norm(n.text));
  const own = norm(d.notes);
  if (own && noteTexts.some((t) => t.includes(own))) out.notes = "";
  const byId = new Map(p.records.map((r) => [r.id, r]));
  for (const att of p.attacks) {
    for (const r of att.rows ?? []) {
      const k = disputeKey(att.path, r), sp = norm(out.attackDisputes[k]);
      if (!sp) continue;
      const rec = askedRecord(r, byId);
      const answered = rec?.decision && (out.decisions[rec.id]?.choice ?? rec.decision.option) === rec.decision.option && wordIngested(rec.decision.word, sp);
      if (answered || noteTexts.some((t) => t.includes(sp))) delete out.attackDisputes[k];
    }
  }
  return JSON.stringify(out) === JSON.stringify(d) ? d : out;
}

/** Строка атаки, закрываемая вопросом человеку к решению записи: ответ на неё — слово к решению, а не замечание. */
function askedRecord(r: { section: string; fix: string }, byId: Map<string, JournalRecord>): JournalRecord | undefined {
  const m = /^(F-\d+),\s*decision\b/.exec(norm(r.section));
  const rec = m ? byId.get(m[1]) : undefined;
  return rec?.kind === "развилка" && norm(r.fix).toLowerCase() === "вопрос человеку" ? rec : undefined;
}

function cleanDecision(rec: JournalRecord, cur: DecisionDraft): DecisionDraft {
  const jpark = rec.parking.map((x) => norm(x.text));
  const same = rec.decision && (!cur.choice || cur.choice === rec.decision.option);
  return {
    choice: rec.decision && cur.choice === rec.decision.option ? null : cur.choice,
    word: cur.word && ((same && wordIngested(rec.decision!.word, cur.word)) || jpark.includes(norm(cur.word))) ? "" : cur.word,
    parked: cur.parked.filter((x) => norm(x.text) && !jpark.includes(norm(x.text))),
  };
}

export interface Prompt {
  text: string;
  /** Вносить нечего: только шапка и строка «нового нет». */
  empty: boolean;
  /** Ключи споров строк атаки: два разных ответа к одному решению. */
  conflictKeys: string[];
  /** Ключи споров строк атаки: ответ к записи без решения ушёл замечанием. */
  undecidedKeys: string[];
}

/** Промпт возврата — чистая функция журнала и черновика. Уже внесённое в промпт не попадает. */
export function buildPrompt(p: ViewPayload, d: Draft, date: string): Prompt {
  const byId = new Map(p.records.map((r) => [r.id, r]));
  const letterOf = (rec: JournalRecord) => d.decisions[rec.id]?.choice ?? journalChoice(rec);
  const lines = [`Решения по журналу ${p.source}, ${date}:`];

  const answers = new Map<string, { key: string; text: string }[]>();
  const otherDisputes: string[] = [];
  const undecidedKeys: string[] = [];
  for (const att of p.attacks) {
    for (const r of att.rows ?? []) {
      const key = disputeKey(att.path, r), sp = norm(d.attackDisputes[key]);
      if (!sp) continue;
      const rec = askedRecord(r, byId);
      if (rec && letterOf(rec)) {
        answers.set(rec.id, [...(answers.get(rec.id) ?? []), { key, text: sp }]);
      } else if (rec) {
        undecidedKeys.push(key);
        otherDisputes.push(`${rec.id}: ${sp}`);
      } else {
        otherDisputes.push(`атака ${att.path} · ${r.lens} · «${shorten(r.claim, 60)}» — спор: ${sp}`);
      }
    }
  }

  const conflicts: string[] = [];
  const conflictKeys: string[] = [];
  for (const rec of p.records) {
    if (rec.kind === "факт") {
      const sp = norm(d.disputes[rec.id]);
      if (sp && !norm(rec.dispute).includes(sp)) lines.push(`- ${rec.id}: факт оспорен — «${sp}»`);
      continue;
    }
    const jc = journalChoice(rec), jword = norm(rec.decision?.word);
    for (const o of d.added[rec.id] ?? []) {
      const known = rec.options.some((x) => x.letter === o.letter && withoutMark(x.text) === norm(o.text));
      if (!known) lines.push(`- ${rec.id}: добавлен вариант ${o.letter}. ${o.text}`);
    }
    const u = d.deps[rec.id];
    if (u) {
      for (const x of u.add) if (!rec.depends_on.includes(x)) lines.push(`- ${rec.id}: зависимость добавлена ${x}`);
      for (const x of u.remove) if (rec.depends_on.includes(x)) lines.push(`- ${rec.id}: зависимость снята ${x}`);
    }
    const cur = d.decisions[rec.id];
    if (cur) {
      const w = cur.word.trim(), jpark = rec.parking.map((x) => norm(x.text));
      for (const x of cur.parked) if (!jpark.includes(norm(x.text))) lines.push(`- ${rec.id}: припарковано → ${x.addressee} — «${x.text}»`);
      if (cur.choice && cur.choice !== jc) lines.push(`- ${rec.id}: ${cur.choice}${jc ? ` (было ${jc})` : ""}${w ? ` — «${w}»` : " — (без слова)"}`);
      else if (w && !wordIngested(jword, w)) lines.push(`- ${rec.id}: ${jc ? `к решению ${jc}` : "без выбора"} — «${w}»`);
    }
    const letter = letterOf(rec);
    const ans = (answers.get(rec.id) ?? []).filter((a) => !(jc && letter === jc && wordIngested(jword, a.text)));
    const distinct = [...new Set(ans.map((a) => a.text))];
    if (distinct.length > 1) {
      conflicts.push(rec.id);
      conflictKeys.push(...ans.map((a) => a.key));
    } else if (distinct.length === 1) {
      lines.push(`- ${rec.id}: ${letter} — «${distinct[0]}»`);
    }
  }

  if (d.newForks.length) {
    lines.push("Новые развилки:");
    for (const f of d.newForks) lines.push(`- ${f.id}: ${f.question} — варианты: ${f.options.replace(/\n+/g, " | ")}${f.word ? ` — «${f.word}»` : ""}`);
  }
  const own = d.notes.trim();
  const ingested = own !== "" && p.notes.some((n) => norm(n.text).includes(norm(own)));
  const notes = [own && !ingested ? own : "", ...otherDisputes, ...conflicts.map((id) => `конфликт ответов к ${id} — оставьте один`)].filter(Boolean);
  if (notes.length) lines.push(`Замечания к схеме: ${notes.join(" · ")}`);
  const empty = lines.length === 1;
  if (empty) lines.push(EMPTY_LINE);
  return { text: lines.join("\n"), empty, conflictKeys, undecidedKeys };
}

/** Просьба слова при выборе мимо рекомендации; текст тот же, что в шаблоне страницы ядра (F-29). */
export const WORD_NEEDED_TEXT = "Выбран не рекомендованный вариант: напиши, почему. Так выбор поймёт читатель журнала; внести можно и без слова.";

/** Условие страницы целиком (F-97): выбор мимо рекомендации, не вариант человека, слова нет ни в черновике, ни в журнале. Только сигнал, выбор не запирает. */
export function wordMissing(p: ViewPayload, d: Draft, rec: JournalRecord): boolean {
  const rc = rec.recommendation?.option;
  const cur = chosen(p, d, rec.id);
  if (!rc || !cur || cur === rc) return false;
  if (allOptions(rec, d).some((o) => o.letter === cur && o.added)) return false;
  const saved = rec.decision?.option === cur ? rec.decision.word : "";
  return !norm(d.decisions[rec.id]?.word) && !norm(saved);
}
