// Запуски хука по папкам. Без `vscode`: настройка, Python, окно и память приходят параметрами, связь с окном живёт в `extension.ts`.
import path from "node:path";
import { hookCondition, installHookScript } from "./hook";
import { installClient, removeHook, type HookClient } from "./hookGit";
import type { PythonResolution } from "../core/python";

export interface HookDeps {
  extensionPath: string;
  enabled(root: string): boolean;
  python(): PythonResolution;
  toolsPath(): string | undefined;
  git(): string | null;
  window: { showWarningMessage(message: string): unknown };
  memory: { get<T>(key: string): T | undefined; update(key: string, value: unknown): unknown };
}

const CLIENTS: HookClient[] = ["claude", "opencode"];

/**
 * Один запуск для папки, возвращает причины отказов. Выключено: снятие, Python не нужен и не проверяется. Условия нет: ничего не пишется и не снимается, снять насовсем можно только настройкой.
 * «Python не найден» и настройка мимо инструментов причинами не считаются: их называет просмотрщик. Скрипт идёт после клиентов: все отказали — файлов хука нет.
 */
export async function syncHook(root: string, deps: HookDeps): Promise<string[]> {
  if (!deps.enabled(root)) return removeHook(root, deps.git());
  const condition = hookCondition(root, deps.python(), deps.toolsPath());
  if (!condition.met) return [];
  const git = deps.git();
  const reasons: string[] = [];
  let installed = false;
  for (const client of CLIENTS) {
    if (!condition[client]) continue;
    const r = await installClient(root, client, condition.python, git);
    if (r.ok) installed = true;
    else reasons.push(r.reason);
  }
  if (installed) {
    const script = installHookScript(root, deps.extensionPath);
    if (!script.ok) reasons.push(script.reason);
  }
  return reasons;
}

/** Один текст для всех отказов, с файлом и тем, что сделать (F-103). */
const warningText = (root: string, reason: string) =>
  `Хук Symphysis в проекте «${path.basename(root)}»: ${reason}. Устрани причину и перезагрузи окно, плагин проверит снова. Выключить хук можно настройкой symphysis.hook.enabled.`;

/**
 * Запуски для одной папки идут по одному, просьбы на время запуска склеиваются в один следующий: активация, смена настройки и появление инструментов могут совпасть.
 * `request` не ждёт и не бросает: работа начинается после возврата, поэтому активация её не ждёт.
 */
export class HookRunner {
  private readonly running = new Map<string, Promise<void>>();
  private readonly again = new Set<string>();

  constructor(private readonly deps: HookDeps) {}

  request(root: string): void {
    if (this.running.has(root)) {
      this.again.add(root);
      return;
    }
    this.running.set(root, this.drain(root));
  }

  /** Для тестов: конец всех запусков, и начатых за время ожидания тоже. */
  async whenIdle(): Promise<void> {
    while (this.running.size) await Promise.all(this.running.values());
  }

  private async drain(root: string): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
    do {
      this.again.delete(root);
      await this.once(root);
    } while (this.again.has(root));
    this.running.delete(root);
  }

  private async once(root: string): Promise<void> {
    let reasons: string[];
    try {
      reasons = await syncHook(root, this.deps);
    } catch (e) {
      reasons = [String(e)];
    }
    try {
      for (const reason of reasons) this.warnOnce(root, reason);
    } catch { /* окно не приняло предупреждение: следующий запуск важнее */ }
  }

  /** Один раз на проект и причину, память в `workspaceState`. Без модальности и без ожидания ответа: иначе запуск встал бы до ответа человека (F-103). */
  private warnOnce(root: string, reason: string): void {
    const key = `symphysis.hook.warned:${root}:${reason}`;
    if (this.deps.memory.get<boolean>(key)) return;
    void this.deps.memory.update(key, true);
    void this.deps.window.showWarningMessage(warningText(root, reason));
  }
}
