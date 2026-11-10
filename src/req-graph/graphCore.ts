import * as fs from "node:fs";
import * as path from "node:path";
import type { CoreEnv } from "../core/core";
import { runPython } from "../core/python";
import { parseGraphView, type GraphSelection, type GraphTarget, type GraphView } from "./graph";

export interface GraphSource { root: string; change: string; snapshot?: string }

export async function requestGraph(env: CoreEnv, source: GraphSource, selection: GraphSelection, run = runPython): Promise<GraphView> {
  const args = [path.join(env.tools, "trace_graph.py"), "view", source.change];
  if (source.snapshot) args.push("--snapshot", source.snapshot);
  if (selection.capability) args.push("--capability", selection.capability);
  if (selection.requirement) args.push("--requirement", selection.requirement);
  if (selection.module) args.push("--module", selection.module);
  if (selection.linked_only) args.push("--linked-only");
  const result = await run(env.python, args, env.cwd);
  if (result.timedOut) throw new Error("Ядро не ответило за отведённое время");
  if (result.overflow) throw new Error("Ответ графа превысил предел буфера");
  if (result.code !== 0) {
    if (selection.requirement && result.stderr.startsWith("требования «")) throw new Error(`Выбранное требование «${selection.requirement}» недоступно`);
    if (result.stderr.startsWith("specs ещё не сформированы")) throw new Error("Просмотр доступен после формирования требований всех capability из proposal");
    if (result.stderr.startsWith("снимок не прочитан")) throw new Error("Выбранный снимок повреждён, недоступен или имеет неподдерживаемый формат");
    if (result.code === 2) throw new Error("Инструменты symphysis не поддерживают просмотр графа. Обнови инструменты.");
    throw new Error("Ядро отказало в получении выбранной части графа. Проверь источник и фильтры.");
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout); }
  catch { throw new Error("Ответ просмотра графа повреждён"); }
  return parseGraphView(value);
}

export function resolveGraphTarget(target: GraphTarget): string | null {
  if (!path.isAbsolute(target.file) || !path.isAbsolute(target.root)) return null;
  try {
    const root = fs.realpathSync(target.root);
    const file = fs.realpathSync(target.file);
    const relative = path.relative(root, file);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) && fs.statSync(file).isFile() ? file : null;
  } catch { return null; }
}
