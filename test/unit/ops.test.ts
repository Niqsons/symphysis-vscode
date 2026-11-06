import { test } from "node:test";
import assert from "node:assert/strict";
import { addDep, addNewFork, addOption, choose, clampPromptHeight, clearChoice, evidenceLevel, matchesRecordFilter, park, recordMark, removeDep, removeNewFork, restoreDep, setWord, stats, unpark } from "../../src/journal/ops";
import { emptyDraft } from "../../src/journal/logic";
import type { RecordFilter } from "../../src/protocol/protocol";
import { fact, fork, option, payload } from "./helpers";

const DATE = "2026-11-01";

test("выбор варианта, совпавшего с журналом, снимает локальный выбор", () => {
  const rec = fork("F-01", { decision: { option: "A", word: "", date: DATE } });
  const d = choose(emptyDraft(), rec, "B");
  assert.equal(d.decisions["F-01"].choice, "B");
  assert.equal(choose(d, rec, "A").decisions["F-01"].choice, null);
});

test("выбор не трогает прежний объект и слово записи", () => {
  const before = setWord(emptyDraft(), "F-01", "слово");
  const after = choose(before, fork("F-01"), "A");
  assert.equal(before.decisions["F-01"].choice, null);
  assert.equal(after.decisions["F-01"].word, "слово");
});

test("снятие выбора оставляет слово и парковки", () => {
  const d = park(setWord(choose(emptyDraft(), fork("F-01"), "A"), "F-01", "слово"), "F-01", "вопрос", "ИБ");
  const out = clearChoice(d, "F-01").decisions["F-01"];
  assert.equal(out.choice, null);
  assert.equal(out.word, "слово");
  assert.equal(out.parked.length, 1);
});

test("добавленный вариант получает следующую свободную букву; пустой текст не добавляется", () => {
  const rec = fork("F-01", { options: [option("A"), option("C")] });
  const d = addOption(emptyDraft(), rec, "  новый  ");
  assert.deepEqual(d.added["F-01"], [{ letter: "B", text: "новый" }]);
  assert.equal(addOption(d, rec, "   "), d);
});

test("парковка и снятие парковки", () => {
  const d = park(park(emptyDraft(), "F-01", "первый", "ИБ"), "F-01", "второй", "человек");
  assert.deepEqual(unpark(d, "F-01", 0).decisions["F-01"].parked, [{ text: "второй", addressee: "человек" }]);
});

test("зависимость: нормализация ввода, отказ на несуществующую и на себя", () => {
  const p = payload([fork("F-01"), fork("F-02")]);
  const ok = addDep(p, emptyDraft(), "F-01", " f02 ");
  assert.ok(!("error" in ok));
  if (!("error" in ok)) assert.deepEqual(ok.draft.deps["F-01"].add, ["F-02"]);
  const missing = addDep(p, emptyDraft(), "F-01", "F-99");
  assert.ok("error" in missing && /нет записи F-99/.test(missing.error));
  const self = addDep(p, emptyDraft(), "F-01", "F-01");
  assert.ok("error" in self && /от себя/.test(self.error));
});

test("зависимость журнала: снятие помечает, возврат снимает пометку, повторное добавление тоже", () => {
  const p = payload([fork("F-01", { depends_on: ["F-02"] }), fork("F-02")]);
  const removed = removeDep(emptyDraft(), p.records[0], "F-02");
  assert.deepEqual(removed.deps["F-01"].remove, ["F-02"]);
  assert.deepEqual(restoreDep(removed, "F-01", "F-02").deps["F-01"].remove, []);
  const again = addDep(p, removed, "F-01", "F-02");
  assert.ok(!("error" in again) && again.draft.deps["F-01"].remove.length === 0 && again.draft.deps["F-01"].add.length === 0);
});

test("своя добавленная зависимость снимается без следа", () => {
  const rec = fork("F-01");
  const d = removeDep({ ...emptyDraft(), deps: { "F-01": { add: ["F-02"], remove: [] } } }, rec, "F-02");
  assert.deepEqual(d.deps["F-01"], { add: [], remove: [] });
});

test("новая развилка: номер не повторяется после удаления, пустой вопрос не добавляется", () => {
  const one = addNewFork(emptyDraft(), "первая?", "да", "");
  const two = addNewFork(one, "вторая?", "нет", "");
  assert.deepEqual(two.newForks.map((f) => f.id), ["F-N1", "F-N2"]);
  const left = removeNewFork(two, "F-N1");
  assert.deepEqual(addNewFork(left, "третья?", "", "").newForks.map((f) => f.id), ["F-N2", "F-N3"]);
  assert.equal(addNewFork(one, "  ", "x", "y"), one);
});

test("счётчики учитывают черновик; факт развилкой не считается", () => {
  const p = payload([
    fork("F-01", { decision: { option: "A", word: "", date: DATE } }), fork("F-02"), fork("F-03", { parking: [{ addressee: "ИБ", text: "в" }] }), fact("F-04"),
  ]);
  const d = { ...choose(choose(emptyDraft(), p.records[0], "B"), p.records[1], "A"), disputes: { "F-04": "спор" } };
  assert.deepEqual(stats(p, d), { forks: 3, decided: 2, changed: 1, open: 1, parked: 1, facts: 1, disputed: 1, newForks: 0, quoteMissing: 0 });
});

test("уровень улики: сверено и «не проверить» побочные, пропажа цитаты сигнальная, «корня нет» побочный", () => {
  assert.equal(evidenceLevel({ path: "x", quote: "y", found: true, verdict: "сверено" }), "muted");
  assert.equal(evidenceLevel({ path: "x", quote: "y", found: null, verdict: "не проверить: бинарный файл" }), "muted");
  assert.equal(evidenceLevel({ path: "x", quote: "y", found: false, verdict: "корня для пути нет" }), "muted");
  assert.equal(evidenceLevel({ path: "x", quote: "y", found: false, verdict: "цитаты нет дословно" }), "signal");
  assert.equal(evidenceLevel({ path: "x", quote: "y", found: false, verdict: "файла нет" }), "signal");
  assert.equal(evidenceLevel({ path: "x", quote: "y", found: false, verdict: "вне корня" }), "signal");
});

test("метка оглавления: факт, открыто, парковка, решено, изменено", () => {
  const decided = { option: "A", word: "", date: DATE };
  const p = payload([fact("F-01"), fork("F-02"), fork("F-03", { parking: [{ addressee: "ИБ", text: "в" }] }), fork("F-04", { decision: decided }), fork("F-05", { decision: decided })]);
  const d = choose(emptyDraft(), p.records[4], "B");
  assert.deepEqual(p.records.map((r) => recordMark(p, d, r)), ["fact", "open", "parked", "decided", "changed"]);
});

test("высота промпта: не ниже минимума и оставляет место шапке и строке панели", () => {
  assert.equal(clampPromptHeight(300, 900), 300);
  assert.equal(clampPromptHeight(5, 900), 48);
  assert.equal(clampPromptHeight(5000, 900), 730);
  assert.equal(clampPromptHeight(300, 100), 48);
});

test("счётчик пропавших цитат смотрит и улики записи, и улики вариантов", () => {
  const miss = { path: "x", quote: "y", found: false, verdict: "цитаты нет дословно" };
  const p = payload([fact("F-01", { evidence: [miss] }), fork("F-02", { options: [option("A", { evidence: [miss] })] })]);
  assert.equal(stats(p, emptyDraft()).quoteMissing, 2);
});

test("фильтр записей: развилки, открытые, факты; черновик учитывается", () => {
  const p = payload([fact("F-01"), fork("F-02"), fork("F-03", { decision: { option: "A", word: "", date: "" } })]);
  const shown = (f: RecordFilter, d = emptyDraft()) => p.records.filter((r) => matchesRecordFilter(p, d, r, f)).map((r) => r.id);
  assert.deepEqual(shown("all"), ["F-01", "F-02", "F-03"]);
  assert.deepEqual(shown("forks"), ["F-02", "F-03"]);
  assert.deepEqual(shown("open"), ["F-02"]);
  assert.deepEqual(shown("facts"), ["F-01"]);
  assert.deepEqual(shown("open", { ...emptyDraft(), decisions: { "F-02": { choice: "B", word: "", parked: [] } } }), []);
});
