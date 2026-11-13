import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tempDir } from "../temp-dir.mjs";

const ROOT = path.resolve(__dirname, "..", "..");

function fixture() {
  const root = tempDir("symphysis-selected-build-");
  fs.copyFileSync(path.join(ROOT, "build.mjs"), path.join(root, "build.mjs"));
  fs.mkdirSync(path.join(root, "test"));
  fs.copyFileSync(path.join(ROOT, "test/worktree-paths.mjs"), path.join(root, "test/worktree-paths.mjs"));
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(root, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  for (const name of ["a", "b", "hook"]) fs.mkdirSync(path.join(root, "src", name, "test"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "hook", "hook.py"), "");
  fs.writeFileSync(path.join(root, "src", "a", "test", "тест с пробелом.test.ts"), "export const a = 1;");
  fs.writeFileSync(path.join(root, "src", "b", "test", "other.test.ts"), "export const b = 2;");
  return root;
}

const entry = "src/a/test/тест с пробелом.test.ts";
const build = (root: string, ...inputs: string[]) =>
  spawnSync(process.execPath, ["build.mjs", "--unit", "--", ...inputs], { cwd: root, encoding: "utf8", timeout: 30000 });

test("сборка по списку выпускает только выбранный тест", () => {
  const root = fixture();
  const result = build(root, entry);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(path.join(root, "out", "test")), ["тест с пробелом.test.js"]);
});

test("исчезнувший выбранный вход отказывает с именем теста", () => {
  const root = fixture();
  const missing = "src/b/test/other.test.ts";
  fs.unlinkSync(path.join(root, missing));
  const result = build(root, entry, missing);
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes(missing), result.stderr);
});

test("адресная сборка сохраняет диагностику коллизии имён", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "src", "b", "test", "тест с пробелом.test.ts"), "");
  const result = build(root, "src/b/test/other.test.ts");
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes("в двух местах"), result.stderr);
});

test("адресная сборка отказывает на каталоге входов или выходов, который ведёт наружу", () => {
  const foreign = tempDir("symphysis-foreign-build-");
  const marker = path.join(foreign, "тест с пробелом.test.ts");
  fs.writeFileSync(marker, "outside");
  for (const name of ["src/b/test", "out"]) {
    const root = fixture();
    const alias = path.join(root, name);
    fs.rmSync(alias, { recursive: true, force: true });
    fs.symlinkSync(foreign, alias, process.platform === "win32" ? "junction" : "dir");
    const result = build(root, entry);
    assert.notEqual(result.status, 0, result.stdout);
    assert.ok(result.stderr.includes("Ссылка в пути сборки"), result.stderr);
    assert.equal(fs.readFileSync(marker, "utf8"), "outside");
    assert.equal(fs.existsSync(path.join(foreign, "test")), false);
  }
});

test("сборка e2e отказывает до записи через ссылку media", () => {
  const root = fixture();
  const foreign = tempDir("symphysis-foreign-media-");
  fs.writeFileSync(path.join(foreign, "mermaid.min.js"), "outside");
  fs.symlinkSync(foreign, path.join(root, "media"), process.platform === "win32" ? "junction" : "dir");
  const result = spawnSync(process.execPath, ["build.mjs", "--tests"], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes("Ссылка в пути сборки"), result.stderr);
  assert.equal(fs.readFileSync(path.join(foreign, "mermaid.min.js"), "utf8"), "outside");
  assert.equal(fs.existsSync(path.join(root, "out")), false);
});

test("сквозной сценарий отказывает до запуска на файле вне дерева", () => {
  const root = fixture();
  const foreign = tempDir("symphysis-foreign-e2e-");
  fs.mkdirSync(path.join(root, "out", "e2e"), { recursive: true });
  fs.mkdirSync(path.join(root, "test", "e2e"), { recursive: true });
  for (const name of ["req-graph.mjs", "paths.mjs"]) {
    fs.copyFileSync(path.join(ROOT, "test/e2e", name), path.join(root, "test/e2e", name));
  }
  fs.copyFileSync(path.join(ROOT, "test/temp-dir.mjs"), path.join(root, "test/temp-dir.mjs"));
  fs.writeFileSync(path.join(root, "test/e2e/harness.mjs"),
    "export const repo=process.cwd(), cleanEnv=0, CODE=0, finish=0, projectWithTools=0, report=0, SYMPHYSIS=0;");
  const marker = path.join(foreign, "keep");
  fs.writeFileSync(marker, "outside");
  const output = path.join(root, "out/e2e/req-graph-scenario.js");
  if (process.platform === "win32") fs.symlinkSync(foreign, output, "junction");
  else fs.symlinkSync(marker, output, "file");
  const result = spawnSync(process.execPath, ["test/e2e/req-graph.mjs"], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Ссылка.*out\/e2e\/req-graph-scenario\.js/);
  assert.equal(fs.readFileSync(marker, "utf8"), "outside");
});

test("упаковка отказывает до vsce при ссылке в вычисленном выходе", () => {
  const root = fixture();
  const foreign = tempDir("symphysis-foreign-vsix-");
  fs.writeFileSync(path.join(foreign, "keep"), "outside");
  fs.copyFileSync(path.join(ROOT, "package.mjs"), path.join(root, "package.mjs"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }));
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "fixture");
  const filename = `demo-1.0.0+${git("rev-parse", "--short", "HEAD")}.dirty.vsix`;
  fs.symlinkSync(foreign, path.join(root, filename), process.platform === "win32" ? "junction" : "dir");
  const result = spawnSync(process.execPath, ["package.mjs"], { cwd: root, encoding: "utf8", timeout: 30000 });
  assert.notEqual(result.status, 0, result.stdout);
  assert.ok(result.stderr.includes(`Ссылка в пути сборки или тестов: ${filename}`), result.stderr);
  assert.deepEqual(fs.readdirSync(foreign), ["keep"]);
});
