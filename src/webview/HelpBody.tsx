// Что показывает справка: вывод ядра, список на выбор или отказ. Текст о шаге идёт только из вывода, своих текстов о шагах нет (F-38).
import type { HelpView } from "../shared/protocol";
import type { StepHelpOutput } from "../shared/types";
import { FailureText } from "./FailureText";

const TURN = { human: "ход человека", model: "ход модели" };

function Output({ output }: { output: StepHelpOutput }) {
  return (
    <>
      {output.current_step && <div className="help-current"><b>{output.current_step}</b>{output.turn && ` · ${TURN[output.turn]}`}</div>}
      {output.current_text && <p>{output.current_text}</p>}
      {output.error && <div className="note signal block">{output.error}</div>}
      <ol className="help-steps">
        {output.steps.map((s) => <li key={s.id} className={s.id === output.current_step ? "current" : undefined} aria-current={s.id === output.current_step ? "step" : undefined}>{s.id}</li>)}
      </ol>
    </>
  );
}

export function HelpBody({ view, choose, openPythonSetting }: { view: HelpView; choose(key: string): void; openPythonSetting(): void }) {
  if (view.panel === "scheme") return <div className="note block">Изменение не выбрано. Выбери его в списке «Изменения», и здесь появится его схема.</div>;
  const { outcome } = view;
  if (!outcome) return <div className="muted">Считается…</div>;
  switch (outcome.kind) {
    case "output":
      return <Output output={outcome.output} />;
    case "failure":
      return <div className="note signal block"><FailureText failure={outcome.failure} openPythonSetting={openPythonSetting} /></div>;
    case "choice":
      return (
        <>
          <p>Активных изменений несколько. Выбери, какое показать:</p>
          <ul className="help-choices">
            {outcome.choices.map((c) => <li key={c.key}><button type="button" className="small" onClick={() => choose(c.key)}>{c.folder ? `${c.change} · ${c.folder}` : c.change}</button></li>)}
          </ul>
        </>
      );
  }
}
