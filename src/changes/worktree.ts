// Название проекта и рабочего дерева для панели «Изменения» (B-37): окно плагина открывается на дереве, и по панели
// должно быть видно, чьё это изменение. Git зовётся как в hookGit: только чтение, без оболочки, с `core.fsmonitor=false`.
// Без `vscode`, чтобы правила проверялись юнит-тестами на настоящем git.
import { execFile } from "node:child_process";
import path from "node:path";

const GIT_TIMEOUT_MS = 10000;
const chomp = (text: string) => text.replace(/\r?\n$/, "");

export interface GitResult {
  code: number | null;
  stdout: string;
}

export type RunGit = (git: string, args: string[], cwd: string) => Promise<GitResult>;

/** Настоящий запуск git: только чтение и `core.fsmonitor=false`, как в hookGit (`security.md`). */
export const defaultRunGit: RunGit = (git, args, cwd) =>
  new Promise((resolve) => {
    execFile(git, ["-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", windowsHide: true, timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout });
    });
  });

const abs = (root: string, p: string): string => (path.isAbsolute(p) ? p : path.resolve(root, p));

/**
 * `проект · ветка` связанного рабочего дерева; `null` — основное дерево, каталог не в репозитории или git отказал.
 * Проект — каталог репозитория над общим `.git` (в связанном дереве `--git-dir` ведёт в `worktrees/<имя>`, поэтому
 * сравнивается с `--git-common-dir`), ветка — короткое имя HEAD, отделённый HEAD назван словами.
 */
export async function worktreeLabel(root: string, git: string, run: RunGit = defaultRunGit): Promise<string | null> {
  const dir = await run(git, ["rev-parse", "--git-dir"], root);
  if (dir.code !== 0) return null;
  const common = await run(git, ["rev-parse", "--git-common-dir"], root);
  if (common.code !== 0) return null;
  const commonAbs = abs(root, chomp(common.stdout));
  if (abs(root, chomp(dir.stdout)) === commonAbs) return null; // основное дерево: подписи ему не нужно
  const branch = await run(git, ["rev-parse", "--abbrev-ref", "HEAD"], root);
  if (branch.code !== 0) return null;
  const name = chomp(branch.stdout);
  const project = path.basename(path.dirname(commonAbs)) || path.basename(commonAbs);
  return `${project} · ${name === "HEAD" ? "отделённый HEAD" : name}`;
}
