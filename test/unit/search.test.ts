import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "../../src/shared/logic";
import { rowAnchor } from "../../src/shared/attack";
import { search, type SearchOutcome } from "../../src/shared/search";
import type { AttackFile, AttackRow, Draft, JournalRecord, ViewPayload } from "../../src/shared/types";
import { fact, fork, option, payload } from "./helpers";

const asText = (o: SearchOutcome) => {
  if (o.kind !== "text") throw new Error(`ожидался текстовый поиск, а не ${o.kind}`);
  return o;
};
const asRecord = (o: SearchOutcome) => {
  if (o.kind !== "record") throw new Error(`ожидалась запись, а не ${o.kind}`);
  return o;
};
const find = (p: ViewPayload, q: string, d: Draft = emptyDraft()) => asText(search(p, d, q));

const row = (over: Partial<AttackRow> = {}): AttackRow =>
  ({ claim: "утверждение", section: "—", lens: "coverage", invariant: "инвариант", severity: "блокер", support: "нет", fix: "правка", ...over });
const file = (rows: AttackRow[], path = "openspec/changes/x/attack/decisions.md"): AttackFile =>
  ({ path, frontmatter: { status: "gaps_found", targets: [{ path: "decisions.json", sha256: "a" }] }, rows });

test("пустой запрос — ничего не ищется", () => {
  assert.equal(search(payload([fork("F-01")]), emptyDraft(), "   ").kind, "empty");
});

test("фраза: регистр и ё не важны, пробелы и переводы строк равны одному пробелу", () => {
  const p = payload([fork("F-01", { question: "Где   хранить\nчЕрновики и всё остальное?" })]);
  for (const q of ["хранить черновики", "ЧЕРНОВИКИ", "все остальное", "  где хранить  "]) {
    assert.deepEqual(find(p, q).journal.map((h) => h.label), ["F-01"], q);
  }
  assert.equal(find(p, "хранить остальное").journal.length, 0);
});

test("отрывок: совпадение отдельно, вокруг — исходный текст с регистром и ё, без разметки кода", () => {
  const p = payload([fork("F-01", { question: "Куда писать `Всё` сразу?" })]);
  const [hit] = find(p, "все").journal;
  assert.deepEqual([hit.before, hit.match, hit.after], ["Куда писать ", "Всё", " сразу?"]);
});

test("отрывок длинного поля обрезан с обеих сторон, совпадение на месте", () => {
  const p = payload([fork("F-01", { question: `${"а".repeat(200)} иголка ${"б".repeat(200)}` })]);
  const [hit] = find(p, "иголка").journal;
  assert.equal(hit.match, "иголка");
  assert.ok(hit.before.startsWith("…") && hit.before.length < 60);
  assert.ok(hit.after.endsWith("…") && hit.after.length < 120);
});

test("символ, меняющий длину при смене регистра, не сдвигает отрывок", () => {
  const p = payload([fork("F-01", { question: "İİİ иголка конец" })]);
  const [hit] = find(p, "иголка").journal;
  assert.equal(hit.match, "иголка");
  assert.equal(hit.after, " конец");
});

test("запись даёт одно попадание: первое поле по порядку карточки и число остальных; порядок — журнальный", () => {
  const p = payload([
    fork("F-02", { question: "искомое раз", consequences: "искомое два", dispute: "искомое три" }),
    fork("F-01", { consequences: "искомое" }),
  ]);
  const { journal } = find(p, "искомое");
  assert.deepEqual(journal.map((h) => [h.label, h.field, h.count]), [["F-02", "вопрос", 3], ["F-01", "следствия", 1]]);
});

test("ищется каждое поле записи", () => {
  const ev = { path: "docs/путь.md", quote: "цитата улики" };
  const cases: [Partial<JournalRecord>, string, string][] = [
    [{ options: [option("B", { text: "текст варианта" })] }, "текст варианта", "вариант B"],
    [{ options: [option("A", { unlikely: "нет причин" })] }, "нет причин", "вариант A, маловероятно"],
    [{ options: [option("A", { evidence: [ev] })] }, "цитата улики", "вариант A, улика"],
    [{ options: [option("A", { evidence: [ev] })] }, "docs/путь", "вариант A, улика"],
    [{ evidence: [ev] }, "цитата улики", "улика"],
    [{ recommendation: { option: "A", why: "потому что так" } }, "потому что", "рекомендация"],
    [{ recommendation: { option: "A", why: "", text: "целиком текст" } }, "целиком текст", "рекомендация"],
    [{ decision: { option: "A", word: "моё слово", date: "" } }, "мое слово", "слово"],
    [{ reversibility: { level: "в одну сторону", why: "станет контрактом" } }, "станет контрактом", "обратимость"],
    [{ outcome: { kind: "проба", value: "Defer", reason: "ждёт показа" } }, "defer", "исход"],
    [{ outcome: { kind: "проба", value: "Defer", reason: "ждёт показа" } }, "ждет показа", "исход"],
    [{ parking: [{ addressee: "ИБ", text: "вопрос адресату" }] }, "вопрос адресату", "парковка"],
    [{ parking: [{ addressee: "ИБ", text: "x", finding: "что нашлось" }] }, "что нашлось", "находка"],
    [{ dispute: "текст спора" }, "текст спора", "спор"],
    [{ consequences: "текст следствия" }, "текст следствия", "следствия"],
    [{ finding: "находка записи" }, "находка записи", "находка"],
  ];
  for (const [over, q, field] of cases) {
    const [hit] = find(payload([fork("F-01", over)]), q).journal;
    assert.equal(hit?.field, field, q);
    assert.deepEqual(hit.target, { id: "F-01" });
  }
});

test("строка атаки: ищется каждая колонка; цель — якорь строки в «атаке», у попадания файл и тяжесть", () => {
  const r = row({ claim: "претензия", section: "F-02, decision", lens: "claim-authority", invariant: "инвариант тот", severity: "предупреждение", support: "опора эта", fix: "чем закрыть" });
  const p = payload([], { attacks: [file([row(), r])] });
  for (const [q, field] of [["претензия", "утверждение"], ["F-02, dec", "раздел"], ["claim-auth", "линза"], ["инвариант тот", "инвариант"], ["предупреждение", "тяжесть"], ["опора эта", "опора"], ["чем закрыть", "чем закрыть"]]) {
    const [hit] = find(p, q).attack;
    assert.equal(hit?.field, field, q);
    assert.deepEqual(hit.target, { id: rowAnchor(0, 1), mode: "attack" });
    assert.equal(hit.label, "decisions.md · F-02, decision");
    assert.equal(hit.level, "accent");
  }
});

test("битый файл атаки поиску не мешает, его строки не считаются", () => {
  const p = payload([], { attacks: [{ path: "attack/artifacts.md", error: "искомое в ошибке" }, file([row({ claim: "искомое" })])] });
  const { attack } = find(p, "искомое");
  assert.equal(attack.length, 1);
  assert.deepEqual(attack[0].target, { id: rowAnchor(1, 0), mode: "attack" });
});

test("заметки журнала: цель — раздел заметок", () => {
  const [hit] = find(payload([], { notes: [{ date: "2026-11-01", text: "круг закончен" }] }), "круг").journal;
  assert.deepEqual([hit.label, hit.field, hit.target], ["заметки", "2026-11-01", { id: "journal-notes" }]);
});

test("черновик ищется и подписан: то, что видно на экране, поиск находит", () => {
  const d: Draft = {
    ...emptyDraft(),
    decisions: { "F-01": { choice: null, word: "моё несохранённое слово", parked: [{ text: "моя парковка", addressee: "ИБ" }] } },
    added: { "F-01": [{ letter: "C", text: "мой вариант" }] },
    disputes: { "F-02": "мой спор с фактом" },
    newForks: [{ id: "F-N1", question: "новый вопрос", options: "x\ny", word: "" }],
    notes: "моё замечание",
    attackDisputes: { "openspec/changes/x/attack/decisions.md|—|утверждение": "мой ответ атаке" },
  };
  const p = payload([fork("F-01"), fact("F-02")], { attacks: [file([row()])] });
  const hit = (q: string) => { const r = find(p, q, d); return r.journal[0] ?? r.attack[0]; };
  assert.deepEqual([hit("несохраненное").field, hit("несохраненное").target], ["в черновике: слово", { id: "F-01" }]);
  assert.equal(hit("моя парковка").field, "в черновике: парковка");
  assert.equal(hit("мой вариант").field, "в черновике: вариант C");
  assert.equal(hit("мой спор").field, "в черновике: спор");
  assert.deepEqual([hit("новый вопрос").label, hit("новый вопрос").target], ["F-N1", { id: "F-N1" }]);
  assert.deepEqual([hit("мое замечание").label, hit("мое замечание").target], ["заметки", { id: "journal-notes" }]);
  assert.equal(hit("мой ответ атаке").field, "в черновике: спор");
  assert.deepEqual(hit("мой ответ атаке").target, { id: rowAnchor(0, 0), mode: "attack" });
});

test("номер: все написания, включая русскую раскладку, ведут к записи", () => {
  const p = payload([fork("F-01"), fork("F-07"), fork("F-100")]);
  for (const q of ["F-07", "f-07", "F07", "f7", "7", "07", " 7 ", "ф-7", "а-07"]) assert.equal(asRecord(search(p, emptyDraft(), q)).card.id, "F-07", q);
  assert.equal(asRecord(search(p, emptyDraft(), "100")).card.id, "F-100");
});

test("номера нет в журнале: сказано об этом, и это обычный текстовый поиск", () => {
  const p = payload([fork("F-01", { question: "вопрос про 2026 год" })]);
  const r = find(p, "2026");
  assert.equal(r.missingRecord, "F-2026");
  assert.deepEqual(r.journal.map((h) => h.label), ["F-01"]);
  assert.equal(find(p, "F-99").missingRecord, "F-99");
  assert.equal(find(p, "вопрос").missingRecord, undefined);
});

test("текст с цифрами — не номер", () => {
  const p = payload([fork("F-01", { question: "этап 7 готов" }), fork("F-07")]);
  assert.equal(search(p, emptyDraft(), "этап 7").kind, "text");
  assert.equal(search(p, emptyDraft(), "-7").kind, "text");
});

const chain = () => payload([
  fact("F-01", { question: "факт основания" }),
  fork("F-02", { depends_on: ["F-01"] }),
  fork("F-03", { depends_on: ["F-02"], decision: { option: "A", word: "", date: "" } }),
  fork("F-04", { depends_on: ["F-03"] }),
  fork("F-05"),
]);

test("запись: зависит от и от неё зависят — прямые отдельно от цепочки, в журнальном порядке", () => {
  const { card } = asRecord(search(chain(), emptyDraft(), "F-02"));
  assert.deepEqual(card.dependsOn.map((l) => l.id), ["F-01"]);
  assert.deepEqual(card.dependsOnChain, []);
  assert.deepEqual(card.dependents.map((l) => l.id), ["F-03"]);
  assert.deepEqual(card.dependentsChain.map((l) => l.id), ["F-04"]);
  const down = asRecord(search(chain(), emptyDraft(), "F-04")).card;
  assert.deepEqual(down.dependsOn.map((l) => l.id), ["F-03"]);
  assert.deepEqual(down.dependsOnChain.map((l) => l.id), ["F-01", "F-02"]);
  assert.deepEqual(down.dependents, []);
});

test("запись: ссылка несёт вопрос и состояние; у самой записи — вид и выбранный вариант", () => {
  const { card } = asRecord(search(chain(), emptyDraft(), "F-02"));
  assert.deepEqual(card.dependsOn[0], { id: "F-01", question: "факт основания", mark: "fact" });
  assert.equal(card.dependents[0].mark, "decided");
  assert.equal(card.kind, "развилка");
  assert.equal(card.picked, null);
  const decided = asRecord(search(chain(), emptyDraft(), "F-03")).card;
  assert.deepEqual(decided.picked, { letter: "A", text: "вариант A" });
});

test("запись: черновик учитывается — добавленная зависимость есть, снятая исчезла, выбор показан", () => {
  const d: Draft = {
    ...emptyDraft(),
    deps: { "F-05": { add: ["F-02"], remove: [] }, "F-03": { add: [], remove: ["F-02"] } },
    decisions: { "F-02": { choice: "B", word: "", parked: [] } },
  };
  const { card } = asRecord(search(chain(), d, "F-02"));
  assert.deepEqual(card.dependents.map((l) => l.id), ["F-05"]);
  assert.deepEqual(card.dependentsChain, []);
  assert.deepEqual(card.picked, { letter: "B", text: "вариант B" });
});

test("запись: цикл в зависимостях не вешает поиск, себя в списках нет", () => {
  const p = payload([fork("F-01", { depends_on: ["F-02"] }), fork("F-02", { depends_on: ["F-01"] })]);
  const { card } = asRecord(search(p, emptyDraft(), "F-01"));
  assert.deepEqual(card.dependsOn.map((l) => l.id), ["F-02"]);
  assert.deepEqual(card.dependsOnChain, []);
  assert.deepEqual(card.dependents.map((l) => l.id), ["F-02"]);
});

test("запись: зависимость от записи, которой нет, названа, а не потеряна", () => {
  const { card } = asRecord(search(payload([fork("F-01", { depends_on: ["F-99"] })]), emptyDraft(), "F-01"));
  assert.deepEqual(card.dependsOn, [{ id: "F-99", question: "", mark: null }]);
});

test("запись: упоминания — полный номер в других записях и строках атаки; F-07 не находит F-070 и саму себя", () => {
  const p = payload([
    fork("F-07", { question: "сама F-07" }),
    fork("F-08", { consequences: "смотри F-07.A" }),
    fork("F-09", { consequences: "смотри F-070" }),
  ], { attacks: [file([row({ section: "F-07, decision", claim: "строка" }), row({ section: "F-070, decision" })])] });
  const r = asRecord(search(p, emptyDraft(), "7"));
  assert.deepEqual(r.journal.map((h) => h.label), ["F-08"]);
  assert.deepEqual(r.attack.map((h) => h.label), ["decisions.md · F-07, decision"]);
});
