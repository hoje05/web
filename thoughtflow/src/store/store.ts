import { create } from 'zustand';
import type { Vec } from '../geometry/vec';
import { addNode, makeNode, removeEdge, removeNode, setNodeText, updateNode } from '../model/docOps';
import { newId } from '../model/ids';
import { EMPTY_DOC, type Doc, type Selection, type Tool, type Viewport } from '../model/types';
import { getRouteGeometry } from '../routing/routeGeometry';
import { fitBounds, screenToWorld, zoomAt } from '../viewport/viewport';
import type { Hit } from '../interaction/hitTest';
import { createRoute, type RouteDraft } from '../routing/createRoute';
import { correctRoute, reverseRoute } from '../routing/routeOps';
import { pushPast, type History } from './history';

export interface AppState extends History {
  doc: Doc;
  /** 마지막으로 저장(또는 연) 시점의 Doc. doc !== savedDoc 이면 저장되지 않은 변경이 있다. */
  savedDoc: Doc;
  filePath: string | null;
  viewport: Viewport;
  boardSize: { width: number; height: number };
  selection: Selection;
  tool: Tool;
  editingNodeId: string | null;
  /** Space 키를 누르고 있는 동안 true → 왼쪽 드래그가 Pan */
  spaceHeld: boolean;
  /** Toolbar에서 Box를 끌고 오는 중일 때 미리보기 위치 (world, Box 중심) */
  ghost: Vec | null;
  /** 마우스 아래에 있는 대상 (커서/hover 표시용) */
  hover: Hit;
  /** 그리는 중인 Route (world 좌표) + 놓으면 연결될 Box */
  draft: (RouteDraft & { targetNodeId: string | null }) | null;

  // ── Doc 변경 (history) ──
  /** 새 Doc을 적용하고 이전 Doc을 Undo 기록에 넣는다 */
  commit: (next: Doc) => void;
  /** 드래그처럼 live로 바꾼 뒤, 시작 시점 Doc을 Undo 기록에 한 번만 넣는다 */
  commitFrom: (before: Doc) => void;
  /** Undo 기록 없이 Doc 변경 (드래그 중간 단계, 크기 측정) */
  setDocLive: (doc: Doc) => void;
  undo: () => void;
  redo: () => void;

  // ── 파일 ──
  resetBoard: () => void;
  loadBoard: (doc: Doc, viewport: Viewport | null, filePath: string) => void;
  markSaved: (filePath: string, doc: Doc) => void;

  // ── 편의 action ──
  addBoxAt: (worldCenter: Vec) => string;
  setText: (id: string, text: string) => void;
  setNodeSize: (id: string, width: number, height: number) => void;
  deleteSelection: () => void;
  reverseEdge: (id: string) => void;
  correctEdge: (id: string) => void;
  /** 그린 경로로 Route(필요하면 새 Box까지) 생성. 성공하면 true */
  finishRoute: (draft: RouteDraft, targetNodeId: string | null) => boolean;
  setDraft: (draft: AppState['draft']) => void;

  select: (selection: Selection) => void;
  startEditing: (id: string) => void;
  stopEditing: () => void;
  setGhost: (ghost: Vec | null) => void;
  setHover: (hover: Hit) => void;

  setViewport: (v: Viewport) => void;
  zoomBy: (factor: number, anchor?: Vec) => void;
  /** 모든 Box와 Route가 화면에 들어오도록 */
  fitView: () => void;
  setBoardSize: (size: { width: number; height: number }) => void;
  setTool: (tool: Tool) => void;
  setSpaceHeld: (held: boolean) => void;
}

export const useStore = create<AppState>()((set, get) => ({
  doc: EMPTY_DOC,
  savedDoc: EMPTY_DOC,
  filePath: null,
  past: [],
  future: [],
  viewport: { zoom: 1, panX: 0, panY: 0 },
  boardSize: { width: 1, height: 1 },
  selection: null,
  tool: 'select',
  editingNodeId: null,
  spaceHeld: false,
  ghost: null,
  hover: { kind: 'empty' },
  draft: null,

  commit: (next) =>
    set((s) => (next === s.doc ? {} : { doc: next, past: pushPast(s.past, s.doc), future: [] })),
  commitFrom: (before) => set((s) => (before === s.doc ? {} : { past: pushPast(s.past, before), future: [] })),
  setDocLive: (doc) => set({ doc }),

  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        doc: prev,
        past: s.past.slice(0, -1),
        future: [s.doc, ...s.future],
        selection: validSelection(s.selection, prev),
        editingNodeId: null,
        draft: null,
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return {
        doc: next,
        past: pushPast(s.past, s.doc),
        future: s.future.slice(1),
        selection: validSelection(s.selection, next),
        editingNodeId: null,
        draft: null,
      };
    }),

  resetBoard: () => {
    const { boardSize } = get();
    set({
      doc: EMPTY_DOC,
      savedDoc: EMPTY_DOC,
      filePath: null,
      past: [],
      future: [],
      selection: null,
      editingNodeId: null,
      draft: null,
      tool: 'select',
      viewport: { zoom: 1, panX: boardSize.width / 2, panY: boardSize.height / 2 },
    });
  },
  loadBoard: (doc, viewport, filePath) => {
    set({
      doc,
      savedDoc: doc,
      filePath,
      past: [],
      future: [],
      selection: null,
      editingNodeId: null,
      draft: null,
      tool: 'select',
    });
    if (viewport) set({ viewport });
    else get().fitView();
  },
  markSaved: (filePath, doc) => set({ filePath, savedDoc: doc }),

  addBoxAt: (center) => {
    const id = newId('n');
    const { doc, commit } = get();
    commit(addNode(doc, makeNode(id, center)));
    set({ selection: { kind: 'node', id }, editingNodeId: id });
    return id;
  },

  setText: (id, text) => {
    const { doc, commit } = get();
    commit(setNodeText(doc, id, text));
  },

  setNodeSize: (id, width, height) => {
    const node = get().doc.nodes[id];
    if (!node || (Math.abs(node.width - width) < 0.5 && Math.abs(node.height - height) < 0.5)) return;
    set((s) => {
      const doc = updateNode(s.doc, id, { width, height });
      // 측정값 갱신은 사용자 변경이 아니므로 "저장 안 됨" 상태를 만들지 않는다
      return { doc, savedDoc: s.doc === s.savedDoc ? doc : s.savedDoc };
    });
  },

  deleteSelection: () => {
    const { selection, doc, commit } = get();
    if (!selection) return;
    commit(selection.kind === 'node' ? removeNode(doc, selection.id) : removeEdge(doc, selection.id));
    set({ selection: null, editingNodeId: null });
  },

  reverseEdge: (id) => {
    const { doc, commit } = get();
    commit(reverseRoute(doc, id));
  },

  correctEdge: (id) => {
    const { doc, commit } = get();
    commit(correctRoute(doc, id));
  },

  finishRoute: (draft, targetNodeId) => {
    const { doc, commit, viewport } = get();
    const result = createRoute(doc, draft, targetNodeId, viewport.zoom);
    if (!result) return false;
    commit(result.doc);
    if (result.editNodeId) {
      set({ selection: { kind: 'node', id: result.editNodeId }, editingNodeId: result.editNodeId });
    } else {
      set({ selection: { kind: 'edge', id: result.edgeId }, editingNodeId: null });
    }
    return true;
  },
  setDraft: (draft) => set({ draft }),

  select: (selection) => set({ selection }),
  startEditing: (id) => set({ selection: { kind: 'node', id }, editingNodeId: id }),
  stopEditing: () => set({ editingNodeId: null }),
  setGhost: (ghost) => set({ ghost }),
  setHover: (hover) => {
    const cur = get().hover;
    if (sameHit(cur, hover)) return;
    set({ hover });
  },

  setViewport: (viewport) => set({ viewport }),
  zoomBy: (factor, anchor) => {
    const { viewport, boardSize } = get();
    const a = anchor ?? { x: boardSize.width / 2, y: boardSize.height / 2 };
    set({ viewport: zoomAt(viewport, a, factor) });
  },
  fitView: () => {
    const { doc, boardSize } = get();
    const nodes = Object.values(doc.nodes);
    if (nodes.length === 0) {
      set({ viewport: { zoom: 1, panX: boardSize.width / 2, panY: boardSize.height / 2 } });
      return;
    }
    const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const include = (x: number, y: number, w: number, h: number) => {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x + w);
      b.maxY = Math.max(b.maxY, y + h);
    };
    for (const n of nodes) include(n.x, n.y, n.width, n.height);
    for (const g of getRouteGeometry(doc).values()) include(g.bbox.x, g.bbox.y, g.bbox.width, g.bbox.height);
    set({ viewport: fitBounds(b, boardSize) });
  },
  setBoardSize: (boardSize) =>
    set((s) => {
      // 처음 크기가 정해질 때 world 원점을 화면 중앙에 둔다
      const first = s.boardSize.width <= 1;
      return first
        ? { boardSize, viewport: { ...s.viewport, panX: boardSize.width / 2, panY: boardSize.height / 2 } }
        : { boardSize };
    }),
  setTool: (tool) => set({ tool }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
}));

/** 현재 화면 중앙의 world 좌표 */
export function viewportCenterWorld(): Vec {
  const { viewport, boardSize } = useStore.getState();
  return screenToWorld(viewport, { x: boardSize.width / 2, y: boardSize.height / 2 });
}

function validSelection(sel: Selection, doc: Doc): Selection {
  if (!sel) return null;
  if (sel.kind === 'node') return doc.nodes[sel.id] ? sel : null;
  return doc.edges[sel.id] ? sel : null;
}

function sameHit(a: Hit, b: Hit): boolean {
  if (a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
