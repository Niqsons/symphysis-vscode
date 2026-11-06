import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSnapshot } from "../../src/viewer/check";
import type { JournalRecord } from "../../src/protocol/types";
import { fact, fork, option, payload } from "./helpers";

const decided = (id: string, date: string, over: Partial<JournalRecord> = {}) => fork(id, { decision: { option: "A", word: "слово", date }, ...over });
const ONE_WAY = { level: "в одну сторону", why: "" };

test("решённые: новые даты первыми; внутри даты «в одну сторону» первыми, затем по номеру", () => {
  const s = checkSnapshot(payload([
    decided("F-10", "2026-10-30"), decided("F-2", "2026-10-30"), decided("F-3", "2026-10-30", { reversibility: ONE_WAY }), decided("F-1", "2026-11-01"), decided("F-4", ""),
  ]));
  assert.deepEqual(s.decidedByDate.map((g) => [g.date, g.records.map((r) => r.id)]), [
    ["2026-11-01", ["F-1"]], ["2026-10-30", ["F-3", "F-2", "F-10"]], ["", ["F-4"]],
  ]);
});

test("разделы: проба вне решённых, но в своём разделе; открытая проба и там, и там; факты отдельно", () => {
  const probe = { kind: "проба", value: "Backstop", reason: "" };
  const s = checkSnapshot(payload([decided("F-1", "2026-11-01"), decided("F-2", "2026-11-01", { outcome: probe }), fork("F-3", { outcome: probe }), fork("F-4"), fact("F-5")]));
  assert.deepEqual(s.decidedByDate[0].records.map((r) => r.id), ["F-1"]);
  assert.deepEqual(s.probes.map((r) => r.id), ["F-2", "F-3"]);
  assert.deepEqual(s.open.map((r) => r.id), ["F-3", "F-4"]);
  assert.deepEqual(s.facts.map((r) => r.id), ["F-5"]);
});

test("вопрос — не проба: outcome вида «вопрос» в пробы не попадает", () => {
  const s = checkSnapshot(payload([decided("F-1", "2026-11-01", { outcome: { kind: "вопрос", value: "x", reason: "" } })]));
  assert.deepEqual(s.probes, []);
  assert.deepEqual(s.decidedByDate[0].records.map((r) => r.id), ["F-1"]);
});

test("парковки по адресатам, с номером записи и «куда уйдёт»; пустых адресатов нет", () => {
  const s = checkSnapshot(payload([
    fork("F-1", { parking: [{ addressee: "ИБ", text: "а", destination: "design.md › Open Questions → security.md" }, { addressee: "человек", text: "б" }] }),
    fork("F-2", { parking: [{ addressee: "ИБ", text: "в", finding: "находка" }] }),
  ]));
  assert.deepEqual(s.parkings.map((g) => [g.addressee, g.items.map((p) => [p.rec, p.text])]), [
    ["человек", [["F-1", "б"]]], ["ИБ", [["F-1", "а"], ["F-2", "в"]]],
  ]);
  assert.equal(s.parkings[1].destination, "design.md › Open Questions → security.md");
});

test("счётчики: решено с пробами, открыто, парковки по адресатам, спорные факты, пропавшие улики записи и вариантов", () => {
  const miss = { path: "x", quote: "y", found: false, verdict: "цитаты нет дословно" };
  const s = checkSnapshot(payload([
    decided("F-1", "2026-11-01", { outcome: { kind: "проба", value: "Dismiss", reason: "" } }),
    fork("F-2", { options: [option("A", { evidence: [miss] })], parking: [{ addressee: "материалы", text: "а" }] }),
    fact("F-3", { dispute: " «спор» ", evidence: [miss, { path: "x", quote: "y", found: true }] }),
    fact("F-4", { dispute: "  " }),
  ]));
  assert.deepEqual(s.counts, { decided: 1, open: 1, parked: { материалы: 1, человек: 0, ИБ: 0 }, disputedFacts: 1, evidenceMissing: 2, evidenceSignal: 2 });
});

test("«корня для пути нет» входит в «не найдено», но сигналом не считается", () => {
  const s = checkSnapshot(payload([fact("F-1", { evidence: [{ path: "x", quote: "y", found: false, verdict: "корня для пути нет" }] })]));
  assert.equal(s.counts.evidenceMissing, 1);
  assert.equal(s.counts.evidenceSignal, 0);
});
