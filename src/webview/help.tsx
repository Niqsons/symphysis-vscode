// Страница справки на вкладке схемы: своя сборка с React (F-107). Считает хост, страница только показывает и просит. Переключатель заменяет страницу целиком: у схемы своя, с mermaid.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HelpHostMessage, HelpPageMessage, HelpView, PanelView } from "../shared/protocol";
import { HelpBody } from "./HelpBody";
import { Segmented } from "./Segmented";

declare const acquireVsCodeApi: () => { postMessage(m: HelpPageMessage): void };
const vscode = acquireVsCodeApi();
const post = (m: HelpPageMessage) => vscode.postMessage(m);

const PANELS: { value: PanelView; label: string }[] = [{ value: "scheme", label: "схема" }, { value: "help", label: "справка" }];

function HelpApp() {
  const [view, setView] = useState<HelpView | null>(null);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<HelpHostMessage>) => {
      if (ev.data.type === "help") setView(ev.data.view);
    };
    window.addEventListener("message", onMessage);
    post({ type: "helpReady" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="scheme-page">
      <div className="scheme-bar">
        <Segmented className="panel-switch" items={PANELS} value={view?.panel ?? "help"} onChange={(next) => post({ type: "panelView", view: next })} />
        <span className="scheme-name">{view?.name}</span>
      </div>
      <main className="help-body">
        {view && <HelpBody view={view} choose={(key) => post({ type: "helpChoose", key })} openPythonSetting={() => post({ type: "openPythonSetting" })} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<HelpApp />);
