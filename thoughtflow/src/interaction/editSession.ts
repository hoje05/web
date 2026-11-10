/**
 * 오른쪽 창의 제목·메모 입력은 입력칸을 떠날 때 Undo 한 칸으로 묶인다 (useEditSession).
 * 입력하는 도중에 다른 변경(이미지 붙여 넣기, 태그 붙이기 …)을 기록해야 하면,
 * 지금까지 쓴 글을 먼저 한 칸으로 닫고 → 그 변경을 한 칸으로 → 이어서 쓰는 글은 다음 칸.
 * 그래야 Ctrl+Z가 한 일의 반대 순서대로 하나씩 되돌린다.
 */
import type { Doc } from '../model/types';
import { useStore } from '../store/store';

interface Session {
  begin: () => void;
  end: () => void;
}

let active: Session | null = null;

export function setActiveSession(session: Session | null) {
  active = session;
}

export function isActiveSession(session: Session) {
  return active === session;
}

/** 지금 Doc에 변경을 적용하고 Undo 한 칸으로 기록한다. 바뀐 것이 없으면 false. */
export function commitChange(change: (doc: Doc) => Doc): boolean {
  const next = change(useStore.getState().doc);
  if (next === useStore.getState().doc) return false;
  const session = active;
  session?.end();
  const s = useStore.getState();
  s.commit(change(s.doc));
  session?.begin();
  return true;
}
