/** 화면에서 계획 규칙(transitions)을 쓰는 곳: 변경은 Undo 한 칸, 안 되는 이유는 돌려준다. 계산한 상태는 Doc이 바뀔 때만 다시. */
import { useMemo } from 'react';
import { commitChange } from '../interaction/editSession';
import type { Doc } from '../model/types';
import { useStore } from '../store/store';
import { effectiveStatuses, progress, type EffectiveStatus } from './graph';
import type { Outcome } from './transitions';

/** 규칙에 따라 Doc을 바꾼다. 안 되면 이유(문장), 되면 null */
export function applyPlan(change: (doc: Doc) => Outcome): string | null {
  const first = change(useStore.getState().doc);
  if (!first.ok) return first.error;
  commitChange((doc) => {
    const o = change(doc);
    return o.ok ? o.doc : doc;
  });
  return null;
}

/** 모든 계획 블록의 화면 상태 (ready / blocked 포함) */
export function useStepStatuses(): Map<string, EffectiveStatus> {
  const nodes = useStore((s) => s.doc.nodes);
  const edges = useStore((s) => s.doc.edges);
  const workflow = useStore((s) => s.doc.workflow);
  return useMemo(() => effectiveStatuses({ nodes, edges, tags: {}, workflow }), [nodes, edges, workflow]);
}

export function useProgress() {
  const nodes = useStore((s) => s.doc.nodes);
  return useMemo(() => progress({ nodes, edges: {}, tags: {} }), [nodes]);
}

export const STATUS_LABEL: Record<EffectiveStatus, string> = {
  todo: '대기',
  ready: '시작 가능',
  blocked: '막힘',
  running: '진행 중',
  waiting: '승인 대기',
  asking: '질문 중',
  review: '검토 대기',
  done: '완료',
  failed: '실패',
  skipped: '건너뜀',
};
