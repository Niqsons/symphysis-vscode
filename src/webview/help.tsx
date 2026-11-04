// Страница справки на вкладке схемы: своя сборка с React (F-107). Считает хост, страница только показывает и просит. Переключатель заменяет страницу целиком: у схемы своя, с mermaid.
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HelpHostMessage, HelpPageMessage, HelpView, PanelView } from "../shared/protocol";
import { HelpBody, type HelpActions } from "./HelpBody";
import { keepShown, type ShownState } from "./helpShown";
import { Segmented } from "./Segmented";

declare const acquireVsCodeApi: () => { postMessage(m: HelpPageMessage): void };
const vscode = acquireVsCodeApi();
const post = (m: HelpPageMessage) => vscode.postMessage(m);

const PANELS: { value: PanelView; label: string }[] = [{ value: "scheme", label: "схема" }, { value: "help", label: "справка" }];

function HelpApp() {
  const [view, setView] = useState<HelpView | null>(null);
  const [state, setState] = useState<ShownState>({ key: null, shown: { step: null, rules: false } });
  const actions = useMemo<HelpActions>(() => ({
    select: (step) => setState((s) => ({ ...s, shown: { step, rules: false } })),
    toggleRules: () => setState((s) => ({ ...s, shown: { ...s.shown, rules: !s.shown.rules } })),
    openFile: (link, line) => post({ type: "helpOpenFile", link, line }),
    openSkill: (name) => post({ type: "helpOpenSkill", name }),
  }), []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<HelpHostMessage>) => {
      if (ev.data.type !== "help") return;
      const next = ev.data.view;
      setView(next);
      setState((s) => keepShown(s, next));
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
        <button type="button" className="small" title="Пересчитать справку сейчас" onClick={() => post({ type: "helpRefresh" })}>Обновить</button>
      </div>
      <main className="help-body">
        {view && <HelpBody view={view} choose={(key) => post({ type: "helpChoose", key })} shown={state.shown} actions={actions} openPythonSetting={() => post({ type: "openPythonSetting" })} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<HelpApp />);
