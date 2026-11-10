import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { pageHtml } from "../ui/pageHtml";
import { GraphSession, initialSelection, type GraphNode, type GraphSelection, type GraphView } from "./graph";
import type { GraphSource } from "./graphCore";

interface GraphTab {
  source: GraphSource;
  panel: vscode.WebviewPanel;
  session: GraphSession;
  selection: GraphSelection;
  ready: boolean;
  choices: GraphView["choices"] | null;
}

export class GraphPanels implements vscode.Disposable {
  private readonly tabs = new Map<string, GraphTab>();
  private active: GraphTab | null = null;
  readonly messages = new vscode.EventEmitter<unknown>();

  constructor(private readonly deps: {
    context: vscode.ExtensionContext;
    request(source: GraphSource, selection: GraphSelection): Promise<GraphView>;
    navigate(node: GraphNode, source: GraphSource): Promise<void>;
  }) {}

  get webview(): vscode.Webview | null { return this.active?.panel.webview ?? null; }

  open(source: GraphSource): void {
    let file = source.snapshot;
    if (file) {
      try { file = fs.realpathSync(file); } catch { file = path.resolve(file); }
    }
    const key = file ? path.normalize(file).toLowerCase() : path.join(source.root, source.change);
    const existing = this.tabs.get(key);
    if (existing) { this.active = existing; existing.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel("symphysis.reqGraph", `Граф: ${source.change}`, vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true, enableFindWidget: true,
        localResourceRoots: [vscode.Uri.joinPath(this.deps.context.extensionUri, "media")] });
    const tab: GraphTab = { source: { ...source, snapshot: file }, panel, session: new GraphSession(), selection: initialSelection(), ready: false, choices: null };
    this.tabs.set(key, tab);
    this.active = tab;
    panel.webview.onDidReceiveMessage((message: unknown) => {
      this.messages.fire(message);
      void this.message(tab, message);
    });
    panel.onDidChangeViewState(() => { if (panel.active) this.active = tab; });
    panel.onDidDispose(() => { tab.ready = false; this.tabs.delete(key); if (this.active === tab) this.active = null; });
    panel.webview.html = pageHtml(panel.webview, this.deps.context, "req-graph.js", { before: ["mermaid.min.js"], inlineStyles: true });
    void this.load(tab);
  }

  dispose(): void {
    for (const tab of this.tabs.values()) tab.panel.dispose();
    this.messages.dispose();
  }

  private send(tab: GraphTab): void {
    if (tab.ready) void tab.panel.webview.postMessage({ type: "graph", revision: tab.session.revision,
      source: tab.source, selection: tab.selection, view: tab.session.current, loading: tab.session.loading, error: tab.session.error });
  }

  private async load(tab: GraphTab): Promise<void> {
    const pending = tab.session.load(() => this.deps.request(tab.source, { ...tab.selection }));
    const revision = tab.session.revision;
    this.send(tab);
    await pending;
    if (revision !== tab.session.revision) return;
    if (tab.session.current) tab.choices = tab.session.current.choices;
    this.send(tab);
  }

  private async message(tab: GraphTab, value: unknown): Promise<void> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const m = value as Record<string, unknown>;
    if (m.type === "graphReady") { tab.ready = true; this.send(tab); return; }
    if (m.type === "graphRefresh") { await this.load(tab); return; }
    if (m.type === "graphChoose") {
      if (typeof m.field !== "string" || !["capability", "requirement", "module"].includes(m.field) || typeof m.value !== "string") return;
      const field = m.field as "capability" | "requirement" | "module";
      const choices = tab.choices;
      const list = choices?.[field === "capability" ? "capabilities" : field === "requirement" ? "requirements" : "modules"];
      if (m.value && !list?.some((choice) => choice.id === m.value)) return;
      tab.selection[field] = m.value || null;
      if (field === "requirement") { tab.selection.capability = null; tab.selection.module = null; }
      else tab.selection.requirement = null;
      await this.load(tab);
      return;
    }
    if (m.type === "graphLinked" && typeof m.value === "boolean") {
      tab.selection.linked_only = m.value;
      await this.load(tab);
      return;
    }
    if (typeof m.revision !== "number" || !Number.isInteger(m.revision)) return;
    if (m.type === "graphRendered") { tab.session.rendered(m.revision); return; }
    if (m.type === "graphRenderFailed") { tab.session.renderFailed(m.revision); this.send(tab); return; }
    const node = m.type === "graphNode" ? tab.session.target(m.revision, m.key)
      : m.type === "graphInspect" ? tab.session.object(m.revision, m.id) : null;
    if (node) await this.deps.navigate(node, tab.source);
  }
}
