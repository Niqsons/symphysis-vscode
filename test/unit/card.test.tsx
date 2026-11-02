// Главное правило скилла «все важные развилки показаны»: карточка рендерится в HTML без браузера и проверяется по составу.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyDraft } from "../../src/shared/logic";
import type { Draft, JournalRecord, ViewPayload } from "../../src/shared/types";
import { Card, type CardContext } from "../../src/webview/Card";
import { fact, fork, option, payload } from "./helpers";

const DATE = "2026-11-01";

function html(rec: JournalRecord, p: ViewPayload = payload([rec]), draft: Draft = emptyDraft()): string {
  const ctx: CardContext = { payload: p, getDraft: () => draft, update: () => {} };
  return renderToStaticMarkup(
    <Card rec={rec} ctx={ctx} entry={draft.decisions[rec.id]} added={draft.added[rec.id]} deps={draft.deps[rec.id]} dispute={draft.disputes[rec.id]} links="" />,
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

test("составная рекомендация пишется строкой как написана", () => {
  const rec = fork("F-01", { recommendation: { option: "A", why: "приближение", text: "A для одного и B для другого" } });
  const out = html(rec);
  assert.ok(out.includes("A для одного и B для другого"));
  assert.ok(!out.includes("приближение"));
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
