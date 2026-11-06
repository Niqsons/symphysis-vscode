// Вкладка, которая уже есть в окне, а у хоста её ещё нет: после перезагрузки вкладка под другой вкладкой спит, пока её не покажут (F-125).
import * as vscode from "vscode";

export function asleepTab(viewType: string): vscode.Tab | undefined {
  return vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.endsWith(viewType));
}
