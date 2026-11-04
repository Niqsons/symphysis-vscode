// Хук на настоящих клиентах: `claude -p` и `opencode run` из каталога с пробелом и кириллицей. Файлы ставит код плагина (out/e2e/hook.cjs).
// Вне `npm test`: каждый запрос идёт к модели, наружу уходит только тестовый вопрос и служебные строки с тестовыми метками.
// Образец: probes/security-probe.py изменения step-help-tab. След пишется без абсолютных путей.
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "../temp-dir.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { installHookScript, installClaudeHook, installOpencodeHook } = require(path.join(repo, "out", "e2e", "hook.cjs"));
const { resolvePython } = require(path.join(repo, "out", "e2e", "python.cjs"));

const CLAUDE_MODEL = "haiku";
const OC_MODEL = "ollama-cloud/deepseek-v4.1-flash";
const EVENT = "КАЛИНА-6161";
const SCHEME = "РЯБИНА-7272";
const FOREIGN = "ЧУЖОЙ-5151";
const CLAUDE_QUESTION = "Перечисли имена изменений из служебных сообщений в твоём контексте (о внесённых решениях и о правке scheme.md) и служебные метки вида «Служебная метка: …». Только имена и метки. Если ничего нет, ответь словом НЕТ.";
const OC_QUESTION = "Есть ли в твоём контексте служебное сообщение о решениях, которые человек внёс кнопкой в журнал? Если есть, ответь только именем изменения из него. Если нет, ответь словом НЕТ.";
const MARK = "// symphysis-vscode: хук opencode, файл пишет и заменяет плагин, не правь";

const work = tempDir("symphysis hook клиенты ");
const log = [];
const tests = [];
const sessionsToClean = [];

// PWD и INIT_CWD: оболочка и npm оставляют в них каталог запуска, и opencode принимает его за каталог проекта вместо cwd.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDE|ELECTRON_|VSCODE_)/i.test(k) && !["NoDefaultCurrentDirectoryInExePath", "PYTHONIOENCODING", "PWD", "OLDPWD", "INIT_CWD"].includes(k)));
const python = resolvePython(process.env, []);

function clean(text) {
  let out = String(text);
  const marks = [[work, "<проект>"], [os.tmpdir(), "<tmp>"], [os.homedir(), "<home>"], [repo, "<плагин>"], [python.ok ? path.dirname(python.path) : "", "<python>"], [os.userInfo().username, "<user>"]];
  for (const [value, mark] of marks) {
    if (!value) continue;
    for (const form of new Set([value, value.replaceAll("\\", "\\\\"), value.replaceAll("\\", "\\\\\\\\"), value.replaceAll("\\", "/")])) out = out.replaceAll(form, mark);
  }
  return out;
}
const note = (row) => log.push(clean(JSON.stringify(row)));

function check(name, ok, detail) {
  tests.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${ok ? "" : `\n   ${detail}`}`);
}

// --- файлы проекта ---

/** Обход, а не `fs.rmSync`: в Node 24 на Windows он молча не снимает файлы с кириллицей в пути. */
function removeTree(p) {
  const st = fs.lstatSync(p, { throwIfNoEntry: false });
  if (!st) return;
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) removeTree(path.join(p, name));
    fs.rmdirSync(p);
  } else {
    fs.unlinkSync(p);
  }
}

function makeProject(name, client) {
  const root = path.join(work, "проекты с пробелом", name);
  fs.mkdirSync(path.join(root, "openspec", "changes", EVENT), { recursive: true });
  fs.mkdirSync(path.join(root, "openspec", "changes", SCHEME), { recursive: true });
  fs.mkdirSync(path.join(root, client === "claude" ? ".claude" : ".opencode"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: root, env });
  return root;
}

const viewerOf = (root) => path.join(root, ".symphysis", "viewer");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const cursorFile = (root, session) => path.join(viewerOf(root), "sessions", `${sha(session)}.json`);

function must(result, what) {
  if (!result.ok) throw new Error(`${what}: ${result.reason}`);
}

function eventLine() {
  const hash = "ab".repeat(32);
  return `${JSON.stringify({ change: EVENT, answers: `openspec/changes/${EVENT}/answers/2026-11-04.md`, sha256_before: hash, sha256_after: "cd".repeat(32) })}\n`;
}

/** Сессия, которая уже обращалась: курсор в начале файла и старый хеш схемы. Новая сессия прошлого не видит, а без номера сессии курсор не подложить. */
function seedSession(root, session, schemeHash) {
  const file = cursorFile(root, session);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ offset: 0, schemes: { [SCHEME]: schemeHash } }), "utf8");
}

/** Скрипт хука из пакета, журнал с событием, схема, правленная после обращения сессии. Возвращает хеш прежней схемы. */
function reset(root) {
  removeTree(viewerOf(root));
  must(installHookScript(root, repo), "скрипт хука");
  fs.writeFileSync(path.join(viewerOf(root), "events.jsonl"), eventLine(), "utf8");
  const scheme = path.join(root, "openspec", "changes", SCHEME, "scheme.md");
  fs.writeFileSync(scheme, "# схема до правки\n", "utf8");
  const before = sha("# схема до правки\n");
  fs.writeFileSync(scheme, "# схема после правки\n", "utf8");
  return before;
}

// --- клиенты ---

function which(names) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    }
  }
  return null;
}

function findClaude() {
  return which(["claude.exe", "claude"]);
}

/** Оболочка npm не годится: `.cmd` без оболочки не запускается, а через неё кириллица в вопросе ломается. Берётся exe, на который она указывает. */
function findOpencode() {
  const shim = which(["opencode.cmd"]);
  const exe = shim && /"%dp0%\\([^"]+\.exe)"/i.exec(fs.readFileSync(shim, "utf8"));
  const file = exe && path.join(path.dirname(shim), exe[1]);
  return file && fs.existsSync(file) ? file : null;
}

const CLAUDE = findClaude();
const OPENCODE = findOpencode();

function claudeOnce(cwd, session) {
  const args = ["-p", CLAUDE_QUESTION, "--model", CLAUDE_MODEL, "--output-format", "json", "--setting-sources", "project,local", "--max-turns", "1", "--tools", "", "--no-session-persistence", "--session-id", session];
  const run = spawnSync(CLAUDE, args, { cwd, env, encoding: "utf8", timeout: 180000, windowsHide: true });
  let reply;
  try {
    reply = JSON.parse(run.stdout);
  } catch {
    reply = { result: String(run.stdout).slice(0, 400), is_error: null };
  }
  const text = typeof reply.result === "string" ? reply.result : "";
  return { code: run.status ?? `сбой запуска: ${run.error?.message}`, is_error: reply.is_error, text, stdout: String(run.stdout), stderr: String(run.stderr).slice(0, 400), ok: run.status === 0 && reply.is_error === false && text.trim() !== "" };
}

/** Один запрос; повтор один раз и только при сбое самого клиента. Повтор виден в следе. */
function claudeAsk(name, cwd, session) {
  let r = claudeOnce(cwd, session);
  const first = r;
  const retried = !r.ok;
  if (retried) r = claudeOnce(cwd, session);
  note({ client: "claude", case: name, code: r.code, is_error: r.is_error, reply: r.text.slice(0, 300), stderr: r.stderr, retried: retried ? { first_code: first.code, first_is_error: first.is_error, first_reply: first.text.slice(0, 200) } : false });
  sessionsToClean.push(cwd);
  return r;
}

function openCodeOnce(cwd, session) {
  const args = ["run", "--standalone", "--format", "json", "--print-logs", "--log-level", "warn", "-m", OC_MODEL, ...(session ? ["--session", session] : []), OC_QUESTION];
  const run = spawnSync(OPENCODE, args, { cwd, env, encoding: "utf8", timeout: 240000, windowsHide: true });
  let id = null;
  const texts = [];
  for (const line of String(run.stdout).split(/\r?\n/)) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (!row || typeof row !== "object") continue;
    id ??= row.sessionID ?? row.session_id ?? row.session?.id ?? null;
    if (typeof row.text === "string") texts.push(row.text);
    else if (typeof row.part?.text === "string") texts.push(row.part.text);
  }
  const errors = String(run.stderr).split(/\r?\n/).filter((l) => /level=(ERROR|WARN)|loading plugin|instructions/i.test(l)).map((l) => l.slice(0, 220)).slice(0, 8);
  const text = texts.join("");
  return { code: run.status ?? `сбой запуска: ${run.error?.message}`, id, text, errors, ok: run.status === 0 && text.trim() !== "" };
}

function openCodeAsk(name, cwd, session) {
  let r = openCodeOnce(cwd, session);
  const first = r;
  const retried = !r.ok;
  if (retried) r = openCodeOnce(cwd, session);
  note({ client: "opencode", case: name, code: r.code, session_known: !!r.id, reply: r.text.slice(0, 300), log_lines: r.errors, retried: retried ? { first_code: first.code, first_reply: first.text.slice(0, 200), first_log_lines: first.errors } : false });
  return r;
}

// --- Claude Code ---

function claudeScenarios() {
  const root = makeProject("claude", "claude");
  const foreign = { type: "command", command: python.path, args: ["-I", "-X", "utf8", "-c", `import sys; sys.stdout.reconfigure(encoding='utf-8'); print('Служебная метка: ${FOREIGN}')`] };
  const settings = path.join(root, ".claude", "settings.local.json");
  const withForeign = () => fs.writeFileSync(settings, JSON.stringify({ permissions: { allow: ["Read"] }, hooks: { UserPromptSubmit: [{ hooks: [foreign] }] } }, null, 2), "utf8");
  const session = () => crypto.randomUUID();

  // Настоящий скрипт, чужие настройки и хуки, схема правлена после обращения: три сценария одним запросом.
  withForeign();
  must(installClaudeHook(root, python.path), "запись Claude Code");
  const saved = JSON.parse(fs.readFileSync(settings, "utf8"));
  const groups = saved.hooks.UserPromptSubmit;
  check("Claude Code: чужие настройки и хуки на месте рядом с записью плагина", saved.permissions?.allow?.[0] === "Read" && groups.length === 2 && groups[0].hooks[0].args.join(" ").includes(FOREIGN), JSON.stringify(saved).slice(0, 300));
  const before = reset(root);
  const s1 = session();
  seedSession(root, s1, before);
  // Те же входные данные, прямым запуском: текст сигнала о схеме читается глазами теста, а не пересказом модели.
  const s1direct = session();
  seedSession(root, s1direct, before);
  const direct = spawnSync(python.path, ["-I", "-X", "utf8", path.join(viewerOf(root), "hook.py")], { input: JSON.stringify({ session_id: s1direct, prompt: "x" }), encoding: "utf8" });
  const schemeLine = direct.stdout.split("\n").find((l) => l.includes(SCHEME)) ?? "";
  check("«Только сигнал»: строка о схеме называет изменение и не просит остановиться", direct.status === 0 && schemeLine !== "" && /сигнал/.test(schemeLine) && !/останов|прекрати|немедленно|сразу/i.test(schemeLine), `код ${direct.status}, строка: ${schemeLine}`);
  let r = claudeAsk("путь с пробелом и кириллицей, чужой хук, правка схемы", root, s1);
  const seen = (label) => r.text.toLowerCase().includes(label.toLowerCase());
  check("«Путь с пробелом и кириллицей»: хук сработал, вывод виден модели", r.ok && seen(EVENT), `ответ: ${r.text.slice(0, 200)}`);
  check("«Чужие настройки и хуки»: при запросе срабатывают оба", r.ok && seen(EVENT) && seen(FOREIGN), `ответ: ${r.text.slice(0, 200)}`);
  check("«Только сигнал»: код 0, запрос дошёл до модели, изменение схемы названо", r.ok && seen(SCHEME), `код ${r.code}, ответ: ${r.text.slice(0, 200)}`);
  check("Claude Code: курсор сессии продвинут хуком клиента", JSON.parse(fs.readFileSync(cursorFile(root, s1), "utf8")).offset === Buffer.byteLength(eventLine()), "курсор не в конце файла");

  // Остальные сценарии без чужого хука: ответ должен быть НЕТ либо любой, но дойти.
  fs.writeFileSync(settings, "", "utf8");
  must(installClaudeHook(root, python.path), "запись Claude Code");

  // «Файла скрипта нет»: запись на месте, `.symphysis/viewer/` снят.
  removeTree(viewerOf(root));
  r = claudeAsk("Файла скрипта нет у Claude Code", root, session());
  check("«Файла скрипта нет у Claude Code»: запрос доходит до модели", r.ok, `код ${r.code}, is_error ${r.is_error}, ответ: ${r.text.slice(0, 200)}`);

  // «Скрипт вышел с кодом 2».
  reset(root);
  fs.writeFileSync(path.join(viewerOf(root), "hook.py"), `import sys\nsys.stdout.reconfigure(encoding="utf-8")\nprint("Служебная метка: ${FOREIGN}")\nsys.exit(2)\n`, "utf8");
  r = claudeAsk("Скрипт вышел с кодом 2", root, session());
  check("«Скрипт вышел с кодом 2»: запрос доходит до модели", r.ok, `код ${r.code}, is_error ${r.is_error}, ответ: ${r.text.slice(0, 200)}`);

  // «Скрипт упал»: на месте каталога курсоров лежит файл, запись курсора падает.
  reset(root);
  fs.writeFileSync(path.join(viewerOf(root), "sessions"), "не каталог", "utf8");
  const crashed = spawnSync(python.path, ["-I", "-X", "utf8", path.join(viewerOf(root), "hook.py")], { input: JSON.stringify({ session_id: session() }), encoding: "utf8" });
  check("«Скрипт упал»: код 0, причина в stderr скрипта", crashed.status === 0 && /^symphysis hook: /.test(crashed.stderr), `код ${crashed.status}, stderr: ${crashed.stderr.slice(0, 200)}`);
  r = claudeAsk("Скрипт упал", root, session());
  const leaked = /symphysis hook:|NotADirectory|WinError|Traceback/.test(r.stdout);
  check("«Скрипт упал»: запрос доходит до модели", r.ok, `код ${r.code}, is_error ${r.is_error}, ответ: ${r.text.slice(0, 200)}`);
  check("«Скрипт упал»: stderr скрипта в ответе модели и в выводе клиента нет", r.ok && !leaked, `в выводе: ${r.stdout.slice(0, 300)}`);

  // «Python переехал»: запись указывает на путь, которого нет.
  reset(root);
  must(installClaudeHook(root, path.join(work, "нет такого", "python.exe")), "запись с мёртвым путём");
  r = claudeAsk("Python переехал", root, session());
  check("«Python переехал»: запрос доходит до модели", r.ok, `код ${r.code}, is_error ${r.is_error}, ответ: ${r.text.slice(0, 200)}`);
}

// --- opencode ---

function pluginFile(root) {
  return path.join(root, ".opencode", "plugins", "symphysis-hook.js");
}

function timeHookCalls(root) {
  const script = path.join(viewerOf(root), "hook.py");
  const ms = [];
  for (let i = 0; i < 12; i++) {
    const t0 = process.hrtime.bigint();
    execFileSync(python.path, ["-I", "-X", "utf8", script], { input: JSON.stringify({ session_id: "замер" }), encoding: "utf8", timeout: 5000, windowsHide: true, stdio: "pipe" });
    ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ms.shift();
  ms.sort((a, b) => a - b);
  return { runs: ms.length, median_ms: Math.round(ms[Math.floor(ms.length / 2)]), max_ms: Math.round(ms.at(-1)) };
}

function opencodeScenarios() {
  const root = makeProject("opencode", "opencode");
  must(installHookScript(root, repo), "скрипт хука");
  must(installOpencodeHook(root, python.path), "файл opencode");
  const sessionsDir = path.join(viewerOf(root), "sessions");
  const cursors = () => (fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []);

  // Первое обращение: сессия встаёт в конец файла (журнала событий ещё нет).
  let r = openCodeAsk("первое обращение, событий нет", root);
  const session = r.id;
  check("opencode: первое обращение дошло, сессия известна, хук создал её курсор", r.ok && !!session && cursors().includes(`${sha(session ?? "")}.json`), `код ${r.code}, сессия ${session}, курсоры ${cursors().length}, ответ: ${r.text.slice(0, 150)}`);
  if (!session) return;

  // «Новые события».
  fs.writeFileSync(path.join(viewerOf(root), "events.jsonl"), eventLine(), "utf8");
  r = openCodeAsk("Новые события", root, session);
  check("«Новые события»: модель видит событие", r.ok && r.text.includes(EVENT), `код ${r.code}, ответ: ${r.text.slice(0, 200)}`);

  // Контроль: файл без `remove`. Если запись не переживает процесс, следующий запрос ничего не докажет.
  const real = fs.readFileSync(pluginFile(root), "utf8");
  const stub = real.replace("else await entry.remove({ sessionID: event.sessionID, key: KEY });", "else { /* контроль: запись не снимается */ }");
  check("контроль: заглушка без remove отличается от файла плагина", stub !== real && stub.split("\n", 1)[0] === MARK, "замена не нашла строку remove");
  fs.writeFileSync(pluginFile(root), stub, "utf8");
  r = openCodeAsk("контроль: запись не снимается, событий нет", root, session);
  const persists = r.ok && r.text.includes(EVENT);
  check("контроль: запись symphysis переживает процесс opencode", persists, `ответ: ${r.text.slice(0, 200)}`);

  // «Новых событий нет» и «Та же сессия»: настоящий файл, события те же, сессия та же.
  must(installOpencodeHook(root, python.path), "файл opencode");
  check("контроль: настоящий файл плагина возвращён", fs.readFileSync(pluginFile(root), "utf8") === real, "файл отличается");
  r = openCodeAsk("Новых событий нет и Та же сессия", root, session);
  check("«Новых событий нет»: запись снята, модель события не видит", r.ok && !r.text.includes(EVENT), `код ${r.code}, ответ: ${r.text.slice(0, 200)}`);
  check("«Новых событий нет»: в журнале клиента нет ошибки remove", r.errors.every((l) => !/ERROR/.test(l)), r.errors.join(" | "));
  check("«Та же сессия»: события в инструкциях нет", r.ok && !r.text.includes(EVENT), `ответ: ${r.text.slice(0, 200)}`);

  // Замер: execFileSync блокирует процесс opencode на время вызова скрипта.
  note({ client: "opencode", case: "замер вызова скрипта", ...timeHookCalls(root) });

  // «Сбой в оболочке opencode»: мёртвый путь к Python, затем файла скрипта нет.
  must(installOpencodeHook(root, path.join(work, "нет такого", "python.exe")), "файл с мёртвым путём");
  r = openCodeAsk("Сбой в оболочке opencode: мёртвый путь к Python", root);
  check("«Сбой в оболочке opencode»: мёртвый путь к Python, запрос доходит до модели", r.ok, `код ${r.code}, ответ: ${r.text.slice(0, 200)}`);
  must(installOpencodeHook(root, python.path), "файл opencode");
  removeTree(viewerOf(root));
  r = openCodeAsk("Сбой в оболочке opencode: файла скрипта нет", root);
  check("«Сбой в оболочке opencode»: файла скрипта нет, запрос доходит до модели", r.ok, `код ${r.code}, ответ: ${r.text.slice(0, 200)}`);
}

function cleanClaudeSessions() {
  for (const cwd of new Set(sessionsToClean)) {
    const sanitized = [...cwd].map((c) => (/^[A-Za-z0-9]$/.test(c) ? c : "-")).join("");
    const dir = path.join(os.homedir(), ".claude", "projects", sanitized);
    if (sanitized.includes("symphysis-hook") && fs.existsSync(dir)) removeTree(dir);
  }
}

// --- прогон ---

function logPath() {
  const root = process.env.SYMPHYSIS_ROOT;
  const probes = root && path.join(root, "openspec", "changes", "step-help-tab", "probes");
  if (probes && fs.existsSync(probes)) return path.join(probes, "hook-clients.log");
  fs.mkdirSync(path.join(repo, "out", "e2e"), { recursive: true });
  return path.join(repo, "out", "e2e", "hook-clients.log");
}

let missing = false;
if (!python.ok) {
  check("Python найден", false, python.reason);
  missing = true;
}
if (!CLAUDE) {
  check("Claude Code найден: claude в PATH", false, "клиента нет на машине");
  missing = true;
}
if (!OPENCODE) {
  check("opencode найден: opencode.cmd в PATH и exe рядом", false, "клиента нет на машине");
  missing = true;
}

if (!missing) {
  const version = (file) => spawnSync(file, ["--version"], { env, encoding: "utf8", windowsHide: true }).stdout.trim();
  note({ case: "версии", claude: version(CLAUDE), opencode: version(OPENCODE), python: python.version, claude_model: CLAUDE_MODEL, opencode_model: OC_MODEL });
  try {
    claudeScenarios();
  } catch (e) {
    check("Claude Code: прогон дошёл до конца", false, String(e.stack ?? e));
  }
  try {
    opencodeScenarios();
  } catch (e) {
    check("opencode: прогон дошёл до конца", false, String(e.stack ?? e));
  }
  cleanClaudeSessions();
  const file = logPath();
  fs.writeFileSync(file, `${log.join("\n")}\n`, { encoding: "utf8" });
  console.log(`след: ${path.basename(file)}`);
}

const failed = tests.filter((t) => !t.ok).length;
console.log(`итого ${tests.length}, упало ${failed}`);
process.exit(failed || missing ? 1 : 0);
