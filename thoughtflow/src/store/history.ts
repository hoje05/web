import type { Doc } from '../model/types';

/**
 * Undo/Redo = Doc snapshot stack.
 * Doc은 불변 객체이므로 snapshot은 참조만 보관한다 (복사 비용 없음).
 */
export interface History {
  past: Doc[];
  future: Doc[];
}

export const HISTORY_LIMIT = 300;

export function pushPast(past: Doc[], doc: Doc): Doc[] {
  const next = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past.slice();
  next.push(doc);
  return next;
}
