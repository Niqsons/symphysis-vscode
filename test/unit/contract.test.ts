// Контракт промпта: что строит расширение, принимает настоящий `apply`; после внесения очистка черновика не оставляет работы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyAnswers, viewJson, type CoreEnv } from "../../src/host/core";
import { changeRef, saveAnswers, type ChangeRef } from "../../src/host/project";
import { allOptions, buildPrompt, cleanupIngested, disputeKey, emptyDraft, nextLetter } from "../../src/shared/logic";
import { ADDRESSEES, type Draft, type ViewPayload } from "../../src/shared/types";
import { bigJournal, coreJournals } from "../core-journals.mjs";
import { addAttack, copyCore, makeProject, noCoreReason, SYMPHYSIS } from "./fixture-project";

const python = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
const opts = { skip: noCoreReason };
const DATE = "2026-11-01";
const SMOKE = path.join(SYMPHYSIS, "tests", "fixtures", "viewer-smoke.js");

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

test("спор по строке атаки: уходит в notes[] журнала, после внесения очистка его убирает", opts, async () => {
  const { env, change } = setup();
  addAttack(change, "decisions.md", [
    "---", "status: gaps_found", "target: decisions.json", `target_sha256: ${"0".repeat(64)}`, "---", "",
    "| Утверждение | Раздел | Линза | Инвариант | Тяжесть | Опора | Закрытие |", "| --- | --- | --- | --- | --- | --- | --- |",
    "| Претензия | F-03, question | coverage | инвариант | блокер | нет | правка цели |", "",
  ].join("\n"));
  const ref = changeRef(env.cwd, path.basename(change));
  const p = await load(env, ref);
  const att = p.attacks[0];
  const draft: Draft = { ...emptyDraft(), attackDisputes: { [disputeKey(att.path, att.rows![0])]: "опора есть" } };
  const applied = await applyAnswers(env, ref, saveAnswers(change, DATE, buildPrompt(p, draft, DATE).text));
  assert.equal(applied.ok, true, applied.report.join("\n"));
  const after = await load(env, changeRef(env.cwd, ref.name));
  assert.ok(after.notes.some((n) => n.text.includes("опора есть")));
  assert.deepEqual(cleanupIngested(after, draft).attackDisputes, {});
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
  for (const att of p.attacks) {
    (att.rows ?? []).forEach((row, i) => {
      if (i % 4 === 0) d.attackDisputes[disputeKey(att.path, row)] = `спор к строке ${i}: «цитата» — и тире`;
    });
  }
  return d;
}

const realJournals = coreJournals(SYMPHYSIS);

// Список строится по диску, поэтому журнал, уехавший в другой каталог, убирает свои прогоны без единого красного теста.
test("большой журнал среди настоящих: перенос в архив не убирает прогоны молча", opts, () => {
  assert.match(bigJournal(SYMPHYSIS).dir, /calibration-fixes$/);
});

test("поиск журналов: активные и архив, большой находится по имени без даты, без него ошибка, а не пропуск", opts, () => {
  const { project, change } = makeProject();
  assert.throws(() => bigJournal(project), /calibration-fixes/);
  const archived = path.join(project, "openspec", "changes", "archive", "2026-11-02-calibration-fixes");
  fs.mkdirSync(archived, { recursive: true });
  fs.copyFileSync(path.join(change, "decisions.json"), path.join(archived, "decisions.json"));
  assert.equal(bigJournal(project).dir, archived);
  assert.deepEqual(coreJournals(project).map((j) => j.name), [path.basename(change), path.basename(archived)]);
});

for (const { name, dir: from } of realJournals) {
  test(`настоящий журнал ${name}: промпт по всем видам строк проходит apply --dry-run`, opts, async () => {
    const { project, change } = makeProject(name);
    fs.copyFileSync(path.join(from, "decisions.json"), path.join(change, "decisions.json"));
    if (fs.existsSync(path.join(from, "attack"))) {
      fs.mkdirSync(path.join(change, "attack"));
      for (const f of fs.readdirSync(path.join(from, "attack"))) fs.copyFileSync(path.join(from, "attack", f), path.join(change, "attack", f));
    }
    const env = { python, tools: copyCore(project), cwd: project };
    const ref = changeRef(project, name);
    const p = await load(env, ref);
    const prompt = buildPrompt(p, exercise(p), DATE);
    assert.ok(prompt.text.split("\n").length > 5);
    const r = await applyAnswers(env, ref, saveAnswers(change, DATE, prompt.text), true);
    assert.equal(r.ok, true, r.report.filter((l) => l.startsWith("[!!]")).slice(0, 10).join("\n"));
  });
}


// --- один черновик, страница и плагин: журналы после apply совпадают побайтно (F-20, F-80, F-81) ---

/** Промпт настоящей страницы: `render-html` этого журнала и скрипт её шаблона при том же черновике. */
function pagePrompt(env: CoreEnv, ref: ChangeRef, change: string, d: Draft): string {
  const page = path.join(change, "decisions.html");
  const rendered = spawnSync(env.python, ["-X", "utf8", path.join(env.tools, "journal.py"), "render-html", path.relative(env.cwd, ref.journal), "--out", path.relative(env.cwd, page)], { cwd: env.cwd, encoding: "utf8" });
  assert.equal(rendered.status, 0, rendered.stderr);
  const { attackDisputes: _unused, ...state } = d;
  const stateFile = path.join(change, "state.json");
  fs.writeFileSync(stateFile, JSON.stringify(state), "utf8");
  const run = spawnSync(process.execPath, [SMOKE, page, stateFile], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  fs.unlinkSync(page);
  fs.unlinkSync(stateFile);
  return JSON.parse(run.stdout).out as string;
}

async function sameJournal(d: Draft) {
  const first = setup();
  const second = setup();
  const page = pagePrompt(first.env, first.ref, first.change, d);
  // Дату промпта страница берёт у часов: плагину подаётся та же, чтобы журналы сравнивались только по словам.
  const date = /(\d{4}-\d{2}-\d{2})/.exec(page.split("\n")[0])![1];
  const plugin = buildPrompt(await load(second.env, second.ref), d, date).text;
  const a = await applyAnswers(first.env, first.ref, saveAnswers(first.change, date, page));
  assert.equal(a.ok, true, `страница:\n${page}\n---\n${a.report.join("\n")}`);
  const b = await applyAnswers(second.env, second.ref, saveAnswers(second.change, date, plugin));
  assert.equal(b.ok, true, `плагин:\n${plugin}\n---\n${b.report.join("\n")}`);
  assert.equal(fs.readFileSync(path.join(first.change, "decisions.json"), "utf8"), fs.readFileSync(path.join(second.change, "decisions.json"), "utf8"), `страница:\n${page}\n---\nплагин:\n${plugin}`);
}

test("Сверка видов слова: выбор, слово, вариант, зависимость, парковка, спор, заметка, новая развилка", opts, async () => {
  await sameJournal(FULL);
});

test("Слово со знаками: кавычки, перевод строки, тире и черта дают одно слово", opts, async () => {
  await sameJournal({ ...emptyDraft(), decisions: { "F-02": { choice: "A", word: "«кавычки»\nвторая строка — тире | черта `код`", parked: [] } } });
});

test("Тест-страховка F-80: два добавленных варианта к одной записи получают одни буквы", opts, async () => {
  await sameJournal({
    ...emptyDraft(),
    decisions: { "F-02": { choice: "E", word: "второй свой", parked: [] } },
    added: { "F-02": [{ letter: "D", text: "первый вариант человека" }, { letter: "E", text: "второй вариант человека" }] },
  });
});
