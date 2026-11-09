import { useEffect, useState, type ReactNode } from 'react';
import type { BoxNode, Deliverable, StepInfo, StepResources, StepStatus } from '../model/types';
import { useStore } from '../store/store';
import { workflowOf } from '../workflow/defaults';
import { planFingerprint } from '../workflow/graph';
import { mergeResources, resourceDiff, type ResourceKind } from '../workflow/resources';
import {
  HUMAN,
  acceptReview,
  answerQuestion,
  approveStep,
  editStepPlan,
  sendBack,
  setStatusByHuman,
  setStepEnabled,
  startStep,
  type StepPlanPatch,
} from '../workflow/transitions';
import { STATUS_LABEL, applyPlan, useStepStatuses } from '../workflow/useWorkflow';

/**
 * 오른쪽 창의 계획 블록 설정 (Box 정보 줄 아래).
 * 계획(할 일·완료 기준·만들 것·참고·담당·승인·검토·도구)은 사람이 쓰고, Claude는 이것을 그대로 따른다.
 * 진행 상태·결과·질문은 Claude가 적고, 사람은 승인·검토·답하기·상태 바꾸기를 한다. 모든 변경은 Ctrl+Z로 되돌린다.
 */
export function StepProps({ node }: { node: BoxNode }) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [node.id]);
  const run = (fn: Parameters<typeof applyPlan>[0]) => setError(applyPlan(fn));

  if (!node.step) {
    return (
      <div className="step-props is-off">
        <button className="step-enable" data-testid="step-enable" onClick={() => run((d) => setStepEnabled(d, node.id, true))}>
          ＋ 계획 블록으로 만들기
        </button>
        <span className="step-hint">할 일·완료 기준·만들 것·쓸 도구를 정해 두면 Claude가 그대로 진행합니다</span>
        {error && <StepError text={error} />}
      </div>
    );
  }
  return <StepEditor node={node as BoxNode & { step: StepInfo }} run={run} error={error} />;
}

function StepError({ text }: { text: string }) {
  return (
    <div className="step-error" role="alert" data-testid="step-error">
      {text}
    </div>
  );
}

function StepEditor({
  node,
  run,
  error,
}: {
  node: BoxNode & { step: StepInfo };
  run: (fn: Parameters<typeof applyPlan>[0]) => void;
  error: string | null;
}) {
  const step = node.step;
  const locked = useStore((s) => workflowOf(s.doc).locked);
  const statuses = useStepStatuses();
  const status = statuses.get(node.id) ?? step.status;
  const edit = (patch: StepPlanPatch) => run((d) => editStepPlan(d, node.id, patch));
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`step-props step-${status}${collapsed ? ' is-collapsed' : ''}`} data-testid="step-props" data-status={status}>
      <div className="step-head">
        <button
          className="step-collapse"
          aria-expanded={!collapsed}
          title={collapsed ? '펼치기' : '접기'}
          data-testid="step-collapse"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="step-title">계획 블록</span>
        <span className={`step-status st-${status}`} data-testid="step-status">
          {STATUS_LABEL[status]}
        </span>
        <StatusSelect value={step.status} onChange={(st) => run((d) => setStatusByHuman(d, node.id, st))} />
      </div>
      <StepActions node={node} status={status} run={run} />
      {error && <StepError text={error} />}
      {!collapsed && (
        <>
          {locked && <div className="step-locked">계획이 잠겨 있어 내용을 바꿀 수 없습니다 (계획 창에서 잠금 풀기)</div>}

          <Field label="할 일">
            <TextField
              value={step.goal}
              placeholder="이 단계에서 할 일 (자세한 설계는 아래 메모에)"
              disabled={locked}
              testId="step-goal"
              onCommit={(goal) => edit({ goal })}
            />
          </Field>
          <Field label="완료 기준">
            <ListEditor
              items={step.doneWhen}
              placeholder="＋ 완료 기준 (예: 빌드와 테스트 통과)"
              disabled={locked}
              testId="step-done"
              onChange={(doneWhen) => edit({ doneWhen })}
              numbered
            />
          </Field>
          <Field label="만들 것">
            <DeliverableEditor items={step.deliverables} disabled={locked} onChange={(deliverables) => edit({ deliverables })} />
          </Field>
          <Field label="참고 자료">
            <ListEditor
              items={step.references}
              placeholder="＋ 꼭 따를 자료 (파일 경로, 링크, 앞 단계 이름)"
              disabled={locked}
              testId="step-ref"
              onChange={(references) => edit({ references })}
            />
          </Field>
          <Field label="진행 방법">
            <div className="step-options">
              <div className="step-seg" role="radiogroup" aria-label="담당">
                {(['claude', 'human'] as const).map((a) => (
                  <button
                    key={a}
                    role="radio"
                    aria-checked={step.assignee === a}
                    className={step.assignee === a ? 'is-on' : undefined}
                    disabled={locked}
                    data-testid={`step-assignee-${a}`}
                    onClick={() => edit({ assignee: a })}
                  >
                    {a === 'claude' ? 'Claude가' : '사람이'}
                  </button>
                ))}
              </div>
              <label className="step-check">
                <input
                  type="checkbox"
                  checked={step.approval === 'ask'}
                  disabled={locked}
                  data-testid="step-approval"
                  onChange={(e) => edit({ approval: e.target.checked ? 'ask' : 'auto' })}
                />
                시작 전 승인
              </label>
              <label className="step-check">
                <input
                  type="checkbox"
                  checked={step.review}
                  disabled={locked}
                  data-testid="step-review"
                  onChange={(e) => edit({ review: e.target.checked })}
                />
                검토 후 다음으로
              </label>
            </div>
          </Field>
          <Field label="쓸 도구">
            <ResourceEditor value={step.resources} disabled={locked} onChange={(resources) => edit({ resources })} />
          </Field>

          {step.result && <ResultView node={node} />}
          {step.questions.some((q) => q.answer) && (
            <Field label="질문과 답">
              <ul className="step-qa">
                {step.questions
                  .filter((q) => q.answer)
                  .map((q) => (
                    <li key={q.id}>
                      <div className="step-q">Q. {q.question}</div>
                      <div className="step-a">A. {q.answer}</div>
                    </li>
                  ))}
              </ul>
            </Field>
          )}
          {step.log.length > 0 && (
            <details className="step-log" data-testid="step-log">
              <summary>진행 기록 {step.log.length}</summary>
              <ol>
                {step.log
                  .slice(-30)
                  .reverse()
                  .map((e, i) => (
                    <li key={i}>
                      <span className="step-log-time">{formatTime(e.at)}</span> <b>{e.by}</b> · {STATUS_LABEL[e.status]}
                      {e.note ? ` — ${e.note}` : ''}
                    </li>
                  ))}
              </ol>
            </details>
          )}
          <button className="step-disable" data-testid="step-disable" disabled={locked} onClick={() => run((d) => setStepEnabled(d, node.id, false))}>
            계획 블록 풀기
          </button>
        </>
      )}
    </div>
  );
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const STATUS_CHOICES: StepStatus[] = ['todo', 'running', 'done', 'skipped', 'failed'];

/** 사람이 상태를 직접 바꾸기 (다시 하기, 건너뛰기, 직접 끝냄 등) */
function StatusSelect({ value, onChange }: { value: StepStatus; onChange: (s: StepStatus) => void }) {
  return (
    <select
      className="step-status-select"
      value={STATUS_CHOICES.includes(value) ? value : ''}
      title="상태 직접 바꾸기"
      data-testid="step-status-select"
      onChange={(e) => e.target.value && onChange(e.target.value as StepStatus)}
    >
      {!STATUS_CHOICES.includes(value) && <option value="">상태 바꾸기…</option>}
      {STATUS_CHOICES.map((s) => (
        <option key={s} value={s}>
          {s === 'todo' ? '할 일로 (다시 하기)' : STATUS_LABEL[s]}
        </option>
      ))}
    </select>
  );
}

/** 상태에 따라 사람이 할 일: 승인, 검토, 질문에 답하기, 사람이 맡은 단계 시작 */
function StepActions({
  node,
  status,
  run,
}: {
  node: BoxNode & { step: StepInfo };
  status: string;
  run: (fn: Parameters<typeof applyPlan>[0]) => void;
}) {
  const step = node.step;
  const [reason, setReason] = useState('');
  const [answer, setAnswer] = useState('');
  const open = step.questions.find((q) => !q.answer);
  useEffect(() => {
    setReason('');
    setAnswer('');
  }, [node.id, status]);

  if (status === 'waiting' || (step.approval === 'ask' && !step.approved && (status === 'ready' || status === 'todo'))) {
    const why = status === 'waiting' ? [...step.log].reverse().find((e) => e.status === 'waiting')?.note : null;
    return (
      <div className="step-action" data-testid="step-approve-box">
        <span>{status === 'waiting' ? `Claude가 시작 승인을 기다립니다${why ? ` — ${why}` : ''}` : '시작 전 승인이 필요한 단계입니다'}</span>
        <button className="step-primary" data-testid="step-approve" onClick={() => run((d) => approveStep(d, node.id))}>
          승인
        </button>
      </div>
    );
  }
  if (status === 'review') {
    return (
      <div className="step-action" data-testid="step-review-box">
        <span>Claude가 끝냈습니다. 결과를 확인해 주세요.</span>
        <button className="step-primary" data-testid="step-accept" onClick={() => run((d) => acceptReview(d, node.id))}>
          검토 통과
        </button>
        <input
          className="step-input"
          value={reason}
          placeholder="다시 할 이유"
          data-testid="step-sendback-reason"
          onChange={(e) => setReason(e.target.value)}
        />
        <button data-testid="step-sendback" disabled={!reason.trim()} onClick={() => run((d) => sendBack(d, node.id, reason))}>
          다시 하기
        </button>
      </div>
    );
  }
  if (open) {
    return (
      <div className="step-action is-question" data-testid="step-question-box">
        <div className="step-q">Claude의 질문: {open.question}</div>
        <textarea
          className="step-input"
          rows={2}
          value={answer}
          placeholder="답 (Claude가 이 답대로 이어서 진행합니다)"
          data-testid="step-answer"
          onChange={(e) => setAnswer(e.target.value)}
        />
        <button
          className="step-primary"
          data-testid="step-answer-send"
          disabled={!answer.trim()}
          onClick={() => run((d) => answerQuestion(d, node.id, open.id, answer))}
        >
          답하기
        </button>
      </div>
    );
  }
  if (step.assignee === 'human' && status === 'ready') {
    return (
      <div className="step-action">
        <span>사람이 하는 단계입니다.</span>
        <button className="step-primary" data-testid="step-human-start" onClick={() => run((d) => startStep(d, node.id, HUMAN))}>
          시작
        </button>
      </div>
    );
  }
  if (step.assignee === 'human' && status === 'running') {
    return (
      <div className="step-action">
        <span>사람이 하는 단계입니다.</span>
        <button className="step-primary" data-testid="step-human-done" onClick={() => run((d) => setStatusByHuman(d, node.id, 'done'))}>
          끝냄
        </button>
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="step-field">
      <div className="step-label">{label}</div>
      <div className="step-value">{children}</div>
    </div>
  );
}

/** 한 줄 입력: 칸을 떠나거나 Enter를 누를 때 한 번만 저장 (Undo 한 칸) */
export function TextField(props: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  multiline?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft.trim() !== props.value.trim()) props.onCommit(draft);
  };
  const common = {
    className: 'step-input',
    value: draft,
    placeholder: props.placeholder,
    disabled: props.disabled,
    spellCheck: false,
    'data-testid': props.testId,
    onBlur: commit,
  };
  if (props.multiline) return <textarea {...common} rows={3} onChange={(e) => setDraft(e.target.value)} />;
  return (
    <input
      {...common}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setDraft(props.value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** 줄 목록 (완료 기준, 참고 자료): 줄마다 고치기·× 빼기, 아래 칸에 쓰고 Enter로 더하기 */
export function ListEditor(props: {
  items: string[];
  placeholder: string;
  disabled?: boolean;
  testId: string;
  numbered?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [adding, setAdding] = useState('');
  const add = () => {
    if (!adding.trim()) return;
    props.onChange([...props.items, adding.trim()]);
    setAdding('');
  };
  return (
    <div className="step-list" data-testid={props.testId}>
      {props.items.map((item, i) => (
        <div key={`${i}:${item}`} className="step-list-row" data-testid={`${props.testId}-item`}>
          {props.numbered && <span className="step-num">{i + 1}</span>}
          <TextField
            value={item}
            disabled={props.disabled}
            onCommit={(v) => props.onChange(v.trim() ? props.items.map((x, j) => (j === i ? v.trim() : x)) : props.items.filter((_, j) => j !== i))}
          />
          {!props.disabled && (
            <button
              className="step-x"
              aria-label="빼기"
              data-testid={`${props.testId}-remove`}
              onClick={() => props.onChange(props.items.filter((_, j) => j !== i))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!props.disabled && (
        <input
          className="step-input step-add"
          value={adding}
          placeholder={props.placeholder}
          spellCheck={false}
          data-testid={`${props.testId}-add`}
          onChange={(e) => setAdding(e.target.value)}
          onBlur={add}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
      )}
    </div>
  );
}

/** 만들 것: 경로(선택) + 조건 */
function DeliverableEditor({ items, disabled, onChange }: { items: Deliverable[]; disabled: boolean; onChange: (items: Deliverable[]) => void }) {
  const [path, setPath] = useState('');
  const [spec, setSpec] = useState('');
  const add = () => {
    if (!path.trim() && !spec.trim()) return;
    onChange([...items, path.trim() ? { path: path.trim(), spec: spec.trim() } : { spec: spec.trim() }]);
    setPath('');
    setSpec('');
  };
  const set = (i: number, d: Deliverable) => onChange(items.map((x, j) => (j === i ? d : x)));
  return (
    <div className="step-list" data-testid="step-deliv">
      {items.map((d, i) => (
        <div key={`${i}:${d.path}:${d.spec}`} className="step-list-row step-deliv-row" data-testid="step-deliv-item">
          <span className="step-num">{i + 1}</span>
          <TextField
            value={d.path ?? ''}
            placeholder="경로 (선택)"
            disabled={disabled}
            onCommit={(p) => set(i, p.trim() ? { path: p.trim(), spec: d.spec } : { spec: d.spec })}
          />
          <TextField value={d.spec} placeholder="조건" disabled={disabled} onCommit={(s) => set(i, { ...d, spec: s.trim() })} />
          {!disabled && (
            <button className="step-x" aria-label="빼기" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <div className="step-list-row step-deliv-row" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && add()}>
          <span className="step-num">＋</span>
          <input
            className="step-input"
            value={path}
            placeholder="경로 (예: src/login.tsx)"
            spellCheck={false}
            data-testid="step-deliv-path"
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          />
          <input
            className="step-input"
            value={spec}
            placeholder="조건 (예: 이메일·비밀번호 입력, 오류 문구)"
            spellCheck={false}
            data-testid="step-deliv-spec"
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
          />
        </div>
      )}
    </div>
  );
}

const KINDS: {
  kind: Exclude<ResourceKind, 'subagent'>;
  key: 'skills' | 'commands' | 'connectors';
  label: string;
  placeholder: string;
}[] = [
  { kind: 'skill', key: 'skills', label: '스킬', placeholder: '스킬 이름' },
  { kind: 'command', key: 'commands', label: '명령어', placeholder: '/명령어' },
  {
    kind: 'connector',
    key: 'connectors',
    label: '커넥터',
    placeholder: '커넥터 이름',
  },
];

/** 쓸 도구: 스킬·명령어·커넥터 칩 + 서브 에이전트 + 하지 말 것 */
export function ResourceEditor({ value, disabled, onChange }: { value: StepResources; disabled?: boolean; onChange: (r: StepResources) => void }) {
  const sub = value.subagent;
  const setSub = (patch: Partial<NonNullable<StepResources['subagent']>>) => {
    const next = { type: sub?.type ?? '', ...sub, ...patch };
    if (!next.type.trim()) {
      const rest = { ...value };
      delete rest.subagent;
      onChange(rest);
    } else onChange({ ...value, subagent: next });
  };
  return (
    <div className="res-editor">
      {KINDS.map(({ kind, key, label, placeholder }) => (
        <div key={kind} className="res-row" data-testid={`res-${kind}`}>
          <span className="res-label">{label}</span>
          <div className="res-chips">
            {value[key].map((name) => (
              <span key={name} className={`res-chip res-${kind}`} data-testid="res-chip">
                {name}
                {!disabled && (
                  <button
                    aria-label={`${name} 빼기`}
                    onClick={() =>
                      onChange({
                        ...value,
                        [key]: value[key].filter((n) => n !== name),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            ))}
            {!disabled && (
              <ChipInput
                placeholder={`＋ ${placeholder}`}
                testId={`res-${kind}-add`}
                onAdd={(name) => onChange({ ...value, [key]: [...value[key], name] })}
              />
            )}
          </div>
        </div>
      ))}
      <div className="res-row" data-testid="res-subagent">
        <span className="res-label">서브 에이전트</span>
        <div className="res-sub">
          <TextField
            value={sub?.type ?? ''}
            placeholder="종류 (예: Explore, general-purpose)"
            disabled={disabled}
            testId="res-subagent-type"
            onCommit={(type) => setSub({ type: type.trim() })}
          />
          {sub && (
            <>
              <TextField
                value={sub.model ?? ''}
                placeholder="모델 (비우면 기본)"
                disabled={disabled}
                testId="res-subagent-model"
                onCommit={(model) => setSub({ model: model.trim() || undefined })}
              />
              <TextField
                value={sub.instructions ?? ''}
                placeholder="서브 에이전트에게 따로 줄 지시 (선택)"
                disabled={disabled}
                multiline
                testId="res-subagent-instructions"
                onCommit={(instructions) => setSub({ instructions: instructions.trim() || undefined })}
              />
            </>
          )}
        </div>
      </div>
      <div className="res-row" data-testid="res-avoid">
        <span className="res-label">하지 말 것</span>
        <ListEditor
          items={value.avoid ?? []}
          placeholder="＋ 이 단계에서 하면 안 되는 것"
          disabled={disabled}
          testId="res-avoid-list"
          onChange={(avoid) => onChange({ ...value, avoid })}
        />
      </div>
    </div>
  );
}

function ChipInput({ placeholder, testId, onAdd }: { placeholder: string; testId: string; onAdd: (name: string) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    if (text.trim()) onAdd(text.trim());
    setText('');
  };
  return (
    <input
      className="res-input"
      value={text}
      placeholder={placeholder}
      spellCheck={false}
      data-testid={testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={add}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault();
          add();
        }
      }}
    />
  );
}

const KIND_LABEL: Record<ResourceKind, string> = {
  skill: '스킬',
  command: '명령어',
  connector: '커넥터',
  subagent: '서브 에이전트',
};

/** 계획 대비 결과: 만들 것 ↔ 만든 위치, 완료 기준 ✓/✗, 지정 도구 ↔ 실제 쓴 도구 */
function ResultView({ node }: { node: BoxNode & { step: StepInfo } }) {
  const step = node.step;
  const result = step.result!;
  const defaults = useStore((s) => workflowOf(s.doc).defaults);
  const fingerprint = useStore((s) => planFingerprint(s.doc));
  const diff = resourceDiff(mergeResources(defaults, step.resources), result.used);
  return (
    <div className="step-result" data-testid="step-result">
      <div className="step-label">
        결과{' '}
        <span className="step-result-by">
          {result.by} · {formatTime(result.at)}
        </span>
      </div>
      {result.summary && <div className="step-result-summary">{result.summary}</div>}
      {step.deliverables.length > 0 && (
        <ul className="step-result-list">
          {step.deliverables.map((d, i) => {
            const out = result.outputs.find((o) => o.deliverable === i + 1);
            return (
              <li key={i} className={out ? 'is-ok' : 'is-missing'}>
                {out ? '✓' : '✗'} {d.path ?? d.spec.slice(0, 40)}{' '}
                {out && out.path !== d.path ? <span className="step-muted">→ {out.path}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {step.doneWhen.length > 0 && (
        <ul className="step-result-list" data-testid="step-result-criteria">
          {step.doneWhen.map((w, i) => {
            const c = result.criteria.find((x) => x.item === i + 1);
            return (
              <li key={i} className={c?.pass ? 'is-ok' : 'is-missing'} title={c?.evidence}>
                {c?.pass ? '✓' : '✗'} {w} {c?.evidence ? <span className="step-muted">— {c.evidence}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {(diff.missing.length > 0 || diff.extra.length > 0) && (
        <div className="step-warn" data-testid="step-tool-diff">
          ⚠ 지정한 도구와 다르게 진행했습니다.
          {diff.missing.length > 0 && <div>안 쓴 것: {diff.missing.map((m) => `${KIND_LABEL[m.kind]} ${m.name}`).join(', ')}</div>}
          {diff.extra.length > 0 && <div>더 쓴 것: {diff.extra.map((m) => `${KIND_LABEL[m.kind]} ${m.name}`).join(', ')}</div>}
        </div>
      )}
      {result.planVersion && result.planVersion !== fingerprint && (
        <div className="step-warn" data-testid="step-plan-changed">
          이 결과가 나온 뒤에 계획이 바뀌었습니다.
        </div>
      )}
    </div>
  );
}
