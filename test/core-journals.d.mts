export type CoreJournal = { name: string; dir: string };
export function coreJournals(root: string): CoreJournal[];
export function bigJournal(root: string): CoreJournal;
