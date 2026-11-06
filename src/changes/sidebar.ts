// Боковая панель: изменения проекта со счётчиками, оглавление журнала и оглавление атаки.
import * as vscode from "vscode";
import { attackOutline, verdictState, type OutlineFile, type OutlineLens, type OutlineRow } from "../journal/attack";
import { recordMark } from "../journal/ops";
import { emptyDraft } from "../journal/logic";
import type { CoreFailure } from "../protocol/protocol";
import type { Draft, JournalRecord } from "../protocol/types";
import type { ChangeState, JournalStore } from "./store";

function failureLine(f: CoreFailure): string {
  switch (f.kind) {
    case "no-journal": return "журнала нет";
    case "no-tools": return "нет инструментов symphysis";
    case "tools-path": return "symphysis.toolsPath мимо инструментов";
    case "no-python": return "Python не найден";
    case "old-core": return "старые инструменты: обнови symphysis";
    case "contract": return f.need === "vsix" ? "инструменты новее плагина: поставь новый .vsix" : "старые инструменты: обнови symphysis";
    case "invalid-journal": return "журнал негоден";
    case "timeout": return "Python не ответил";
    case "crash": return "ядро не отработало";
  }
}

/** Статус атак из frontmatter файлов: `decisions: passed`; битый файл и устаревший вердикт называются. */
function attackLine(state: ChangeState): string {
  const parts = (state.payload?.attacks ?? []).map((a) => {
    const name = a.path.split("/").pop()?.replace(/\.md$/, "");
    if (a.error) return `${name}: битый файл`;
    const stale = verdictState(a, state.payload?.sha256) === "stale" ? ", устарел" : "";
    return `${name}: ${a.frontmatter?.status || "?"}${stale}`;
  });
  // Атака журнала идёт раньше атаки артефактов и важнее: строка в панели обрезается справа.
  return parts.sort((a, b) => Number(b.startsWith("decisions")) - Number(a.startsWith("decisions"))).join(" · ");
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
    this.draft = emptyDraft();
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

type OutlineNode = OutlineFile | OutlineLens | OutlineRow;

const SEVERITY_ICON: Record<OutlineRow["level"], vscode.ThemeIcon> = {
  signal: new vscode.ThemeIcon("error", new vscode.ThemeColor("problemsErrorIcon.foreground")),
  accent: new vscode.ThemeIcon("warning", new vscode.ThemeColor("problemsWarningIcon.foreground")),
  muted: new vscode.ThemeIcon("info"),
  plain: new vscode.ThemeIcon("circle-outline"),
};

const weights = (n: { blockers: number; warnings: number }) =>
  [n.blockers ? `блокеров ${n.blockers}` : "", n.warnings ? `предупреждений ${n.warnings}` : ""].filter(Boolean);

/** Оглавление режима «атака»: отдельный список, потому что у него свои записи и свой режим; клик сам переводит страницу в «атаку». */
export class AttackTocProvider implements vscode.TreeDataProvider<OutlineNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private key: string | null = null;

  constructor(private readonly store: JournalStore) {}

  show(key: string | null): void {
    this.key = key;
    this.emitter.fire();
  }

  refresh(): void {
    this.emitter.fire();
  }

  /** Сказать вслух, почему список пуст; пустое дерево выглядит как поломка. */
  message(): string | undefined {
    if (!this.key) return "Журнал не открыт.";
    return this.files().length ? undefined : "Атаки ещё нет: у изменения нет файлов attack/*.md.";
  }

  private files(): OutlineFile[] {
    const payload = this.key ? this.store.get(this.key)?.payload : null;
    return payload ? attackOutline(payload.attacks, payload.sha256) : [];
  }

  getChildren(node?: OutlineNode): OutlineNode[] {
    if (!node) return this.files();
    return node.kind === "file" ? node.lenses : node.kind === "lens" ? node.rows : [];
  }

  getTreeItem(node: OutlineNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.kind === "file" ? node.name : node.kind === "lens" ? node.title : node.section);
    item.id = `${this.key}|${node.anchor}`;
    item.command = { command: "symphysis.revealAttack", title: "Показать в атаке", arguments: [node.anchor] };
    switch (node.kind) {
      case "file": {
        const parts = node.error ? ["битый файл"] : [node.status || "?", ...(node.stale ? ["устарел"] : []), ...weights(node)];
        item.description = parts.join(" · ");
        item.tooltip = node.error ?? parts.join("\n");
        item.iconPath = node.error ? SEVERITY_ICON.signal : new vscode.ThemeIcon("file");
        item.collapsibleState = node.lenses.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
        break;
      }
      case "lens":
        item.description = [String(node.count), ...weights(node)].join(" · ");
        item.tooltip = [node.title, node.label].filter(Boolean).join(" — ");
        item.iconPath = node.blockers ? SEVERITY_ICON.signal : node.warnings ? SEVERITY_ICON.accent : SEVERITY_ICON.muted;
        item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        break;
      case "row":
        item.description = node.claim;
        item.tooltip = `${node.severity}\n${node.claim}`;
        item.iconPath = SEVERITY_ICON[node.level];
        break;
    }
    return item;
  }
}
