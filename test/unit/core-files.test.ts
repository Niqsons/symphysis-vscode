// Список установки в тестах плагина держится один с ядром: новый модуль ядра без строки здесь — копия ядра не запускается (B-42).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { coreSource, DOCS_FILES, installCore, TOOLS_FILES } from "../core-files.mjs";
import { tempDir } from "../temp-dir.mjs";
import { noCoreReason, SYMPHYSIS } from "./fixture-project";

/** Строки массива `const <name> = [...]` из `installer/scripts/sync-payload.js` ядра. */
function payloadList(name: string): string[] {
  const text = fs.readFileSync(path.join(SYMPHYSIS, "installer", "scripts", "sync-payload.js"), "utf8");
  const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(text);
  assert.ok(body, `в sync-payload.js нет массива ${name}`);
  return [...body[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

test("Список файлов ядра: TOOLS_FILES тестов плагина равен TOOLS_FILES установки ядра", { skip: noCoreReason }, () => {
  assert.deepEqual([...TOOLS_FILES].sort(), payloadList("TOOLS_FILES").sort());
});

test("Список файлов ядра: DOCS_FILES тестов плагина равен SHARED_FILES установки ядра", { skip: noCoreReason }, () => {
  assert.deepEqual([...DOCS_FILES].sort(), payloadList("SHARED_FILES").sort());
});

test("контрактный стенд отказывает на исходнике за границей выбранного ядра", () => {
  const core = tempDir("symphysis-core-confined-");
  const external = tempDir("symphysis-core-external-");
  const project = tempDir("symphysis-core-fixture-");
  fs.writeFileSync(path.join(external, "journal.py"), "outside");
  fs.symlinkSync(external, path.join(core, "cli"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => coreSource(core, "journal.py"), /вне выбранного дерева/);
  assert.throws(() => installCore(core, project), /вне выбранного дерева/);
  assert.deepEqual(fs.readdirSync(project), []);
});
