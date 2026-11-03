// «Внести» целиком на настоящем ядре: сверка хеша, ответ в answers/, apply, пересборка.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EXPECTED_CONTRACT } from "../../src/host/core";
import { applyFlow } from "../../src/host/apply";
import { changeRef, sha256File } from "../../src/host/project";
import { makeProject, noCoreReason } from "./fixture-project";

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
  const r = await applyFlow({ env, ref, text: "- F-04: A — «и так»", shownSha: first.stage === "applied" ? first.sha256After : "", date: DATE });
  assert.equal(r.stage, "applied");
  if (r.stage === "applied") assert.equal(path.basename(r.answers), "2026-11-01-2.md");
});

test("журнала нет на диске: это устаревший показ, а не падение", opts, async () => {
  const { env, ref, change, sha } = setup();
  fs.unlinkSync(path.join(change, "decisions.json"));
  const r = await applyFlow({ env, ref, text: "- F-02: A", shownSha: sha, date: DATE });
  assert.equal(r.stage, "stale");
});

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
