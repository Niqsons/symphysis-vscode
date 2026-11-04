// «Внести» целиком на настоящем ядре: сверка хеша, ответ в answers/, apply, пересборка.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXPECTED_CONTRACT } from "../../src/host/core";
import { applyFlow } from "../../src/host/apply";
import { changeRef, sha256File } from "../../src/host/project";
import { addAttack, makeProject, noCoreReason } from "./fixture-project";

const python = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
const opts = { skip: noCoreReason };
const DATE = "2026-11-01";

function setup() {
  const { project, tools, change } = makeProject();
  const ref = changeRef(project, path.basename(change));
  return { env: { python, tools, cwd: project }, ref, change, sha: sha256File(ref.journal) };
}
const answersOf = (change: string) => (fs.existsSync(path.join(change, "answers")) ? fs.readdirSync(path.join(change, "answers")) : []);

test("успех: ответ сохранён как есть, журнал изменён, производные собраны, отчёт дословно", opts, async () => {
  const { env, ref, change, sha } = setup();
  const text = "Решения по журналу decisions.json, 2026-11-01:\n- F-02: A — «так»";
  const r = await applyFlow({ env, ref, text, shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage !== "applied") return;
  assert.equal(path.basename(r.answers), "2026-11-01.md");
  assert.equal(fs.readFileSync(r.answers, "utf8"), text);
  assert.ok(r.report.includes("[ok] F-02: решено A"), r.report.join("\n"));
  assert.equal(r.rebuildOk, true);
  assert.ok(fs.existsSync(path.join(change, "decisions.md")));
  assert.ok(fs.existsSync(path.join(change, "symphysis.html")));
  assert.notEqual(r.sha256After, sha);
  assert.equal(r.sha256After, sha256File(ref.journal));
});

test("журнал изменён после показа: внесения нет, файла ответа нет", opts, async () => {
  const { env, ref, change } = setup();
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: "0".repeat(64), date: DATE });
  assert.equal(r.stage, "stale");
  assert.deepEqual(answersOf(change), []);
});

test("хеш показанного не передан: считается изменённым, внесения нет", opts, async () => {
  const { env, ref, change } = setup();
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: undefined, date: DATE });
  assert.equal(r.stage, "stale");
  assert.deepEqual(answersOf(change), []);
});

test("отказ apply: журнал не тронут, отчёт называет запись, файла ответа не остаётся", opts, async () => {
  const { env, ref, change, sha } = setup();
  const r = await applyFlow({ env, ref, text: "- F-02: Z — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "refused");
  if (r.stage !== "refused") return;
  assert.ok(r.report.some((l) => l.includes("F-02: варианта Z нет")), r.report.join("\n"));
  assert.equal(sha256File(ref.journal), sha);
  assert.deepEqual(answersOf(change), []);
});

test("отказ не занимает номер: следующий удачный ответ — на чистую дату", opts, async () => {
  const { env, ref, sha } = setup();
  await applyFlow({ env, ref, text: "- F-02: Z — «так»", shownSha: sha, date: DATE });
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage === "applied") assert.equal(path.basename(r.answers), "2026-11-01.md");
});

test("второй ответ за день не затирает первый", opts, async () => {
  const { env, ref, sha } = setup();
  const first = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(first.stage, "applied");
  const r = await applyFlow({ env, ref, text: "- F-04: A — «и так»", shownSha: first.stage === "applied" ? first.sha256After ?? "" : "", date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage === "applied") assert.equal(path.basename(r.answers), "2026-11-01-2.md");
});

test("журнала нет на диске: это устаревший показ, а не падение", opts, async () => {
  const { env, ref, change, sha } = setup();
  fs.unlinkSync(path.join(change, "decisions.json"));
  const r = await applyFlow({ env, ref, text: "- F-02: A", shownSha: sha, date: DATE });
  assert.equal(r.stage, "stale");
});

// --- событие для хука: только после успешного `apply`, сбой записи не отменяет внесённого (F-33, F-70, F-99) ---

const viewerPath = (project: string, ...rest: string[]) => path.join(project, ".symphysis", "viewer", ...rest);
const eventsOf = (project: string): any[] => {
  const file = viewerPath(project, "events.jsonl");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
function addCursor(project: string, name = `${"c".repeat(64)}.json`) {
  fs.mkdirSync(viewerPath(project, "sessions"), { recursive: true });
  fs.writeFileSync(viewerPath(project, "sessions", name), "{}", "utf8");
}
const NO_SESSIONS = /Ни одна сессия агента ещё не обращалась через хук в этом проекте, агенту в другом каталоге надо сказать самому/;
const EVENT_LOST = /Журнал внесён, но событие для агента не записалось.*: агенту надо сказать самому/;

test("«Внесено»: в events.jsonl новая строка с изменением, файлом answers/ от корня, двумя хешами и отчётом", opts, async () => {
  const { env, ref, sha } = setup();
  addCursor(ref.root);
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage !== "applied") return;
  assert.ok(r.report.includes("[ok] F-02: решено A"), r.report.join("\n"));
  assert.deepEqual(eventsOf(ref.root), [{
    change: ref.name,
    answers: `openspec/changes/${ref.name}/answers/2026-11-01.md`,
    sha256_before: sha,
    sha256_after: sha256File(ref.journal),
    report: r.report,
  }]);
});

test("«Внесено»: второе внесение дописывает вторую строку, хеш до равен прежнему хешу после", opts, async () => {
  const { env, ref, sha } = setup();
  const first = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  const after = first.stage === "applied" ? first.sha256After ?? "" : "";
  await applyFlow({ env, ref, text: "- F-04: A — «и так»", shownSha: after, date: DATE });
  const [one, two, ...rest] = eventsOf(ref.root);
  assert.deepEqual(rest, []);
  assert.equal(one.answers.endsWith("/2026-11-01.md"), true);
  assert.equal(two.answers.endsWith("/2026-11-01-2.md"), true);
  assert.equal(two.sha256_before, one.sha256_after);
});

test("«Внесено»: сборка упала, журнал уже внесён — строка всё равно есть", opts, async () => {
  const { env, ref: before, change, sha } = setup();
  addAttack(change, "decisions.md", "не файл атаки");
  const ref = changeRef(before.root, before.name);
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage !== "applied") return;
  assert.equal(r.rebuildOk, false);
  assert.equal(eventsOf(ref.root).length, 1);
  assert.equal(eventsOf(ref.root)[0].sha256_after, sha256File(ref.journal));
});

test("«Внесено»: строку понимает настоящий hook.py, курсор этого хука снимает слова о сессиях", opts, async () => {
  // Имя без пробела: `valid_name` в hook.py другие не пропускает.
  const { project, tools, change } = makeProject("изменение-один");
  const ref = changeRef(project, path.basename(change));
  const sha = sha256File(ref.journal);
  fs.mkdirSync(viewerPath(project), { recursive: true });
  fs.copyFileSync(path.resolve("hook", "hook.py"), viewerPath(project, "hook.py"));
  const hook = () => spawnSync("python", ["-I", "-X", "utf8", viewerPath(project, "hook.py")], { input: JSON.stringify({ session_id: "сессия" }), cwd: project, encoding: "utf8" });
  assert.equal(hook().stdout, "");
  const r = await applyFlow({ env: { python, tools, cwd: project }, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage !== "applied") return;
  assert.ok(!r.report.some((l) => NO_SESSIONS.test(l)), r.report.join("\n"));
  const out = hook().stdout;
  assert.ok(out.includes("openspec/changes/изменение-один/answers/2026-11-01.md"), out);
  assert.ok(out.includes(sha.slice(0, 8)), out);
  assert.ok(out.includes(sha256File(ref.journal).slice(0, 8)), out);
});

test("«Отказ `apply`»: строки в events.jsonl нет, журнал не тронут", opts, async () => {
  const { env, ref, sha } = setup();
  const r = await applyFlow({ env, ref, text: "- F-02: Z — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "refused");
  assert.deepEqual(eventsOf(ref.root), []);
  assert.equal(sha256File(ref.journal), sha);
});

test("устаревший журнал строки не даёт", opts, async () => {
  const { env, ref } = setup();
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: "0".repeat(64), date: DATE });
  assert.equal(r.stage, "stale");
  assert.deepEqual(eventsOf(ref.root), []);
});

test("«Событие не записалось»: запись упала, журнал внесён, к отчёту добавлено предупреждение", opts, async () => {
  const { env, ref, sha } = setup();
  // Каталог на месте файла: настоящий отказ записи.
  fs.mkdirSync(viewerPath(ref.root, "events.jsonl"), { recursive: true });
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage !== "applied") return;
  assert.equal(JSON.parse(fs.readFileSync(ref.journal, "utf8")).records[1].decision.option, "A");
  assert.equal(r.rebuildOk, true);
  assert.equal(r.sha256After, sha256File(ref.journal));
  assert.ok(r.report.includes("[ok] F-02: решено A"), r.report.join("\n"));
  assert.ok(r.report.some((l) => EVENT_LOST.test(l)), r.report.join("\n"));
  // Хука нет: и сессий нет, обе строки на месте.
  assert.ok(r.report.some((l) => NO_SESSIONS.test(l)), r.report.join("\n"));
});

test("«Событие не записалось»: хеш после внесения не прочитать, внесённое не называется отказом, строки нет", opts, async () => {
  const { env, ref, sha } = setup();
  // Настоящее ядро в обёртке: `apply` проходит, затем журнал пропадает.
  fs.renameSync(path.join(env.tools, "journal.py"), path.join(env.tools, "journal_real.py"));
  fs.writeFileSync(path.join(env.tools, "journal.py"), [
    "import os, runpy, sys",
    "try:",
    '    runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "journal_real.py"), run_name="__main__")',
    "finally:",
    '    if sys.argv[1] == "apply":',
    "        os.unlink(sys.argv[2])",
    "",
  ].join("\n"), "utf8");
  const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage !== "applied") return;
  assert.equal(fs.existsSync(ref.journal), false);
  assert.equal(r.sha256After, null);
  assert.ok(r.report.some((l) => EVENT_LOST.test(l)), r.report.join("\n"));
  assert.deepEqual(eventsOf(ref.root), []);
});

for (const [name, prepare] of [
  ["каталога курсоров нет", () => {}],
  ["каталог курсоров пуст", (p: string) => fs.mkdirSync(viewerPath(p, "sessions"), { recursive: true })],
  ["в каталоге только временный файл хука", (p: string) => addCursor(p, `${"c".repeat(64)}.json.1.tmp`)],
] as const) {
  test(`«Ни одна сессия не обращалась»: ${name}, к отчёту добавлена строка, событие записано без неё`, opts, async () => {
    const { env, ref, sha } = setup();
    prepare(ref.root);
    const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
    assert.equal(r.stage, "applied");
    if (r.stage !== "applied") return;
    assert.ok(r.report.some((l) => NO_SESSIONS.test(l)), r.report.join("\n"));
    const [event] = eventsOf(ref.root);
    assert.ok(event.report.includes("[ok] F-02: решено A"));
    assert.ok(!event.report.some((l: string) => NO_SESSIONS.test(l)), event.report.join("\n"));
  });
}

// --- номер контракта меняется после показа: хост сам не пишет ни журнал, ни страницу (F-22, F-35) ---

function patchContract(tools: string, value: number) {
  const file = path.join(tools, "journal_render.py");
  const text = fs.readFileSync(file, "utf8");
  const next = text.replace(/^CONTRACT = \d+\r?$/m, `CONTRACT = ${value}`);
  assert.notEqual(next, text, "код ядра не подменён");
  fs.writeFileSync(file, next, "utf8");
}

for (const [name, value, reason] of [
  ["Старый плагин и новое ядро", EXPECTED_CONTRACT + 1, /новый \.vsix/],
  ["Новый плагин и старое ядро", EXPECTED_CONTRACT - 1, /обнови.*symphysis/],
] as const) {
  test(`${name}: ядро сменилось после показа, «Внести» не доходит до журнала, страницы нет, причина названа`, opts, async () => {
    const { env, ref, change, sha } = setup();
    patchContract(env.tools, value);
    const r = await applyFlow({ env, ref, text: "- F-02: A — «так»", shownSha: sha, date: DATE });
    assert.equal(r.stage, "error");
    if (r.stage !== "error") return;
    assert.match(r.text, reason);
    assert.equal(sha256File(ref.journal), sha);
    assert.equal(fs.existsSync(path.join(change, "symphysis.html")), false);
    assert.equal(fs.existsSync(path.join(change, "decisions.md")), false);
    assert.deepEqual(answersOf(change), []);
  });
}
