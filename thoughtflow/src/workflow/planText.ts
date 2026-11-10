/**
 * 계획을 Claude가 읽을 글로 — get_plan · next_steps · start_step이 돌려주는 내용.
 *
 *  - 계획 전체: 목표, 작업 폴더, 권한, 진행, 지금 시작할 수 있는 단계, 진행 순서대로 각 단계의 모든 지시
 *  - 작업 지시서(한 단계): 해야 할 일과 기준, 만들 것, 참고, 쓸 도구와 쓰는 법, 사람의 되돌림 이유·답, 보고 방법
 * 사람이 적은 그대로 전하고, Claude가 지어내지 않도록 "계획에 없는 것은 묻기"를 함께 적는다.
 */
import type { BoxNode, Doc, StepInfo, StepResources } from '../model/types';
import { findInCatalog, type CatalogItem } from './catalog';
import { workflowOf } from './defaults';
import { effectiveStatuses, nextSteps, planFingerprint, progress, stepGraph, stepOrder, type EffectiveStatus } from './graph';
import { isEmptyResources, mergeResources } from './resources';
import { statusName } from './transitions';

const STATUS_TEXT = (s: EffectiveStatus) => (s === 'ready' ? '시작할 수 있음' : s === 'blocked' ? '막힘 (앞 단계 실패·순환)' : statusName(s));

const label = (n: BoxNode) => `${n.text.replace(/\s+/g, ' ').trim() || '(제목 없음)'} [${n.id}]`;
const indent = (text: string, pad = '   ') =>
  text
    .trim()
    .split('\n')
    .map((l) => `${pad}${l}`)
    .join('\n');

/** 도구 이름 + (이 PC에서 찾지 못했으면) 표시 */
function toolName(kind: CatalogItem['kind'], name: string, catalog?: CatalogItem[]): string {
  if (!catalog) return name;
  const found = findInCatalog(catalog, kind, name);
  return found ? name : `${name} (이 PC의 목록에 없음 — claude.ai 커넥터 등일 수 있음)`;
}

/** 도구 목록 한 줄씩 (계획 전체 보기용) */
export function resourceLines(r: StepResources, catalog?: CatalogItem[]): string[] {
  const out: string[] = [];
  if (r.skills.length) out.push(`스킬: ${r.skills.map((n) => toolName('skill', n, catalog)).join(', ')}`);
  if (r.commands.length) out.push(`명령어: ${r.commands.map((n) => toolName('command', n, catalog)).join(', ')}`);
  if (r.connectors.length) out.push(`커넥터: ${r.connectors.map((n) => toolName('connector', n, catalog)).join(', ')}`);
  if (r.subagent) {
    const extra = [r.subagent.model && `모델 ${r.subagent.model}`, r.subagent.instructions && `지시: ${r.subagent.instructions}`].filter(Boolean).join(' · ');
    out.push(`서브 에이전트: ${toolName('subagent', r.subagent.type, catalog)}${extra ? ` (${extra})` : ''}`);
  }
  if (r.avoid?.length) out.push(`하지 말 것: ${r.avoid.join(' / ')}`);
  return out;
}

/** 작업 지시서용: 도구마다 어떻게 쓰는지 */
function resourceHowTo(r: StepResources, catalog?: CatalogItem[]): string[] {
  const out: string[] = [];
  for (const n of r.skills) out.push(`- 스킬 ${toolName('skill', n, catalog)}: Skill 도구로 "${n}" 스킬을 불러 그 지시를 따르세요.`);
  for (const n of r.commands) out.push(`- 명령어 ${toolName('command', n, catalog)}: ${n.startsWith('/') ? n : `/${n}`} 명령을 실행하세요 (필요하면 인자를 붙여서).`);
  for (const n of r.connectors) out.push(`- 커넥터 ${toolName('connector', n, catalog)}: 이 커넥터(MCP 서버)의 도구로 작업하세요.`);
  if (r.subagent) {
    const s = r.subagent;
    out.push(
      `- 서브 에이전트 ${toolName('subagent', s.type, catalog)}: 이 단계의 일을 Agent 도구(subagent_type: "${s.type}"${s.model ? `, model: "${s.model}"` : ''})에 맡기세요.` +
        (s.instructions ? ` 에이전트에게 줄 지시: ${s.instructions}` : ''),
    );
  }
  for (const a of r.avoid ?? []) out.push(`- 하지 말 것: ${a}`);
  return out;
}

const roleText = (st: StepInfo) =>
  [
    st.assignee === 'human' ? '사람이 하는 단계 (Claude는 기다림)' : 'Claude가 하는 단계',
    st.approval === 'ask' ? (st.approved ? '시작 승인 받음' : '시작 전 사람 승인 필요') : null,
    st.review ? '끝나면 사람이 검토' : null,
  ]
    .filter(Boolean)
    .join(' · ');

/** 계획 내용(사람이 쓴 것) — 전체 보기와 작업 지시서가 같이 쓴다 */
function planBody(n: BoxNode & { step: StepInfo }, pad: string): string[] {
  const st = n.step;
  const out: string[] = [];
  if (st.goal) out.push(`${pad}할 일: ${st.goal}`);
  if (st.doneWhen.length) {
    out.push(`${pad}완료 기준 (모두 통과해야 완료):`);
    st.doneWhen.forEach((w, i) => out.push(`${pad}  ${i + 1}. ${w}`));
  }
  if (st.deliverables.length) {
    out.push(`${pad}만들 것:`);
    st.deliverables.forEach((d, i) => out.push(`${pad}  ${i + 1}. ${[d.path, d.spec].filter(Boolean).join(' — ')}`));
  }
  if (st.references.length) {
    out.push(`${pad}참고 (꼭 읽고 따를 것):`);
    for (const r of st.references) out.push(`${pad}  - ${r}`);
  }
  if (n.note.trim()) out.push(`${pad}설계 메모:`, indent(n.note, `${pad}  `));
  return out;
}

/** 사람이 되돌려 보낸 이유 (마지막 되돌림 이후 아직 다시 끝내지 않았으면) */
function sendBackNote(st: StepInfo): string | null {
  for (let i = st.log.length - 1; i >= 0; i--) {
    const e = st.log[i];
    if (e.status === 'done' || e.status === 'review') return null;
    if (e.status === 'todo' && e.note?.startsWith('다시 하기:')) return e.note.replace(/^다시 하기:\s*/, '');
  }
  return null;
}

export interface PlanTextOptions {
  projectName: string;
  /** 이 PC에서 찾은 도구 (없으면 이름만) */
  catalog?: CatalogItem[];
}

/** get_plan: 계획 전체 */
export function describePlan(doc: Doc, opts: PlanTextOptions): string {
  const wf = workflowOf(doc);
  const { order, cycle } = stepOrder(doc);
  const all = [...order, ...cycle];
  const head = [`프로젝트: ${opts.projectName}`];
  if (!all.length) {
    return [...head, '', '이 보드에는 아직 계획 블록이 없습니다. 계획은 사용자가 ThoughtFlow에서 직접 만듭니다 (Box → 오른쪽 창 → "계획 블록으로 만들기").', 'Claude는 계획을 만들거나 고칠 수 없습니다. 필요하면 사용자에게 계획을 만들어 달라고 말해 주세요.'].join('\n');
  }
  const p = progress(doc);
  const status = effectiveStatuses(doc);
  const { preds } = stepGraph(doc);
  head.push(`계획 버전: ${planFingerprint(doc)} (사람이 계획을 고치면 바뀝니다)`);
  head.push(`계획 전체 목표: ${wf.goal || '(적지 않음)'}`);
  if (wf.workingDir) head.push(`작업 폴더: ${wf.workingDir} (이 폴더에서 작업하세요)`);
  head.push(
    `AI 권한: ${wf.stepPermission === 'read' ? '읽기만 — 진행 상태를 적을 수 없습니다' : 'Claude가 진행 상태·결과·질문·제안을 적을 수 있음 (계획 내용은 사람만 고침)'}` +
      ` · 동시에 ${wf.parallel}개까지 진행${wf.locked ? ' · 계획 잠김' : ''}`,
  );
  head.push(`진행: 단계 ${p.total}개 중 ${p.done + p.skipped}개 끝남${p.active ? ` · 진행 중 ${p.active}` : ''}${p.failed ? ` · 실패 ${p.failed}` : ''}`);
  const ready = nextSteps(doc, 'claude');
  head.push(`지금 Claude가 시작할 수 있는 단계: ${ready.length ? ready.map((id) => label(doc.nodes[id])).join(', ') : '없음 (next_steps로 이유 확인)'}`);
  const defaults = resourceLines(wf.defaults, opts.catalog);
  if (defaults.length) head.push('모든 단계에 쓸 기본 도구:', ...defaults.map((l) => `  - ${l}`));

  const out = [...head, '', '[단계 — 진행 순서]'];
  all.forEach((id, i) => {
    const n = doc.nodes[id] as BoxNode & { step: StepInfo };
    const st = n.step;
    out.push(`${i + 1}. ${label(n)} — ${STATUS_TEXT(status.get(id) ?? st.status)}${cycle.includes(id) ? ' (Route가 순환해서 순서를 정할 수 없음)' : ''}`);
    out.push(`   ${roleText(st)}`);
    const ps = preds.get(id) ?? [];
    if (ps.length) out.push(`   앞 단계: ${ps.map((p) => label(doc.nodes[p])).join(', ')}`);
    out.push(...planBody(n, '   '));
    const tools = resourceLines(st.resources, opts.catalog);
    if (tools.length) out.push('   이 단계 도구:', ...tools.map((l) => `     - ${l}`));
    const back = sendBackNote(st);
    if (back) out.push(`   사람이 되돌려 보낸 이유: ${back}`);
    for (const q of st.questions) out.push(`   질문: ${q.question}${q.answer ? `\n   답: ${q.answer}` : ' (아직 답 없음)'}`);
    if (st.result) {
      const r = st.result;
      out.push(`   결과 (${r.by}, ${r.at.slice(0, 16).replace('T', ' ')}${r.planVersion !== planFingerprint(doc) ? ' · 이후 계획이 바뀜' : ''}): ${r.summary || '(요약 없음)'}`);
      for (const o of r.outputs) out.push(`     만든 것 ${o.deliverable}: ${o.path}`);
    }
  });
  const open = wf.proposals.filter((x) => x.state === 'open');
  if (open.length) {
    out.push('', '[아직 사용자가 답하지 않은 수정 제안]');
    for (const x of open) out.push(`- ${x.stepId && doc.nodes[x.stepId] ? `${label(doc.nodes[x.stepId])}: ` : ''}${x.change}`);
  }
  out.push('', '단계를 진행하려면 next_steps → start_step(id) 순서로 부르세요. start_step이 그 단계의 작업 지시서를 돌려줍니다.');
  return out.join('\n');
}

/** next_steps: 지금 할 수 있는 단계, 없으면 왜 없는지 */
export function describeNext(doc: Doc): string {
  const { order, cycle } = stepOrder(doc);
  const all = [...order, ...cycle];
  if (!all.length) return '계획 블록이 없습니다. 사용자가 계획을 만들어야 진행할 수 있습니다.';
  const wf = workflowOf(doc);
  const status = effectiveStatuses(doc);
  const ready = nextSteps(doc, 'claude');
  const lines: string[] = [];
  if (wf.stepPermission === 'read') lines.push('이 계획은 AI가 읽기만 하도록 설정되어 있어 진행할 수 없습니다. 사용자가 계획 창에서 AI 권한을 바꿔야 합니다.');
  if (ready.length) {
    lines.push('지금 시작할 수 있는 단계 (이 순서대로):');
    for (const id of ready) {
      const st = doc.nodes[id].step!;
      lines.push(`- ${label(doc.nodes[id])}${st.approval === 'ask' && !st.approved ? ' — 시작 전 승인 필요: request_approval을 먼저 부르세요' : ''}`);
    }
    lines.push('', 'start_step(id)로 시작하면 작업 지시서를 받습니다.');
    return lines.join('\n');
  }
  const by = (s: EffectiveStatus) => all.filter((id) => status.get(id) === s).map((id) => label(doc.nodes[id]));
  const running = by('running');
  const waiting = by('waiting');
  const asking = by('asking');
  const review = by('review');
  const human = all.filter((id) => status.get(id) === 'ready' && doc.nodes[id].step!.assignee === 'human').map((id) => label(doc.nodes[id]));
  const failed = by('failed');
  const blocked = by('blocked');
  const p = progress(doc);
  if (p.total && p.done + p.skipped === p.total) lines.push('모든 단계가 끝났습니다. 계획이 완료되었습니다.');
  else lines.push('지금 Claude가 새로 시작할 단계가 없습니다.');
  if (running.length) lines.push(`진행 중: ${running.join(', ')} — 이 단계를 마저 하고 finish_step 또는 fail_step으로 끝내세요.`);
  if (asking.length) lines.push(`질문에 대한 사용자의 답을 기다리는 중: ${asking.join(', ')}`);
  if (waiting.length) lines.push(`사용자의 시작 승인을 기다리는 중: ${waiting.join(', ')}`);
  if (review.length) lines.push(`사용자의 검토를 기다리는 중: ${review.join(', ')}`);
  if (human.length) lines.push(`사람이 할 단계 (사용자가 끝낼 때까지 기다림): ${human.join(', ')}`);
  if (failed.length) lines.push(`실패한 단계: ${failed.join(', ')} — 사용자가 다시 하기·건너뛰기를 정할 때까지 뒤 단계는 막힙니다.`);
  if (blocked.length) lines.push(`막힌 단계: ${blocked.join(', ')}`);
  const active = all.filter((id) => ['running', 'waiting', 'asking', 'review'].includes(status.get(id)!)).length;
  if (active >= wf.parallel && !running.length) lines.push(`동시에 ${wf.parallel}개까지만 진행합니다. 위 단계가 끝나야 다음 단계를 시작할 수 있습니다.`);
  if (asking.length || waiting.length || review.length || human.length) lines.push('', '사용자에게 ThoughtFlow에서 확인해 달라고 알리고, 답이 오면 다시 next_steps를 부르세요.');
  return lines.join('\n');
}

/** start_step / get_plan(id): 한 단계의 작업 지시서 */
export function workOrder(doc: Doc, id: string, opts: PlanTextOptions): string {
  const n = doc.nodes[id] as BoxNode & { step: StepInfo };
  const st = n.step;
  const wf = workflowOf(doc);
  const status = effectiveStatuses(doc).get(id) ?? st.status;
  const tools = mergeResources(wf.defaults, st.resources);
  const out = [`[작업 지시서] ${label(n)} — ${STATUS_TEXT(status)}`, `계획 버전: ${planFingerprint(doc)}`];
  if (wf.goal) out.push(`계획 전체 목표: ${wf.goal}`);
  if (wf.workingDir) out.push(`작업 폴더: ${wf.workingDir}`);
  out.push(roleText(st));
  const preds = stepGraph(doc).preds.get(id) ?? [];
  for (const p of preds) {
    const r = doc.nodes[p].step?.result;
    if (r) out.push(`앞 단계 ${label(doc.nodes[p])}의 결과: ${r.summary}${r.outputs.length ? ` (만든 것: ${r.outputs.map((o) => o.path).join(', ')})` : ''}`);
  }
  out.push('', ...planBody(n, ''));
  out.push('', '쓸 도구:');
  out.push(...(isEmptyResources(tools) ? ['- 지정된 도구가 없습니다. 기본으로 갖고 있는 도구로 하세요.'] : resourceHowTo(tools, opts.catalog)));
  const back = sendBackNote(st);
  if (back) out.push('', `사람이 이 단계를 되돌려 보냈습니다. 이유: ${back}`, '이 이유를 먼저 해결하세요.');
  const answered = st.questions.filter((q) => q.answer);
  const openQ = st.questions.filter((q) => !q.answer);
  if (answered.length) {
    out.push('', '사용자의 답 (그대로 따르세요):');
    for (const q of answered) out.push(`- 질문: ${q.question}`, `  답: ${q.answer}`);
  }
  if (openQ.length) out.push('', `아직 답이 없는 질문 ${openQ.length}개 — 답이 올 때까지 그 부분은 진행하지 마세요.`);
  out.push(
    '',
    '규칙:',
    '- 위 계획에 적힌 것만, 적힌 대로 하세요. 만들 것에 없는 것을 더 만들지 말고, 참고 자료를 따르세요.',
    '- 계획에 없는 결정이 필요하면 ask_user로 묻고 답을 기다리세요. 계획이 틀려 보이면 propose_change로 제안만 하세요.',
    '- 계획 블록(이 Box)의 제목·메모·Route는 고치지 마세요. 진행 중 남길 말은 log_step으로.',
    '',
    '끝낼 때 finish_step으로 보고하세요:',
  );
  if (st.deliverables.length) out.push(`- outputs: 만들 것 ${st.deliverables.map((_, i) => i + 1).join(', ')}번마다 { deliverable: 번호, path: 만든 위치 }`);
  if (st.doneWhen.length) out.push(`- criteria: 완료 기준 ${st.doneWhen.map((_, i) => i + 1).join(', ')}번마다 { item: 번호, pass: true/false, evidence: 직접 확인한 근거 }`);
  out.push('- used: 실제로 쓴 스킬·명령어·커넥터·서브 에이전트 (안 쓴 것은 빼고, 쓴 것이 없으면 빈 목록)', '- 기준을 통과하지 못하면 계속 고치거나 fail_step(이유)으로 알리세요.');
  if (st.review) out.push('- 이 단계는 끝나면 사람이 검토합니다. 검토가 끝날 때까지 뒤 단계는 시작되지 않습니다.');
  return out.join('\n');
}
