// Файлы хука спрятаны от git (F-66, F-80, F-81). Без `vscode`: связь с окном живёт не здесь.
// `git` зовётся абсолютным путём, без оболочки и с `core.fsmonitor=false`: `ls-files` иначе исполнил бы команду из настроек чужого репозитория
// при активации, без действия человека (`security.md`). Зовётся только чтение и `worktree list`.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { installClaudeHook, installOpencodeHook, removeClaudeHook, removeHookScript, removeOpencodeHook, replaceFile } from "./hook";
import { writeRefusal, type WriteResult } from "./project";
import { pathCandidates } from "./python";

export type HookClient = "claude" | "opencode";

const CLIENT_FILE: Record<HookClient, string> = { claude: ".claude/settings.local.json", opencode: ".opencode/plugins/symphysis-hook.js" };
const GIT_TIMEOUT_MS = 10000;
const BLOCK_BEGIN = "# symphysis-vscode: файлы хука, строки до конца блока снимает плагин";
const BLOCK_END = "# symphysis-vscode: конец блока";

const OK: WriteResult = { ok: true };
const fail = (reason: string): WriteResult => ({ ok: false, reason });
const noGit = (detail = "") => `в проекте есть .git, а git не найден или отказал: спрятать файлы хука нечем${detail && ` (${detail})`}`;
const chomp = (text: string) => text.replace(/\r?\n$/, "");

export const resolveGit = (env: NodeJS.ProcessEnv, workspaceDirs: string[]): string | null => pathCandidates(env, workspaceDirs, ["git"])[0] ?? null;

/** `.git` в папке или выше: папка-подкаталог репозитория не проект без git. */
function insideRepo(root: string): boolean {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    if (path.dirname(dir) === dir) return false;
  }
}

function runGit(git: string, args: string[], cwd: string): Promise<{ code: number | null; stdout: string; detail: string }> {
  return new Promise((resolve) => {
    execFile(git, ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: GIT_TIMEOUT_MS }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : null) : 0;
      resolve({ code, stdout, detail: (stderr || err?.message || "").split(/\r?\n/, 1)[0] });
    });
  });
}

/** Префикс папки от корня репозитория и файл `exclude`, который назвал git: в рабочем дереве он в основном клоне и один на все деревья. */
async function repoOf(root: string, git: string): Promise<{ prefix: string; exclude: string } | { reason: string }> {
  const prefix = await runGit(git, ["rev-parse", "--show-prefix"], root);
  if (prefix.code !== 0) return { reason: noGit(prefix.detail) };
  const exclude = await runGit(git, ["rev-parse", "--git-path", "info/exclude"], root);
  if (exclude.code !== 0) return { reason: noGit(exclude.detail) };
  return { prefix: chomp(prefix.stdout), exclude: path.resolve(root, chomp(exclude.stdout)) };
}

/** От корня репозитория, со `/` в начале: только этот путь, а не любой такой. `*?[\` в имени папки экранируются, иначе это шаблон. */
const lineOf = (prefix: string, rel: string) => `/${prefix.replace(/[\\*?[]/g, "\\$&")}${rel}`;

// `exclude` читается как latin1 и пишется так же: чужие байты не в UTF-8 иначе пришли бы с заменёнными знаками, и перезапись их потеряла.
const asBytes = (text: string) => Buffer.from(text, "utf8").toString("latin1");
const BEGIN = asBytes(BLOCK_BEGIN);
const END = asBytes(BLOCK_END);
const noCr = (line: string) => line.replace(/\r$/, "");

function readExclude(file: string): string {
  if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error(`${file} это ссылка: плагин через неё не пишет`);
  try {
    return fs.readFileSync(file, "latin1");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw e;
  }
}

function writeExclude(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  replaceFile(file, Buffer.from(text, "latin1"));
}

/** Границы своего блока. Концевая метка отделяет свои строки от такой же строки человека сразу под блоком. Метка без пары блока не даёт: чужое не трогаем. */
function findBlock(lines: string[]): [number, number] | null {
  let begin = -1;
  for (let i = 0; i < lines.length; i++) {
    if (noCr(lines[i]) === BEGIN) begin = i;
    else if (noCr(lines[i]) === END && begin >= 0) return [begin, i];
  }
  return null;
}

/** `true`, если строка добавлена; уже стоит — файл не пишется. */
function addLine(file: string, line: string): boolean {
  const own = asBytes(line);
  const text = readExclude(file);
  const lines = text.split("\n");
  const block = findBlock(lines);
  if (block) {
    if (lines.slice(block[0] + 1, block[1]).some((l) => noCr(l) === own)) return false;
    lines.splice(block[1], 0, own);
    writeExclude(file, lines.join("\n"));
  } else {
    writeExclude(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${BEGIN}\n${own}\n${END}\n`);
  }
  return true;
}

/** Снимаются только строки блока, опустевший блок уходит целиком. */
function removeLines(file: string, remove: string[]): void {
  const own = remove.map(asBytes);
  const lines = readExclude(file).split("\n");
  const block = findBlock(lines);
  if (!block) return;
  const [begin, end] = block;
  const inside = lines.slice(begin + 1, end);
  const rest = inside.filter((l) => !own.includes(noCr(l)));
  if (rest.length === inside.length) return;
  lines.splice(begin, end - begin + 1, ...(rest.length ? [lines[begin], ...rest, lines[end]] : []));
  writeExclude(file, lines.join("\n"));
}

/**
 * Шаг установки клиента: проверка отслеживания → строка `exclude` → файл. Отказ на любом шаге: файла нет, причина значением.
 * `exclude` не действует на отслеживаемый файл, и абсолютный путь к Python уехал бы в историю (F-80).
 */
export async function installClient(root: string, client: HookClient, python: string, git: string | null): Promise<WriteResult> {
  const rel = CLIENT_FILE[client];
  // До git и `exclude`: запись через такую ссылку всё равно откажет, и `exclude` незачем трогать ради отката.
  const refusal = writeRefusal(root, path.join(root, rel));
  if (refusal) return fail(refusal);
  const write = () => (client === "claude" ? installClaudeHook(root, python) : installOpencodeHook(root, python));
  if (!insideRepo(root)) return write();
  if (git === null) return fail(noGit());
  const repo = await repoOf(root, git);
  if ("reason" in repo) return fail(repo.reason);
  const tracked = await runGit(git, ["ls-files", "--error-unmatch", "--", rel], root);
  if (tracked.code === 0) return fail(`${rel} отслеживается git: плагин его не трогает, иначе абсолютный путь к Python уедет в историю`);
  if (tracked.code !== 1) return fail(noGit(tracked.detail));
  const line = lineOf(repo.prefix, rel);
  let added: boolean;
  try {
    added = addLine(repo.exclude, line);
  } catch (e) {
    return fail(String(e));
  }
  const written = write();
  if (!written.ok && added) {
    // Файл не записан, а на этом месте может быть файл человека: новая строка спрятала бы его от git.
    try {
      removeLines(repo.exclude, [line]);
    } catch { /* причина уже есть, она важнее */ }
  }
  return written;
}

function realOr(dir: string): string {
  try {
    return fs.realpathSync(dir);
  } catch {
    return dir;
  }
}

async function otherWorktrees(root: string, git: string): Promise<string[] | { reason: string }> {
  const top = await runGit(git, ["rev-parse", "--show-toplevel"], root);
  if (top.code !== 0) return { reason: noGit(top.detail) };
  const list = await runGit(git, ["worktree", "list", "--porcelain"], root);
  if (list.code !== 0) return { reason: noGit(list.detail) };
  const own = realOr(chomp(top.stdout));
  return list.stdout.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).map((l) => l.slice("worktree ".length)).filter((dir) => path.relative(own, realOr(dir)) !== "");
}

/** Снятие своих строк. Файл один на все рабочие деревья, поэтому строка снимается, только если её файла нет ни в одном другом: отдельно на каждую (F-81). */
export async function removeExcludeLines(root: string, git: string | null, clients: HookClient[] = ["claude", "opencode"]): Promise<WriteResult> {
  if (!insideRepo(root)) return OK;
  if (git === null) return fail(noGit());
  const repo = await repoOf(root, git);
  if ("reason" in repo) return fail(repo.reason);
  const others = await otherWorktrees(root, git);
  if ("reason" in others) return fail(others.reason);
  const free = clients.map((client) => CLIENT_FILE[client]).filter((rel) => !others.some((dir) => fs.existsSync(path.join(dir, repo.prefix, rel))));
  try {
    removeLines(repo.exclude, free.map((rel) => lineOf(repo.prefix, rel)));
    return OK;
  } catch (e) {
    return fail(String(e));
  }
}

/**
 * Снятие хука в проекте: сначала файлы, потом строки, и строка уходит только у клиента, чей файл снят. Иначе файл с абсолютным путём к Python, который не вышло снять, стал бы виден git.
 * Возвращает причины. `events.jsonl`, курсоры и `.gitignore` остаются (F-105).
 */
export async function removeHook(root: string, git: string | null): Promise<string[]> {
  const reasons: string[] = [];
  const free: HookClient[] = [];
  let removed = false;
  for (const [client, remove] of [["claude", removeClaudeHook], ["opencode", removeOpencodeHook]] as const) {
    const r = remove(root);
    if (r.ok) {
      free.push(client);
      removed ||= r.removed;
    } else {
      reasons.push(r.reason);
    }
  }
  const script = removeHookScript(root);
  if (script.ok) removed ||= script.removed;
  else reasons.push(script.reason);
  // Ничего не снято — хука здесь нет: настройка может быть выключена на всю машину, и git в посторонних репозиториях не зовётся.
  // Строки, оставшиеся после ручного снятия, безвредны, при следующем включении блок используется снова.
  if (!removed) return reasons;
  const lines = await removeExcludeLines(root, git, free);
  if (!lines.ok) reasons.push(lines.reason);
  return reasons;
}
