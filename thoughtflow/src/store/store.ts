import { create } from 'zustand';
import type { Vec } from '../geometry/vec';
import { addNode, makeNode, removeEdge, removeNode, setNodeNote, setNodeText, updateNode } from '../model/docOps';
import { newId } from '../model/ids';
import { EMPTY_DOC, type Doc, type Selection, type Tool, type Viewport } from '../model/types';
import { getRouteGeometry } from '../routing/routeGeometry';
import { fitBounds, screenToWorld, zoomAt } from '../viewport/viewport';
import type { Hit } from '../interaction/hitTest';
import { createRoute, type RouteDraft } from '../routing/createRoute';
import { reverseRoute } from '../routing/routeOps';
import type { BoardUiState } from '../persistence/fileFormat';
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

  // ── 오른쪽 창 (Box별 생각 메모) ──
  panelOpen: boolean;
  /** 사용자가 창을 닫았으면 true → 클릭으로는 다시 열지 않고, 더블클릭으로만 연다 */
  panelDismissed: boolean;
  panelWidth: number;
  /** 창 윗부분에 한 줄로 나열되는 Box 탭 (연 순서) */
  tabs: string[];
  activeTab: string | null;
  /** 창의 제목/메모 입력칸으로 포커스를 옮기라는 요청 (seq가 바뀔 때마다 실행) */
  panelFocus: { nodeId: string; field: 'title' | 'note'; seq: number } | null;

  // ── 검색 (Ctrl+F) ──
  searchOpen: boolean;
  /** Ctrl+F를 누를 때마다 증가 → 검색칸에 다시 포커스 */
  searchSeq: number;
  searchQuery: string;

  // ── 자동 저장 상태 ──
  saveState: 'idle' | 'saving' | 'saved' | 'error';

  /** 우클릭 메뉴 (Board 영역 기준 화면 좌표) */
  contextMenu: { x: number; y: number; target: 'node' | 'edge' } | null;
  setContextMenu: (menu: AppState['contextMenu']) => void;

  // ── 프로젝트 창 (왼쪽에서 스르륵) ──
  drawerOpen: boolean;
  /** 열 때 바로 "새 프로젝트" 이름 입력칸을 보여 줄지 */
  drawerCreate: boolean;
  setDrawer: (open: boolean, create?: boolean) => void;

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
  loadBoard: (doc: Doc, viewport: Viewport | null, filePath: string, ui?: BoardUiState | null) => void;
  /** 파일에 함께 저장하는 화면 상태 (오른쪽 창의 탭) */
  uiState: () => BoardUiState;
  markSaved: (filePath: string | null, doc: Doc) => void;

  // ── 편의 action ──
  addBoxAt: (worldCenter: Vec) => string;
  setText: (id: string, text: string) => void;
  /** 입력 중 실시간 반영 (Undo 기록은 입력칸을 떠날 때 한 번) */
  setTextLive: (id: string, text: string) => void;
  setNoteLive: (id: string, note: string) => void;
  setNodeSize: (id: string, width: number, height: number) => void;
  deleteSelection: () => void;
  reverseEdge: (id: string) => void;
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

  /** Box의 창을 연다. force가 아니면 사용자가 창을 닫아 둔 상태에서는 열지 않는다. */
  openPage: (id: string, opts?: { force?: boolean; focus?: 'title' | 'note' }) => void;
  closePanel: () => void;
  activateTab: (id: string) => void;
  closeTab: (id: string) => void;
  setPanelWidth: (width: number) => void;
  setPanelDismissed: (dismissed: boolean) => void;
  /** Box가 보이는 영역 밖이면 화면 가운데로 */
  ensureVisible: (id: string) => void;
  centerOn: (id: string) => void;

  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (q: string) => void;
  setSaveState: (s: AppState['saveState']) => void;
}

export const PANEL_MIN = 300;
export const PANEL_MAX = 720;

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
  panelOpen: false,
  panelDismissed: false,
  panelWidth: 400,
  tabs: [],
  activeTab: null,
  panelFocus: null,
  searchOpen: false,
  searchSeq: 0,
  searchQuery: '',
  saveState: 'idle',
  drawerOpen: false,
  contextMenu: null,
  setContextMenu: (contextMenu) => set({ contextMenu }),
  drawerCreate: false,
  setDrawer: (drawerOpen, drawerCreate = false) => set({ drawerOpen, drawerCreate: drawerOpen && drawerCreate }),

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
      saveState: 'idle',
  drawerOpen: false,
  contextMenu: null,
  setContextMenu: (contextMenu) => set({ contextMenu }),
  drawerCreate: false,
  setDrawer: (drawerOpen, drawerCreate = false) => set({ drawerOpen, drawerCreate: drawerOpen && drawerCreate }),
    });
    get().closePanel();
    set({ tabs: [], activeTab: null, panelDismissed: false });
  },
  loadBoard: (doc, viewport, filePath, ui) => {
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
      saveState: 'saved',
    });
    get().closePanel();
    set({ tabs: [], activeTab: null, panelDismissed: false });
    if (viewport) set({ viewport });
    else get().fitView();
    // 이 프로젝트에서 보던 탭/오른쪽 창을 그대로
    if (ui && ui.tabs.length) {
      set({ tabs: ui.tabs, activeTab: ui.activeTab });
      if (ui.panelOpen && ui.activeTab) {
        const s = get();
        set({ panelOpen: true, boardSize: { ...s.boardSize, width: Math.max(1, s.boardSize.width - s.panelWidth) } });
      }
    }
  },
  uiState: () => {
    const s = get();
    return { tabs: s.tabs, activeTab: s.activeTab, panelOpen: s.panelOpen };
  },
  markSaved: (filePath, doc) => set({ filePath, savedDoc: doc }),

  addBoxAt: (center) => {
    const id = newId('n');
    const { doc, commit } = get();
    commit(addNode(doc, makeNode(id, center)));
    set({ selection: { kind: 'node', id }, editingNodeId: id });
    if (get().panelOpen) get().openPage(id);
    return id;
  },

  setText: (id, text) => {
    const { doc, commit } = get();
    commit(setNodeText(doc, id, text));
  },
  setTextLive: (id, text) => set((s) => ({ doc: setNodeText(s.doc, id, text) })),
  setNoteLive: (id, note) => set((s) => ({ doc: setNodeNote(s.doc, id, note) })),

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
    if (selection.kind === 'node') get().closeTab(selection.id);
  },

  reverseEdge: (id) => {
    const { doc, commit } = get();
    commit(reverseRoute(doc, id));
  },


  finishRoute: (draft, targetNodeId) => {
    const { doc, commit, viewport } = get();
    const result = createRoute(doc, draft, targetNodeId, viewport.zoom);
    if (!result) return false;
    commit(result.doc);
    if (result.editNodeId) {
      set({ selection: { kind: 'node', id: result.editNodeId }, editingNodeId: result.editNodeId });
      if (get().panelOpen) get().openPage(result.editNodeId);
    } else {
      set({ selection: { kind: 'edge', id: result.edgeId }, editingNodeId: null });
    }
    return true;
  },
  setDraft: (draft) => set({ draft }),

  select: (selection) => set({ selection }),
  startEditing: (id) => {
    set({ selection: { kind: 'node', id }, editingNodeId: id });
    if (get().panelOpen) get().openPage(id);
  },
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

  openPage: (id, opts = {}) => {
    const s = get();
    if (!s.doc.nodes[id]) return;
    if (!s.panelOpen && s.panelDismissed && !opts.force) return;
    const tabs = s.tabs.includes(id) ? s.tabs : [...s.tabs, id];
    if (!s.panelOpen) {
      // 창은 Board 오른쪽을 차지한다. Board 왼쪽 끝은 그대로라 내용이 움직이지 않는다.
      // (boardSize는 ResizeObserver가 곧 갱신하지만, 바로 아래 ensureVisible이 새 크기를 쓰도록 미리 반영)
      set({
        panelOpen: true,
        boardSize: { ...s.boardSize, width: Math.max(1, s.boardSize.width - s.panelWidth) },
      });
    }
    set({
      tabs,
      activeTab: id,
      panelDismissed: false,
      panelFocus: opts.focus ? { nodeId: id, field: opts.focus, seq: (s.panelFocus?.seq ?? 0) + 1 } : s.panelFocus,
    });
    get().ensureVisible(id);
  },
  closePanel: () => {
    const s = get();
    if (!s.panelOpen) return;
    set({
      panelOpen: false,
      boardSize: { ...s.boardSize, width: s.boardSize.width + s.panelWidth },
    });
  },
  activateTab: (id) => {
    if (!get().doc.nodes[id]) return get().closeTab(id);
    set({ activeTab: id, selection: { kind: 'node', id } });
    get().ensureVisible(id);
  },
  closeTab: (id) => {
    const s = get();
    const i = s.tabs.indexOf(id);
    if (i < 0) return;
    const tabs = s.tabs.filter((t) => t !== id);
    const activeTab = s.activeTab === id ? (tabs[Math.min(i, tabs.length - 1)] ?? null) : s.activeTab;
    set({ tabs, activeTab });
    if (tabs.length === 0) get().closePanel();
  },
  setPanelWidth: (width) => {
    const s = get();
    const w = Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, width)));
    const d = w - s.panelWidth;
    if (!d) return;
    set({
      panelWidth: w,
      ...(s.panelOpen ? { boardSize: { ...s.boardSize, width: Math.max(1, s.boardSize.width - d) } } : {}),
    });
  },
  setPanelDismissed: (panelDismissed) => set({ panelDismissed }),
  ensureVisible: (id) => {
    const { doc, viewport: v, boardSize } = get();
    const n = doc.nodes[id];
    if (!n) return;
    const m = 24;
    // 왼쪽 도구 막대(약 80px)에 가려지는 곳도 "안 보이는" 영역으로 본다
    const left = 90;
    const x1 = n.x * v.zoom + v.panX;
    const y1 = n.y * v.zoom + v.panY;
    const x2 = (n.x + n.width) * v.zoom + v.panX;
    const y2 = (n.y + n.height) * v.zoom + v.panY;
    if (x1 >= left && y1 >= m && x2 <= boardSize.width - m && y2 <= boardSize.height - m) return;
    get().centerOn(id);
  },
  centerOn: (id) => {
    const { doc, viewport: v, boardSize } = get();
    const n = doc.nodes[id];
    if (!n) return;
    set({
      viewport: {
        ...v,
        panX: boardSize.width / 2 - (n.x + n.width / 2) * v.zoom,
        panY: boardSize.height / 2 - (n.y + n.height / 2) * v.zoom,
      },
    });
  },

  openSearch: () => set((s) => ({ searchOpen: true, searchSeq: s.searchSeq + 1 })),
  closeSearch: () => set({ searchOpen: false, searchQuery: '' }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSaveState: (saveState) => set({ saveState }),
}));

/** 검색어가 Box의 제목이나 메모에 들어 있는지 (대소문자 무시) */
export function nodeMatches(node: { text: string; note: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return node.text.toLowerCase().includes(q) || node.note.toLowerCase().includes(q);
}

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
