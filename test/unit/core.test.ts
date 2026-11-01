// Ядро настоящее: `journal.py` из соседнего репозитория, скопированный в проект с кириллицей и пробелами в пути.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { applyAnswers, rebuild, viewJson } from "../../src/host/core";
import { changeRef, sha256File } from "../../src/host/project";
import { addAttack, makeProject, noCoreReason } from "./fixture-project";

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

test("пересборка: decisions.md и decisions.html записаны, отчёт собран", opts, async () => {
  const { env, ref, change } = setup();
  const r = await rebuild(env, ref);
  assert.equal(r.ok, true, r.report.join("\n"));
  assert.ok(fs.existsSync(path.join(change, "decisions.md")));
  assert.ok(fs.existsSync(path.join(change, "decisions.html")));
  assert.ok(r.report.some((l) => l.includes("цитаты нет дословно")), r.report.join("\n"));
});

test("пересборка: битый файл атаки — страница не собрана, отказ в отчёте, остальное записано", opts, async () => {
  const { env, change } = setup();
  addAttack(change, "decisions.md", "не файл атаки");
  const ref = changeRef(env.cwd, path.basename(change));
  const r = await rebuild(env, ref);
  assert.equal(r.ok, false);
  assert.ok(fs.existsSync(path.join(change, "decisions.md")));
  assert.equal(fs.existsSync(path.join(change, "decisions.html")), false);
  assert.ok(r.report.some((l) => l.startsWith("[!!]")), r.report.join("\n"));
});
