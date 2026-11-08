// Ядро настоящее: `journal.py` из соседнего репозитория, скопированный в проект с кириллицей и пробелами в пути.
import { test } from "node:test";
import assert from "node:assert/strict";
import cp, { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mock } from "node:test";
import { applyAnswers, EXPECTED_CONTRACT, rebuild, viewJson } from "../core";
import { changeRef, sha256File } from "../project";
import { addAttack, makeProject, noCoreReason } from "../../../test/unit/fixture-project";

const python = spawnSync("python", ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
const opts = { skip: noCoreReason };

function setup() {
  const { project, tools, change } = makeProject();
  return { project, change, ref: changeRef(project, path.basename(change)), env: { python, tools, cwd: project } };
}

test("view-json: записи, улики сверены с корнями проекта, хеш совпадает с файлом", opts, async () => {
  const { env, ref, change } = setup();
  const r = await viewJson(env, ref);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.records.length, 4);
  assert.equal(r.payload.sha256, sha256File(path.join(change, "decisions.json")));
  const options = r.payload.records[1].options;
  assert.equal(options[0].evidence[0].found, true);
  assert.equal(options[1].evidence[0].found, false);
  assert.equal(options[1].evidence[0].verdict, "цитаты нет дословно");
  assert.equal(r.payload.records[1].destination?.label, "design.md › Open Questions");
});

test("view-json: атака разобрана; битый файл атаки журнал не прячет", opts, async () => {
  const { env, change } = setup();
  addAttack(change);
  addAttack(change, "artifacts.md", "не файл атаки");
  const ref = changeRef(env.cwd, path.basename(change));
  const r = await viewJson(env, ref);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.payload.records.length, 4);
  const good = r.payload.attacks.find((a) => a.path.endsWith("decisions.md"))!;
  const bad = r.payload.attacks.find((a) => a.path.endsWith("artifacts.md"))!;
  assert.equal(good.rows?.length, 1);
  assert.equal(good.rows?.[0].section, "F-02, decision");
  assert.ok(bad.error);
  // Путь входит в ключ спора и в текст промпта: он не должен зависеть от разделителя системы.
  assert.equal(good.path, `openspec/changes/${path.basename(change)}/attack/decisions.md`);
});

test("негодный журнал: отказ с текстом ядра", opts, async () => {
  const { env, ref, change } = setup();
  fs.writeFileSync(path.join(change, "decisions.json"), JSON.stringify({ title: "x", source: "y" }), "utf8");
  const r = await viewJson(env, ref);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.failure.kind, "invalid-journal");
  if (r.failure.kind === "invalid-journal") assert.match(r.failure.text, /'records' is a required property/);
});

test("недописанный JSON — тот же отказ, а не падение расширения", opts, async () => {
  const { env, ref, change } = setup();
  fs.writeFileSync(path.join(change, "decisions.json"), '{"title": "обрыв', "utf8");
  const r = await viewJson(env, ref);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.failure.kind, "invalid-journal");
});

test("старое ядро без view-json: отказ «обнови symphysis»", opts, async () => {
  const { env, ref } = setup();
  fs.writeFileSync(path.join(env.tools, "journal.py"), [
    "import argparse", "ap = argparse.ArgumentParser(prog='journal')", "sub = ap.add_subparsers(dest='cmd', required=True)",
    "sub.add_parser('check')", "ap.parse_args()",
  ].join("\n"), "utf8");
  const r = await viewJson(env, ref);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.failure.kind, "old-core");
});

test("журнала нет: отказ без запуска Python", opts, async () => {
  const { env, change } = setup();
  fs.unlinkSync(path.join(change, "decisions.json"));
  const r = await viewJson({ ...env, python: "нет такого" }, changeRef(env.cwd, path.basename(change)));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.failure.kind, "no-journal");
});

function answers(change: string, text: string): string {
  const dir = path.join(change, "answers");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "2026-11-01.md");
  fs.writeFileSync(file, text, "utf8");
  return file;
}

test("apply: журнал изменён, отчёт дословно", opts, async () => {
  const { env, ref, change } = setup();
  const before = sha256File(ref.journal);
  const r = await applyAnswers(env, ref, answers(change, "Решения:\n- F-02: A — «так»\n"));
  assert.equal(r.ok, true);
  assert.ok(r.report.includes("[ok] F-02: решено A"), r.report.join("\n"));
  assert.notEqual(sha256File(ref.journal), before);
  const journal = JSON.parse(fs.readFileSync(path.join(change, "decisions.json"), "utf8"));
  assert.equal(journal.records[1].decision.word, "так");
});

test("apply: отказ называет запись, журнал не тронут ни байтом", opts, async () => {
  const { env, ref, change } = setup();
  const before = sha256File(ref.journal);
  const r = await applyAnswers(env, ref, answers(change, "Решения:\n- F-02: Z — «так»\n"));
  assert.equal(r.ok, false);
  assert.ok(r.report.some((l) => l.includes("F-02: варианта Z нет")), r.report.join("\n"));
  assert.equal(sha256File(ref.journal), before);
});

test("Номера совпали: пересборка пишет decisions.md и symphysis.html, справка посчитана, отчёт собран", opts, async () => {
  const { env, ref, change } = setup();
  const r = await rebuild(env, ref);
  assert.equal(r.ok, true, r.report.join("\n"));
  assert.ok(fs.existsSync(path.join(change, "decisions.md")));
  assert.ok(fs.existsSync(path.join(change, "symphysis.html")));
  // Ядро в проекте с step_help.py: страница несёт справку, а не отказ «скрипта справки нет».
  assert.ok(!fs.readFileSync(path.join(change, "symphysis.html"), "utf8").includes("Скрипта справки"));
  assert.ok(r.report.some((l) => l.includes("цитаты нет дословно")), r.report.join("\n"));
});

test("пересборка: битый файл атаки — страница не собрана, отказ в отчёте, остальное записано", opts, async () => {
  const { env, change } = setup();
  addAttack(change, "decisions.md", "не файл атаки");
  const ref = changeRef(env.cwd, path.basename(change));
  const r = await rebuild(env, ref);
  assert.equal(r.ok, false);
  assert.ok(fs.existsSync(path.join(change, "decisions.md")));
  assert.equal(fs.existsSync(path.join(change, "symphysis.html")), false);
  assert.ok(r.report.some((l) => l.startsWith("[!!]")), r.report.join("\n"));
});


// --- номер контракта: ядро настоящее, номер подменяется прямо в его коде (F-08, F-31, F-76, F-78) ---

/** `literal` — значение на Python; `null` — ядро без номера совсем. */
function patchContract(tools: string, literal: string | null) {
  const file = path.join(tools, "journal_render.py");
  const text = fs.readFileSync(file, "utf8");
  const next = literal === null
    ? text.replace(/^ *payload\["contract"\] = CONTRACT\r?\n/m, "")
    : text.replace(/^CONTRACT = 6\r?$/m, `CONTRACT = ${literal}`);
  assert.notEqual(next, text, "код ядра не подменён");
  fs.writeFileSync(file, next, "utf8");
}

test("Номер совпал: журнал показан, отказа нет", opts, async () => {
  const { env, ref } = setup();
  assert.equal(EXPECTED_CONTRACT, 6);
  const r = await viewJson(env, ref);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.payload.contract, EXPECTED_CONTRACT);
});

test("Ядро без номера: просит обновить инструменты", opts, async () => {
  const { env, ref } = setup();
  patchContract(env.tools, null);
  const r = await viewJson(env, ref);
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.failure, { kind: "contract", need: "tools", root: env.cwd });
});

test("Номер ядра ниже: просит обновить инструменты", opts, async () => {
  const { env, ref } = setup();
  patchContract(env.tools, "0");
  const r = await viewJson(env, ref);
  assert.ok(!r.ok && r.failure.kind === "contract" && r.failure.need === "tools");
});

test("Номер ядра выше: просит поставить новый .vsix", opts, async () => {
  const { env, ref } = setup();
  patchContract(env.tools, "99");
  const r = await viewJson(env, ref);
  assert.ok(!r.ok && r.failure.kind === "contract" && r.failure.need === "vsix");
});

for (const literal of ['"1"', "1.5", "None", "-1"]) {
  test(`негодный номер ${literal}: журнал не показан, просит обновить инструменты (F-76)`, opts, async () => {
    const { env, ref } = setup();
    patchContract(env.tools, literal);
    const r = await viewJson(env, ref);
    assert.ok(!r.ok && r.failure.kind === "contract" && r.failure.need === "tools", JSON.stringify(r));
  });
}

test("Два проекта с разными номерами: сверка по проекту журнала, просьба называет проект, второй работает", opts, async () => {
  const stale = setup();
  const fine = setup();
  patchContract(stale.env.tools, "0");
  const a = await viewJson(stale.env, stale.ref);
  const b = await viewJson(fine.env, fine.ref);
  assert.ok(!a.ok && a.failure.kind === "contract" && a.failure.root === stale.env.cwd);
  assert.equal(b.ok, true);
});

test("Вызовы процессов при несовпадении: только чтение журнала, ничего не обновляется (F-106)", opts, async () => {
  const { env, ref } = setup();
  patchContract(env.tools, "99");
  const spy = mock.method(cp, "execFile");
  try {
    const r = await viewJson(env, ref);
    assert.equal(r.ok, false);
    assert.equal(spy.mock.calls.length, 1);
    const args = spy.mock.calls[0].arguments[1] as string[];
    assert.ok(args.includes("view-json"), args.join(" "));
  } finally {
    spy.mock.restore();
  }
});
