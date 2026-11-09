import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/store';
import { planIssues } from '../workflow/check';
import { workflowOf } from '../workflow/defaults';
import { stepOrder } from '../workflow/graph';
import { editWorkflow, resolveProposal } from '../workflow/transitions';
import { STATUS_LABEL, applyPlan, useProgress, useStepStatuses } from '../workflow/useWorkflow';
import { ResourceEditor, TextField } from './StepProps';

/**
 * 계획 창: 계획 전체 목표·작업 폴더·기본 도구·AI 권한·잠금, 진행 순서대로 단계 목록, 계획 점검, Claude의 수정 제안.
 * 계획 블록은 Box의 오른쪽 창에서 만들고, 여기서는 전체를 본다.
 */
export function WorkflowPanel() {
  const open = useStore((s) => s.workflowOpen);
  const setOpen = useStore((s) => s.setWorkflowOpen);
  const doc = useStore((s) => s.doc);
  const wf = workflowOf(doc);
  const statuses = useStepStatuses();
  const prog = useProgress();
  const [error, setError] = useState<string | null>(null);
  const order = useMemo(() => {
    const { order, cycle } = stepOrder(doc);
    return [...order, ...cycle];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.nodes, doc.edges]);
  const issues = useMemo(() => planIssues(doc), [doc]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    // Esc: 닫기 (글을 쓰는 칸에서는 그 칸의 Esc가 먼저 — 체크박스·버튼에 포커스가 있어도 닫힌다)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(t.type));
      if (e.key === 'Escape' && !e.isComposing && !typing) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  const run = (fn: Parameters<typeof applyPlan>[0]) => setError(applyPlan(fn));
  const go = (id: string) => {
    const s = useStore.getState();
    s.select({ kind: 'node', id });
    s.openPage(id, { force: true });
    s.centerOn?.(id);
  };
  const proposals = wf.proposals.filter((p) => p.state === 'open');

  return (
    <>
      <div className="modal-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="workflow-panel" role="dialog" aria-label="계획" data-testid="workflow-panel">
        <div className="wf-head">
          <span className="wf-title">계획</span>
          {prog.total > 0 && (
            <span className="wf-progress" data-testid="wf-progress">
              {prog.done + prog.skipped}/{prog.total} 끝남
              {prog.failed ? ` · 실패 ${prog.failed}` : ''}
            </span>
          )}
          <button className="wf-close" aria-label="닫기" onClick={() => setOpen(false)}>
            ×
          </button>
        </div>
        <div className="wf-body">
          {error && (
            <div className="step-error" role="alert" data-testid="wf-error">
              {error}
            </div>
          )}
          <section className="wf-section">
            <div className="step-label">계획 전체 목표</div>
            <TextField
              value={wf.goal}
              placeholder="이 계획으로 만들 것 (Claude가 모든 단계에서 봅니다)"
              multiline
              disabled={wf.locked}
              testId="wf-goal"
              onCommit={(goal) => run((d) => editWorkflow(d, { goal }))}
            />
            <div className="step-label">작업 폴더 (선택)</div>
            <TextField
              value={wf.workingDir ?? ''}
              placeholder="Claude Code가 작업할 폴더 (예: C:\Users\나\projects\app)"
              disabled={wf.locked}
              testId="wf-dir"
              onCommit={(workingDir) => run((d) => editWorkflow(d, { workingDir }))}
            />
          </section>

          <section className="wf-section">
            <div className="wf-row">
              <label className="step-check" title="잠그면 계획 내용(할 일·기준·만들 것·도구)을 실수로 바꾸지 않게 막습니다">
                <input
                  type="checkbox"
                  checked={wf.locked}
                  data-testid="wf-lock"
                  onChange={(e) => run((d) => editWorkflow(d, { locked: e.target.checked }))}
                />
                계획 잠그기
              </label>
              <label className="step-check" title="동시에 진행할 수 있는 단계 수">
                동시에
                <select
                  value={wf.parallel}
                  data-testid="wf-parallel"
                  onChange={(e) => run((d) => editWorkflow(d, { parallel: Number(e.target.value) }))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}개
                    </option>
                  ))}
                </select>
                진행
              </label>
            </div>
            <div className="step-seg" role="radiogroup" aria-label="AI 권한">
              <button
                role="radio"
                aria-checked={wf.stepPermission === 'status'}
                className={wf.stepPermission === 'status' ? 'is-on' : undefined}
                data-testid="wf-perm-status"
                onClick={() => run((d) => editWorkflow(d, { stepPermission: 'status' }))}
              >
                Claude가 진행 상태·결과를 적음
              </button>
              <button
                role="radio"
                aria-checked={wf.stepPermission === 'read'}
                className={wf.stepPermission === 'read' ? 'is-on' : undefined}
                data-testid="wf-perm-read"
                onClick={() => run((d) => editWorkflow(d, { stepPermission: 'read' }))}
              >
                읽기만
              </button>
            </div>
            <p className="step-hint">계획 내용은 언제나 사람만 고칩니다. Claude는 고칠 점을 제안만 할 수 있습니다.</p>
          </section>

          <section className="wf-section">
            <div className="step-label">모든 단계에 쓸 기본 도구</div>
            <ResourceEditor value={wf.defaults} disabled={wf.locked} onChange={(defaults) => run((d) => editWorkflow(d, { defaults }))} />
          </section>

          {proposals.length > 0 && (
            <section className="wf-section" data-testid="wf-proposals">
              <div className="step-label">Claude의 수정 제안</div>
              {proposals.map((p) => (
                <div key={p.id} className="wf-proposal" data-testid="wf-proposal">
                  <div>
                    {p.stepId && doc.nodes[p.stepId] ? <b>{doc.nodes[p.stepId].text}: </b> : null}
                    {p.change}
                  </div>
                  {p.why && <div className="step-muted">이유: {p.why}</div>}
                  <div className="wf-proposal-actions">
                    <button
                      data-testid="wf-proposal-accept"
                      onClick={() => run((d) => resolveProposal(d, p.id, true))}
                      title="받아들임으로 표시합니다. 계획은 직접 고쳐 주세요."
                    >
                      받아들임
                    </button>
                    <button data-testid="wf-proposal-reject" onClick={() => run((d) => resolveProposal(d, p.id, false))}>
                      거절
                    </button>
                    {p.stepId && doc.nodes[p.stepId] && <button onClick={() => go(p.stepId!)}>그 단계 보기</button>}
                  </div>
                </div>
              ))}
            </section>
          )}

          <section className="wf-section">
            <div className="step-label">단계 (진행 순서)</div>
            {order.length === 0 ? (
              <p className="step-hint" data-testid="wf-empty">
                아직 계획 블록이 없습니다. Box를 누르고 오른쪽 창에서 <b>＋ 계획 블록으로 만들기</b>를 누르세요. Box끼리 Route로 이으면 그 순서대로
                진행합니다.
              </p>
            ) : (
              <ol className="wf-steps" data-testid="wf-steps">
                {order.map((id) => {
                  const n = doc.nodes[id];
                  const st = statuses.get(id) ?? 'todo';
                  return (
                    <li key={id} className={`wf-step step-${st}`} data-testid="wf-step" data-status={st}>
                      <button onClick={() => go(id)}>
                        <span className={`step-status st-${st}`}>{STATUS_LABEL[st]}</span>
                        <span className="wf-step-name">{n.text || '(제목 없음)'}</span>
                        {n.step!.assignee === 'human' && <span className="step-muted">사람</span>}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          {issues.length > 0 && (
            <section className="wf-section" data-testid="wf-issues">
              <div className="step-label">계획 점검</div>
              <ul className="wf-issues">
                {issues.map((i, k) => (
                  <li key={k} className={`wf-issue is-${i.level}`} data-testid="wf-issue" data-level={i.level}>
                    {i.level === 'error' ? '✗' : i.level === 'warn' ? '⚠' : '·'} {i.text}
                    {i.stepId && (
                      <button className="ai-link" onClick={() => go(i.stepId!)}>
                        보기
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
