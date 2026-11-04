// Страница справки на вкладке схемы: своя сборка с React (F-107). Считает хост, страница только показывает и просит. Переключатель заменяет страницу целиком: у схемы своя, с mermaid.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HelpHostMessage, HelpPageMessage, HelpView, PanelView } from "../shared/protocol";
import { HelpBody, type HelpActions, type ShownPage } from "./HelpBody";
import { Segmented } from "./Segmented";

declare const acquireVsCodeApi: () => { postMessage(m: HelpPageMessage): void };
const vscode = acquireVsCodeApi();
const post = (m: HelpPageMessage) => vscode.postMessage(m);

const PANELS: { value: PanelView; label: string }[] = [{ value: "scheme", label: "схема" }, { value: "help", label: "справка" }];

function HelpApp() {
  const [view, setView] = useState<HelpView | null>(null);
  const shownFor = useRef<string | null>(null);
  const [shown, setShown] = useState<ShownPage>({ step: null, rules: false });
  const actions = useMemo<HelpActions>(() => ({
    select: (step) => setShown({ step, rules: false }),
    toggleRules: () => setShown((s) => ({ ...s, rules: !s.rules })),
    openFile: (link, line) => post({ type: "helpOpenFile", link, line }),
    openSkill: (name) => post({ type: "helpOpenSkill", name }),
  }), []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent<HelpHostMessage>) => {
      if (ev.data.type !== "help") return;
      setView(ev.data.view);
      // Листание живёт, пока страница та же; другое изменение или шаг, которого больше нет, возвращают к текущему.
      const { name, outcome } = ev.data.view;
      const output = outcome?.kind === "output" ? outcome.output : null;
      const same = shownFor.current === name;
      shownFor.current = name;
      setShown((s) => (!same ? { step: null, rules: false } : s.step && !output?.steps.some((p) => p.id === s.step) ? { step: null, rules: s.rules } : s));
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
        {view && <HelpBody view={view} choose={(key) => post({ type: "helpChoose", key })} shown={shown} actions={actions} openPythonSetting={() => post({ type: "openPythonSetting" })} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<HelpApp />);
