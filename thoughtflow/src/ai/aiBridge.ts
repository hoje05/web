/**
 * AI(Claude·ChatGPT)의 요청을 실제 보드에 적용한다 (renderer 쪽).
 *
 *  Claude/ChatGPT → MCP 서버 → Electron main → (IPC) → 여기 → Zustand store
 *
 *  - 요청은 하나씩 차례로 처리한다 (프로젝트 전환 도중 다른 요청이 끼어들지 않도록).
 *  - 보드를 바꾸는 요청 하나 = Undo 한 번. 사용자는 Ctrl+Z나 알림의 "되돌리기"로 취소할 수 있다.
 *  - 바뀐 결과는 평소처럼 자동 저장된다.
 */
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
import { aiDisplayName, type AddFlowArgs, type AiRequest, type AiResponse, type FlowRouteInput } from './protocol';

const FLASH_MS = 2600;

let queue: Promise<unknown> = Promise.resolve();
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let activitySeq = 0;

export function handleAiRequest(req: AiRequest): Promise<AiResponse> {
  const run = queue.then(() => execute(req));
  queue = run.catch(() => undefined);
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
      return apply(addFlow(doc(), args as unknown as AddFlowArgs, ai, viewportCenterWorld()), ai);

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
      await switchProject(target.filePath);
      if (!samePath(useStore.getState().filePath, target.filePath)) return errorText(`'${target.name}' 프로젝트를 열지 못했습니다.`);
      return { text: `'${target.name}' 프로젝트를 열었습니다.\n\n${currentBoardText()}` };
    }

    case 'create_project': {
      const name = str(args.name).trim();
      const problem = await createProject(name);
      if (problem) return errorText(`프로젝트를 만들지 못했습니다: ${problem}`);
      return { text: `새 프로젝트 '${projectName(useStore.getState().filePath)}'를 만들고 열었습니다. 이제 add_flow로 내용을 채울 수 있습니다.` };
    }

    default:
      return errorText(`알 수 없는 도구입니다: ${String(tool)}`);
  }
}
