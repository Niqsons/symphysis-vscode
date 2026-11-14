---
name: viewer
kind: доменный
dependencies:
  - repo: symphysis-vscode
    module: changes
  - repo: symphysis-vscode
    module: core
  - repo: symphysis-vscode
    module: file-links
  - repo: symphysis-vscode
    module: journal
  - repo: symphysis-vscode
    module: protocol
  - repo: symphysis-vscode
    module: scheme
  - repo: symphysis-vscode
    module: search
  - repo: symphysis-vscode
    module: step-help
  - repo: symphysis-vscode
    module: ui
---

# viewer

Просмотрщик журнала: вкладка на стороне VS Code (`viewerPanel.ts`) и «Внести» — единственный путь слова человека в журнал (`apply.ts`); страница — `page.tsx`, сборка кладёт её в `media/viewer.js`, — с `App.tsx` и режимами «решения» (`Card.tsx`, `ReturnPanel.tsx`), «проверка» (`CheckView.tsx`, `check.ts`) и «атака» (`AttackView.tsx`).

## Вложенные каталоги

Переход из req-graph вызывает `revealRecord(key, id)`. Панель открывает журнал источника и ждёт сообщения `journalPainted` от страницы с его данными, затем показывает нужную запись. Фильтры отдельной вкладки графа принадлежат модулю req-graph.

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
