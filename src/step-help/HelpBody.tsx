// Что показывает справка: вывод ядра, список на выбор или отказ. Текст о шаге идёт только из вывода, своих текстов о шагах нет (F-38).
// Весь текст проходит через React: разметка из вывода не создаётся, готовый HTML на страницу не ставится.
import { ownLink } from "../file-links/links";
import type { HelpView } from "../protocol/protocol";
import type { StepHelpOutput, StepHelpPage } from "../protocol/types";
import { FailureText } from "../ui/FailureText";
import { FileLink, LinksContext, Text } from "../ui/Text";

const TURN = { human: "ход человека", model: "ход модели" };
const INTENT = "intent";

/** Что листает человек: страница шага (`null` — текущий) и раздел правил намерения. Отметка текущего от этого не зависит. */
export interface ShownPage {
  step: string | null;
  rules: boolean;
}

export interface HelpActions {
  select(id: string): void;
  toggleRules(): void;
  openFile(key: string, line: number | null): void;
  openSkill(name: string): void;
}

const NO_ACTIONS: HelpActions = { select: () => {}, toggleRules: () => {}, openFile: () => {}, openSkill: () => {} };

/** Подписи разделов текста шага: слова подразделов `steps.md` ядра, человек сверяет страницу с файлом. Сами тексты приходят из вывода. */
const SECTIONS: { key: keyof StepHelpPage["texts"]; label: string; code?: boolean }[] = [
  { key: "why", label: "Зачем" },
  { key: "mechanics", label: "Механики" },
  { key: "if_skipped", label: "Если пропустить" },
  { key: "what_to_check", label: "Что смотреть" },
  { key: "command", label: "Команда", code: true },
];

export const SECTION_LABELS = SECTIONS.map((s) => s.label);

type Links = StepHelpOutput["file_links"];

function Files({ page, links }: { page: StepHelpPage; links: Links }) {
  if (page.files.length === 0 && !page.file_note) return null;
  return (
    <div className="help-files">
      {page.files.length > 0 && <b>Файлы:</b>}
      <ul>
        {page.files.map((f) => (
          <li key={f.path}>{f.exists && ownLink(links, f.path) !== null ? <FileLink link={{ key: f.path, line: null }}><code>{f.path}</code></FileLink> : <code>{f.path}</code>}</li>
        ))}
      </ul>
      {page.file_note && <div className="muted">{page.file_note}</div>}
    </div>
  );
}

function Skills({ page, links, openSkill }: { page: StepHelpPage; links: Links; openSkill(name: string): void }) {
  const skills = page.skills ?? [];
  if (skills.length === 0) return null;
  return (
    <div className="help-skills">
      <b>Скиллы:</b>
      <ul>
        {skills.map((s) => {
          const shown = <code>{s.name}</code>;
          let body = shown;
          if (s.path && s.base === "project" && ownLink(links, s.path) !== null) body = <FileLink link={{ key: s.path, line: null }}>{shown}</FileLink>;
          else if (s.path && s.base === "install") {
            body = <a className="filelink" role="link" tabIndex={0} data-skill={s.name} onClick={(e) => { e.preventDefault(); openSkill(s.name); }} onKeyDown={(e) => { if (e.key === "Enter") openSkill(s.name); }}>{shown}</a>;
          }
          return <li key={s.name}>{body}</li>;
        })}
      </ul>
    </div>
  );
}

function StepPage({ page, links, openSkill }: { page: StepHelpPage; links: Links; openSkill(name: string): void }) {
  return (
    <section className="help-page" data-step={page.id}>
      <h2><Text s={page.texts.title || page.id} /></h2>
      <div className="muted">{page.id} · {TURN[page.turn]}{page.optional ? " · можно пропустить" : ""}</div>
      {page.text_note && <div className="note block">{page.text_note}</div>}
      {SECTIONS.map((s) => page.texts[s.key] && (
        <div className="help-section" key={s.key}>
          <b>{s.label}</b>
          <div className="help-text">{s.code ? <code>{page.texts[s.key]}</code> : <Text s={page.texts[s.key]} />}</div>
        </div>
      ))}
      {page.waits_for.length > 0 && <div className="muted">ждёт: {page.waits_for.join(", ")}</div>}
      <Files page={page} links={links} />
      <Skills page={page} links={links} openSkill={openSkill} />
    </section>
  );
}

function Output({ output, shown, actions, pluginVersion }: { output: StepHelpOutput; shown: ShownPage; actions: HelpActions; pluginVersion: string }) {
  const links = output.file_links;
  const stepId = shown.step ?? output.current_step ?? output.steps[0]?.id ?? null;
  const page = output.steps.find((s) => s.id === stepId);
  const intent = output.steps.find((s) => s.id === INTENT);
  return (
    <LinksContext.Provider value={{ links, open: actions.openFile }}>
      {output.current_step && <div className="help-current"><b>{output.current_step}</b>{output.turn && ` · ${TURN[output.turn]}`}</div>}
      {output.current_text && <p><Text s={output.current_text} /></p>}
      {output.error && <div className="note signal block">{output.error}</div>}
      <ol className="help-steps">
        {output.steps.map((s) => (
          <li key={s.id} className={[s.id === output.current_step ? "current" : "", s.id === page?.id && !shown.rules ? "shown" : ""].filter(Boolean).join(" ") || undefined} aria-current={s.id === output.current_step ? "step" : undefined}>
            <button type="button" className="step" onClick={() => actions.select(s.id)}>{s.id}</button>
          </li>
        ))}
      </ol>
      {intent && (
        <div className="row">
          <button type="button" className="small" aria-pressed={shown.rules} onClick={actions.toggleRules}>Как готовить intent.md?</button>
        </div>
      )}
      {shown.rules && intent
        ? <section className="help-page" data-rules><h2>Как готовить intent.md</h2><div className="help-text"><Text s={intent.texts.how_to_prepare || intent.text_note || ""} /></div></section>
        : page && (
          <>
            <div className="help-nav">
              <button type="button" className="small" disabled={!page.prev} onClick={() => page.prev && actions.select(page.prev)}>предыдущий</button>
              <button type="button" className="small" disabled={!page.next} onClick={() => page.next && actions.select(page.next)}>следующий</button>
            </div>
            <StepPage page={page} links={links} openSkill={actions.openSkill} />
          </>
        )}
      <footer className="help-versions muted">
        форк {output.versions.openspec ?? "неизвестно"} · symphysis {output.versions.symphysis ?? "неизвестно"} · плагин {pluginVersion}
      </footer>
    </LinksContext.Provider>
  );
}

export function HelpBody({ view, choose, openPythonSetting, shown = { step: null, rules: false }, actions = NO_ACTIONS }: {
  view: HelpView;
  choose(key: string): void;
  openPythonSetting(): void;
  shown?: ShownPage;
  actions?: HelpActions;
}) {
  if (view.panel === "scheme") return <div className="note block">Изменение не выбрано. Выбери его в списке «Изменения», и здесь появится его схема.</div>;
  const { outcome } = view;
  if (!outcome) return <div className="muted">Считается…</div>;
  switch (outcome.kind) {
    case "output":
      return <Output output={outcome.output} shown={shown} actions={actions} pluginVersion={view.pluginVersion} />;
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
