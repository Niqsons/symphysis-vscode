export const CORE_ENTRY: string;
export const TOOLS_FILES: string[];
export const DOCS_FILES: string[];
export function coreRoot(env: NodeJS.ProcessEnv, sibling: string): string;
export function coreMissing(root: string): string | null;
export function resolveCore(env: NodeJS.ProcessEnv, sibling: string): { root: string; missing: string | null };
export function coreSource(root: string, name: string): string;
export function installCore(root: string, project: string): string;
