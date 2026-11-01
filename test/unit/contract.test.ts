// Контракт промпта: что строит расширение, принимает настоящий `apply`; после внесения очистка черновика не оставляет работы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyAnswers, viewJson, type CoreEnv } from "../../src/host/core";
import { changeRef, saveAnswers, type ChangeRef } from "../../src/host/project";
import { allOptions, buildPrompt, cleanupIngested, emptyDraft, nextLetter } from "../../src/shared/logic";
import { ADDRESSEES, type Draft, type ViewPayload } from "../../src/shared/types";
import { addAttack, copyCore, makeProject, noCoreReason, SYMPHYSIS } from "./fixture-project";

const python = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
const opts = { skip: noCoreReason };
const DATE = "2026-11-01";

function setup(): { env: CoreEnv; ref: ChangeRef; change: string } {
  const { project, tools, change } = makeProject();
  return { env: { python, tools, cwd: project }, ref: changeRef(project, path.basename(change)), change };
}

async function load(env: CoreEnv, ref: ChangeRef): Promise<ViewPayload> {
  const r = await viewJson(env, ref);
  assert.equal(r.ok, true, r.ok ? "" : JSON.stringify(r.failure));
  return (r as { ok: true; payload: ViewPayload }).payload;
}

const FULL: Draft = {
  ...emptyDraft(),
  decisions: {
    "F-02": { choice: "D", word: "свой вариант лучше", parked: [{ text: "Узнать размер файла", addressee: "материалы" }] },
    "F-03": { choice: "B", word: "передумал — «вложенные» кавычки\nи вторая строка", parked: [] },
    "F-04": { choice: null, word: "", parked: [{ text: "Кто решит", addressee: "человек" }] },
  },
  added: { "F-02": [{ letter: "D", text: "Вариант человека" }] },
  disputes: { "F-01": "Цитата не про это" },
  deps: { "F-03": { add: ["F-01"], remove: [] }, "F-04": { add: [], remove: ["F-02"] } },
  newForks: [{ id: "F-N1", question: "Нужна ли кнопка?", options: "Да\nНет", word: "почему развилка" }],
  notes: "Замечание\nв две строки",
};

test("все виды строк: apply принимает, отчёт называет каждую", opts, async () => {
  const { env, ref, change } = setup();
  const p = await load(env, ref);
  const prompt = buildPrompt(p, FULL, DATE);
  const r = await applyAnswers(env, ref, saveAnswers(change, DATE, prompt.text), true);
  assert.equal(r.ok, true, `${prompt.text}\n---\n${r.report.join("\n")}`);
  for (const line of ["F-02: добавлен вариант D", "F-02: решено D", "F-02: припарковано → материалы", "F-03: решено B (было A)", "F-01: факт оспорен",
    "F-03: зависимость добавлена F-01", "F-04: зависимость снята F-02", "F-04: припарковано → человек", "F-N1 -> F-05: новая развилка", "замечание к схеме внесено"]) {
    assert.ok(r.report.some((l) => l.includes(line)), `нет «${line}» в отчёте:\n${r.report.join("\n")}`);
  }
});

test("после настоящего внесения: очистка забирает всё, второй промпт пуст, журнал не задваивается", opts, async () => {
  const { env, ref, change } = setup();
  const before = await load(env, ref);
  const applied = await applyAnswers(env, ref, saveAnswers(change, DATE, buildPrompt(before, FULL, DATE).text));
  assert.equal(applied.ok, true, applied.report.join("\n"));
  const after = await load(env, changeRef(env.cwd, ref.name));
  assert.equal(after.records.length, before.records.length + 1);
  const cleaned = cleanupIngested(after, FULL);
  const second = buildPrompt(after, cleaned, DATE);
  assert.equal(second.empty, true, second.text);
  const f03 = after.records.find((r) => r.id === "F-03")!;
  assert.equal(f03.decision?.word, "передумал — «вложенные» кавычки и вторая строка");
  assert.equal(after.records.find((r) => r.id === "F-02")?.decision?.option, "D");
});

test("ответ на вопрос атаки уходит словом к решению и принимается", opts, async () => {
  const { env, change } = setup();
  addAttack(change);
  const ref = changeRef(env.cwd, path.basename(change));
  const p = await load(env, ref);
  const att = p.attacks[0], row = att.rows![0];
  const draft: Draft = { ...emptyDraft(), decisions: { "F-02": { choice: "A", word: "", parked: [] } }, attackDisputes: { [`${att.path}|${row.section}|${row.claim}`]: "ответ человека" } };
  const prompt = buildPrompt(p, draft, DATE);
  assert.match(prompt.text, /- F-02: A — «ответ человека»/);
  const r = await applyAnswers(env, ref, saveAnswers(change, DATE, prompt.text), true);
  assert.equal(r.ok, true, `${prompt.text}\n---\n${r.report.join("\n")}`);
});

/** Детерминированный черновик по настоящему журналу: у каждой развилки своё действие по кругу, все варианты, какие есть. */
function exercise(p: ViewPayload): Draft {
  const d = emptyDraft();
  p.records.forEach((rec, i) => {
    if (rec.kind === "факт") {
      if (i % 3 === 0) d.disputes[rec.id] = `спор к ${rec.id}: «цитата» — и тире`;
      return;
    }
    const opts = allOptions(rec, d);
    const pick = opts[i % opts.length]?.letter ?? null;
    if (i % 5 === 0) d.decisions[rec.id] = { choice: pick, word: `слово к ${rec.id}\nвторая строка`, parked: [] };
    if (i % 5 === 1) d.decisions[rec.id] = { choice: null, word: rec.decision ? `к решению ${rec.id}` : "", parked: [] };
    if (i % 5 === 2) d.decisions[rec.id] = { choice: null, word: "", parked: [{ text: `вопрос к ${rec.id}`, addressee: ADDRESSEES[i % 3] }] };
    if (i % 5 === 3) {
      const letter = nextLetter(rec, d);
      if (letter) d.added[rec.id] = [{ letter, text: `вариант человека ${rec.id}` }];
    }
    if (i % 5 === 4 && rec.depends_on.length) d.deps[rec.id] = { add: [], remove: [rec.depends_on[0]] };
  });
  d.notes = "заметка: проверка контракта";
  return d;
}

const realJournals = (() => {
  const base = path.join(SYMPHYSIS, "openspec", "changes");
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((n) => fs.existsSync(path.join(base, n, "decisions.json")));
})();

for (const name of realJournals) {
  test(`настоящий журнал ${name}: промпт по всем видам строк проходит apply --dry-run`, opts, async () => {
    const { project, change } = makeProject(name);
    fs.copyFileSync(path.join(SYMPHYSIS, "openspec", "changes", name, "decisions.json"), path.join(change, "decisions.json"));
    const env = { python, tools: copyCore(project), cwd: project };
    const ref = changeRef(project, name);
    const p = await load(env, ref);
    const prompt = buildPrompt(p, exercise(p), DATE);
    assert.ok(prompt.text.split("\n").length > 5);
    const r = await applyAnswers(env, ref, saveAnswers(change, DATE, prompt.text), true);
    assert.equal(r.ok, true, r.report.filter((l) => l.startsWith("[!!]")).slice(0, 10).join("\n"));
  });
}
