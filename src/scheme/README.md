---
name: scheme
kind: доменный
dependencies:
  - repo: symphysis-vscode
    module: core
  - repo: symphysis-vscode
    module: file-links
  - repo: symphysis-vscode
    module: protocol
  - repo: symphysis-vscode
    module: step-help
  - repo: symphysis-vscode
    module: ui
---

# scheme

Вкладка схемы решения: разбор `scheme.md`, правила масштаба и клика (`scheme.ts`), путь и чтение файла изменения (`schemeFile.ts`, его берёт и просмотрщик), вкладка на стороне VS Code — одна на окно, с ней и справка (`schemePanel.ts`); страница — `page.ts`, сборка кладёт её в `media/scheme.js`.

## Вложенные каталоги

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
