// Боковая панель: изменения проекта со счётчиками и оглавление выбранного журнала.
import * as vscode from "vscode";
import { recordMark } from "../shared/ops";
import { emptyDraft } from "../shared/logic";
import type { CoreFailure } from "../shared/protocol";
import type { Draft, JournalRecord } from "../shared/types";
import type { ChangeState, JournalStore } from "./store";

function failureLine(f: CoreFailure): string {
  switch (f.kind) {
    case "no-journal": return "журнала нет";
    case "no-tools": return "нет инструментов symphysis";
    case "no-python": return "Python не найден";
    case "old-core": return "старые инструменты: обнови symphysis";
    case "invalid-journal": return "журнал негоден";
    case "timeout": return "Python не ответил";
    case "crash": return "ядро не отработало";
  }
}

/** Статус атак из frontmatter файлов: `decisions.md: passed`; битый файл называется. */
function attackLine(state: ChangeState): string {
  return (state.payload?.attacks ?? []).map((a) => {
    const name = a.path.split(/[\\/]/).pop()?.replace(/\.md$/, "");
    if (a.error) return `${name}: битый файл`;
    return `${name}: ${a.frontmatter?.status ?? "?"}`;
  }).join(", ");
}

export class ChangesProvider implements vscode.TreeDataProvider<ChangeState> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly store: JournalStore, private readonly multiRoot: () => boolean) {}

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(): ChangeState[] {
    return this.store.list().sort((a, b) => a.ref.name.localeCompare(b.ref.name));
  }

  getTreeItem(state: ChangeState): vscode.TreeItem {
    const item = new vscode.TreeItem(state.ref.name);
    item.id = state.ref.dir;
    item.command = { command: "symphysis.openChange", title: "Открыть журнал", arguments: [state.ref.dir] };
    const parts: string[] = [];
    const s = state.payload?.stats;
    if (s) parts.push(`открыто ${s.forks - s.decided} · решено ${s.decided}`);
    const attacks = attackLine(state);
    if (attacks) parts.push(attacks);
    if (state.failure) parts.push(failureLine(state.failure));
    if (!s && !state.failure) parts.push(state.loading ? "читается…" : "");
    if (this.multiRoot()) parts.push(vscode.workspace.asRelativePath(state.ref.root, true));
    item.description = parts.filter(Boolean).join(" · ");
    item.tooltip = [state.ref.dir, ...parts].join("\n");
    const blocking = state.failure && state.failure.kind !== "no-journal";
    item.iconPath = blocking
      ? new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground"))
      : s && s.forks > s.decided
        ? new vscode.ThemeIcon("circle-large-outline", new vscode.ThemeColor("problemsWarningIcon.foreground"))
        : new vscode.ThemeIcon(state.failure ? "circle-slash" : "pass");
    return item;
  }
}

const MARK_ICON: Record<ReturnType<typeof recordMark>, vscode.ThemeIcon> = {
  fact: new vscode.ThemeIcon("book"),
  open: new vscode.ThemeIcon("circle-large-outline", new vscode.ThemeColor("problemsWarningIcon.foreground")),
  parked: new vscode.ThemeIcon("bookmark"),
  decided: new vscode.ThemeIcon("pass"),
  changed: new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("problemsWarningIcon.foreground")),
};

export class TocProvider implements vscode.TreeDataProvider<JournalRecord> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private key: string | null = null;
  private draft: Draft = emptyDraft();

  constructor(private readonly store: JournalStore) {}

  show(key: string | null): void {
    this.key = key;
    this.emitter.fire();
  }

  setDraft(key: string, draft: Draft): void {
    if (key !== this.key) return;
    this.draft = draft;
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  getChildren(): JournalRecord[] {
    return (this.key ? this.store.get(this.key)?.payload?.records : null) ?? [];
  }

  getTreeItem(rec: JournalRecord): vscode.TreeItem {
    const item = new vscode.TreeItem(rec.id);
    const payload = this.key ? this.store.get(this.key)?.payload : null;
    item.id = rec.id;
    item.description = rec.question.replace(/`/g, "");
    item.tooltip = rec.question;
    item.iconPath = payload ? MARK_ICON[recordMark(payload, this.draft, rec)] : undefined;
    item.command = { command: "symphysis.revealRecord", title: "Показать запись", arguments: [rec.id] };
    return item;
  }
}
