// Данные и последовательность ответов вкладки req-graph, без DOM и VS Code.
export interface GraphTarget { file: string; root: string; line: number; journal: boolean }
export interface GraphNode { id: string; kind: string; name: string; at: string; capability?: string; repo?: string; target?: GraphTarget }
export interface GraphSelection { capability: string | null; requirement: string | null; module: string | null; linked_only: boolean }
export interface GraphChoice { id: string; name: string; capability?: string; repo?: string }
export interface GraphView {
  view_format: 1;
  source: { kind: "live" | "snapshot"; change: string; preliminary: boolean };
  selection: GraphSelection;
  choices: { capabilities: GraphChoice[]; requirements: GraphChoice[]; modules: GraphChoice[] };
  text: string | null;
  elements: Record<string, GraphNode>;
  empty: boolean;
  unlinked: { scope: "change" | "selection"; items: GraphNode[] };
  diagnostics: { kind: string; at: string; reason: string }[];
  incomplete: boolean;
}

export const initialSelection = (): GraphSelection => ({ capability: null, requirement: null, module: null, linked_only: false });
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const strings = (value: Record<string, any>, keys: string[]) => keys.every((key) => typeof value[key] === "string");
const node = (value: unknown): boolean => record(value) && strings(value, ["id", "name", "kind", "at"])
  && (value.target === undefined || (record(value.target) && strings(value.target, ["file", "root"])
    && Number.isInteger(value.target.line) && value.target.line > 0 && typeof value.target.journal === "boolean"));

export function parseGraphView(value: unknown): GraphView {
  const v = value as Record<string, any>;
  const valid = record(v) && v.view_format === 1 && record(v.source) && ["live", "snapshot"].includes(v.source.kind)
    && typeof v.source.change === "string" && typeof v.source.preliminary === "boolean"
    && record(v.selection) && ["capability", "requirement", "module"].every((key) => v.selection[key] === null || typeof v.selection[key] === "string")
    && typeof v.selection.linked_only === "boolean" && record(v.choices)
    && ["capabilities", "requirements", "modules"].every((key) => Array.isArray(v.choices[key])
      && v.choices[key].every((item: unknown) => record(item) && strings(item, ["id", "name"])))
    && (v.text === null || typeof v.text === "string") && record(v.elements) && Object.values(v.elements).every(node)
    && record(v.unlinked) && ["change", "selection"].includes(v.unlinked.scope) && Array.isArray(v.unlinked.items) && v.unlinked.items.every(node)
    && Array.isArray(v.diagnostics) && v.diagnostics.every((item: unknown) => record(item) && strings(item, ["kind", "at", "reason"]))
    && typeof v.empty === "boolean" && typeof v.incomplete === "boolean";
  if (!valid) throw new Error("Ядро вернуло неподдерживаемый ответ просмотра графа. Обнови инструменты symphysis.");
  return value as GraphView;
}

export class GraphSession {
  revision = 0;
  current: GraphView | null = null;
  error: string | null = null;
  loading = false;
  private shown = 0;

  async load(request: () => Promise<unknown>): Promise<void> {
    const revision = ++this.revision;
    this.current = null;
    this.error = null;
    this.loading = true;
    this.shown = 0;
    try {
      const view = parseGraphView(await request());
      if (revision === this.revision) this.current = view;
    } catch (error) {
      if (revision === this.revision) this.error = error instanceof Error ? error.message : "Просмотр графа завершился отказом";
    } finally {
      if (revision === this.revision) this.loading = false;
    }
  }

  rendered(revision: number): void {
    if (revision === this.revision && this.current && !this.loading) this.shown = revision;
  }

  renderFailed(revision: number): void {
    if (revision !== this.revision) return;
    this.current = null;
    this.shown = 0;
    this.error = "Mermaid не смог отрисовать выбранную часть графа";
  }

  target(revision: number, key: unknown): GraphNode | null {
    const map = this.current?.elements;
    return revision === this.shown && typeof key === "string" && map && Object.hasOwn(map, key) ? map[key] : null;
  }

  object(revision: number, id: unknown): GraphNode | null {
    return revision === this.shown && typeof id === "string" ? this.current?.unlinked.items.find((item) => item.id === id) ?? null : null;
  }
}

export const graphFit = (width: number, height: number, panelWidth: number, panelHeight: number): number =>
  width > 0 && height > 0 && panelWidth > 0 && panelHeight > 0 ? Math.min(1, panelWidth / width, panelHeight / height) : 1;
