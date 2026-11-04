import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tempDir } from "../temp-dir.mjs";
import { coreRoot } from "./fixture-project";
import { appendEvent, deleteDraft, findTools, listChanges, readDraft, saveAnswers, sha256File, writeDraft } from "../../src/host/project";
import { emptyDraft } from "../../src/shared/logic";

const tmp = () => tempDir("symphysis-проект-");

function change(root: string, name: string, files: Record<string, string> = {}): string {
  const dir = path.join(root, "openspec", "changes", name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text, "utf8");
  }
  return dir;
}

test("ядро: установленное важнее tools/ репозитория, нет обоих — null", () => {
  const root = tmp();
  assert.equal(findTools(root), null);
  fs.mkdirSync(path.join(root, "tools"));
  fs.writeFileSync(path.join(root, "tools", "journal.py"), "");
  assert.equal(findTools(root), path.join(root, "tools"));
  fs.mkdirSync(path.join(root, ".symphysis", "tools"), { recursive: true });
  fs.writeFileSync(path.join(root, ".symphysis", "tools", "journal.py"), "");
  assert.equal(findTools(root), path.join(root, ".symphysis", "tools"));
});

test("изменения: по имени, архив не входит, журнала может не быть, атаки перечислены", () => {
  const root = tmp();
  change(root, "б-второе", { "decisions.json": "{}", "attack/decisions.md": "x", "attack/artifacts.md": "y", "attack/заметка.txt": "z" });
  change(root, "а-первое");
  change(root, "archive");
  fs.writeFileSync(path.join(root, "openspec", "changes", "файл.md"), "");
  const list = listChanges(root);
  assert.deepEqual(list.map((c) => c.name), ["а-первое", "б-второе"]);
  assert.equal(list[0].hasJournal, false);
  assert.equal(list[1].hasJournal, true);
  assert.deepEqual(list[1].attacks.map((f) => path.basename(f)), ["artifacts.md", "decisions.md"]);
});

test("нет каталога изменений — пустой список", () => {
  assert.deepEqual(listChanges(tmp()), []);
});

test("ответы: файл на дату, занято — следующий номер, текст как есть", () => {
  const dir = change(tmp(), "x");
  const first = saveAnswers(dir, "2026-11-01", "первый\nтекст");
  const second = saveAnswers(dir, "2026-11-01", "второй");
  const third = saveAnswers(dir, "2026-11-01", "третий");
  assert.equal(path.basename(first), "2026-11-01.md");
  assert.equal(path.basename(second), "2026-11-01-2.md");
  assert.equal(path.basename(third), "2026-11-01-3.md");
  assert.equal(fs.readFileSync(first, "utf8"), "первый\nтекст");
  assert.equal(path.dirname(first), path.join(dir, "answers"));
});

test("хеш файла — по байтам, как у ядра", () => {
  const file = path.join(tmp(), "f");
  fs.writeFileSync(file, Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]));
  assert.equal(sha256File(file), crypto.createHash("sha256").update(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a])).digest("hex"));
});

test("черновик: нет файла — пустой; запись и чтение; каталог сам себя исключает из git", () => {
  const root = tmp();
  assert.deepEqual(readDraft(root, "х"), { draft: emptyDraft(), damaged: null });
  writeDraft(root, "х", { ...emptyDraft(), notes: "заметка" });
  assert.equal(readDraft(root, "х").draft.notes, "заметка");
  assert.equal(fs.readFileSync(path.join(root, ".symphysis", "viewer", ".gitignore"), "utf8"), "*\n");
  assert.deepEqual(fs.readdirSync(path.join(root, ".symphysis", "viewer")).sort(), [".gitignore", "х.json"]);
});

test("черновик: битый файл не затирается — откладывается и называется", () => {
  const root = tmp();
  const dir = path.join(root, ".symphysis", "viewer");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "х.json"), "{ не json", "utf8");
  const r = readDraft(root, "х");
  assert.deepEqual(r.draft, emptyDraft());
  assert.ok(r.damaged);
  assert.equal(fs.readFileSync(r.damaged!, "utf8"), "{ не json");
  assert.equal(fs.existsSync(path.join(dir, "х.json")), false);
});

test("черновик: сброс удаляет файл, отсутствие файла не ошибка", () => {
  const root = tmp();
  writeDraft(root, "х", emptyDraft());
  deleteDraft(root, "х");
  deleteDraft(root, "х");
  assert.equal(fs.existsSync(path.join(root, ".symphysis", "viewer", "х.json")), false);
});


const event = (report: string[]) => ({ change: "х", answers: "openspec/changes/х/answers/2026-11-01.md", sha256_before: "a".repeat(64), sha256_after: "b".repeat(64), report });

test("событие: первая запись создаёт каталог и `.gitignore`, git каталога не видит", () => {
  const root = tmp();
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  appendEvent(root, event(["[ok] F-02: решено A"]));
  const dir = path.join(root, ".symphysis", "viewer");
  assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), "*\n");
  assert.deepEqual(fs.readdirSync(dir).sort(), [".gitignore", "events.jsonl"]);
  assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout, "");
});

test("событие: одна строка JSON с переводом в конце, перевод внутри отчёта её не ломает, вторая дописывается за первой", () => {
  const root = tmp();
  const file = path.join(root, ".symphysis", "viewer", "events.jsonl");
  const first = event(["строка\nс переводом"]);
  appendEvent(root, first);
  const written = fs.readFileSync(file, "utf8");
  assert.equal(written, `${JSON.stringify(first)}\n`);
  assert.equal(written.indexOf("\n"), written.length - 1);
  appendEvent(root, event(["вторая"]));
  const lines = fs.readFileSync(file, "utf8").split("\n");
  assert.equal(lines.length, 3);
  assert.deepEqual(JSON.parse(lines[0]), first);
  assert.deepEqual(JSON.parse(lines[1]).report, ["вторая"]);
  assert.equal(lines[2], "");
});

// --- SYMPHYSIS_ROOT: опечатка в пути не должна выглядеть как «ядра нет» (F-20, F-82) ---

test("Пустая переменная считается незаданной", () => {
  assert.equal(coreRoot({ SYMPHYSIS_ROOT: "" }, "сосед"), "сосед");
  assert.equal(coreRoot({}, "сосед"), "сосед");
  assert.equal(coreRoot({ SYMPHYSIS_ROOT: "мой" }, "сосед"), "мой");
});

test("Опечатка в пути: прогон красный и называет причину, тесты на ядре не пропущены", () => {
  const env: NodeJS.ProcessEnv = { ...process.env, SYMPHYSIS_ROOT: path.join(os.tmpdir(), "нет-такого-ядра") };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", path.join(__dirname, "core.test.js")], { encoding: "utf8", env });
  assert.notEqual(run.status, 0, run.stdout);
  assert.match(run.stdout + run.stderr, /SYMPHYSIS_ROOT/);
});
