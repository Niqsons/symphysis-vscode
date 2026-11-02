// Страница вкладки схемы: рисует `scheme.md` сборкой mermaid из пакета. Файл читает хост; страница его не меняет (F-25, F-103).
// React здесь не нужен: страница одна, состояние — масштаб, сдвиг и рисунок.
import type { SchemeHostMessage, SchemePageMessage, SchemeView } from "../shared/protocol";
import { blocksNote, fitScale, isClick, nodeIdOf, SVG_ID, zoomIn, zoomOut } from "../shared/scheme";

declare const acquireVsCodeApi: () => { postMessage(m: SchemePageMessage): void };
declare const mermaid: {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById("root")!;
root.innerHTML = `<div class="scheme-page">
  <div class="scheme-bar"><span class="scheme-name"></span><span class="spacer"></span>
    <button type="button" class="small" data-zoom="out" title="уменьшить">−</button>
    <button type="button" class="small" data-zoom="in" title="увеличить">+</button>
    <button type="button" class="small" data-zoom="fit" title="показать схему целиком">вписать</button></div>
  <div id="plates"></div>
  <div id="stage"><div id="canvas"></div></div>
  <pre id="source" hidden></pre>
</div>`;
const nameEl = root.querySelector<HTMLElement>(".scheme-name")!;
const plates = document.getElementById("plates")!;
const stage = document.getElementById("stage")!;
const canvas = document.getElementById("canvas")!;
const source = document.getElementById("source")!;

let scale = 1, x = 0, y = 0, shownText: string | null = null, seq = 0, flowchart = false;

function place() {
  canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  canvas.dataset.scale = String(scale);
  canvas.dataset.x = String(x);
  canvas.dataset.y = String(y);
}

function showPlates(items: { text: string; signal?: boolean; line?: number | null; open?: boolean }[]) {
  plates.replaceChildren(...items.map((p) => {
    const note = document.createElement("div");
    note.className = `note block${p.signal ? " signal" : ""}`;
    note.textContent = p.text;
    if (p.open) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "small";
      button.textContent = "Открыть scheme.md";
      button.onclick = () => vscode.postMessage({ type: "schemeOpenFile", line: p.line ?? null });
      note.append(" ", button);
    }
    return note;
  }));
}

/** Натуральный размер, верхний узел посередине: иначе вкладка пуста, пока не прокрутишь (F-29, F-35, F-122). */
function startPosition() {
  scale = 1;
  x = 0;
  y = 0;
  place();
  const nodes = [...canvas.querySelectorAll<SVGGraphicsElement>("g.node")];
  if (nodes.length) {
    const box = (n: Element) => n.getBoundingClientRect();
    const top = nodes.reduce((a, b) => (box(b).top < box(a).top ? b : a));
    x = stage.clientWidth / 2 - (box(top).left + box(top).width / 2 - box(canvas).left);
  }
  y = 8;
  place();
}

function naturalSize(): { width: number; height: number } | null {
  const vb = canvas.querySelector("svg")?.viewBox?.baseVal;
  return vb?.width ? { width: vb.width, height: vb.height } : null;
}

function clearDrawing() {
  canvas.replaceChildren();
  shownText = null;
  flowchart = false;
  source.hidden = true;
  stage.dataset.state = "";
}

/** Сообщение mermaid при незакрытой скобке называет конец текста: верная строка — в `hash.loc`, от начала блока; поля может не быть (F-28, F-61, F-71). */
function errorText(e: unknown, firstLine: number | null): { text: string; line: number | null } {
  const err = e as { hash?: { loc?: { first_line?: number } }; message?: string } | null;
  const inBlock = err?.hash?.loc?.first_line;
  const line = typeof inBlock === "number" && firstLine ? inBlock + firstLine - 1 : null;
  const message = String(err?.message ?? e).replace(/^Parse error on line \d+:?\s*/, "");
  return { text: `Ошибка mermaid${line ? `, строка ${line} в scheme.md` : ""}:\n${message}`, line };
}

async function draw(view: SchemeView) {
  const mine = ++seq;
  nameEl.textContent = view.name;
  if (!view.exists) {
    clearDrawing();
    stage.dataset.state = "missing";
    return showPlates([{ text: "Схема не создана" }]);
  }
  if (view.text === null) {
    clearDrawing();
    stage.dataset.state = "empty";
    return showPlates([{ text: "В scheme.md нет схемы", open: true }]);
  }
  const blocks = view.blocks > 1 ? [{ text: blocksNote(view.blocks) }] : [];
  if (view.text === shownText) return showPlates(blocks);
  // mermaid убирает из страницы элемент с этим идентификатором ещё до разбора: прежний рисунок при ошибке надо вернуть.
  const kept = canvas.innerHTML;
  try {
    const { svg } = await mermaid.render(SVG_ID, view.text);
    if (mine !== seq) return;
    canvas.innerHTML = svg;
    const el = canvas.querySelector("svg")!;
    const size = naturalSize();
    if (size) {
      el.style.width = `${size.width}px`;
      el.style.height = `${size.height}px`;
      el.style.maxWidth = "none";
    }
    flowchart = (el.getAttribute("aria-roledescription") ?? "").startsWith("flowchart");
    shownText = view.text;
    source.hidden = true;
    stage.dataset.state = "svg";
    showPlates(blocks);
    startPosition();
  } catch (e) {
    if (mine !== seq) return;
    const { text, line } = errorText(e, view.first_line);
    showPlates([...blocks, { text, signal: true, line, open: true }]);
    // Рисунок уже есть — остаётся прежний: правка могла быть сохранена на середине (F-28).
    if (shownText !== null) {
      canvas.innerHTML = kept;
      return;
    }
    source.textContent = view.text;
    source.hidden = false;
    stage.dataset.state = "text";
  }
}

root.addEventListener("click", (e) => {
  const zoom = (e.target as HTMLElement).closest<HTMLElement>("[data-zoom]")?.dataset.zoom;
  if (!zoom) return;
  const size = naturalSize();
  if (zoom === "fit" && size) {
    scale = fitScale(size.width, size.height, stage.clientWidth, stage.clientHeight);
    x = Math.max(0, (stage.clientWidth - size.width * scale) / 2);
    y = 0;
  } else {
    // Масштаб вокруг середины вкладки: то, на что смотришь, остаётся на месте.
    const next = zoom === "in" ? zoomIn(scale) : zoomOut(scale);
    const cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
    x = cx - ((cx - x) * next) / scale;
    y = cy - ((cy - y) * next) / scale;
    scale = next;
  }
  place();
});

// Перетаскивание зажатой мышью без переключателя; сдвиг в пределах порога остаётся кликом по узлу (F-29, F-68).
let press: { x: number; y: number; startX: number; startY: number; target: Element; moved: boolean } | null = null;
stage.addEventListener("pointerdown", (e) => {
  press = { x: e.clientX, y: e.clientY, startX: x, startY: y, target: e.target as Element, moved: false };
  try { stage.setPointerCapture(e.pointerId); } catch { /* событие не от настоящего указателя */ }
});
stage.addEventListener("pointermove", (e) => {
  if (!press) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.moved && isClick(dx, dy)) return;
  press.moved = true;
  x = press.startX + dx;
  y = press.startY + dy;
  place();
});
stage.addEventListener("pointerup", () => {
  if (!press) return;
  const { moved, target } = press;
  press = null;
  if (moved || !flowchart) return;
  const id = nodeIdOf(target.closest("g.node")?.id ?? "");
  if (id) vscode.postMessage({ type: "schemeNode", id });
});
stage.addEventListener("pointercancel", () => { press = null; });

window.addEventListener("message", (ev: MessageEvent<SchemeHostMessage | { type: string }>) => {
  if (ev.data.type === "scheme") void draw((ev.data as SchemeHostMessage).view);
});

const dark = !document.body.classList.contains("vscode-light");
mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", suppressErrorRendering: true });
place();
vscode.postMessage({ type: "schemeReady" });
