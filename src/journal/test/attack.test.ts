import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attackAnchor, attackKind, attackOutline, demotion, effectiveLens, fileGroups, isKnownLens, lensAnchor, lensFilters, lensLabel, OUTSIDE, recordIdOf, rowAnchor, setAttackDispute, severityLevel, sevBase, sevReason, verdictState,
} from "../attack";
import { emptyDraft } from "../logic";
import type { AttackFile, AttackRow } from "../../protocol/types";
import { fork, payload } from "../../../test/unit/helpers";

const row = (over: Partial<AttackRow> = {}): AttackRow =>
  ({ claim: "утверждение", section: "—", lens: "coverage", invariant: "—", severity: "блокер", support: "нет", fix: "правка", ...over });
const journalFile = (rows: AttackRow[], sha = "a".repeat(64)): AttackFile =>
  ({ path: "attack/decisions.md", frontmatter: { status: "gaps_found", targets: [{ path: "decisions.json", sha256: sha }] }, rows });
const artifactsFile = (rows: AttackRow[]): AttackFile =>
  ({ path: "attack/artifacts.md", frontmatter: { status: "passed", targets: [{ path: "specs/a/spec.md", sha256: "b" }, { path: "design.md", sha256: "c" }] }, rows });

test("вид файла: журнал — единственная цель decisions.json, всё прочее — артефакты", () => {
  assert.equal(attackKind(journalFile([])), "journal");
  assert.equal(attackKind(artifactsFile([])), "artifacts");
  assert.equal(attackKind({ path: "x", frontmatter: { status: "", targets: [] }, rows: [] }), "artifacts");
  assert.equal(attackKind({ path: "x", frontmatter: { status: "", targets: [{ path: "decisions.json", sha256: "" }, { path: "design.md", sha256: "" }] }, rows: [] }), "artifacts");
});

test("подпись линзы: у каждого файла свой закрытый список", () => {
  assert.equal(lensLabel(journalFile([]), "coverage"), "покрытие разделов");
  assert.equal(lensLabel(artifactsFile([]), "coverage"), "");
  assert.equal(lensLabel(artifactsFile([]), "scenario-run"), "прогон сценария");
  assert.equal(lensLabel(artifactsFile([]), "trace-link"), "связи изменения");
  assert.equal(lensLabel(journalFile([]), "trace-link"), "");
});

test("линза trace-link: третья в списке артефактов; без строк группы нет, со строкой — после claim-extraction", () => {
  assert.equal(isKnownLens(artifactsFile([]), "trace-link"), true);
  assert.equal(isKnownLens(journalFile([]), "trace-link"), false);
  assert.deepEqual(fileGroups(artifactsFile([row({ lens: "scenario-run" })])).groups.map((g) => g.slug), ["scenario-run"]);
  assert.deepEqual(fileGroups(artifactsFile([])).groups, []);
  const g = fileGroups(artifactsFile([row({ lens: "trace-link" }), row({ lens: "claim-extraction" }), row({ lens: "scenario-run" })]));
  assert.deepEqual(g.groups.map((x) => x.slug), ["scenario-run", "claim-extraction", "trace-link"]);
  assert.deepEqual(g.lensCounts, [["scenario-run", 1], ["claim-extraction", 1], ["trace-link", 1]]);
});

test("тяжесть — первое слово ячейки, регистр не важен, причина — в скобках", () => {
  assert.equal(sevBase("Блокер"), "блокер");
  assert.equal(sevBase("предупреждение (решено человеком в F-11)"), "предупреждение");
  assert.equal(sevReason("предупреждение (решено человеком в F-11)"), "решено человеком в F-11");
  assert.equal(sevReason("блокер"), "");
  assert.equal(sevBase("блокерский"), "блокерский");
});

test("уровень цвета тяжести по Р21: блокер, предупреждение, справка, прочее", () => {
  assert.equal(severityLevel("блокер"), "signal");
  assert.equal(severityLevel("предупреждение (причина)"), "accent");
  assert.equal(severityLevel("справка"), "muted");
  assert.equal(severityLevel("что-то иное"), "plain");
});

test("понижение: только при опоре «нет» и тяжести ниже блокера", () => {
  assert.deepEqual(demotion(row({ support: "нет", severity: "предупреждение" })), { reason: "" });
  assert.deepEqual(demotion(row({ support: "нет: не найдено", severity: "справка (мелочь)" })), { reason: "мелочь" });
  assert.equal(demotion(row({ support: "нет", severity: "блокер" })), null);
  assert.equal(demotion(row({ support: "есть", severity: "справка" })), null);
  assert.equal(demotion(row({ support: "по спеке не выводится", severity: "справка" })), null);
  assert.equal(demotion(row({ support: "нету", severity: "справка" })), null);
});

test("запись по разделу: только существующая и только целый номер", () => {
  const records = [fork("F-02")];
  assert.equal(recordIdOf("F-02, decision", records), "F-02");
  assert.equal(recordIdOf("F-021, decision", records), null);
  assert.equal(recordIdOf("F-99, decision", records), null);
  assert.equal(recordIdOf("design.md › Decisions", records), null);
});

test("вердикт: совпал, устарел, хеша нет, сверять не с чем", () => {
  const sha = "a".repeat(64);
  assert.equal(verdictState(journalFile([], sha), sha), "match");
  assert.equal(verdictState(journalFile([], "f".repeat(64)), sha), "stale");
  assert.equal(verdictState(journalFile([], ""), sha), "no-hash");
  assert.equal(verdictState(journalFile([], sha), undefined), "none");
  assert.equal(verdictState({ path: "x", frontmatter: { status: "", targets: [{ path: "design.md", sha256: "b" }] }, rows: [] }, sha), "none");
  assert.equal(verdictState({ path: "x", error: "битый" }, sha), "none");
});

test("группы файла: линзы в порядке списка, «вне списка» последней, внутри — по тяжести, прочая тяжесть в конце", () => {
  const f = journalFile([
    row({ lens: "coverage", severity: "справка", claim: "1" }),
    row({ lens: "выдуманная", claim: "2" }),
    row({ lens: "context-compliance", severity: "странная", claim: "3" }),
    row({ lens: "coverage", severity: "блокер", claim: "4" }),
    row({ lens: "context-compliance", severity: "предупреждение", claim: "5" }),
  ]);
  const g = fileGroups(f);
  assert.deepEqual(g.groups.map((x) => x.slug), ["context-compliance", "coverage", OUTSIDE]);
  assert.deepEqual(g.groups[0].severities.map((s) => [s.severity, s.rows.map((r) => r.claim)]), [["предупреждение", ["5"]], ["странная", ["3"]]]);
  assert.deepEqual(g.groups[1].severities.map((s) => s.severity), ["блокер", "справка"]);
  assert.deepEqual(g.severityCounts, { блокер: 2, предупреждение: 1, справка: 1, прочих: 1 });
  assert.deepEqual(g.lensCounts, [["context-compliance", 2], ["coverage", 2]]);
  assert.equal(g.outside, 1);
});

test("фильтр линз: перечень по всем файлам, битый файл не считается, недоступный выбор — «все»", () => {
  const attacks = [journalFile([row({ lens: "coverage" }), row({ lens: "claim-extraction" })]), artifactsFile([row({ lens: "claim-extraction" }), row({ lens: "coverage" })]), { path: "x", error: "битый" }];
  const f = lensFilters(attacks);
  assert.equal(f.total, 4);
  assert.deepEqual(f.lenses, [["claim-extraction", 2], ["coverage", 1], [OUTSIDE, 1]]);
  assert.equal(effectiveLens("coverage", attacks), "coverage");
  assert.equal(effectiveLens("scenario-run", attacks), "all");
  assert.equal(effectiveLens("all", attacks), "all");
});

test("спор по строке: пустой убирает ключ", () => {
  const d = setAttackDispute(emptyDraft(), "k", "спор");
  assert.equal(d.attackDisputes.k, "спор");
  assert.deepEqual(setAttackDispute(d, "k", "  ").attackDisputes, {});
});

test("пустой перечень атак: фильтр пуст", () => {
  assert.deepEqual(lensFilters(payload([]).attacks), { total: 0, lenses: [] });
});

test("оглавление атаки: файл → линза → строка; блокеры первыми, вне списка — последней группой", () => {
  const rows = [
    row({ lens: "coverage", severity: "справка", support: "есть", section: "F-03, question", claim: "мелочь" }),
    row({ lens: "coverage", severity: "блокер", section: "F-02, decision", claim: "главное" }),
    row({ lens: "выдуманная", severity: "предупреждение", support: "есть", claim: "чужая" }),
    row({ lens: "claim-authority", severity: "предупреждение", support: "есть", claim: "числа" }),
  ];
  const [f] = attackOutline([journalFile(rows)], "a".repeat(64));
  assert.deepEqual([f.name, f.anchor, f.status, f.stale, f.blockers, f.warnings], ["decisions.md", attackAnchor(0), "gaps_found", false, 1, 2]);
  assert.deepEqual(f.lenses.map((l) => [l.title, l.count, l.blockers, l.warnings]), [["claim-authority", 1, 0, 1], ["coverage", 2, 1, 0], ["вне списка", 1, 0, 1]]);
  const coverage = f.lenses[1];
  assert.equal(coverage.label, "покрытие разделов");
  assert.equal(coverage.anchor, lensAnchor(0, "coverage"));
  assert.deepEqual(coverage.rows.map((r) => [r.section, r.claim, r.level, r.anchor]), [
    ["F-02, decision", "главное", "signal", rowAnchor(0, 1)],
    ["F-03, question", "мелочь", "muted", rowAnchor(0, 0)],
  ]);
  assert.equal(f.lenses[2].anchor, lensAnchor(0, OUTSIDE));
});

test("оглавление атаки: устаревший вердикт и битый файл названы, номер файла — как в режиме", () => {
  const out = attackOutline([{ path: "attack/artifacts.md", error: "ячеек 3" }, journalFile([row()], "f".repeat(64))], "a".repeat(64));
  assert.deepEqual([out[0].name, out[0].error, out[0].lenses], ["artifacts.md", "ячеек 3", []]);
  assert.equal(out[1].stale, true);
  assert.equal(out[1].anchor, attackAnchor(1));
  assert.equal(out[1].lenses[0].rows[0].anchor, rowAnchor(1, 0));
});

test("разметка кода в оглавлении не показывается", () => {
  const [f] = attackOutline([journalFile([row({ claim: "про `код` тут" })])], undefined);
  assert.equal(f.lenses[0].rows[0].claim, "про код тут");
});
