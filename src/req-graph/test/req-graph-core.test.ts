import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { tempDir } from "../../../test/temp-dir.mjs";
import * as core from "../graphCore";
import { initialSelection } from "../graph";

test("req-graph ошибка, timeout и maxBuffer отказывают даже при JSON в stdout", async () => {
  assert.equal(typeof core.requestGraph, "function");
  for (const failure of [{ code: 1 }, { timedOut: true }, { overflow: true }]) {
    const run = async () => ({ code: 0, timedOut: false, overflow: false, stdout: "{}", stderr: "sensitive marker", ms: 1, ...failure });
    await assert.rejects(core.requestGraph({ python: "python", tools: "tools", cwd: "root" },
      { root: "root", change: "demo" }, initialSelection(), run), (error: Error) => !error.message.includes("sensitive marker"));
  }
});

test("req-graph фильтры и путь снимка передаются отдельными аргументами", async () => {
  let observed: string[] = [];
  const run = async (_python: string, args: string[]) => {
    observed = args;
    return { code: 0, timedOut: false, overflow: false, stdout: "{}", stderr: "", ms: 1 };
  };
  await assert.rejects(core.requestGraph({ python: "python", tools: "tools", cwd: "root" },
    { root: "root", change: "demo", snapshot: 'путь с "кавычкой".json' },
    { capability: 'cap "two"', requirement: null, module: "repo/module", linked_only: true }, run));
  assert.deepEqual(observed.slice(1), ["view", "demo", "--snapshot", 'путь с "кавычкой".json',
    "--capability", 'cap "two"', "--module", "repo/module", "--linked-only"]);
});

test("req-graph исчезнувшее требование явно названо недоступным", async () => {
  const run = async () => ({ code: 1, timedOut: false, overflow: false, stdout: "",
    stderr: "требования «a/R» в изменении нет; известные: secret marker", ms: 1 });
  await assert.rejects(core.requestGraph({ python: "python", tools: "tools", cwd: "root" },
    { root: "root", change: "demo" }, { ...initialSelection(), requirement: "req:a/R" }, run),
    (error: Error) => /req:a\/R.*недоступно/.test(error.message) && !error.message.includes("secret marker"));
});

test("req-graph файловая цель проверяет настоящий корень перед каждым открытием", () => {
  assert.equal(typeof core.resolveGraphTarget, "function");
  const work = tempDir("req-graph-target-");
  const allowed = path.join(work, "allowed");
  const outside = path.join(work, "outside");
  fs.mkdirSync(allowed); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(allowed, "a.md"), "target");
  fs.writeFileSync(path.join(outside, "a.md"), "outside");
  const link = path.join(allowed, "link");
  fs.symlinkSync(allowed, link, process.platform === "win32" ? "junction" : "dir");
  const target = { file: path.join(link, "a.md"), root: allowed, line: 1, journal: false };
  assert.equal(core.resolveGraphTarget(target), fs.realpathSync(path.join(allowed, "a.md")));
  fs.rmdirSync(link);
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  assert.equal(core.resolveGraphTarget(target), null);
  assert.equal(core.resolveGraphTarget({ ...target, file: path.join(outside, "a.md") }), null);
});
