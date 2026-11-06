// Хук клиента: где он нужен, безопасная запись, скрипт из пакета, запись Claude Code, файл opencode. Без `vscode`: связь с окном и настройками живёт не здесь.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { findTools, viewerDir, viewerRefusal, writeRefusal, type WriteResult } from "../core/project";
import type { PythonResolution } from "../core/python";

const SCRIPT = "hook.py";

/** `reason` только у ненайденного Python и настройки инструментов мимо них: остальное значит, что хук здесь не нужен, и говорить не о чем. */
export type HookCondition =
  | { met: true; python: string; claude: boolean; opencode: boolean }
  | { met: false; reason?: string };

function statOf(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}
const isDir = (p: string) => !!statOf(p)?.isDirectory();
const isFile = (p: string) => !!statOf(p)?.isFile();

/** Признак проекта на symphysis: строка в `openspec/config.yaml`, YAML разбирать незачем (F-75, F-98). */
function hasSymphysisSchema(root: string): boolean {
  try {
    return /^\uFEFF?schema:[ \t]+(["']?)symphysis\1(?:[ \t]+#.*)?[ \t]*$/m.test(fs.readFileSync(path.join(root, "openspec", "config.yaml"), "utf8"));
  } catch {
    return false;
  }
}

/**
 * Условие установки по папке: след клиента говорит отдельно про каждого (F-60).
 * `.symphysis/tools/` ставит только symphysis. `tools/` и настройка на всю машину могут оказаться чужими, поэтому нужна схема (F-65, F-75, F-98).
 */
export function hookCondition(root: string, python: PythonResolution, toolsPath?: string): HookCondition {
  if (!isDir(path.join(root, "openspec"))) return { met: false };
  const tools = findTools(root, toolsPath);
  const installed = !("kind" in tools) && tools.dir === path.join(root, ".symphysis", "tools");
  if (!installed && !hasSymphysisSchema(root)) return { met: false };
  const claude = isDir(path.join(root, ".claude"));
  const opencode = isDir(path.join(root, ".opencode")) || isFile(path.join(root, "opencode.json")) || isFile(path.join(root, "opencode.jsonc"));
  if (!claude && !opencode) return { met: false };
  if ("kind" in tools) return tools.kind === "tools-path" ? { met: false, reason: tools.reason } : { met: false };
  if (!python.ok) return { met: false, reason: python.reason };
  return { met: true, python: python.path, claude, opencode };
}

/**
 * Через временный файл: обрыв не оставит половину. `wx`: чужой файл или ссылка с именем временного не сработают.
 * Права прежнего файла: иначе новый получит их по umask, и `0600` у настроек с токенами станет `0644`.
 */
export function replaceFile(file: string, data: string | Buffer): void {
  const previous = fs.statSync(file, { throwIfNoEntry: false });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, data, { flag: "wx", mode: previous && previous.mode & 0o777 });
    fs.renameSync(temp, file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
      try {
        fs.unlinkSync(temp);
      } catch { /* временный файл не создан */ }
    }
    throw e;
  }
}

/** Запись при активации. Отказ и сбой идут значением с причиной. */
export function writeProjectFile(root: string, file: string, data: string | Buffer): WriteResult {
  const refusal = writeRefusal(root, file);
  if (refusal) return { ok: false, reason: refusal };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    replaceFile(file, data);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

function sameBytes(file: string, data: Buffer): boolean {
  try {
    return fs.readFileSync(file).equals(data);
  } catch {
    return false;
  }
}

/** Скрипт исполняется на каждом запросе, поэтому при активации сверяется с пакетным по байтам (F-31, F-63). Совпал — не пишется, время изменения прежнее. */
export function installHookScript(root: string, extensionPath: string): WriteResult {
  const refusal = viewerRefusal(root, SCRIPT);
  if (refusal) return { ok: false, reason: refusal };
  try {
    const packaged = fs.readFileSync(path.join(extensionPath, "hook", SCRIPT));
    const file = path.join(viewerDir(root), SCRIPT);
    if (!sameBytes(file, packaged)) replaceFile(file, packaged);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// --- запись Claude Code ---

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

const SETTINGS = ".claude/settings.local.json";
const SCRIPT_TAIL = "/.symphysis/viewer/hook.py";
/** Файла нет или скрипт вышел с любым кодом — код процесса 0. Без обёртки Python сам выходит с кодом 2, а он блокирует запрос (F-69). Текст из пробы F-69. */
const GUARD = "import os,runpy,sys\np=sys.argv[1]\ntry:\n    os.path.isfile(p) and runpy.run_path(p,run_name='__main__')\nexcept BaseException:\n    pass\n";

/** Без оболочки: `${CLAUDE_PROJECT_DIR}` подставляет клиент. `-I`: каталог вызова не попадает в `sys.path`. */
const claudeHandler = (python: string) => ({ type: "command", command: python, args: ["-I", "-X", "utf8", "-c", GUARD, `\${CLAUDE_PROJECT_DIR}${SCRIPT_TAIL}`], timeout: 5 });

/** Своя запись: путь скрипта в `args`. Путь к Python и остальное могут быть любыми: они и сверяются. */
export const isOwnClaudeHandler = (handler: unknown): boolean =>
  isObject(handler) && Array.isArray(handler.args) && handler.args.some((a) => typeof a === "string" && a.endsWith(SCRIPT_TAIL));

/** Настройки из файла или причина их не трогать: файл человека, не в git, и вернуть его нечем (F-77). */
function readClaudeSettings(file: string): { settings: Json } | { reason: string } {
  let raw: Buffer;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { settings: {} } : { reason: `${SETTINGS}: ${String(e)}` };
  }
  if (raw.length === 0) return { settings: {} };
  let settings: unknown;
  try {
    // `fatal`: иначе чужая кодировка пришла бы с заменёнными знаками, и перезапись их потеряла. `ignoreBOM`: BOM остаётся в тексте, и JSON его не примет.
    settings = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw));
  } catch (e) {
    return { reason: `${SETTINGS} не разбирается как JSON: ${String(e)}` };
  }
  if (!isObject(settings)) return { reason: `${SETTINGS}: верхний уровень не объект` };
  if (settings.hooks !== undefined && !isObject(settings.hooks)) return { reason: `${SETTINGS}: поле hooks не объект` };
  if (isObject(settings.hooks) && settings.hooks.UserPromptSubmit !== undefined && !Array.isArray(settings.hooks.UserPromptSubmit)) return { reason: `${SETTINGS}: поле hooks.UserPromptSubmit не список` };
  return { settings };
}

const handlersOf = (group: unknown): unknown[] => (isObject(group) && Array.isArray(group.hooks) ? group.hooks : []);

/** Группы без своих записей. Чужое остаётся как было, группа, где не осталось ничего, уходит. */
function withoutOwnHandlers(groups: unknown[]): unknown[] {
  return groups.flatMap((group) => {
    if (!handlersOf(group).some(isOwnClaudeHandler)) return [group];
    const rest = handlersOf(group).filter((h) => !isOwnClaudeHandler(h));
    return rest.length ? [{ ...(group as Json), hooks: rest }] : [];
  });
}

/** Запись стоит и совпадает — файл не пишется вовсе. Иначе своя запись одна, в своей группе (F-57). */
export function installClaudeHook(root: string, python: string): WriteResult {
  const file = path.join(root, ".claude", "settings.local.json");
  const refusal = writeRefusal(root, file);
  if (refusal) return { ok: false, reason: refusal };
  const read = readClaudeSettings(file);
  if ("reason" in read) return { ok: false, reason: read.reason };
  const hooks = (read.settings.hooks ??= {}) as Json;
  const groups = (hooks.UserPromptSubmit ??= []) as unknown[];
  const wanted = claudeHandler(python);
  const own = groups.flatMap(handlersOf).filter(isOwnClaudeHandler);
  if (own.length === 1 && isDeepStrictEqual(own[0], wanted)) return { ok: true };
  hooks.UserPromptSubmit = [...withoutOwnHandlers(groups), { hooks: [wanted] }];
  return writeProjectFile(root, file, `${JSON.stringify(read.settings, null, 2)}\n`);
}

// --- файл opencode ---

const OPENCODE_MARK = "// symphysis-vscode: хук opencode, файл пишет и заменяет плагин, не правь";

/** Свой файл: метка в первой строке. Файл скрыт от git, и переписанное чужое уже не вернуть (F-79). */
export const isOwnOpencodeFile = (text: string): boolean => text.split(/\r?\n/, 1)[0] === OPENCODE_MARK;

/**
 * Оболочка над тем же скриптом (F-68). Подстановка одна, путь к Python через JSON; остальное постоянный текст, путь к скрипту от своего файла.
 * Необработанное исключение в хуке `prompt` останавливает запрос человека, поэтому ловится всё (F-69). `remove` без записи ничего не делает.
 * Вызов асинхронный: плагин встроен в чужой процесс на каждый запрос, и зависший Python не должен останавливать его таймеры и сеть на время предела.
 * Обработчик ошибки входа обязателен: Python мог выйти, не прочитав вход, а необработанная ошибка потока остановила бы запрос.
 */
const opencodeText = (python: string) => [
  OPENCODE_MARK,
  'import { execFile } from "node:child_process";',
  'import path from "node:path";',
  'import { fileURLToPath } from "node:url";',
  "",
  `const PYTHON = ${JSON.stringify(python)};`,
  'const KEY = "symphysis";',
  "",
  "function read(sessionID) {",
  '  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".symphysis", "viewer", "hook.py");',
  "  return new Promise((resolve, reject) => {",
  '    const child = execFile(PYTHON, ["-I", "-X", "utf8", script], { encoding: "utf8", timeout: 5000, windowsHide: true }, (err, out) => (err ? reject(err) : resolve(out.trim())));',
  '    child.stdin.on("error", () => {});',
  "    child.stdin.end(JSON.stringify({ session_id: sessionID }));",
  "  });",
  "}",
  "",
  "export default {",
  '  id: "symphysis-hook",',
  "  async setup(ctx) {",
  "    try {",
  "      const entry = ctx.session.instructions.entry;",
  '      await ctx.session.hook("prompt", async (event) => {',
  "        try {",
  "          const value = await read(event.sessionID);",
  "          if (value) await entry.put({ sessionID: event.sessionID, key: KEY, value });",
  "          else await entry.remove({ sessionID: event.sessionID, key: KEY });",
  "        } catch {",
  "          try {",
  "            await entry.remove({ sessionID: event.sessionID, key: KEY });",
  "          } catch { /* запрос человека важнее */ }",
  "        }",
  "      });",
  "    } catch { /* запрос человека важнее */ }",
  "  },",
  "};",
  "",
].join("\n");

/** Чужой файл не трогается. Свой совпал — не пишется. `opencode.json` не меняется (F-49). */
export function installOpencodeHook(root: string, python: string): WriteResult {
  const file = path.join(root, ".opencode", "plugins", "symphysis-hook.js");
  const refusal = writeRefusal(root, file);
  if (refusal) return { ok: false, reason: refusal };
  const wanted = opencodeText(python);
  let current: string | null = null;
  try {
    current = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return { ok: false, reason: `.opencode/plugins/symphysis-hook.js: ${String(e)}` };
  }
  if (current === wanted) return { ok: true };
  if (current !== null && !isOwnOpencodeFile(current)) return { ok: false, reason: ".opencode/plugins/symphysis-hook.js чужой файл: в первой строке нет метки плагина" };
  return writeProjectFile(root, file, wanted);
}

// --- снятие ---

export type RemoveResult = { ok: true; removed: boolean } | { ok: false; reason: string };

/** Файл есть? Проверка до `writeRefusal`: через ссылку наружу снимать нельзя, но если и там файла нет, говорить не о чем. Только `unlinkSync`: `rmSync` молча не удаляет файл с кириллицей в пути. */
function unlinkOwn(root: string, file: string, own: (file: string) => boolean | { reason: string }): RemoveResult {
  try {
    if (!fs.lstatSync(file, { throwIfNoEntry: false })) return { ok: true, removed: false };
    const refusal = writeRefusal(root, file);
    if (refusal) return { ok: false, reason: refusal };
    const verdict = own(file);
    if (typeof verdict === "object") return { ok: false, reason: verdict.reason };
    if (!verdict) return { ok: true, removed: false };
    fs.unlinkSync(file);
    return { ok: true, removed: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/**
 * Своя запись уходит, чужое остаётся. Файл, в котором не осталось ничего, удаляется: иначе он останется виден git.
 * Не разбирается: файл прежний, причина названа. Клиент такой файл не читает, запись снимется при первой активации после починки.
 */
export function removeClaudeHook(root: string): RemoveResult {
  const file = path.join(root, ".claude", "settings.local.json");
  let rewrite: Json | null = null;
  const removed = unlinkOwn(root, file, () => {
    const read = readClaudeSettings(file);
    if ("reason" in read) return { reason: read.reason };
    const hooks = read.settings.hooks;
    const groups = isObject(hooks) && Array.isArray(hooks.UserPromptSubmit) ? (hooks.UserPromptSubmit as unknown[]) : [];
    if (!isObject(hooks) || !groups.flatMap(handlersOf).some(isOwnClaudeHandler)) return false;
    const rest = withoutOwnHandlers(groups);
    if (rest.length) hooks.UserPromptSubmit = rest;
    else delete hooks.UserPromptSubmit;
    if (!Object.keys(hooks).length) delete read.settings.hooks;
    if (!Object.keys(read.settings).length) return true;
    rewrite = read.settings;
    return false;
  });
  if (!removed.ok || !rewrite) return removed;
  const written = writeProjectFile(root, file, `${JSON.stringify(rewrite, null, 2)}\n`);
  return written.ok ? { ok: true, removed: true } : written;
}

/** Файл с меткой уходит, чужой остаётся без причины: он не наш. Каталог `.opencode/plugins/` остаётся, пустых каталогов git не видит. */
export const removeOpencodeHook = (root: string): RemoveResult =>
  unlinkOwn(root, path.join(root, ".opencode", "plugins", "symphysis-hook.js"), (file) => isOwnOpencodeFile(fs.readFileSync(file, "utf8")));

export const removeHookScript = (root: string): RemoveResult => unlinkOwn(root, path.join(root, ".symphysis", "viewer", SCRIPT), () => true);
