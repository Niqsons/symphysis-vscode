import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allOptions, antipodesOf, blockedBy, buildPrompt, chosen, cleanupIngested, effectiveDeps, emptyDraft, nextLetter, normalizeDraft,
} from "../../src/shared/logic";
import type { AttackRow, Draft } from "../../src/shared/types";
import { fact, fork, option, payload } from "./helpers";

const DATE = "2026-11-01";
const lines = (p: ReturnType<typeof payload>, d: Draft) => buildPrompt(p, d, DATE).text.split("\n").slice(1);
const draft = (over: Partial<Draft>): Draft => ({ ...emptyDraft(), ...over });
const decision = (choice: string | null, word = "", parked: { text: string; addressee: string }[] = []) => ({ choice, word, parked });

test("пустой черновик: шапка и строка «нового нет», промпт помечен пустым", () => {
  const r = buildPrompt(payload([fork("F-01")]), emptyDraft(), DATE);
  assert.equal(r.empty, true);
  assert.match(r.text, /^Решения по журналу decisions\.json, 2026-11-01:\n\(нового нет/);
});

test("выбор без слова: (без слова)", () => {
  assert.deepEqual(lines(payload([fork("F-01")]), draft({ decisions: { "F-01": decision("B") } })), ["- F-01: B — (без слова)"]);
});

test("смена решения: (было X) и слово", () => {
  const p = payload([fork("F-01", { decision: { option: "A", word: "старое", date: DATE } })]);
  assert.deepEqual(lines(p, draft({ decisions: { "F-01": decision("B", "передумал") } })), ["- F-01: B (было A) — «передумал»"]);
});

test("выбор, совпавший с журналом, строки не даёт", () => {
  const p = payload([fork("F-01", { decision: { option: "A", word: "", date: DATE } })]);
  assert.equal(buildPrompt(p, draft({ decisions: { "F-01": decision("A") } }), DATE).empty, true);
});

test("слово без выбора: к решению у решённой и без выбора у открытой", () => {
  const p = payload([fork("F-01", { decision: { option: "A", word: "", date: DATE } }), fork("F-02")]);
  assert.deepEqual(lines(p, draft({ decisions: { "F-01": decision(null, "уточняю"), "F-02": decision(null, "думаю") } })),
    ["- F-01: к решению A — «уточняю»", "- F-02: без выбора — «думаю»"]);
});

test("слово, уже вошедшее в решение журнала, строки не даёт: сравнение вхождением, пробелы схлопнуты", () => {
  const p = payload([fork("F-01", { decision: { option: "A", word: "первое слово  и второе", date: DATE } })]);
  assert.equal(buildPrompt(p, draft({ decisions: { "F-01": decision(null, "слово и\nвторое") } }), DATE).empty, true);
});

test("добавленный вариант идёт раньше выбора этого варианта", () => {
  const d = draft({ added: { "F-01": [{ letter: "C", text: "третий" }] }, decisions: { "F-01": decision("C") } });
  assert.deepEqual(lines(payload([fork("F-01")]), d), ["- F-01: добавлен вариант C. третий", "- F-01: C — (без слова)"]);
});

test("добавленный вариант, уже внесённый с пометкой человека, строки не даёт", () => {
  const rec = fork("F-01", { options: [option("A"), option("C", { text: "третий (добавлен человеком)", added: true })] });
  assert.equal(buildPrompt(payload([rec]), draft({ added: { "F-01": [{ letter: "C", text: "третий" }] } }), DATE).empty, true);
});

test("зависимости: добавлена и снята; уже внесённые строки не дают", () => {
  const p = payload([fork("F-01", { depends_on: ["F-02"] }), fork("F-02"), fork("F-03")]);
  assert.deepEqual(lines(p, draft({ deps: { "F-01": { add: ["F-03"], remove: ["F-02"] } } })),
    ["- F-01: зависимость добавлена F-03", "- F-01: зависимость снята F-02"]);
  assert.equal(buildPrompt(p, draft({ deps: { "F-01": { add: ["F-02"], remove: ["F-03"] } } }), DATE).empty, true);
});

test("парковка: строка с адресатом, уже внесённая не повторяется", () => {
  const p = payload([fork("F-01", { parking: [{ addressee: "ИБ", text: "старая" }] })]);
  const d = draft({ decisions: { "F-01": decision(null, "", [{ text: "старая", addressee: "ИБ" }, { text: "новая", addressee: "материалы" }]) } });
  assert.deepEqual(lines(p, d), ["- F-01: припарковано → материалы — «новая»"]);
});

test("факт оспорен", () => {
  assert.deepEqual(lines(payload([fact("F-01")]), draft({ disputes: { "F-01": " не так " } })), ["- F-01: факт оспорен — «не так»"]);
});

test("новые развилки: отдельный раздел, варианты через черту", () => {
  const d = draft({ newForks: [{ id: "F-N1", question: "что?", options: "да\nнет", word: "почему" }] });
  assert.deepEqual(lines(payload([]), d), ["Новые развилки:", "- F-N1: что? — варианты: да | нет — «почему»"]);
});

test("замечания: своё последним разделом одной строкой, внесённое не повторяется", () => {
  assert.deepEqual(lines(payload([]), draft({ notes: "поправить" })), ["Замечания к схеме: поправить"]);
  const p = payload([], { notes: [{ date: DATE, text: "поправить и ещё" }] });
  assert.equal(buildPrompt(p, draft({ notes: "поправить" }), DATE).empty, true);
});

const row = (over: Partial<AttackRow>): AttackRow =>
  ({ claim: "утверждение", section: "F-01, decision", lens: "coverage", invariant: "", severity: "блокер", support: "нет", fix: "вопрос человеку", ...over });
const key = (r: AttackRow) => `attack/decisions.md|${r.section}|${r.claim}`;

test("ответ на вопрос атаки к решённой записи — слово к решению с её буквой", () => {
  const r = row({});
  const p = payload([fork("F-01", { decision: { option: "A", word: "", date: DATE } })], { attacks: [{ path: "attack/decisions.md", rows: [r] }] });
  assert.deepEqual(lines(p, draft({ attackDisputes: { [key(r)]: "ответ" } })), ["- F-01: A — «ответ»"]);
});

test("ответ к записи без решения — замечание, запись остаётся открытой", () => {
  const r = row({});
  const p = payload([fork("F-01")], { attacks: [{ path: "attack/decisions.md", rows: [r] }] });
  const out = buildPrompt(p, draft({ attackDisputes: { [key(r)]: "ответ" } }), DATE);
  assert.deepEqual(out.text.split("\n").slice(1), ["Замечания к схеме: F-01: ответ"]);
  assert.deepEqual(out.undecidedKeys, [key(r)]);
});

test("два разных ответа к одной записи — конфликт: строки слова нет, ключи названы", () => {
  const a = row({ claim: "первое" }), b = row({ claim: "второе" });
  const p = payload([fork("F-01", { decision: { option: "A", word: "", date: DATE } })], { attacks: [{ path: "attack/decisions.md", rows: [a, b] }] });
  const out = buildPrompt(p, draft({ attackDisputes: { [key(a)]: "да", [key(b)]: "нет" } }), DATE);
  assert.deepEqual(out.text.split("\n").slice(1), ["Замечания к схеме: конфликт ответов к F-01 — оставьте один"]);
  assert.deepEqual(out.conflictKeys.sort(), [key(a), key(b)].sort());
});

test("спор по прочей строке атаки — замечание с файлом, линзой и началом утверждения", () => {
  const r = row({ section: "F-01, question", fix: "правка" });
  const p = payload([fork("F-01")], { attacks: [{ path: "attack/decisions.md", rows: [r] }] });
  assert.deepEqual(lines(p, draft({ attackDisputes: { [key(r)]: "опора есть" } })),
    ["Замечания к схеме: атака attack/decisions.md · coverage · «утверждение» — спор: опора есть"]);
});

test("битый файл атаки промпт не ломает", () => {
  assert.equal(buildPrompt(payload([], { attacks: [{ path: "attack/x.md", error: "битый" }] }), emptyDraft(), DATE).empty, true);
});

test("антиподы видны с обеих сторон; блокируют, только если другая сторона выбрана", () => {
  const p = payload([fork("F-01", { antipodes: [{ option: "A", other: "F-02.B" }] }), fork("F-02")]);
  assert.deepEqual(antipodesOf(p.records, "F-01", "A"), ["F-02.B"]);
  assert.deepEqual(antipodesOf(p.records, "F-02", "B"), ["F-01.A"]);
  assert.deepEqual(blockedBy(p, emptyDraft(), "F-02", "B"), []);
  assert.deepEqual(blockedBy(p, draft({ decisions: { "F-01": decision("A") } }), "F-02", "B"), ["F-01.A"]);
});

test("выбор: черновик важнее журнала, журнал важнее пустоты, рекомендация выбором не считается", () => {
  const p = payload([fork("F-01", { decision: { option: "A", word: "", date: DATE } }), fork("F-02", { recommendation: { option: "A", why: "" } })]);
  assert.equal(chosen(p, emptyDraft(), "F-01"), "A");
  assert.equal(chosen(p, draft({ decisions: { "F-01": decision("B") } }), "F-01"), "B");
  assert.equal(chosen(p, emptyDraft(), "F-02"), null);
});

test("действующие зависимости: журнал, снятая и добавленная различимы", () => {
  const rec = fork("F-01", { depends_on: ["F-02", "F-03"] });
  assert.deepEqual(effectiveDeps(rec, draft({ deps: { "F-01": { add: ["F-04"], remove: ["F-03"] } } })),
    [{ id: "F-02", kind: "journal" }, { id: "F-03", kind: "removed" }, { id: "F-04", kind: "added" }]);
});

test("варианты: журнал и добавленные; следующая буква свободна с учётом добавленных", () => {
  const rec = fork("F-01");
  const d = draft({ added: { "F-01": [{ letter: "C", text: "третий" }] } });
  assert.deepEqual(allOptions(rec, d).map((o) => o.letter), ["A", "B", "C"]);
  assert.equal(nextLetter(rec, d), "D");
});

test("очистка: то, что внесено, из черновика уходит; невнесённое остаётся", () => {
  const p = payload([
    fork("F-01", { decision: { option: "A", word: "слово", date: DATE }, options: [option("A"), option("C", { text: "третий (добавлен человеком)", added: true })], parking: [{ addressee: "ИБ", text: "вопрос" }], depends_on: ["F-02"] }),
    fact("F-02", { dispute: "«не так»" }),
    fork("F-03"),
  ], { notes: [{ date: DATE, text: "замечание" }] });
  const d: Draft = {
    decisions: {
      "F-01": decision("A", "слово", [{ text: "вопрос", addressee: "ИБ" }, { text: "другой", addressee: "человек" }]),
      "F-03": decision("B", "ещё нет"),
    },
    added: { "F-01": [{ letter: "C", text: "третий" }, { letter: "D", text: "четвёртый" }] },
    newForks: [], disputes: { "F-02": "не так" }, deps: { "F-01": { add: ["F-02", "F-03"], remove: ["F-09"] } }, notes: "замечание", attackDisputes: {},
  };
  const out = cleanupIngested(p, d);
  assert.deepEqual(out.decisions["F-01"], decision(null, "", [{ text: "другой", addressee: "человек" }]));
  assert.deepEqual(out.decisions["F-03"], decision("B", "ещё нет"));
  assert.deepEqual(out.added["F-01"], [{ letter: "D", text: "четвёртый" }]);
  assert.deepEqual(out.disputes, {});
  assert.deepEqual(out.deps["F-01"], { add: ["F-03"], remove: [] });
  assert.equal(out.notes, "");
});

test("очистка: новая развилка, вопрос которой уже в журнале, уходит — повторное внесение не задвоит запись", () => {
  const p = payload([fork("F-05", { question: "что выбрать?" })]);
  const d = draft({ newForks: [{ id: "F-N1", question: "что  выбрать?", options: "да", word: "" }, { id: "F-N2", question: "другое?", options: "да", word: "" }] });
  assert.deepEqual(cleanupIngested(p, d).newForks.map((f) => f.question), ["другое?"]);
});

test("очистка: спор по строке атаки, вошедший в заметки журнала, уходит", () => {
  const r = row({ section: "F-01, question", fix: "правка" });
  const p = payload([fork("F-01")], { attacks: [{ path: "attack/decisions.md", rows: [r] }], notes: [{ date: DATE, text: "атака … спор: опора есть" }] });
  assert.deepEqual(cleanupIngested(p, draft({ attackDisputes: { [key(r)]: "опора есть" } })).attackDisputes, {});
});

test("очистка: ответ на вопрос атаки, вошедший в слово решения, уходит; при смене буквы остаётся", () => {
  const r = row({});
  const p = payload([fork("F-01", { decision: { option: "A", word: "прежнее ответ человека", date: DATE } })], { attacks: [{ path: "attack/decisions.md", rows: [r] }] });
  const answered = { [key(r)]: "ответ человека" };
  assert.deepEqual(cleanupIngested(p, draft({ attackDisputes: answered })).attackDisputes, {});
  const changing = draft({ attackDisputes: answered, decisions: { "F-01": decision("B") } });
  assert.deepEqual(cleanupIngested(p, changing).attackDisputes, answered);
});

test("очистка: прочий спор, похожий на слово решения, не трогается — он уходит замечанием", () => {
  const r = row({ fix: "правка" });
  const p = payload([fork("F-01", { decision: { option: "A", word: "совпало", date: DATE } })], { attacks: [{ path: "attack/decisions.md", rows: [r] }] });
  assert.deepEqual(cleanupIngested(p, draft({ attackDisputes: { [key(r)]: "совпало" } })).attackDisputes, { [key(r)]: "совпало" });
});

test("очистка без изменений возвращает тот же объект", () => {
  const d = draft({ decisions: { "F-01": decision("B", "слово") } });
  assert.equal(cleanupIngested(payload([fork("F-01")]), d), d);
});

test("очистка не трогает черновик записи, которой в журнале нет", () => {
  const d = draft({ decisions: { "F-77": decision("B", "слово") } });
  assert.equal(cleanupIngested(payload([fork("F-01")]), d), d);
});

test("черновик из файла: мусор заменяется умолчаниями, годное сохраняется", () => {
  assert.deepEqual(normalizeDraft(null), emptyDraft());
  assert.deepEqual(normalizeDraft({ notes: 5, newForks: "x", decisions: { "F-01": { choice: "A" } } }),
    { ...emptyDraft(), decisions: { "F-01": decision("A") } });
});
