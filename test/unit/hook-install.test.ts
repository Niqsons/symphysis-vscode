// Условие установки хука, запись при активации и скрипт из пакета: настоящие файлы, настоящие junction, настоящий поиск Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hookCondition, installClaudeHook, installHookScript, installOpencodeHook, isOwnClaudeHandler, isOwnOpencodeFile, writeProjectFile } from "../../src/host/hook";
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

test("признак схемы: только строка `schema: symphysis`, с кавычками и хвостовым комментарием тоже", () => {
  const root = make(tmp(), "openspec/", "tools/journal.py", ".claude/");
  for (const good of ["schema: symphysis", "schema: symphysis\n", "a: 1\r\nschema: symphysis\r\nb: 2\r\n", "\uFEFFschema: symphysis\n", "schema:  symphysis  \n", "schema: \"symphysis\"\n", "schema: 'symphysis'\r\n", "schema: symphysis # заметка\n", "schema: \"symphysis\"  # заметка\n", "\uFEFFschema: 'symphysis' #\n"]) {
    config(root, good);
    assert.deepEqual(hookCondition(root, PYTHON), met(true, false), JSON.stringify(good));
  }
  for (const bad of ["# schema: symphysis\n", "  schema: symphysis\n", "schema: symphysis-x\n", "schema:\nsymphysis\n", "schema: other symphysis\n", "x-schema: symphysis\n", "", "schema: symphysis#заметка\n", "schema: \"symphysis\n", "schema: symphysis\"\n", "schema: \"symphysis'\n", "schema: \"symphysis-x\"\n", "schema: \"symphysis\"#заметка\n", "schema: symphysis заметка\n"]) {
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

// --- запись Claude Code (F-31, F-48, F-57, F-69, F-77) ---

const PY = PYTHON.ok ? PYTHON.path : "";
// Текст обёртки дословно из проб F-69 и security: копия здесь ловит случайную правку в коде.
const GUARD = "import os,runpy,sys\np=sys.argv[1]\ntry:\n    os.path.isfile(p) and runpy.run_path(p,run_name='__main__')\nexcept BaseException:\n    pass\n";
const handler = (python: string) => ({ type: "command", command: python, args: ["-I", "-X", "utf8", "-c", GUARD, "${CLAUDE_PROJECT_DIR}/.symphysis/viewer/hook.py"], timeout: 5 });
const settingsOf = (root: string) => path.join(root, ".claude", "settings.local.json");
const readSettings = (root: string) => JSON.parse(fs.readFileSync(settingsOf(root), "utf8"));
const writeSettings = (root: string, value: unknown) => fs.writeFileSync(settingsOf(root), JSON.stringify(value), "utf8");
const ownHandlers = (root: string) => readSettings(root).hooks.UserPromptSubmit.flatMap((g: any) => g.hooks).filter(isOwnClaudeHandler);

/** Старое время: перезапись того же содержимого видна по времени изменения. */
function freeze(file: string) {
  const old = new Date("2020-01-02T03:04:05Z");
  fs.utimesSync(file, old, old);
  return { bytes: fs.readFileSync(file), mtime: fs.statSync(file).mtimeMs };
}
function assertUntouched(file: string, was: { bytes: Buffer; mtime: number }) {
  assert.ok(fs.readFileSync(file).equals(was.bytes), "файл изменился");
  assert.equal(fs.statSync(file).mtimeMs, was.mtime, "файл перезаписан");
}

test("«Файла нет»: файл создан, одна запись, отступ два пробела и перевод строки в конце", () => {
  const root = make(tmp(), ".claude/");
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assert.equal(fs.readFileSync(settingsOf(root), "utf8"), `${JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [handler(PY)] }] } }, null, 2)}\n`);
  assert.deepEqual(fs.readdirSync(path.join(root, ".claude")), ["settings.local.json"]);
});

test("«Чужие настройки и хуки»: всё на месте без изменений, запись плагина отдельной группой рядом", () => {
  const root = make(tmp(), ".claude/");
  const foreign = {
    permissions: { allow: ["Bash(git status)"] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "чужой-до-инструмента" }] }],
      UserPromptSubmit: [{ hooks: [{ type: "command", command: "чужой-хук" }] }],
    },
    env: { A: "1" },
  };
  writeSettings(root, foreign);
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assert.deepEqual(readSettings(root), { ...foreign, hooks: { ...foreign.hooks, UserPromptSubmit: [...foreign.hooks.UserPromptSubmit, { hooks: [handler(PY)] }] } });
  assert.deepEqual(Object.keys(readSettings(root)), ["permissions", "hooks", "env"]);
});

test("«Повторная активация»: файл байт в байт прежний и не перезаписан", () => {
  const root = make(tmp(), ".claude/");
  installClaudeHook(root, PY);
  const was = freeze(settingsOf(root));
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assertUntouched(settingsOf(root), was);
});

test("«Повторная активация»: другой порядок полей и другое форматирование человека не повод переписывать", () => {
  const root = make(tmp(), ".claude/");
  const { type, command, args, timeout } = handler(PY);
  fs.writeFileSync(settingsOf(root), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ timeout, args, command, type }] }] } }, null, 4), "utf8");
  const was = freeze(settingsOf(root));
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assertUntouched(settingsOf(root), was);
});

test("«Python переехал»: путь в записи новый, запись одна, чужое на месте", () => {
  const root = make(tmp(), ".claude/");
  writeSettings(root, { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "чужой-хук" }] }, { hooks: [handler("C:\\старый\\python.exe")] }] } });
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assert.deepEqual(ownHandlers(root), [handler(PY)]);
  assert.deepEqual(readSettings(root).hooks.UserPromptSubmit[0], { hooks: [{ type: "command", command: "чужой-хук" }] });
  assert.equal(readSettings(root).hooks.UserPromptSubmit.length, 2);
});

test("«Python переехал»: записи плагина размножились и одна попала в чужую группу, остаётся одна, чужая группа цела", () => {
  const root = make(tmp(), ".claude/");
  const mixed = { matcher: "x", hooks: [{ type: "command", command: "чужой-хук" }, handler("старый-1")] };
  writeSettings(root, { hooks: { UserPromptSubmit: [mixed, { hooks: [handler("старый-2")] }] } });
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assert.deepEqual(readSettings(root).hooks.UserPromptSubmit, [{ matcher: "x", hooks: [{ type: "command", command: "чужой-хук" }] }, { hooks: [handler(PY)] }]);
});

const UNPARSED: [string, string | Buffer][] = [
  ["комментарий", '// заметка человека\n{"permissions": {}}\n'],
  ["обрыв", '{"hooks": '],
  ["только пробелы", "  \n"],
  ["BOM", '\uFEFF{"permissions": {}}'],
  ["не UTF-8: при чтении знаки заменились бы, и перезапись их потеряла", Buffer.concat([Buffer.from('{"заметка": "'), Buffer.from([0xcf, 0xf0, 0xe8]), Buffer.from('"}')])],
  ["верхний уровень список", "[]"],
  ["верхний уровень null", "null"],
  ["верхний уровень строка", '"настройки"'],
  ["hooks список", '{"hooks": []}'],
  ["hooks null", '{"hooks": null}'],
  ["UserPromptSubmit объект", '{"hooks": {"UserPromptSubmit": {}}}'],
  ["UserPromptSubmit null", '{"hooks": {"UserPromptSubmit": null}}'],
];
for (const [name, text] of UNPARSED) {
  test(`«Файл настроек не разбирается»: ${name}, файл байт в байт прежний, записи нет, названы файл и причина`, () => {
    const root = make(tmp(), ".claude/");
    fs.writeFileSync(settingsOf(root), text);
    const was = freeze(settingsOf(root));
    assertRefused(installClaudeHook(root, PY), ".claude/settings.local.json");
    assertUntouched(settingsOf(root), was);
    assert.deepEqual(fs.readdirSync(path.join(root, ".claude")), ["settings.local.json"]);
  });
}

test("«Пустой файл настроек»: считается пустыми настройками, запись плагина в нём", () => {
  const root = make(tmp(), ".claude/settings.local.json");
  assert.equal(fs.statSync(settingsOf(root)).size, 0);
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  assert.deepEqual(readSettings(root), { hooks: { UserPromptSubmit: [{ hooks: [handler(PY)] }] } });
});

test("запись Claude Code идёт через проверку: `.claude` как junction и файл-ссылка, снаружи пусто, причина названа", () => {
  const viaDir = tmp();
  const dirTarget = tmp();
  junction(dirTarget, path.join(viaDir, ".claude"));
  assertRefused(installClaudeHook(viaDir, PY), ".claude");
  assert.deepEqual(fs.readdirSync(dirTarget), []);

  const viaFile = make(tmp(), ".claude/");
  const fileTarget = tmp();
  junction(fileTarget, settingsOf(viaFile));
  assertRefused(installClaudeHook(viaFile, PY), ".claude/settings.local.json это ссылка");
  assert.deepEqual(fs.readdirSync(fileTarget), []);
});

test("своя запись узнаётся по пути скрипта в `args`, и только так", () => {
  assert.equal(isOwnClaudeHandler(handler(PY)), true);
  assert.equal(isOwnClaudeHandler({ type: "command", command: "x", args: ["/другой/корень/.symphysis/viewer/hook.py"] }), true);
  for (const foreign of [
    { type: "command", command: "python ${CLAUDE_PROJECT_DIR}/.symphysis/viewer/hook.py" },
    { type: "command", command: "x", args: ["/.symphysis/viewer/другой.py"] },
    { type: "command", command: "x", args: ["/чужой/каталог/hook.py"] },
    { type: "command", command: "x", args: "/.symphysis/viewer/hook.py" },
    { type: "command", command: "x", args: [1, null] },
    null, "строка", [],
  ]) assert.equal(isOwnClaudeHandler(foreign), false, JSON.stringify(foreign));
});

// --- права файла при перезаписи: новый файл иначе получит их по umask, и `0600` у настроек с токенами станет `0644` ---

const OPENCODE_FILE = (root: string) => path.join(root, ".opencode", "plugins", "symphysis-hook.js");
for (const [name, install, fileOf, tamper] of [
  ["настройки Claude Code", (root: string) => installClaudeHook(root, PY), settingsOf, () => "{}\n"],
  ["файл opencode", (root: string) => installOpencodeHook(root, PY), OPENCODE_FILE, (text: string) => `${text.split("\n")[0]}\nправка\n`],
  ["скрипт", (root: string) => installHookScript(root, EXTENSION), scriptOf, () => "# правка\n"],
] as const) {
  test(`права при перезаписи: ${name}, файл с \`0600\` остаётся с \`0600\` (режим сверяется вне Windows)`, () => {
    const root = tmp();
    const file = fileOf(root);
    assert.deepEqual(install(root), { ok: true });
    const tampered = tamper(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, tampered, "utf8");
    fs.chmodSync(file, 0o600);
    assert.deepEqual(install(root), { ok: true });
    assert.notEqual(fs.readFileSync(file, "utf8"), tampered, "файл не перезаписан, проверять нечего");
    // На Windows `chmod` управляет только признаком «только чтение», режима `0600` там нет.
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
}

test("права при перезаписи: временный файл создан с правами прежнего, на Windows это видно на «только чтение»", () => {
  const root = make(tmp(), ".claude/");
  const file = settingsOf(root);
  fs.writeFileSync(file, "{}\n", "utf8");
  fs.chmodSync(file, 0o444);
  let seen: number | null = null;
  const rename = fs.renameSync;
  // Только наблюдение: файл и переименование настоящие. Иначе в режим временного файла до переименования не заглянуть.
  fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
    seen = fs.statSync(from).mode & 0o777;
    rename(from, to);
  }) as typeof fs.renameSync;
  let r;
  try {
    r = installClaudeHook(root, PY);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(seen, 0o444);
  if (process.platform === "win32") {
    // Windows не даёт заменить файл «только чтение»: отказ значением, файл цел.
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(file, "utf8"), "{}\n");
  } else {
    assert.deepEqual(r, { ok: true });
    assert.equal(fs.statSync(file).mode & 0o777, 0o444);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["settings.local.json"], "временный файл не снят");
});

test("права при перезаписи: новый файл создаётся как обычно", () => {
  const root = make(tmp(), ".claude/");
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  const usual = path.join(root, "обычный файл");
  fs.writeFileSync(usual, "");
  assert.equal(fs.statSync(settingsOf(root)).mode & 0o777, fs.statSync(usual).mode & 0o777);
});

/** `command` и `args` записи как есть, без оболочки: `${CLAUDE_PROJECT_DIR}` подставляет клиент. */
function runRecord(root: string, session = "сессия") {
  const [own] = ownHandlers(root);
  const args = own.args.map((a: string) => a.replace("${CLAUDE_PROJECT_DIR}", root));
  return spawnSync(own.command, args, { input: JSON.stringify({ session_id: session, prompt: "вопрос" }), cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000 });
}
function recordProject(script?: string) {
  const root = make(tmp(), ".claude/");
  assert.deepEqual(installClaudeHook(root, PY), { ok: true });
  if (script !== undefined) {
    make(root, ".symphysis/viewer/hook.py");
    fs.writeFileSync(scriptOf(root), script, "utf8");
  }
  return root;
}

test("запись запущена как есть: «Файла скрипта нет у Claude Code», код 0, вывод пуст", () => {
  const r = runRecord(recordProject());
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
});

test("запись запущена как есть: «Скрипт вышел с кодом 2», код 0, вывод скрипта на месте", () => {
  const r = runRecord(recordProject("import sys\nprint('метка до выхода')\nsys.exit(2)\n"));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /метка до выхода/);
});

test("запись запущена как есть: скрипт упал исключением, код 0", () => {
  const r = runRecord(recordProject("raise ValueError('сбой скрипта')\n"));
  assert.equal(r.status, 0, r.stderr);
});

test("запись запущена как есть: настоящий hook.py через обёртку `runpy` даёт вывод и код 0, путь с пробелом и кириллицей", () => {
  const root = recordProject();
  assert.deepEqual(installHookScript(root, EXTENSION), { ok: true });
  const first = runRecord(root);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, "");
  assert.deepEqual(appendEvent(root, EVENT), { ok: true });
  const second = runRecord(root);
  assert.equal(second.status, 0, second.stderr);
  assert.ok(second.stdout.includes("openspec/changes/х/answers/2026-11-01.md"), second.stdout);
  assert.equal(second.stderr, "");
  assert.equal(runRecord(root).stdout, "");
});

// --- файл opencode (F-49, F-67, F-68, F-69, F-79): подключается через `import()`, `instructions.entry` — заглушка, скрипт настоящий ---

const pluginOf = (root: string) => path.join(root, ".opencode", "plugins", "symphysis-hook.js");

let loads = 0;
/** Файл подключён как у клиента: `setup` с заглушкой, новый `import` на каждый вызов — как новый процесс клиента. */
async function plug(root: string, entry: Partial<Record<"put" | "remove", (a: any) => Promise<void>>> = {}) {
  const calls: [string, any][] = [];
  let prompt: ((event: any) => Promise<void>) | undefined;
  const ctx = {
    session: {
      hook: async (name: string, fn: (event: any) => Promise<void>) => {
        if (name === "prompt") prompt = fn;
      },
      instructions: {
        entry: {
          put: async (a: any) => {
            calls.push(["put", a]);
            await entry.put?.(a);
          },
          remove: async (a: any) => {
            calls.push(["remove", a]);
            await entry.remove?.(a);
          },
        },
      },
    },
  };
  const mod = await import(`${pathToFileURL(pluginOf(root)).href}?${++loads}`);
  await mod.default.setup(ctx);
  assert.ok(prompt, "хук prompt не зарегистрирован");
  return { calls, prompt: prompt! };
}
function pluginProject(python = PY) {
  const root = make(tmp(), ".opencode/");
  assert.deepEqual(installOpencodeHook(root, python), { ok: true });
  assert.deepEqual(installHookScript(root, EXTENSION), { ok: true });
  return root;
}
const REMOVED = (sessionID: string) => ["remove", { sessionID, key: "symphysis" }];

/** Метка берётся из настоящего файла: тест метки в чужой строке иначе проверял бы выдуманную. */
function installedMark(): string {
  const root = make(tmp(), ".opencode/");
  installOpencodeHook(root, "x");
  return fs.readFileSync(pluginOf(root), "utf8").split("\n")[0];
}

test("«Установка»: файл есть, метка в первой строке, `opencode.json` не менялся", async () => {
  const root = make(tmp(), ".opencode/", "opencode.json");
  fs.writeFileSync(path.join(root, "opencode.json"), '{"$schema": "чужой"}\n', "utf8");
  const was = freeze(path.join(root, "opencode.json"));
  assert.deepEqual(installOpencodeHook(root, PY), { ok: true });
  const text = fs.readFileSync(pluginOf(root), "utf8");
  assert.match(text, /^\/\/ .*\n/);
  assert.equal(isOwnOpencodeFile(text), true);
  assertUntouched(path.join(root, "opencode.json"), was);
  await plug(root);
});

test("«Файл совпадает с нужным»: байт в байт прежний и не перезаписан", () => {
  const root = pluginProject();
  const was = freeze(pluginOf(root));
  assert.deepEqual(installOpencodeHook(root, PY), { ok: true });
  assertUntouched(pluginOf(root), was);
});

test("Python переехал: свой файл с другим путём заменён, метка та же", () => {
  const root = pluginProject("C:\\старый\\python.exe");
  assert.deepEqual(installOpencodeHook(root, PY), { ok: true });
  const text = fs.readFileSync(pluginOf(root), "utf8");
  assert.ok(text.includes(JSON.stringify(PY)));
  assert.ok(!text.includes("старый"));
  assert.equal(isOwnOpencodeFile(text), true);
  assert.deepEqual(fs.readdirSync(path.dirname(pluginOf(root))), ["symphysis-hook.js"]);
});

for (const [name, text] of [
  ["свой код человека", () => "export default {};\n"],
  ["метка не в первой строке", () => `\n${installedMark()}\n`],
  ["пустой файл", () => ""],
] as const) {
  test(`«Чужой файл с тем же именем»: ${name}, файл не тронут, причина названа`, () => {
    const root = make(tmp(), ".opencode/plugins/");
    fs.writeFileSync(pluginOf(root), text(), "utf8");
    const was = freeze(pluginOf(root));
    assertRefused(installOpencodeHook(root, PY), ".opencode/plugins/symphysis-hook.js");
    assertUntouched(pluginOf(root), was);
  });
}

test("своя метка: первая строка файла, и перевод строки CRLF её не прячет", () => {
  const mark = installedMark();
  assert.equal(isOwnOpencodeFile(`${mark}\nкод`), true);
  assert.equal(isOwnOpencodeFile(`${mark}\r\nкод`), true);
  assert.equal(isOwnOpencodeFile(mark), true);
  assert.equal(isOwnOpencodeFile(`код\n${mark}\n`), false);
  assert.equal(isOwnOpencodeFile(`${mark} и ещё`), false);
  assert.equal(isOwnOpencodeFile(""), false);
});

test("запись opencode идёт через проверку: `.opencode/plugins` как junction и файл-ссылка, снаружи пусто, причина названа", () => {
  const viaDir = tmp();
  const dirTarget = tmp();
  junction(dirTarget, path.join(viaDir, ".opencode", "plugins"));
  assertRefused(installOpencodeHook(viaDir, PY), ".opencode/plugins");
  assert.deepEqual(fs.readdirSync(dirTarget), []);

  const viaFile = make(tmp(), ".opencode/plugins/");
  const fileTarget = tmp();
  junction(fileTarget, pluginOf(viaFile));
  assertRefused(installOpencodeHook(viaFile, PY), "symphysis-hook.js это ссылка");
  assert.deepEqual(fs.readdirSync(fileTarget), []);
});

test("из окружения в файл идёт только путь к Python, закодированный JSON: кавычка, обратная косая и прочее не ломают разбор", async () => {
  const nasty = 'C:\\стр"анный\\путь\\`${process.exit(9)}\n*/ \u2028 \'\\python.exe';
  const root = make(tmp(), ".opencode/");
  assert.deepEqual(installOpencodeHook(root, nasty), { ok: true });
  const lines = fs.readFileSync(pluginOf(root), "utf8").split("\n");
  const isPython = (l: string) => l.startsWith("const PYTHON = ");
  assert.equal(lines.filter(isPython).length, 1);
  assert.equal(JSON.parse(lines.find(isPython)!.slice("const PYTHON = ".length, -1)), nasty);

  // Остальной текст файла от пути не зависит: подстановка одна.
  const other = make(tmp(), ".opencode/");
  installOpencodeHook(other, "другой");
  const otherLines = fs.readFileSync(pluginOf(other), "utf8").split("\n");
  assert.deepEqual(lines.filter((l) => !isPython(l)), otherLines.filter((l) => !isPython(l)));

  const { calls, prompt } = await plug(root);
  await prompt({ sessionID: "с" });
  assert.deepEqual(calls, [REMOVED("с")]);
});

test("настоящий Python по пути с апострофом и обратной косой: файл разбирается и запускается, событие показано", async () => {
  const link = path.join(tmp(), "стран'ный `каталог` $x");
  junction(path.dirname(PY), link);
  try {
    const root = pluginProject(path.join(link, path.basename(PY)));
    const { calls, prompt } = await plug(root);
    await prompt({ sessionID: "с" });
    appendEvent(root, EVENT);
    await prompt({ sessionID: "с" });
    const [kind, arg] = calls.at(-1)!;
    assert.equal(kind, "put");
    assert.ok(arg.value.includes("openspec/changes/х/answers/2026-11-01.md"), arg.value);
  } finally {
    // Ссылка ведёт в настоящий каталог Python: снимается сразу, общая уборка временных каталогов её не видит.
    fs.unlinkSync(link);
  }
});

test("«Новые события»: запись с ключом `symphysis` несёт событие, слова запроса не изменены", async () => {
  const root = pluginProject();
  const { calls, prompt } = await plug(root);
  const event = { sessionID: "сессия-1", messageID: "m", prompt: { text: "вопрос человека" } };
  await prompt(event);
  assert.deepEqual(calls, [REMOVED("сессия-1")]);
  appendEvent(root, EVENT);
  await prompt(event);
  const [kind, arg] = calls.at(-1)!;
  assert.equal(kind, "put");
  assert.equal(arg.sessionID, "сессия-1");
  assert.equal(arg.key, "symphysis");
  assert.ok(arg.value.includes("openspec/changes/х/answers/2026-11-01.md"), arg.value);
  assert.deepEqual(event, { sessionID: "сессия-1", messageID: "m", prompt: { text: "вопрос человека" } });
});

test("«Новых событий нет»: запись с прошлого обращения снята", async () => {
  const root = pluginProject();
  const { calls, prompt } = await plug(root);
  await prompt({ sessionID: "с" });
  appendEvent(root, EVENT);
  await prompt({ sessionID: "с" });
  assert.equal(calls.at(-1)![0], "put");
  await prompt({ sessionID: "с" });
  assert.deepEqual(calls.at(-1), REMOVED("с"));
});

test("«Та же сессия»: сессия продолжена с тем же номером новым процессом, события в инструкциях нет", async () => {
  const root = pluginProject();
  const first = await plug(root);
  await first.prompt({ sessionID: "с" });
  appendEvent(root, EVENT);
  await first.prompt({ sessionID: "с" });
  assert.equal(first.calls.at(-1)![0], "put");
  const second = await plug(root);
  await second.prompt({ sessionID: "с" });
  assert.deepEqual(second.calls, [REMOVED("с")]);
});

test("путь к скрипту оболочка считает от своего файла: `cwd` процесса другой, скрипт найден", async () => {
  const root = pluginProject();
  const { calls, prompt } = await plug(root);
  const cwd = process.cwd();
  process.chdir(tmp());
  try {
    await prompt({ sessionID: "с" });
    appendEvent(root, EVENT);
    await prompt({ sessionID: "с" });
  } finally {
    process.chdir(cwd);
  }
  assert.equal(calls.at(-1)![0], "put");
});

for (const [name, prepare] of [
  ["файла скрипта нет", (root: string) => fs.unlinkSync(scriptOf(root))],
  ["скрипт вышел с кодом 2", (root: string) => fs.writeFileSync(scriptOf(root), "import sys\nprint('метка')\nsys.exit(2)\n", "utf8")],
  ["скрипт упал", (root: string) => fs.writeFileSync(scriptOf(root), "raise ValueError('сбой')\n", "utf8")],
  ["путь к Python мёртв", (root: string) => assert.deepEqual(installOpencodeHook(root, path.join(root, "нет такого", "python.exe")), { ok: true })],
] as const) {
  test(`«Сбой в оболочке opencode»: ${name}, запрос не останавливается, запись снята`, async () => {
    const root = pluginProject();
    prepare(root);
    const { calls, prompt } = await plug(root);
    await prompt({ sessionID: "с" });
    assert.deepEqual(calls, [REMOVED("с")]);
  });
}

test("«Сбой в оболочке opencode»: скрипт завис, предел вызова 5 с, запрос идёт дальше, запись снята", async () => {
  const root = pluginProject();
  fs.writeFileSync(scriptOf(root), "import time\ntime.sleep(60)\n", "utf8");
  const { calls, prompt } = await plug(root);
  const t0 = Date.now();
  await prompt({ sessionID: "с" });
  const ms = Date.now() - t0;
  assert.ok(ms >= 4500 && ms < 9000, `вызов шёл ${ms} мс`);
  assert.deepEqual(calls, [REMOVED("с")]);
});

test("«Сбой в оболочке opencode»: `put` бросает, запрос не останавливается, запись снимается", async () => {
  const root = pluginProject();
  const { calls, prompt } = await plug(root, { put: async () => { throw new Error("сбой put"); } });
  await prompt({ sessionID: "с" });
  appendEvent(root, EVENT);
  await prompt({ sessionID: "с" });
  assert.deepEqual(calls.at(-1), REMOVED("с"));
});

test("«Сбой в оболочке opencode»: бросают и `put`, и `remove`, запрос всё равно не останавливается", async () => {
  const root = pluginProject();
  const fail = async () => { throw new Error("сбой"); };
  const { prompt } = await plug(root, { put: fail, remove: fail });
  await prompt({ sessionID: "с" });
  appendEvent(root, EVENT);
  await prompt({ sessionID: "с" });
  await prompt(undefined);
});

test("«Сбой в оболочке opencode»: регистрация хука бросает, `setup` не падает", async () => {
  const root = pluginProject();
  const mod = await import(`${pathToFileURL(pluginOf(root)).href}?${++loads}`);
  await mod.default.setup({ session: { hook: async () => { throw new Error("сбой hook"); } } });
  await mod.default.setup({});
});
