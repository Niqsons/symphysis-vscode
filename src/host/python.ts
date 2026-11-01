// Поиск и запуск Python. В VS Code голое имя запускает `python.exe` из корня проекта (пробный запуск),
// поэтому имя разрешается в абсолютный путь по PATH без каталогов рабочей области; shell не участвует.
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type PythonResolution = { ok: true; path: string; version: string } | { ok: false; reason: string; tried: string[] };

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  overflow: boolean;
  ms: number;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

function inside(dir: string, parent: string): boolean {
  const rel = path.relative(parent.toLowerCase(), dir.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function version(file: string): string | null {
  const r = spawnSync(file, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
  return !r.error && r.status === 0 ? (r.stdout || r.stderr).trim() : null;
}

/** `override` — настройка `symphysis.python`, только абсолютный путь; иначе `python`, затем `python3` из PATH. */
export function resolvePython(env: NodeJS.ProcessEnv, workspaceDirs: string[], override?: string): PythonResolution {
  if (override) {
    if (!path.isAbsolute(override)) return { ok: false, reason: `в настройке symphysis.python нужен абсолютный путь, а там «${override}»`, tried: [override] };
    const v = fs.existsSync(override) ? version(override) : null;
    return v ? { ok: true, path: override, version: v } : { ok: false, reason: `${override} не отвечает на --version`, tried: [override] };
  }
  const entries = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const tried: string[] = [];
  for (const name of ["python", "python3"]) {
    for (const dir of entries) {
      if (!path.isAbsolute(dir) || workspaceDirs.some((w) => inside(dir, w))) continue;
      const file = path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
      if (!fs.existsSync(file)) continue;
      tried.push(file);
      const v = version(file);
      if (v) return { ok: true, path: file, version: v };
    }
  }
  return { ok: false, reason: "нет python и python3 в PATH вне рабочей области", tried };
}

export function runPython(python: string, args: string[], cwd: string, opts: { timeoutMs?: number; maxBuffer?: number } = {}): Promise<RunResult> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    execFile(python, ["-X", "utf8", ...args], {
      cwd, encoding: "utf8", windowsHide: true, timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
    }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      resolve({
        code: e ? (typeof e.code === "number" ? e.code : null) : 0,
        stdout, stderr,
        timedOut: !!e?.killed && e.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        overflow: e?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        ms: performance.now() - t0,
      });
    });
  });
}
