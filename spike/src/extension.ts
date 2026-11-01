import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import * as crypto from "node:crypto";

export interface PythonFound { path: string; version: string; tried: string[] }
export interface RunResult { code: number | null; stdout: string; stderr: string; ms: number }

const inside = (dir: string, parent: string) => {
  const rel = path.relative(parent.toLowerCase(), dir.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** `python`, затем `python3` по PATH: абсолютный путь, без относительных каталогов и без каталогов рабочей области. */
export function resolvePython(env: NodeJS.ProcessEnv, workspaceDirs: string[]): PythonFound | null {
  const entries = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const tried: string[] = [];
  for (const name of ["python", "python3"]) {
    for (const dir of entries) {
      if (!path.isAbsolute(dir) || workspaceDirs.some((w) => inside(dir, w))) continue;
      const file = path.join(dir, process.platform === "win32" ? `${name}.exe` : name);
      if (!fs.existsSync(file)) continue;
      tried.push(file);
      const r = spawnSync(file, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 10000 });
      if (!r.error && r.status === 0) return { path: file, version: (r.stdout || r.stderr).trim(), tried };
    }
  }
  return null;
}

export function runPython(python: string, args: string[], cwd: string, utf8Flag = true): Promise<RunResult> {
  const t0 = performance.now();
  return new Promise((resolve) => {
    execFile(python, utf8Flag ? ["-X", "utf8", ...args] : args,
      { cwd, encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({
        code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout, stderr, ms: performance.now() - t0,
      }));
  });
}

class Bus {
  private queue: any[] = [];
  private waiting: { type: string; resolve: (m: any) => void; timer: NodeJS.Timeout }[] = [];
  push(m: any) {
    const i = this.waiting.findIndex((w) => w.type === m.type);
    if (i < 0) { this.queue.push(m); return; }
    const [w] = this.waiting.splice(i, 1);
    clearTimeout(w.timer);
    w.resolve(m);
  }
  next(type: string, ms = 60000): Promise<any> {
    const i = this.queue.findIndex((m) => m.type === type);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`нет сообщения ${type} за ${ms} мс`)), ms);
      this.waiting.push({ type, resolve, timer });
    });
  }
  drain(type: string) { const out = this.queue.filter((m) => m.type === type); this.queue = this.queue.filter((m) => m.type !== type); return out; }
}

export class Page {
  readonly bus = new Bus();
  constructor(readonly panel: vscode.WebviewPanel) {
    panel.webview.onDidReceiveMessage((m) => this.bus.push(m));
  }
  post(m: any) { return this.panel.webview.postMessage(m); }
}

const STYLE = `
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:12px}
.card{border:1px solid var(--vscode-panel-border);border-radius:4px;padding:10px;margin:0 0 10px}
.card h3{margin:0 0 6px;font-size:1em}.id{color:var(--vscode-descriptionForeground);margin-right:6px}
label.opt{display:block;margin:4px 0}.ev{display:block;margin:2px 0 2px 22px;color:var(--vscode-descriptionForeground);font-size:.92em}
code{font-family:var(--vscode-editor-font-family)}.ok{color:var(--vscode-testing-iconPassed)}.bad{color:var(--vscode-testing-iconFailed)}
.rec{margin:6px 0;font-style:italic}textarea{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent)}
#scheme svg{max-width:100%;height:auto}`;

function pageHtml(webview: vscode.Webview, root: vscode.Uri, scripts: string[]): string {
  const nonce = crypto.randomBytes(16).toString("base64");
  const csp = [`default-src 'none'`, `img-src ${webview.cspSource} data:`, `font-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}' ${webview.cspSource}`].join("; ");
  const tags = scripts.map((s) => `<script nonce="${nonce}"${s.endsWith(".mjs") ? ' type="module"' : ""} src="${webview.asWebviewUri(vscode.Uri.joinPath(root, "media", s))}"></script>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${STYLE}</style></head><body><div id="root"></div><div id="scheme"></div>${tags}</body></html>`;
}

export class Spike {
  constructor(private readonly ctx: vscode.ExtensionContext) {}
  get workspaceDirs() { return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath); }
  get protoScript() { return path.join(this.ctx.extensionPath, "python", "view_json_proto.py"); }

  async open(kind: "viewer" | "scheme", title: string, column: vscode.ViewColumn): Promise<Page> {
    const root = this.ctx.extensionUri;
    const panel = vscode.window.createWebviewPanel(`symphysisSpike.${kind}`, title, { viewColumn: column, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(root, "media")] });
    const page = new Page(panel);
    const schemeScripts = process.env.SPIKE_SCHEME === "esm" ? ["esm-loader.mjs"] : ["mermaid.min.js", "scheme.js"];
    panel.webview.html = pageHtml(panel.webview, root, kind === "viewer" ? ["viewer.js"] : schemeScripts);
    await page.bus.next("ready");
    return page;
  }

  /** Ручной осмотр: первый журнал рабочей области в просмотрщике, scheme.md рядом; клик по узлу фильтрует карточки. */
  async openForHuman() {
    const dir = this.workspaceDirs[0];
    const python = resolvePython(process.env, this.workspaceDirs);
    if (!python) { void vscode.window.showErrorMessage("Python не найден: нет python и python3 в PATH вне рабочей области"); return; }
    const [journal] = await vscode.workspace.findFiles("openspec/changes/*/decisions.json", "**/archive/**", 1);
    if (!journal) { void vscode.window.showWarningMessage("В рабочей области нет openspec/changes/*/decisions.json"); return; }
    const tools = [".symphysis/tools", "tools"].map((t) => path.join(dir, t)).find((t) => fs.existsSync(path.join(t, "journal.py")));
    if (!tools) { void vscode.window.showErrorMessage("Нет .symphysis/tools/journal.py и tools/journal.py"); return; }
    const r = await runPython(python.path, [this.protoScript, tools, journal.fsPath], dir);
    if (r.code !== 0) { void vscode.window.showErrorMessage(`journal: код ${r.code}: ${r.stderr.slice(0, 300)}`); return; }
    const payload = JSON.parse(r.stdout);
    const viewer = await this.open("viewer", "Журнал (проба)", vscode.ViewColumn.One);
    await viewer.post({ type: "load", records: payload.records, sentAt: Date.now() });
    const schemeFile = path.join(path.dirname(journal.fsPath), "scheme.md");
    if (!fs.existsSync(schemeFile)) return;
    const block = /```mermaid\r?\n([\s\S]*?)```/.exec(fs.readFileSync(schemeFile, "utf8"));
    if (!block) return;
    const scheme = await this.open("scheme", "Схема (проба)", vscode.ViewColumn.Two);
    scheme.panel.webview.onDidReceiveMessage((m) => { if (m.type === "nodeClick") void viewer.post({ type: "filter", ids: payload.records.slice(0, 3).map((x: any) => x.id) }); });
    await scheme.post({ type: "render", label: "scheme.md", text: block[1] });
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  const spike = new Spike(ctx);
  ctx.subscriptions.push(vscode.commands.registerCommand("symphysisSpike.open", () => spike.openForHuman()));
  return { spike, resolvePython, runPython };
}
