// Состав режимов «проверка» и «атака» по SKILL просмотрщика: рендер в HTML без браузера.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { attackAnchor, lensAnchor, rowAnchor } from "../../src/shared/attack";
import { buildPrompt, emptyDraft } from "../../src/shared/logic";
import { search } from "../../src/shared/search";
import type { AttackFile, AttackRow, Draft, ViewPayload } from "../../src/shared/types";
import { AttackView, LensFilter } from "../../src/webview/AttackView";
import { CheckView } from "../../src/webview/CheckView";
import { FailureText } from "../../src/webview/FailureText";
import { SearchResults } from "../../src/webview/SearchResults";
import { Segmented } from "../../src/webview/Segmented";
import { fact, fork, option, payload } from "./helpers";

const DATE = "2026-11-01";
const SHA = "a".repeat(64);
const noop = () => {};

const check = (p: ViewPayload) => renderToStaticMarkup(<CheckView payload={p} />);

function attack(p: ViewPayload, lens = "all", draft: Draft = emptyDraft()): string {
  return renderToStaticMarkup(<AttackView payload={p} draft={draft} flags={buildPrompt(p, draft, DATE)} lens={lens} update={noop} />);
}

const results = (p: ViewPayload, q: string, d: Draft = emptyDraft()) => renderToStaticMarkup(<SearchResults outcome={search(p, d, q)} onOpen={noop} />);
const flat = (html: string) => html.replace(/<[^>]+>/g, "");

const row = (over: Partial<AttackRow> = {}): AttackRow =>
  ({ claim: "утверждение", section: "—", lens: "coverage", invariant: "инвариант", severity: "блокер", support: "нет", fix: "правка", ...over });
const file = (rows: AttackRow[], sha = SHA, status = "gaps_found"): AttackFile =>
  ({ path: "openspec/changes/x/attack/decisions.md", frontmatter: { status, targets: [{ path: "decisions.json", sha256: sha }] }, rows });
const withAttack = (rows: AttackRow[], records = [fork("F-02")], sha = SHA) => payload(records, { attacks: [file(rows, sha)] });

test("проверка: только чтение — ни одного поля, переключателя и кнопки", () => {
  const out = check(payload([fork("F-01"), fact("F-02")]));
  for (const tag of ["<textarea", "<input", "<button", "<select"]) assert.ok(!out.includes(tag), tag);
});

test("проверка: «куда уйдёт» у каждой записи, с пометкой", () => {
  const rec = fork("F-01", { decision: { option: "A", word: "", date: DATE }, destination: { label: "design.md › Decisions", note: "в одну сторону — первой" } });
  const out = check(payload([rec, fact("F-02", { destination: { label: "design.md › Context", note: "" } })]));
  assert.match(out, /→ design\.md › Decisions · в одну сторону — первой/);
  assert.match(out, /→ design\.md › Context/);
});

test("проверка: решённая показывает выбранный вариант и слово, остальных вариантов нет", () => {
  const rec = fork("F-01", { decision: { option: "B", word: "так решил", date: DATE }, options: [option("A", { text: "первый" }), option("B", { text: "второй", deviation: "F-09" })] });
  const out = check(payload([rec]));
  assert.ok(out.includes("второй"));
  assert.ok(!out.includes("первый"));
  assert.ok(out.includes("так решил"));
  assert.match(out, /tag accent[^>]*>отступление от F-09/);
});

test("проверка: открытая показывает все варианты с «маловероятно» и рекомендацию", () => {
  const rec = fork("F-01", { options: [option("A", { text: "первый" }), option("B", { text: "второй", unlikely: "нет причин" })], recommendation: { option: "A", why: "потому" } });
  const out = check(payload([rec]));
  assert.ok(out.includes("первый") && out.includes("второй") && out.includes("нет причин") && out.includes("потому"));
});

test("проверка: факт с уликами; спор показан, либо сказано, что его нет", () => {
  const ev = { path: "a.md", quote: "цитата", found: false, verdict: "цитаты нет дословно" };
  const out = check(payload([fact("F-01", { evidence: [ev], dispute: "«не так»" }), fact("F-02")]));
  assert.ok(out.includes("цитата"));
  assert.match(out, /class="signal"[^>]*>не найдено: цитаты нет дословно/);
  assert.ok(out.includes("не так"));
  assert.ok(out.includes("спора нет"));
});

test("проверка: в шапке хеш журнала и статус атаки; журнал изменён после атаки — сигнал", () => {
  const stale = check(withAttack([], [fork("F-01")], "f".repeat(64)));
  assert.ok(stale.includes(SHA.slice(0, 12)));
  assert.match(stale, /атака: gaps_found/);
  assert.match(stale, /badge signal[^>]*>вердикт устарел: журнал изменён после атаки/);
  assert.match(check(withAttack([], [fork("F-01")])), /badge muted[^>]*>хеш журнала совпал/);
  assert.ok(check(payload([fork("F-01")])).includes("атаки нет"));
});

test("проверка: разделы со счётчиками, парковки с адресатом и находкой, заметки", () => {
  const out = check(payload([
    fork("F-01", { parking: [{ addressee: "ИБ", text: "вопрос ИБ", finding: "находка ИБ", destination: "design.md › Open Questions → security.md" }] }),
  ], { notes: [{ date: DATE, text: "круг закончен" }] }));
  for (const s of ["Решено — по дате решения", "Открытые развилки", "Пробы", "Факты", "Парковки", "Заметки", "вопрос ИБ", "находка ИБ", "security.md", "круг закончен"]) assert.ok(out.includes(s), s);
});

test("атака: счётчики тяжести считаются по всему файлу и стоят вне фильтра", () => {
  const p = withAttack([row({ lens: "coverage", severity: "блокер", claim: "первая" }), row({ lens: "claim-authority", severity: "справка", support: "есть", claim: "вторая" })]);
  const out = attack(p, "claim-authority");
  assert.ok(!out.includes("первая"));
  assert.ok(out.includes("вторая"));
  assert.match(out.replace(/<[^>]+>/g, ""), /блокеров 1 · предупреждений 0 · справок 1/);
});

test("атака: группы линза → тяжесть с подписью и счётчиком", () => {
  const out = attack(withAttack([row({ lens: "coverage", severity: "блокер" }), row({ lens: "coverage", severity: "предупреждение", support: "есть" })]));
  const flat = out.replace(/<[^>]+>/g, "");
  assert.ok(flat.includes("coverage · покрытие разделов · 2"));
  assert.ok(flat.includes("блокер · 1"));
  assert.ok(flat.includes("предупреждение · 1"));
});

test("атака: уровни тяжести; понижение без причины — сигнал, с причиной — показана", () => {
  const out = attack(withAttack([row({ severity: "блокер", claim: "а" }), row({ severity: "предупреждение", claim: "б" }), row({ severity: "справка (мелочь)", claim: "в" })]));
  assert.match(out, /badge signal[^>]*>блокер/);
  assert.match(out, /badge signal[^>]*>понижение без причины/);
  assert.match(out, /badge accent[^>]*>понижено: мелочь/);
});

test("атака: линза вне списка — отдельная группа, строка помечена, в счётчике линз её нет, в счётчике тяжести есть", () => {
  const out = attack(withAttack([row({ lens: "выдуманная" })]));
  const flat = out.replace(/<[^>]+>/g, "");
  assert.match(out, /badge signal[^>]*>линза «выдуманная» вне списка/);
  assert.ok(flat.includes("вне списка — слуг не из закрытого списка"));
  assert.ok(flat.includes("строк вне списка (невалидны, в счётчике линз их нет): 1"));
  assert.ok(flat.includes("блокеров 1"));
});

test("атака: блок записи — вопрос, выбранный вариант, переход; записи нет — блока и ссылки нет", () => {
  const rec = fork("F-02", { question: "текст вопроса", decision: { option: "A", word: "", date: DATE } });
  const out = attack(withAttack([row({ section: "F-02, decision" })], [rec]));
  assert.ok(out.includes("запись F-02 — текст вопроса"));
  assert.ok(out.includes("текст вопроса"));
  assert.ok(out.includes("вариант A"));
  assert.ok(out.includes('href="#F-02"'));
  const open = attack(withAttack([row({ section: "F-02, decision" })]));
  assert.ok(open.includes("решения нет — запись открыта"));
  const none = attack(withAttack([row({ section: "F-77, decision" })]));
  assert.ok(!none.includes("recblock"));
  assert.ok(!none.includes('href="#F-77"'));
});

test("атака: ответ к нерешённой записи и конфликт ответов видны у строк", () => {
  const a = row({ section: "F-02, decision", fix: "вопрос человеку", claim: "первое" });
  const b = row({ section: "F-02, decision", fix: "вопрос человеку", claim: "второе" });
  const key = (r: AttackRow) => `openspec/changes/x/attack/decisions.md|${r.section}|${r.claim}`;
  const undecided = attack(withAttack([a]), "all", { ...emptyDraft(), attackDisputes: { [key(a)]: "ответ" } });
  assert.match(undecided, /note accent[^>]*>запись не решена/);
  const rec = fork("F-02", { decision: { option: "A", word: "", date: DATE } });
  const conflict = attack(withAttack([a, b], [rec]), "all", { ...emptyDraft(), attackDisputes: { [key(a)]: "да", [key(b)]: "нет" } });
  assert.equal((conflict.match(/note signal[^>]*>конфликт ответов/g) ?? []).length, 2);
});

test("атака: битый файл назван сигналом, остальные показаны", () => {
  const out = attack(payload([fork("F-02")], { attacks: [{ path: "attack/artifacts.md", error: "attack/artifacts.md:7: ячеек 3" }, file([row({ claim: "живая строка" })])] }));
  assert.match(out, /note signal[^>]*>[^<]*attack\/artifacts\.md:7: ячеек 3/);
  assert.ok(out.includes("живая строка"));
});

test("атака: файлов нет — сказано прямо", () => {
  assert.ok(attack(payload([fork("F-02")])).includes("Атаки ещё нет"));
});

test("атака: шапка файла — статус, вердикт, цели с хешами, вид линз", () => {
  const out = attack(withAttack([row()], [fork("F-02")], "f".repeat(64)));
  assert.match(out, /status: gaps_found/);
  assert.match(out, /badge signal[^>]*>вердикт устарел/);
  assert.ok(out.includes("decisions.json"));
  assert.ok(out.includes("f".repeat(12)));
  assert.ok(out.includes("линзы журнала"));
});

test("атака: разметка ячеек — только `код`", () => {
  const out = attack(withAttack([row({ claim: "про `код` и <b>тег</b>" })]));
  assert.ok(out.includes("<code>код</code>"));
  assert.ok(out.includes("&lt;b&gt;тег&lt;/b&gt;"));
});

test("переключатель: нажатым помечен только выбранный — классом и для чтения с экрана", () => {
  const out = renderToStaticMarkup(<Segmented label="показать:" items={[{ value: "a", label: "первый" }, { value: "b", label: "второй" }]} value="b" onChange={noop} />);
  assert.match(out, /aria-pressed="true"[^>]*>второй/);
  assert.match(out, /aria-pressed="false"[^>]*>первый/);
  assert.equal((out.match(/class="active"/g) ?? []).length, 1);
  assert.ok(out.includes("показать:"));
});

test("фильтр линз: выбранная нажата; линзы, которой у журнала нет, нет — нажата «все»", () => {
  const p = withAttack([row({ lens: "coverage" }), row({ lens: "выдуманная" })]);
  const pressed = (lens: string) => /aria-pressed="true"[^>]*>([^<]*)/.exec(renderToStaticMarkup(<LensFilter attacks={p.attacks} lens={lens} onLens={noop} />))![1];
  assert.equal(pressed("coverage"), "coverage · 1");
  assert.equal(pressed("__outside__"), "вне списка · 1");
  assert.equal(pressed("scenario-run"), "все · 2");
});

test("атака: фильтра на странице нет — он в шапке и не уезжает с прокруткой", () => {
  assert.ok(!attack(withAttack([row()])).includes("lensfilter"));
});

test("атака: у файла, группы линзы и строки есть якоря для оглавления и поиска", () => {
  const out = attack(withAttack([row({ lens: "выдуманная" }), row({ lens: "coverage" })]));
  for (const id of [attackAnchor(0), lensAnchor(0, "coverage"), lensAnchor(0, "__outside__"), rowAnchor(0, 0), rowAnchor(0, 1)]) assert.ok(out.includes(`id="${id}"`), id);
});

test("проверка: у заметок есть якорь", () => {
  assert.ok(check(payload([fork("F-01")])).includes('id="journal-notes"'));
});

test("поиск: подсказка на пустом запросе, «не найдено» и про отсутствующий номер сказано словами", () => {
  const p = payload([fork("F-01")]);
  assert.match(flat(results(p, "")), /номер/i);
  assert.match(flat(results(p, "нет такого")), /Ничего не найдено/);
  assert.match(flat(results(p, "F-99")), /Записи F-99 нет/);
});

test("поиск: попадания по разделам со счётчиком, совпадение выделено, число прочих полей названо", () => {
  const p = payload([fork("F-01", { question: "искомое слово", consequences: "искомое" })], { attacks: [file([row({ claim: "искомое", severity: "блокер", section: "F-01, decision" })])] });
  const out = results(p, "искомое");
  const text = flat(out);
  assert.ok(text.includes("Журнал · 1") && text.includes("Атака · 1"));
  assert.ok(out.includes("<mark>искомое</mark>"));
  assert.ok(text.includes("вопрос +1"));
  assert.match(out, /class="hit-label signal"[^>]*>decisions\.md · F-01, decision/);
});

test("поиск: раздел без попаданий не показан", () => {
  const text = flat(results(payload([fork("F-01", { question: "искомое" })]), "искомое"));
  assert.ok(text.includes("Журнал · 1"));
  assert.ok(!text.includes("Атака"));
});

test("поиск по номеру: запись, зависимости кратким списком, цепочка и упоминания свёрнуты", () => {
  const p = payload([
    fact("F-01", { question: "основание" }),
    fork("F-02", { question: "средняя", depends_on: ["F-01"], decision: { option: "A", word: "", date: "" } }),
    fork("F-03", { question: "зависимая", depends_on: ["F-02"] }),
    fork("F-04", { question: "дальняя", depends_on: ["F-03"], consequences: "см. F-02" }),
  ]);
  const out = results(p, "2");
  const text = flat(out);
  assert.ok(text.includes("F-02") && text.includes("средняя"));
  assert.ok(text.includes("выбран A. вариант A"));
  assert.ok(text.includes("Зависит от · 1"));
  assert.ok(text.includes("От неё зависят · 1"));
  assert.match(out, /<details[^>]*><summary>по цепочке ещё · 1<\/summary>[\s\S]*F-04/);
  assert.match(out, /<details[^>]*><summary>упоминания · 1<\/summary>/);
  assert.match(text, /основание/);
  assert.match(text, /факт/);
});

test("поиск по номеру: зависимостей нет — так и сказано; запись, которой нет, названа", () => {
  assert.ok(flat(results(payload([fork("F-01")]), "1")).includes("зависимостей нет"));
  assert.ok(flat(results(payload([fork("F-01", { depends_on: ["F-99"] })]), "1")).includes("записи нет"));
});

test("Прежних данных нет: просмотрщик говорит, что обновить, называет проект и команду (F-78, F-79)", () => {
  const text = (need: "tools" | "vsix") => renderToStaticMarkup(<FailureText failure={{ kind: "contract", need, root: "D:/проект" }} openPythonSetting={noop} />);
  assert.match(text("tools"), /D:\/проект/);
  assert.match(text("tools"), /symphysis install --project \. --force/);
  assert.match(text("vsix"), /D:\/проект/);
  assert.match(text("vsix"), /поставь новый \.vsix/);
});

test("«Путь мимо инструментов»: отказ называет причину с настройкой и путём, команда установки только запасной ход", () => {
  const reason = "в настройке symphysis.toolsPath нужен абсолютный путь, а там «tools»";
  const text = renderToStaticMarkup(<FailureText failure={{ kind: "tools-path", reason }} openPythonSetting={noop} />);
  assert.ok(text.includes(reason), text);
  assert.ok(text.includes("symphysis install --project ."), text);
});
