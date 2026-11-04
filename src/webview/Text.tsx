// Текст журнала и справки со ссылками на файлы. Общее для страниц: просмотрщика и справки. Единственная разметка данных — пары backticks, остальное React показывает текстом.
import { createContext, useContext, type MouseEvent } from "react";
import { linkOf, type FileLinks } from "../shared/links";

/** Карта ссылок последнего показанного вывода и открытие файла: страница даёт их сверху, без карты всё остаётся кодом (F-44). */
export interface LinksValue {
  links: FileLinks | undefined;
  open(key: string, line: number | null): void;
}
export const LinksContext = createContext<LinksValue>({ links: undefined, open: () => {} });

/** Нажатие ссылки открывает файл и не доходит ни до метки варианта, ни до якорей страницы. */
export function clickLink(e: Pick<MouseEvent, "preventDefault" | "stopPropagation">, open: LinksValue["open"], key: string, line: number | null): void {
  e.preventDefault();
  e.stopPropagation();
  open(key, line);
}

export const FileLink = ({ link, children }: { link: { key: string; line: number | null }; children: React.ReactNode }) => {
  const { open } = useContext(LinksContext);
  return (
    <a className="filelink" role="link" tabIndex={0} data-file-link={link.key} data-file-line={link.line ?? undefined} onClick={(e) => clickLink(e, open, link.key, link.line)} onKeyDown={(e) => { if (e.key === "Enter") clickLink(e, open, link.key, link.line); }}>
      {children}
    </a>
  );
};

/** Ссылкой становится только текст из карты. */
export const Text = ({ s }: { s: string }) => {
  const { links } = useContext(LinksContext);
  return <>{String(s ?? "").split(/`([^`]+)`/).map((part, i) => {
    if (i % 2 === 0) return part;
    const link = linkOf(links, part);
    return link ? <FileLink key={i} link={link}><code>{part}</code></FileLink> : <code key={i}>{part}</code>;
  })}</>;
};

