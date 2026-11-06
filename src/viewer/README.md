---
name: viewer
kind: доменный
---

# viewer

Просмотрщик журнала: вкладка на стороне VS Code (`viewerPanel.ts`) и «Внести» — единственный путь слова человека в журнал (`apply.ts`); страница — `page.tsx`, сборка кладёт её в `media/viewer.js`, — с `App.tsx` и режимами «решения» (`Card.tsx`, `ReturnPanel.tsx`), «проверка» (`CheckView.tsx`, `check.ts`) и «атака» (`AttackView.tsx`).

## Вложенные каталоги

- [test/](test/) — юнит-тесты модуля; `npm test` собирает их отсюда, в пакет они не идут
