---
name: activation
kind: технический
dependencies:
  - repo: symphysis-vscode
    module: changes
  - repo: symphysis-vscode
    module: core
  - repo: symphysis-vscode
    module: file-links
  - repo: symphysis-vscode
    module: hook
  - repo: symphysis-vscode
    module: protocol
  - repo: symphysis-vscode
    module: req-graph
  - repo: symphysis-vscode
    module: scheme
  - repo: symphysis-vscode
    module: search
  - repo: symphysis-vscode
    module: step-help
  - repo: symphysis-vscode
    module: viewer
---

# activation

Команды графа открывают активное изменение или выбранный снимок через `GraphPanels`. Для журнала архива используется его снимок. Инициализация инструментов и обработчиков начинается после подтверждения Workspace Trust.

Активация расширения: `extension.ts` — точка входа хоста, сборка кладёт её в `out/extension.js`. Поднимает Python и ядро, хранилище журналов, боковую панель, вкладки, поиск, хук и справку и связывает их; своей механики не несёт.
