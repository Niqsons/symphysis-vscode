// Главное правило скилла «все важные развилки показаны»: карточка рендерится в HTML без браузера и проверяется по составу.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPrompt, emptyDraft } from "../../src/journal/logic";
import type { Draft, JournalRecord, ViewPayload } from "../../src/protocol/types";
import { Card, type CardContext } from "../../src/viewer/Card";
import { clickLink, LinksContext } from "../../src/ui/Text";
import { fact, fork, option, payload } from "./helpers";

const DATE = "2026-11-01";

function html(rec: JournalRecord, p: ViewPayload = payload([rec]), draft: Draft = emptyDraft()): string {
  const ctx: CardContext = { payload: p, getDraft: () => draft, update: () => {} };
  return renderToStaticMarkup(
    <LinksContext.Provider value={{ links: p.file_links, open: () => {} }}>
      <Card rec={rec} ctx={ctx} entry={draft.decisions[rec.id]} added={draft.added[rec.id]} deps={draft.deps[rec.id]} dispute={draft.disputes[rec.id]} links="" />
    </LinksContext.Provider>,
  );
}

const before = (s: string, a: string, b: string) => {
  assert.ok(s.includes(a), `нет «${a}»`);
  assert.ok(s.includes(b), `нет «${b}»`);
  assert.ok(s.indexOf(a) < s.indexOf(b), `«${a}» должно стоять раньше «${b}»`);
};

test("все варианты на месте; маловероятный показан с причиной и его можно выбрать", () => {
  const rec = fork("F-01", { options: [option("A"), option("B", { unlikely: "нет браузера" }), option("C")] });
  const out = html(rec);
  assert.equal((out.match(/type="radio"/g) ?? []).length, 3);
  assert.ok(out.includes("нет браузера"));
  assert.ok(out.includes("маловероятно"));
});

test("рекомендация стоит под списком вариантов и выбором не становится", () => {
  const rec = fork("F-01", { recommendation: { option: "A", why: "причина" } });
  const out = html(rec);
  before(out, "вариант B", "рекомендация: ");
  assert.equal((out.match(/checked=""/g) ?? []).length, 0);
});

test("карточка при поле text показывает вариант и причину, а не его", () => {
  // Старый журнал: поле приходит из файла, типа у него нет, поэтому объект заведён отдельно.
  const recommendation = { option: "A", why: "дешевле откатить", text: "A — кратко" };
  const out = html(fork("F-01", { recommendation }));
  assert.ok(out.includes("<b>A</b> — дешевле откатить"), out);
  assert.ok(!out.includes("A — кратко"));
});

test("поля text нет: видны вариант и причина", () => {
  const out = html(fork("F-01", { recommendation: { option: "A", why: "дешевле откатить" } }));
  assert.ok(out.includes("<b>A</b> — дешевле откатить"), out);
});

test("выбор в журнале отмечен; слово журнала видно с датой", () => {
  const rec = fork("F-01", { decision: { option: "B", word: "так решил", date: DATE } });
  const out = html(rec);
  assert.equal((out.match(/checked=""/g) ?? []).length, 1);
  assert.ok(out.includes("так решил"));
  assert.ok(out.includes(DATE));
  assert.match(out, /badge muted[^>]*>решено в журнале: B/);
});

test("открытая развилка — выделяющийся уровень, изменённый выбор — тоже", () => {
  assert.match(html(fork("F-01")), /badge accent[^>]*>открыто/);
  const rec = fork("F-01", { decision: { option: "A", word: "", date: DATE } });
  const d: Draft = { ...emptyDraft(), decisions: { "F-01": { choice: "B", word: "", parked: [] } } };
  assert.match(html(rec, payload([rec]), d), /badge accent[^>]*>изменено: A → B/);
});

test("отступление от постановки: бейдж выделяющегося уровня с номером факта", () => {
  const rec = fork("F-01", { options: [option("A", { deviation: "F-09" })] });
  assert.match(html(rec), /tag accent[^>]*>отступление от F-09/);
});

test("антипод виден на варианте; выбранный антипод не блокирует, пара видна у обоих", () => {
  const a = fork("F-01", { antipodes: [{ option: "A", other: "F-02.B" }] });
  const b = fork("F-02");
  const p = payload([a, b]);
  assert.ok(html(b, p).includes("антипод F-01.A"));
  const d: Draft = { ...emptyDraft(), decisions: { "F-01": { choice: "A", word: "", parked: [] } } };
  assert.match(html(b, p, d), /антипод уже выбран: F-01\.A/);
  assert.doesNotMatch(html(b, p, d), /blocked/);
  const both: Draft = { ...d, decisions: { ...d.decisions, "F-02": { choice: "B", word: "", parked: [] } } };
  assert.match(html(a, p, both), /антипод уже выбран: F-02\.B/);
});

test("подсказка адресатов: «материалы» ищет агент, в файлах или пробой (F-41)", () => {
  assert.match(html(fork("F-01")), /ответ ищет агент, в файлах или пробой/);
});

test("улики: сверено побочным, пропавшая цитата сигнальным, с местом и цитатой", () => {
  const rec = fork("F-01", {
    options: [option("A", { evidence: [
      { path: "a.md", quote: "есть", line: 7, found: true, verdict: "сверено" },
      { path: "b.md", quote: "нету", line: null, found: false, verdict: "цитаты нет дословно" },
      { path: "c.md", quote: "корень", line: null, found: false, verdict: "корня для пути нет" },
      { path: "d.png", quote: "бинарь", line: null, found: null, verdict: "не проверить: бинарный файл" },
    ] })],
  });
  const out = html(rec);
  assert.ok(out.includes("a.md:7"));
  assert.match(out, /class="muted"[^>]*>сверено/);
  assert.match(out, /class="signal"[^>]*>не найдено: цитаты нет дословно/);
  assert.match(out, /class="muted"[^>]*>не найдено: корня для пути нет/);
  assert.match(out, /class="muted"[^>]*>не проверить: бинарный файл/);
});

test("факт: улики, следствия и поле «оспорить», вариантов и слова нет", () => {
  const rec = fact("F-01", { evidence: [{ path: "a.md", quote: "цитата", found: true, verdict: "сверено" }], consequences: "следствие", dispute: "«прежний спор»" });
  const out = html(rec);
  assert.ok(out.includes("цитата"));
  assert.ok(out.includes("следствие"));
  assert.ok(out.includes("прежний спор"));
  assert.ok(out.includes("оспорить факт"));
  assert.ok(!out.includes('type="radio"'));
  assert.ok(!out.includes("слово человека"));
});

test("парковка журнала и черновика с адресатами; журнальную снять нельзя", () => {
  const rec = fork("F-01", { parking: [{ addressee: "ИБ", text: "из журнала", finding: "находка" }] });
  const d: Draft = { ...emptyDraft(), decisions: { "F-01": { choice: null, word: "", parked: [{ text: "из черновика", addressee: "материалы" }] } } };
  const out = html(rec, payload([rec]), d);
  assert.ok(out.includes("из журнала"));
  assert.ok(out.includes("из черновика"));
  assert.ok(out.includes("→ ИБ · в журнале"));
  assert.ok(out.includes("→ материалы"));
  assert.ok(out.includes("находка"));
  assert.equal((out.match(/>снять</g) ?? []).length, 1);
});

test("зависимости: нерешённая предпосылка — выделяющаяся пометка; снятая её не даёт", () => {
  const rec = fork("F-01", { depends_on: ["F-02"] });
  const other = fork("F-02");
  const p = payload([rec, other]);
  assert.match(html(rec, p), /note accent[^>]*>предпосылка не решена: F-02/);
  const d: Draft = { ...emptyDraft(), deps: { "F-01": { add: [], remove: ["F-02"] } } };
  assert.ok(!html(rec, p, d).includes("предпосылка не решена"));
});

test("зависимость от факта предпосылкой не считается: факт закрыт уликами, выбирать в нём нечего", () => {
  const rec = fork("F-01", { depends_on: ["F-02"] });
  assert.ok(!html(rec, payload([rec, fact("F-02")])).includes("предпосылка не решена"));
});

test("разметка данных — только `код`: теги показываются текстом", () => {
  const out = html(fork("F-01", { question: "вопрос `код` <b>жирный</b>" }));
  assert.ok(out.includes("<code>код</code>"));
  assert.ok(out.includes("&lt;b&gt;жирный&lt;/b&gt;"));
});

test("обратимость: «в одну сторону» — выделяющимся, причина рядом", () => {
  const out = html(fork("F-01", { reversibility: { level: "в одну сторону", why: "формат станет контрактом" } }));
  assert.match(out, /badge accent[^>]*>в одну сторону/);
  assert.ok(out.includes("формат станет контрактом"));
});

test("вариант человека из журнала помечен; локальный можно убрать", () => {
  const rec = fork("F-01", { options: [option("A", { text: "свой (добавлен человеком)", added: true })] });
  assert.ok(html(rec).includes("добавлен человеком"));
  const d: Draft = { ...emptyDraft(), added: { "F-01": [{ letter: "B", text: "ещё" }] } };
  const out = html(fork("F-01", { options: [] }), undefined, d);
  assert.ok(out.includes("ещё"));
  assert.ok(out.includes(">убрать<"));
});

const ASK = "Выбран не рекомендованный вариант";
const withChoice = (letter: string, word = ""): Draft => ({ ...emptyDraft(), decisions: { "F-01": { choice: letter, word, parked: [] } } });
const askRec = () => fork("F-01", { options: [option("A"), option("B")], recommendation: { option: "A", why: "причина" } });

test("«Выбор мимо рекомендации»: просьба видна, выбор и «Внести» не заперты", () => {
  const rec = askRec();
  const out = html(rec, payload([rec]), withChoice("B"));
  assert.ok(out.includes(ASK));
  assert.doesNotMatch(out, /disabled/);
  assert.equal((out.match(/type="radio"/g) ?? []).length, 2);
  assert.ok(buildPrompt(payload([rec]), withChoice("B"), DATE).text.includes("- F-01: B"));
});

test("«Слово написано»: просьбы нет", () => {
  const rec = askRec();
  assert.ok(!html(rec, payload([rec]), withChoice("B", "потому что")).includes(ASK));
  assert.match(buildPrompt(payload([rec]), withChoice("B", "потому что"), DATE).text, /- F-01: B.*потому что/);
});

test("«Одни пробелы»: просьба на месте", () => {
  const rec = askRec();
  assert.ok(html(rec, payload([rec]), withChoice("B", " \n\t ")).includes(ASK));
});

test("«Рекомендованный вариант»: просьбы нет", () => {
  const rec = askRec();
  assert.ok(!html(rec, payload([rec]), withChoice("A")).includes(ASK));
});

test("«Вариант человека»: просьбы нет ни у варианта из журнала, ни у локального", () => {
  const rec = fork("F-01", { options: [option("A"), option("B", { added: true })], recommendation: { option: "A", why: "причина" } });
  assert.ok(!html(rec, payload([rec]), withChoice("B")).includes(ASK));
  const marked = fork("F-01", { options: [option("A"), option("B", { text: "свой (добавлен человеком)", added: false })], recommendation: { option: "A", why: "причина" } });
  assert.ok(!html(marked, payload([marked]), withChoice("B")).includes(ASK));
  const own = askRec();
  const d: Draft = { ...withChoice("C"), added: { "F-01": [{ letter: "C", text: "свой" }] } };
  assert.ok(!html(own, payload([own]), d).includes(ASK));
});

test("«Слово уже в журнале»: просьбы нет; слово журнала другого варианта не считается", () => {
  const rec = fork("F-01", { options: [option("A"), option("B"), option("C")], recommendation: { option: "A", why: "причина" }, decision: { option: "B", word: "так решил", date: DATE } });
  assert.ok(!html(rec, payload([rec]), emptyDraft()).includes(ASK));
  assert.ok(!html(rec, payload([rec]), withChoice("B")).includes(ASK));
  assert.ok(html(rec, payload([rec]), withChoice("C")).includes(ASK));
});

test("запись без рекомендации: просьбы нет", () => {
  const rec = fork("F-01", { options: [option("A"), option("B")] });
  assert.ok(!html(rec, payload([rec]), withChoice("B")).includes(ASK));
});

const FILES = { "tools/a.py": "tools/a.py", "a.md": "a.md", "../x/b.md": "../x/b.md" };
const linksOf = (rec: JournalRecord, file_links?: Record<string, string>) => payload([rec], file_links ? { file_links } : {});
const linkCount = (out: string) => (out.match(/data-file-link=/g) ?? []).length;

test("«Улика с файлом»: путь улики из карты показан ссылкой со строкой, не из карты остаётся кодом", () => {
  const rec = fork("F-01", { options: [option("A", { evidence: [
    { path: "tools/a.py", quote: "цитата", line: 7, found: true, verdict: "сверено" },
    { path: "нет.py", quote: "цитата", line: null, found: false, verdict: "корня для пути нет" },
  ] })] });
  const out = html(rec, linksOf(rec, FILES));
  assert.match(out, /<a[^>]*data-file-link="tools\/a\.py"[^>]*data-file-line="7"[^>]*><code>tools\/a\.py:7<\/code><\/a>/);
  assert.equal(linkCount(out), 1);
  assert.ok(out.includes("<code>нет.py</code>"));
});

test("«Текст не из карты»: нет.md, constructor, __proto__ и путь вне корня показаны кодом", () => {
  const rec = fork("F-01", { question: "см. `нет.md`, `constructor`, `__proto__`, `toString`, `../../секрет.txt`, `a.md`" });
  const out = html(rec, linksOf(rec, FILES));
  for (const t of ["нет.md", "constructor", "__proto__", "toString", "../../секрет.txt"]) assert.ok(out.includes(`<code>${t}</code>`), t);
  assert.equal(linkCount(out), 1);
  assert.match(out, /data-file-link="a\.md"[^>]*><code>a\.md<\/code>/);
});

test("текст в кавычках с хвостом :строка — ссылка на ключ без хвоста, строка отдельно", () => {
  const rec = fork("F-01", { question: "см. `a.md:2-5` и `a.md:9`" });
  const out = html(rec, linksOf(rec, FILES));
  assert.match(out, /data-file-link="a\.md" data-file-line="2"[^>]*><code>a\.md:2-5<\/code>/);
  assert.match(out, /data-file-line="9"/);
});

test("«Старое ядро»: карты нет, всё показано кодом, просьбы обновиться нет", () => {
  const rec = fork("F-01", { question: "см. `a.md`", options: [option("A", { evidence: [{ path: "tools/a.py", quote: "ц", line: 3, found: true, verdict: "сверено" }] })] });
  const out = html(rec, linksOf(rec));
  assert.equal(linkCount(out), 0);
  assert.ok(out.includes("<code>a.md</code>"));
  assert.ok(out.includes("<code>tools/a.py:3</code>"));
  assert.doesNotMatch(out, /обнов/);
});

test("«Ссылка внутри варианта»: ссылка стоит в варианте, нажатие не доходит до выбора", () => {
  const rec = fork("F-01", { options: [option("A", { text: "правка в `a.md:2`" }), option("B")] });
  const out = html(rec, linksOf(rec, FILES));
  assert.match(out, /<label[^>]*>(?:(?!<\/label>).)*<a[^>]*data-file-link="a\.md"/);
  const calls: string[] = [];
  const e = { preventDefault: () => calls.push("prevent"), stopPropagation: () => calls.push("stop") };
  clickLink(e, () => calls.push("open"), "a.md", 2);
  assert.deepEqual(calls.sort(), ["open", "prevent", "stop"]);
});
