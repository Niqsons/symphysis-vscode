// Условие установки хука, запись при активации и скрипт из пакета: настоящие файлы, настоящие junction, настоящий поиск Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hookCondition, installHookScript, writeProjectFile } from "../../src/host/hook";
import { appendEvent } from "../../src/host/project";
import { resolvePython } from "../../src/host/python";
import { tempDir } from "../temp-dir.mjs";

const tmp = () => tempDir("хук установка ");
const PYTHON = resolvePython(process.env, []);
const NO_PYTHON = resolvePython({ PATH: "" }, []);
const INSTALLED = ".symphysis/tools/journal.py";

/** Запись с `/` на конце — каталог, остальное — пустой файл. */
function make(root: string, ...entries: string[]): string {
  for (const e of entries) {
    const full = path.join(root, e);
    fs.mkdirSync(e.endsWith("/") ? full : path.dirname(full), { recursive: true });
    if (!e.endsWith("/")) fs.writeFileSync(full, "");
  }
  return root;
}
const config = (root: string, text: string) => fs.writeFileSync(path.join(root, "openspec", "config.yaml"), text, "utf8");
const met = (claude: boolean, opencode: boolean) => ({ met: true, python: PYTHON.ok ? PYTHON.path : "", claude, opencode });
const NOT_MET = { met: false };

// --- условие по папке (F-60, F-65, F-75, F-98) ---

test("«Проект с журналом и следом Claude Code»: Claude Code да, opencode нет", () => {
  const root = make(tmp(), "openspec/", INSTALLED, ".claude/");
  assert.deepEqual(hookCondition(root, PYTHON), met(true, false));
});

for (const trace of [".opencode/", "opencode.json", "opencode.jsonc"]) {
  test(`«Оба следа»: \`.claude/\` и ${trace}, условие говорит про обоих клиентов`, () => {
    const root = make(tmp(), "openspec/", INSTALLED, ".claude/", trace);
    assert.deepEqual(hookCondition(root, PYTHON), met(true, true));
  });

  test(`след только opencode: ${trace} без \`.claude/\``, () => {
    const root = make(tmp(), "openspec/", INSTALLED, trace);
    assert.deepEqual(hookCondition(root, PYTHON), met(false, true));
  });
}

test("«Нет следа клиента»: условие не выполнено, причину называть незачем", () => {
  assert.deepEqual(hookCondition(make(tmp(), "openspec/", INSTALLED), PYTHON), NOT_MET);
  assert.deepEqual(hookCondition(make(tmp(), "openspec/", INSTALLED, ".claude", ".opencode", "opencode.json/", "opencode.jsonc/"), PYTHON), NOT_MET, "файл вместо каталога и каталог вместо файла следом не считаются");
});

test("«Проект без `openspec/`»: настройка задана, след есть, условие не выполнено", () => {
  const install = make(tmp(), "journal.py");
  assert.deepEqual(hookCondition(make(tmp(), ".claude/"), PYTHON, install), NOT_MET);
  assert.deepEqual(hookCondition(make(tmp(), ".claude/", INSTALLED), PYTHON), NOT_MET);
  assert.deepEqual(hookCondition(make(tmp(), ".claude/", "openspec", INSTALLED), PYTHON), NOT_MET, "файл с именем openspec не каталог");
});

for (const layout of [".symphysis/tools/journal.py", "tools/journal.py", "journal.py"]) {
  test(`«Инструменты по настройке»: каталог установки с ${layout}, схема symphysis в проекте`, () => {
    const root = make(tmp(), "openspec/", ".claude/");
    config(root, "schema: symphysis\n");
    assert.deepEqual(hookCondition(root, PYTHON, make(tmp(), layout)), met(true, false));
  });
}

test("«Инструменты по настройке»: настройка мимо инструментов и относительный путь инструментами не считаются", () => {
  const root = make(tmp(), "openspec/", ".claude/");
  config(root, "schema: symphysis\n");
  assert.deepEqual(hookCondition(root, PYTHON, tmp()), NOT_MET);
  assert.deepEqual(hookCondition(root, PYTHON, path.join(tmp(), "нет-такого")), NOT_MET);
  // Относительный путь нашёл бы инструменты от текущего каталога, а настройка требует абсолютный.
  const install = make(tmp(), "journal.py");
  const cwd = process.cwd();
  process.chdir(path.dirname(install));
  try {
    assert.deepEqual(hookCondition(root, PYTHON, path.basename(install)), NOT_MET);
  } finally {
    process.chdir(cwd);
  }
});

test("«Python не найден»: условие не выполнено, причина та, что дал поиск Python", () => {
  assert.equal(NO_PYTHON.ok, false);
  const root = make(tmp(), "openspec/", INSTALLED, ".claude/");
  assert.deepEqual(hookCondition(root, NO_PYTHON), { met: false, reason: NO_PYTHON.ok ? "" : NO_PYTHON.reason });
});

test("Python не найден в чужом проекте: причины нет, там хук и так не нужен", () => {
  assert.deepEqual(hookCondition(make(tmp(), "openspec/", INSTALLED), NO_PYTHON), NOT_MET);
  assert.deepEqual(hookCondition(make(tmp(), ".claude/"), NO_PYTHON), NOT_MET);
});

test("«Две папки в рабочей области»: условие выполнено только у одной", () => {
  const first = make(tmp(), "openspec/", INSTALLED, ".claude/");
  const second = make(tmp(), "openspec/");
  assert.deepEqual(hookCondition(first, PYTHON), met(true, false));
  assert.deepEqual(hookCondition(second, PYTHON), NOT_MET);
});

test("«Проект на обычном OpenSpec»: инструменты только по настройке, схемы symphysis нет", () => {
  const install = make(tmp(), "journal.py");
  const noFile = make(tmp(), "openspec/", ".claude/");
  assert.deepEqual(hookCondition(noFile, PYTHON, install), NOT_MET);
  const other = make(tmp(), "openspec/", ".claude/");
  config(other, "schema: spec-driven\n");
  assert.deepEqual(hookCondition(other, PYTHON, install), NOT_MET);
});

test("«Чужой `tools/journal.py`»: без схемы symphysis это не инструменты, со схемой инструменты", () => {
  const root = make(tmp(), "openspec/", "tools/journal.py", ".claude/");
  assert.deepEqual(hookCondition(root, PYTHON), NOT_MET);
  config(root, "schema: spec-driven\n");
  assert.deepEqual(hookCondition(root, PYTHON), NOT_MET);
  config(root, "schema: symphysis\n");
  assert.deepEqual(hookCondition(root, PYTHON), met(true, false));
});

test("признак схемы: только строка `schema: symphysis`", () => {
  const root = make(tmp(), "openspec/", "tools/journal.py", ".claude/");
  for (const good of ["schema: symphysis", "schema: symphysis\n", "a: 1\r\nschema: symphysis\r\nb: 2\r\n", "﻿schema: symphysis\n", "schema:  symphysis  \n"]) {
    config(root, good);
    assert.deepEqual(hookCondition(root, PYTHON), met(true, false), JSON.stringify(good));
  }
  for (const bad of ["# schema: symphysis\n", "  schema: symphysis\n", "schema: symphysis-x\n", "schema:\nsymphysis\n", "schema: other symphysis\n", "x-schema: symphysis\n", ""]) {
    config(root, bad);
    assert.deepEqual(hookCondition(root, PYTHON), NOT_MET, JSON.stringify(bad));
  }
  fs.unlinkSync(path.join(root, "openspec", "config.yaml"));
  fs.mkdirSync(path.join(root, "openspec", "config.yaml"));
  assert.deepEqual(hookCondition(root, PYTHON), NOT_MET, "каталог вместо файла");
});

// --- запись при активации: наружу через ссылку не идём (`security.md`, «Пути с `../` и символические ссылки») ---

function junction(target: string, link: string) {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(target, link, "junction");
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, "lstat видит junction как ссылку");
}

function assertRefused(r: { ok: boolean; reason?: string }, names: string) {
  assert.equal(r.ok, false);
  assert.ok(r.reason?.includes(names), r.reason);
}

for (const [dir, file] of [[".claude", "settings.local.json"], [".opencode/plugins", "symphysis-hook.js"], [".symphysis/viewer", "hook.py"]]) {
  test(`\`${dir}\` как junction на временный каталог: там файла не появилось, причина названа`, () => {
    const root = tmp();
    const target = tmp();
    junction(target, path.join(root, dir));
    assertRefused(writeProjectFile(root, path.join(root, dir, file), "данные"), dir);
    assert.deepEqual(fs.readdirSync(target), []);
  });
}

for (const [dir, file] of [[".opencode", "plugins/symphysis-hook.js"], [".symphysis", "viewer/hook.py"]]) {
  test(`\`${dir}\` как junction, вложенного каталога ещё нет: проверяется ближайший существующий предок`, () => {
    const root = tmp();
    const target = tmp();
    junction(target, path.join(root, dir));
    assertRefused(writeProjectFile(root, path.join(root, dir, file), "данные"), dir);
    assert.deepEqual(fs.readdirSync(target), []);
  });
}

test("`.claude` как junction остаётся следом клиента: иначе отказ записи некому было бы назвать", () => {
  const root = make(tmp(), "openspec/", INSTALLED);
  junction(tmp(), path.join(root, ".claude"));
  assert.deepEqual(hookCondition(root, PYTHON), met(true, false));
});

test("сам файл назначения ссылка: отказ, ссылка на месте, снаружи пусто", () => {
  const root = make(tmp(), ".claude/");
  const target = tmp();
  const file = path.join(root, ".claude", "settings.local.json");
  junction(target, file);
  assertRefused(writeProjectFile(root, file, "данные"), ".claude/settings.local.json");
  assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(target), []);
});

test("ссылка в никуда: отказ значением, а не исключением", () => {
  const root = tmp();
  const target = path.join(tmp(), "снаружи");
  fs.mkdirSync(target);
  junction(target, path.join(root, ".claude"));
  fs.rmdirSync(target);
  assertRefused(writeProjectFile(root, path.join(root, ".claude", "settings.local.json"), "данные"), "не проверить, куда ведёт путь");
  assert.equal(fs.existsSync(target), false);
});

test("путь с `../`: отказ, снаружи файла нет", () => {
  const parent = tmp();
  const root = make(parent, "проект/");
  const project = path.join(root, "проект");
  assertRefused(writeProjectFile(project, path.join(project, "..", "снаружи", "файл"), "данные"), "за пределы проекта");
  assert.deepEqual(fs.readdirSync(parent), ["проект"]);
});

test("запись: каталог создан, файл целиком, прежний заменён, временного файла нет", () => {
  const root = tmp();
  const file = path.join(root, ".opencode", "plugins", "symphysis-hook.js");
  assert.deepEqual(writeProjectFile(root, file, "первый"), { ok: true });
  assert.equal(fs.readFileSync(file, "utf8"), "первый");
  assert.deepEqual(writeProjectFile(root, file, "второй"), { ok: true });
  assert.equal(fs.readFileSync(file, "utf8"), "второй");
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["symphysis-hook.js"]);
});

test("запись: сбой идёт значением с причиной, временного файла не остаётся", () => {
  const root = make(tmp(), ".claude/settings.local.json/занято");
  const r = writeProjectFile(root, path.join(root, ".claude", "settings.local.json"), "данные");
  assert.equal(r.ok, false);
  assert.deepEqual(fs.readdirSync(path.join(root, ".claude")), ["settings.local.json"]);
  assert.deepEqual(fs.readdirSync(path.join(root, ".claude", "settings.local.json")), ["занято"]);
});

test("запись: чужой файл с именем временного не затирается", () => {
  const root = make(tmp(), ".claude/");
  const file = path.join(root, ".claude", "settings.local.json");
  fs.writeFileSync(`${file}.${process.pid}.tmp`, "чужое", "utf8");
  assert.equal(writeProjectFile(root, file, "данные").ok, false);
  assert.equal(fs.readFileSync(`${file}.${process.pid}.tmp`, "utf8"), "чужое");
  assert.equal(fs.existsSync(file), false);
});

test("корень проекта сам ссылка: запись внутри него разрешена", () => {
  const real = tmp();
  const link = path.join(tmp(), "ссылка на проект");
  junction(real, link);
  assert.deepEqual(writeProjectFile(link, path.join(link, ".claude", "settings.local.json"), "данные"), { ok: true });
  assert.equal(fs.readFileSync(path.join(real, ".claude", "settings.local.json"), "utf8"), "данные");
});

test("ссылка внутри проекта на каталог этого же проекта: запись разрешена", () => {
  const root = make(tmp(), "настройки/");
  junction(path.join(root, "настройки"), path.join(root, ".claude"));
  assert.deepEqual(writeProjectFile(root, path.join(root, ".claude", "settings.local.json"), "данные"), { ok: true });
  assert.equal(fs.readFileSync(path.join(root, "настройки", "settings.local.json"), "utf8"), "данные");
});

const EVENT = { change: "х", answers: "openspec/changes/х/answers/2026-11-01.md", sha256_before: "a".repeat(64), sha256_after: "b".repeat(64), report: [] };

test("запись события: `.symphysis/viewer` как junction, снаружи пусто, даже `.gitignore` нет, причина названа", () => {
  const root = tmp();
  const target = tmp();
  junction(target, path.join(root, ".symphysis", "viewer"));
  assertRefused(appendEvent(root, EVENT), ".symphysis/viewer");
  assert.deepEqual(fs.readdirSync(target), []);
});

test("запись события: сам `events.jsonl` ссылка, отказ", () => {
  const root = tmp();
  const target = tmp();
  junction(target, path.join(root, ".symphysis", "viewer", "events.jsonl"));
  assertRefused(appendEvent(root, EVENT), "events.jsonl");
  assert.deepEqual(fs.readdirSync(target), []);
});

test("запись события: обычный случай и сбой записи идут значением", () => {
  const root = tmp();
  assert.deepEqual(appendEvent(root, EVENT), { ok: true });
  const blocked = make(tmp(), ".symphysis/viewer/events.jsonl/");
  assert.equal(appendEvent(blocked, EVENT).ok, false);
});

// --- скрипт из пакета (F-31, F-63): корень репозитория устроен как установленное расширение, `hook/hook.py` рядом с `out/` ---

const EXTENSION = path.resolve(".");
const PACKAGED = fs.readFileSync(path.join(EXTENSION, "hook", "hook.py"));
const scriptOf = (root: string) => path.join(root, ".symphysis", "viewer", "hook.py");

test("«Скрипта нет»: файл появился и совпадает с пакетным, каталог исключает себя из git", () => {
  const root = tmp();
  assert.deepEqual(installHookScript(root, EXTENSION), { ok: true });
  assert.ok(fs.readFileSync(scriptOf(root)).equals(PACKAGED));
  assert.equal(fs.readFileSync(path.join(root, ".symphysis", "viewer", ".gitignore"), "utf8"), "*\n");
  assert.deepEqual(fs.readdirSync(path.dirname(scriptOf(root))).sort(), [".gitignore", "hook.py"]);
});

test("«Файл подменён»: другая длина и та же длина с другим байтом, файл заменён пакетным", () => {
  const root = tmp();
  installHookScript(root, EXTENSION);
  fs.writeFileSync(scriptOf(root), "print('чужой код')\n", "utf8");
  assert.deepEqual(installHookScript(root, EXTENSION), { ok: true });
  assert.ok(fs.readFileSync(scriptOf(root)).equals(PACKAGED));

  const sameLength = Buffer.from(PACKAGED);
  sameLength[0] ^= 0xff;
  fs.writeFileSync(scriptOf(root), sameLength);
  assert.deepEqual(installHookScript(root, EXTENSION), { ok: true });
  assert.ok(fs.readFileSync(scriptOf(root)).equals(PACKAGED));
  assert.deepEqual(fs.readdirSync(path.dirname(scriptOf(root))).sort(), [".gitignore", "hook.py"]);
});

test("«Файл совпадает»: время изменения прежнее", () => {
  const root = tmp();
  installHookScript(root, EXTENSION);
  const old = new Date("2020-01-02T03:04:05Z");
  fs.utimesSync(scriptOf(root), old, old);
  const before = fs.statSync(scriptOf(root)).mtimeMs;
  assert.deepEqual(installHookScript(root, EXTENSION), { ok: true });
  assert.equal(fs.statSync(scriptOf(root)).mtimeMs, before);
});

test("скрипт: `.symphysis/viewer` как junction, снаружи пусто, даже `.gitignore` нет, причина названа", () => {
  const root = tmp();
  const target = tmp();
  junction(target, path.join(root, ".symphysis", "viewer"));
  assertRefused(installHookScript(root, EXTENSION), ".symphysis/viewer");
  assert.deepEqual(fs.readdirSync(target), []);
});

test("скрипт: сам файл ссылка, отказ, ссылка на месте", () => {
  const root = tmp();
  const target = tmp();
  junction(target, scriptOf(root));
  assertRefused(installHookScript(root, EXTENSION), "hook.py");
  assert.equal(fs.lstatSync(scriptOf(root)).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(target), []);
});

test("скрипт и событие: `.gitignore` как ссылка в никуда, отказ: `viewerDir` записал бы через неё наружу", () => {
  const root = tmp();
  const gone = path.join(tmp(), "снаружи");
  fs.mkdirSync(gone);
  junction(gone, path.join(root, ".symphysis", "viewer", ".gitignore"));
  fs.rmdirSync(gone);
  // Текст отказа, а не только имя: сбой записи через эту ссылку назвал бы то же имя, а на POSIX запись и вовсе прошла бы наружу.
  assertRefused(installHookScript(root, EXTENSION), ".symphysis/viewer/.gitignore это ссылка");
  assertRefused(appendEvent(root, EVENT), ".symphysis/viewer/.gitignore это ссылка");
  assert.equal(fs.existsSync(gone), false);
});

test("скрипт: в пакете файла нет, отказ значением, в проекте ничего не появилось", () => {
  const root = tmp();
  assert.equal(installHookScript(root, tmp()).ok, false);
  assert.deepEqual(fs.readdirSync(root), []);
});
