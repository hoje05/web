/**
 * AI(Claude·ChatGPT)의 요청을 실제 보드에 적용한다 (renderer 쪽).
 *
 *  Claude/ChatGPT → MCP 서버 → Electron main → (IPC) → 여기 → Zustand store
 *
 *  - 요청은 하나씩 차례로 처리한다 (프로젝트 전환 도중 다른 요청이 끼어들지 않도록).
 *    앞 요청이 오래 끝나지 않으면 다음 요청은 더 기다리지 않는다 (하나가 멈춰도 전부 막히지 않게).
 *  - 보드를 바꾸는 요청 하나 = Undo 한 번. 사용자는 Ctrl+Z나 알림의 "되돌리기"로 취소할 수 있다.
 *  - 바뀐 결과는 평소처럼 자동 저장된다. AI 요청 중에는 대화상자를 띄우지 않는다 (사용자는 AI 창을 보고 있으므로).
 */
import { EMPTY_DOC } from '../model/types';
import { createProject, listProjects, projectName, samePath, switchProject } from '../persistence/fileService';
import { useStore, viewportCenterWorld } from '../store/store';
import {
  addFlow,
  boxLabel,
  connectBoxes,
  deleteItems,
  describeBoard,
  readBox,
  resolveBox,
  searchBoxes,
  updateBox,
  type OpResult,
} from './boardOps';
import type { Doc } from '../model/types';
import { workflowOf } from '../workflow/defaults';
import { SOURCE_LABEL, findInCatalog, type CatalogItem } from '../workflow/catalog';
import { describeNext, describePlan, workOrder } from '../workflow/planText';
import { mergeResources, normalizeResources, type ResourceKind } from '../workflow/resources';
import { steps } from '../workflow/graph';
import { askUser, failStep, finishStep, logStep, proposeChange, requestApproval, startStep, type Outcome } from '../workflow/transitions';
import { addReported, catalogFor } from '../workflow/useCatalog';
import { aiDisplayName, type AddFlowArgs, type AiRequest, type AiResponse, type FlowRouteInput } from './protocol';

const FLASH_MS = 2600;
/** 앞 요청을 기다리는 최대 시간 */
const QUEUE_WAIT_MS = 20000;

let queue: Promise<unknown> = Promise.resolve();
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let activitySeq = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function handleAiRequest(req: AiRequest): Promise<AiResponse> {
  const run = queue.then(() => execute(req));
  queue = Promise.race([run.catch(() => undefined), sleep(QUEUE_WAIT_MS)]);
  return run.catch((err: unknown) => ({
    text: `ThoughtFlow에서 오류가 났습니다: ${err instanceof Error ? err.message : String(err)}`,
    isError: true,
  }));
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const errorText = (text: string): AiResponse => ({ text, isError: true });

/** 사용자가 지금 보고 있는 Box: 오른쪽 창의 탭, 없으면 선택한 Box */
function focusedBox(): string | null {
  const s = useStore.getState();
  if (s.panelOpen && s.activeTab) return s.activeTab;
  return s.selection?.kind === 'node' ? s.selection.id : null;
}

function currentBoardText(includeNotes = true) {
  const s = useStore.getState();
  return describeBoard(s.doc, { projectName: projectName(s.filePath), includeNotes, focusId: focusedBox() });
}

/** 읽기 전용 결과 */
const reply = (r: OpResult): AiResponse => (r.ok ? { text: r.text } : errorText(r.error));

/** 보드를 바꾸는 결과: 적용 + 알림 + 새 Box 보이기 */
function apply(r: OpResult, ai: string): AiResponse {
  if (!r.ok) return errorText(r.error);
  const s = useStore.getState();
  if (r.doc === s.doc) return { text: r.text };
  const before = s.doc;
  s.commit(r.doc);

  // 지워진 Box를 가리키던 선택·탭 정리
  const after = useStore.getState();
  if (after.selection?.kind === 'node' && !r.doc.nodes[after.selection.id]) after.select(null);
  if (after.selection?.kind === 'edge' && !r.doc.edges[after.selection.id]) after.select(null);
  if (after.editingNodeId && !r.doc.nodes[after.editingNodeId]) after.stopEditing();
  for (const t of after.tabs) if (!r.doc.nodes[t]) after.closeTab(t);

  const created = (r.created ?? []).filter((id) => r.doc.nodes[id]);
  useStore.setState({
    aiActivity: { seq: ++activitySeq, message: `${ai}: ${r.text.split('\n')[0]}`, before },
    aiFlash: created,
  });
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => useStore.setState({ aiFlash: [] }), FLASH_MS);
  if (created.length && !created.some(isVisible)) useStore.getState().centerOn(created[0]);
  return { text: r.text };
}

/** 보드는 그대로이고 알림만 (프로젝트를 만들거나 열었을 때) */
function notify(message: string) {
  useStore.setState({ aiActivity: { seq: ++activitySeq, message, before: null }, aiFlash: [] });
}

/** 계획 블록 찾기 (id 또는 정확한 제목) */
function stepRef(ref: unknown): { id: string; title: string } | { error: string } {
  const n = resolveBox(useStore.getState().doc, str(ref));
  if ('error' in n) return n;
  if (!n.step) return { error: `${boxLabel(n)}은(는) 계획 블록이 아닙니다. get_plan으로 단계 id를 확인하세요.` };
  return { id: n.id, title: n.text.trim() || '(제목 없음)' };
}

/** 계획 규칙(transitions)의 결과를 적용: Undo 한 칸 + 알림(message가 있으면) + 그 단계 반짝 */
function commitPlan(o: Outcome, ai: string, text: string, message: string | null, stepId?: string): AiResponse {
  if (!o.ok) return errorText(o.error);
  const s = useStore.getState();
  if (o.doc === s.doc) return { text };
  const before = s.doc;
  s.commit(o.doc);
  if (message) {
    useStore.setState({ aiActivity: { seq: ++activitySeq, message: `${ai}: ${message}`, before }, aiFlash: stepId ? [stepId] : [] });
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => useStore.setState({ aiFlash: [] }), FLASH_MS);
  }
  return { text };
}

const planOpts = async (d: Doc) => {
  const catalog = await catalogFor(workflowOf(d).workingDir ?? null);
  return { projectName: projectName(useStore.getState().filePath), catalog: catalog.items };
};

const KIND_TEXT: Record<ResourceKind, string> = { skill: '스킬', command: '명령어', connector: '커넥터', subagent: '서브 에이전트' };
const nameList = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).map((x) => x.trim()).filter(Boolean).slice(0, 300) : []);

function flowArgs(args: Record<string, unknown>): AddFlowArgs {
  return {
    boxes: Array.isArray(args.boxes) ? (args.boxes as AddFlowArgs['boxes']) : [],
    routes: Array.isArray(args.routes) ? (args.routes as FlowRouteInput[]) : undefined,
    after: typeof args.after === 'string' ? args.after : undefined,
  };
}

function isVisible(id: string): boolean {
  const { doc, viewport: v, boardSize } = useStore.getState();
  const n = doc.nodes[id];
  if (!n) return false;
  const x1 = n.x * v.zoom + v.panX;
  const y1 = n.y * v.zoom + v.panY;
  return x1 >= 0 && y1 >= 0 && x1 + n.width * v.zoom <= boardSize.width && y1 + n.height * v.zoom <= boardSize.height;
}

async function execute({ tool, args, client }: AiRequest): Promise<AiResponse> {
  const ai = aiDisplayName(client);
  const doc = () => useStore.getState().doc;

  switch (tool) {
    case 'get_board':
      return { text: currentBoardText(args.include_notes !== false) };

    case 'read_box':
      return reply(readBox(doc(), str(args.id)));

    case 'search_boxes':
      return reply(searchBoxes(doc(), str(args.query)));

    case 'add_flow':
      return apply(addFlow(doc(), flowArgs(args), ai, viewportCenterWorld()), ai);

    case 'update_box':
      return apply(
        updateBox(doc(), {
          id: str(args.id),
          title: typeof args.title === 'string' ? args.title : undefined,
          note: typeof args.note === 'string' ? args.note : undefined,
          append_note: typeof args.append_note === 'string' ? args.append_note : undefined,
        }),
        ai,
      );

    case 'connect_boxes':
      return apply(connectBoxes(doc(), str(args.from), str(args.to)), ai);

    case 'delete_items':
      return apply(
        deleteItems(doc(), {
          box_ids: Array.isArray(args.box_ids) ? args.box_ids.map(str) : undefined,
          routes: Array.isArray(args.routes) ? (args.routes as FlowRouteInput[]) : undefined,
        }),
        ai,
      );

    case 'focus_box': {
      const n = resolveBox(doc(), str(args.id));
      if ('error' in n) return errorText(n.error);
      const s = useStore.getState();
      s.select({ kind: 'node', id: n.id });
      s.openPage(n.id, { force: true });
      s.centerOn(n.id);
      return { text: `사용자 화면에서 ${boxLabel(n)} Box를 열어 보여 주었습니다.` };
    }

    case 'list_projects': {
      const list = await listProjects();
      const cur = useStore.getState().filePath;
      if (!list.length) return { text: '프로젝트가 없습니다. create_project로 만들 수 있습니다.' };
      const lines = [`프로젝트 ${list.length}개 (최근 수정 순):`];
      for (const p of list) {
        const when = new Date(p.modifiedAt).toLocaleString('ko-KR');
        const count = p.boxCount === null ? '' : ` · Box ${p.boxCount}개`;
        lines.push(`- ${p.name}${count} · ${when}${samePath(p.filePath, cur) ? '  ← 지금 열린 프로젝트' : ''}`);
      }
      return { text: lines.join('\n') };
    }

    case 'open_project': {
      const name = str(args.name).trim();
      if (!name) return errorText('name이 비어 있습니다.');
      const list = await listProjects();
      const lower = name.toLowerCase();
      const exact = list.filter((p) => p.name.toLowerCase() === lower);
      const partial = list.filter((p) => p.name.toLowerCase().includes(lower));
      const target = exact[0] ?? (partial.length === 1 ? partial[0] : null);
      if (!target) {
        const hint = partial.length > 1 ? `비슷한 이름이 여러 개입니다: ${partial.map((p) => p.name).join(', ')}` : 'list_projects로 이름을 확인하세요.';
        return errorText(`'${name}' 프로젝트를 찾을 수 없습니다. ${hint}`);
      }
      const problem = await switchProject(target.filePath, { quiet: true });
      if (problem || !samePath(useStore.getState().filePath, target.filePath)) {
        return errorText(`'${target.name}' 프로젝트를 열지 못했습니다. ${problem ?? ''}`.trim());
      }
      notify(`${ai}: '${target.name}' 프로젝트를 열었습니다`);
      return { text: `'${target.name}' 프로젝트를 열었습니다.\n\n${currentBoardText()}` };
    }

    case 'create_project': {
      // 빈 보드에 넣을 흐름이 함께 왔으면, 프로젝트를 만들기 전에 먼저 검사한다 (잘못된 요청이면 아무것도 만들지 않는다)
      const flow = flowArgs(args);
      const withFlow = flow.boxes.length > 0;
      if (withFlow) {
        const check = addFlow(EMPTY_DOC, { ...flow, after: undefined }, ai, { x: 0, y: 0 });
        if (!check.ok) return errorText(`프로젝트를 만들지 않았습니다. ${check.error}`);
      }
      const problem = await createProject(str(args.name));
      if (problem) return errorText(`프로젝트를 만들지 못했습니다: ${problem}`);
      const name = projectName(useStore.getState().filePath);
      const made = `새 프로젝트 '${name}'를 만들어 빈 보드를 열었습니다.`;
      if (!withFlow) {
        notify(`${ai}: 새 프로젝트 '${name}'를 만들었습니다`);
        return { text: `${made} 이제 add_flow로 내용을 채우세요.` };
      }
      const res = apply(addFlow(doc(), { ...flow, after: undefined }, ai, viewportCenterWorld()), ai);
      return res.isError ? res : { text: `${made}\n${res.text}` };
    }

    // ───────────── 계획 진행 ─────────────

    case 'get_plan': {
      if (str(args.id).trim()) {
        const st = stepRef(args.id);
        if ('error' in st) return errorText(st.error);
        return { text: workOrder(doc(), st.id, await planOpts(doc())) };
      }
      return { text: describePlan(doc(), await planOpts(doc())) };
    }

    case 'next_steps':
      return { text: describeNext(doc()) };

    case 'start_step': {
      const st = stepRef(args.id);
      if ('error' in st) return errorText(st.error);
      const o = startStep(doc(), st.id, ai);
      if (!o.ok) return errorText(o.error);
      const opts = await planOpts(o.doc);
      return commitPlan(o, ai, `'${st.title}' 단계를 시작했습니다.\n\n${workOrder(o.doc, st.id, opts)}`, `'${st.title}' 단계를 시작했습니다`, st.id);
    }

    case 'request_approval': {
      const st = stepRef(args.id);
      if ('error' in st) return errorText(st.error);
      const o = requestApproval(doc(), st.id, ai, str(args.why));
      return commitPlan(
        o,
        ai,
        `'${st.title}' 단계의 시작 승인을 요청했습니다. 사용자가 ThoughtFlow에서 승인할 때까지 기다리세요. 승인되면 next_steps에 다시 나옵니다.`,
        `'${st.title}' 단계를 시작해도 되는지 승인을 기다립니다`,
        st.id,
      );
    }

    case 'log_step': {
      const st = stepRef(args.id);
      if ('error' in st) return errorText(st.error);
      return commitPlan(logStep(doc(), st.id, ai, str(args.note)), ai, `'${st.title}' 단계에 기록했습니다.`, null);
    }

    case 'ask_user': {
      const st = stepRef(args.id);
      if ('error' in st) return errorText(st.error);
      const q = str(args.question).trim();
      return commitPlan(
        askUser(doc(), st.id, ai, q),
        ai,
        `'${st.title}' 단계에 질문을 남겼습니다. 사용자가 ThoughtFlow에서 답할 때까지 이 결정이 필요한 부분은 진행하지 마세요. 답은 get_plan(id)로 확인할 수 있습니다 (답하면 단계가 다시 진행 중이 됩니다).`,
        `질문 — ${q.replace(/\s+/g, ' ').slice(0, 80)}`,
        st.id,
      );
    }

    case 'finish_step': {
      const st = stepRef(args.id);
      if ('error' in st) return errorText(st.error);
      const o = finishStep(doc(), st.id, ai, {
        summary: str(args.summary),
        outputs: Array.isArray(args.outputs) ? (args.outputs as { deliverable: number; path: string }[]) : [],
        criteria: Array.isArray(args.criteria) ? (args.criteria as { item: number; pass: boolean; evidence: string }[]) : [],
        used: args.used === undefined ? (undefined as never) : normalizeResources(args.used),
      });
      if (!o.ok) return errorText(o.error);
      const status = o.doc.nodes[st.id].step!.status;
      const then = describeNext(o.doc);
      return commitPlan(
        o,
        ai,
        `'${st.title}' 단계를 ${status === 'review' ? '끝냈습니다. 사용자의 검토를 기다립니다' : '완료했습니다'}.\n\n${then}`,
        `'${st.title}' 단계를 ${status === 'review' ? '끝냈습니다 — 검토해 주세요' : '완료했습니다'}`,
        st.id,
      );
    }

    case 'fail_step': {
      const st = stepRef(args.id);
      if ('error' in st) return errorText(st.error);
      return commitPlan(
        failStep(doc(), st.id, ai, str(args.reason)),
        ai,
        `'${st.title}' 단계를 실패로 표시했습니다. 사용자가 다시 하기나 건너뛰기를 정할 때까지 뒤 단계는 시작할 수 없습니다.`,
        `'${st.title}' 단계가 실패했습니다`,
        st.id,
      );
    }

    case 'propose_change': {
      let stepId: string | undefined;
      if (str(args.step_id).trim()) {
        const st = stepRef(args.step_id);
        if ('error' in st) return errorText(st.error);
        stepId = st.id;
      }
      return commitPlan(
        proposeChange(doc(), ai, { stepId, change: str(args.change), why: str(args.why) }),
        ai,
        '수정 제안을 남겼습니다. 계획은 바뀌지 않았습니다 — 사용자가 받아들이면 직접 고칩니다. 지금 계획대로 계속하거나, 제안이 꼭 필요하면 ask_user로 기다리세요.',
        '계획 수정을 제안했습니다 (계획 창)',
        stepId,
      );
    }

    case 'get_catalog': {
      const d = doc();
      const catalog = await catalogFor(workflowOf(d).workingDir ?? null);
      const kind = str(args.kind) as ResourceKind;
      const kinds: ResourceKind[] = ['skill', 'command', 'connector', 'subagent'].includes(kind) ? [kind] : ['skill', 'command', 'connector', 'subagent'];
      const lines = [`이 PC에서 찾은 도구${catalog.workingDir ? ` (작업 폴더 ${catalog.workingDir} 포함)` : ''}:`];
      for (const k of kinds) {
        const items = catalog.items.filter((i) => i.kind === k);
        lines.push('', `[${KIND_TEXT[k]} ${items.length}개]`);
        for (const i of items) lines.push(`- ${i.name} (${SOURCE_LABEL[i.source]}${i.where ? ` · ${i.where}` : ''})${i.description ? `: ${i.description}` : ''}`);
      }
      lines.push('', 'claude.ai에 연결한 커넥터는 PC에 없어서 이 목록에 나오지 않습니다.');
      return { text: lines.join('\n') };
    }

    case 'report_capabilities': {
      const groups: [ResourceKind, string[]][] = [
        ['skill', nameList(args.skills)],
        ['command', nameList(args.commands)],
        ['connector', nameList(args.connectors)],
        ['subagent', nameList(args.subagents)],
      ];
      const items: CatalogItem[] = groups.flatMap(([kind, names]) => names.map((name) => ({ kind, name: kind === 'command' && !name.startsWith('/') ? `/${name}` : name, description: '', source: 'claude' as const })));
      if (!items.length) return errorText('알려 줄 도구 이름이 없습니다 (skills, commands, connectors, subagents).');
      const added = addReported(items);
      // 계획에 적힌 도구 중 Claude가 갖고 있지 않은 것
      const d = doc();
      const wf = workflowOf(d);
      const missing: string[] = [];
      for (const s of steps(d)) {
        const r = mergeResources(wf.defaults, s.step.resources);
        const want: [ResourceKind, string][] = [
          ...r.skills.map((n) => ['skill', n] as [ResourceKind, string]),
          ...r.commands.map((n) => ['command', n] as [ResourceKind, string]),
          ...r.connectors.map((n) => ['connector', n] as [ResourceKind, string]),
          ...(r.subagent ? [['subagent', r.subagent.type] as [ResourceKind, string]] : []),
        ];
        for (const [k, n] of want) {
          if (!findInCatalog(items, k, n)) missing.push(`${s.text.trim() || '(제목 없음)'} [${s.id}]: ${KIND_TEXT[k]} ${n}`);
        }
      }
      const lines = [`도구 ${items.length}개를 받았습니다 (새로 ${added}개). ThoughtFlow의 도구 목록에 함께 보여 줍니다 (앱을 끄면 잊음).`];
      if (missing.length) {
        lines.push('', '계획에 적혀 있지만 지금 갖고 있지 않은 도구:', ...[...new Set(missing)].map((m) => `- ${m}`));
        lines.push('', '이 단계를 시작하기 전에 사용자에게 알리세요 (설치·연결이 필요하거나, 계획을 고쳐야 할 수 있습니다).');
      } else if (steps(d).length) lines.push('계획에 적힌 도구를 모두 갖고 있습니다.');
      notify(`${ai}: 쓸 수 있는 도구 ${items.length}개를 알려 왔습니다${missing.length ? ` — 계획의 도구 ${missing.length}개가 없음` : ''}`);
      return { text: lines.join('\n') };
    }

    default:
      return errorText(`알 수 없는 도구입니다: ${String(tool)}`);
  }
}
