export interface ForkReply { stdout?: string; stderr?: string; code?: number; hang?: number }
export type ForkReplies = Record<string, ForkReply>;
export interface ForkCall { argv: string[]; cwd: string; pid: number }
export interface ForkShim {
  file: string;
  env: Record<string, string>;
  answer(replies: ForkReplies): void;
  calls(): ForkCall[];
}
export const python: string;
export const VERSION_OK: ForkReply;
export const FORK_APPLY: ForkReply;
export function forkStatus(project: string, change: string, state?: "ready" | "done"): ForkReply;
export function forkStatusAll(...names: string[]): ForkReply;
export function forkScenario(replies: ForkReplies): string;
export function installForkShim(coreRoot: string, dir: string, replies: ForkReplies): ForkShim;
