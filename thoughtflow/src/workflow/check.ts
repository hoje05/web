/**
 * 계획 점검: Claude에게 맡기기 전에 계획에서 빠진 것·막힐 곳을 알려 준다 (계획 창).
 *  error = 이대로는 진행이 멈춘다, warn = 계획대로 만들기 어렵다, info = 알아 두면 좋은 것
 */
import type { Doc } from '../model/types';
import { workflowOf } from './defaults';
import { stepGraph, stepOrder, steps } from './graph';

export interface PlanIssue {
  level: 'error' | 'warn' | 'info';
  /** 관련 계획 블록 (없으면 계획 전체) */
  stepId?: string;
  text: string;
}

export function planIssues(doc: Doc): PlanIssue[] {
  const all = steps(doc);
  if (!all.length) return [];
  const out: PlanIssue[] = [];
  const name = (id: string) => `'${doc.nodes[id].text || '(제목 없음)'}'`;
  const { cycle } = stepOrder(doc);
  if (cycle.length)
    out.push({
      level: 'error',
      stepId: cycle[0],
      text: `순서가 돌고 돕니다 (${cycle.map(name).join(' → ')}). Route 하나를 지워 주세요.`,
    });
  if (!workflowOf(doc).goal.trim()) out.push({ level: 'warn', text: '계획 전체 목표가 비어 있습니다.' });
  const { preds, succs } = stepGraph(doc);
  for (const s of stepOrder(doc).order.map((id) => doc.nodes[id])) {
    const st = s.step!;
    if (!st.goal.trim() && !s.note.trim())
      out.push({
        level: 'warn',
        stepId: s.id,
        text: `${name(s.id)}: 할 일이 비어 있습니다.`,
      });
    if (st.assignee === 'claude' && !st.doneWhen.length)
      out.push({
        level: 'warn',
        stepId: s.id,
        text: `${name(s.id)}: 완료 기준이 없어 Claude가 끝났는지 확인할 방법이 없습니다.`,
      });
    if (st.assignee === 'claude' && !st.deliverables.length)
      out.push({
        level: 'info',
        stepId: s.id,
        text: `${name(s.id)}: 만들 것이 없습니다 (조사·확인만 하는 단계라면 괜찮습니다).`,
      });
    if (all.length > 1 && !preds.get(s.id)!.length && !succs.get(s.id)!.length)
      out.push({
        level: 'info',
        stepId: s.id,
        text: `${name(s.id)}: 다른 계획 블록과 이어지지 않아 순서가 보드 위치로만 정해집니다.`,
      });
    for (const q of st.questions)
      if (!q.answer)
        out.push({
          level: 'warn',
          stepId: s.id,
          text: `${name(s.id)}: Claude의 질문에 답해 주세요 — "${q.question.slice(0, 60)}"`,
        });
  }
  const open = workflowOf(doc).proposals.filter((p) => p.state === 'open').length;
  if (open)
    out.push({
      level: 'info',
      text: `Claude의 계획 수정 제안 ${open}개가 기다리고 있습니다.`,
    });
  return out;
}
