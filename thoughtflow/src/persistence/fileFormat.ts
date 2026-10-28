/**
 * Project 파일 형식 (.tflow, JSON).
 *
 * {
 *   "format": "thoughtflow", "version": 3,
 *   "board": { "zoom", "panX", "panY" },
 *   "tags": [{ "id", "name", "normalizedName", "active" }],   // 저장된 태그 (v3). active=false = 지운 태그(붙어 있던 Box에는 남음)
 *   "nodes": [{ "id", "x", "y", "width", "height", "text", "note", "origin"?,   // note = 오른쪽 창의 메모 (v2), origin = 만든 AI (선택)
 *               "tagIds": [...],                                              // 붙인 태그 (v3)
 *               "attachments": [{ "id", "type": "image" | "file", "name", "relativePath": "assets/…",
 *                                 "mimeType", "size", "width"?, "height"? }] }],   // 첨부 (v3). 파일은 "프로젝트 이름.assets" 폴더에
 *   "edges": [{ "id", "sourceNodeId", "targetNodeId",
 *               "sourceAnchor": { "side" }, "targetAnchor": { "side" },
 *               "pathPoints": [[u, v], ...],   // Chord 좌표 (source → target 순서)
 *               "pathMode": "straight" | "freehand" | "smoothed" }]  // smoothed = 보정됨
 * }
 * 방향은 sourceNodeId → targetNodeId 로 표현한다.
 * Selection/Highlight 같은 순간적인 UI 상태는 저장하지 않는다.
 * 다만 프로젝트를 오갈 때 "보던 그대로" 돌아오도록 오른쪽 창의 탭 상태는 "ui"에 함께 저장한다 (선택 항목).
 */
import {
  DEFAULT_BOX_HEIGHT,
  DEFAULT_BOX_WIDTH,
  type Attachment,
  type BoxNode,
  type ChordPoint,
  type Doc,
  type PathMode,
  type RouteEdge,
  type Side,
  type Tag,
  type Viewport,
} from '../model/types';
import { normalizeTagName } from '../model/tags';
import { noteImagePaths } from '../editor/markdown';
import { MAX_ZOOM, MIN_ZOOM } from '../viewport/viewport';

export const FILE_FORMAT = 'thoughtflow';
/**
 * v1: 초기 형식, v2: Box note 추가, v3: 태그(tags, tagIds)와 첨부(attachments) 추가.
 * 예전 파일도 그대로 읽는다 (없는 칸은 빈 값으로).
 */
export const FILE_VERSION = 3;
export const FILE_EXTENSION = 'tflow';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const PATH_MODES: PathMode[] = ['auto', 'smoothed', 'straight', 'freehand'];

/** 프로젝트별로 기억하는 화면 상태 (오른쪽 창의 탭) */
export interface BoardUiState {
  tabs: string[];
  activeTab: string | null;
  panelOpen: boolean;
}

const round = (v: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

export function serializeBoard(doc: Doc, viewport: Viewport, ui?: BoardUiState): string {
  const data = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    savedAt: new Date().toISOString(),
    board: { zoom: round(viewport.zoom, 4), panX: round(viewport.panX, 1), panY: round(viewport.panY, 1) },
    tags: Object.values(doc.tags ?? {}).map((t) => ({ id: t.id, name: t.name, normalizedName: t.normalizedName, active: t.active })),
    nodes: Object.values(doc.nodes).map((n) => ({
      id: n.id,
      x: round(n.x, 1),
      y: round(n.y, 1),
      width: round(n.width, 1),
      height: round(n.height, 1),
      text: n.text,
      note: n.note,
      ...(n.origin ? { origin: n.origin } : {}),
      tagIds: (n.tagIds ?? []).filter((id) => doc.tags?.[id]),
      attachments: (n.attachments ?? []).map((a) => ({
        id: a.id,
        type: a.type,
        name: a.name,
        relativePath: a.relativePath,
        mimeType: a.mimeType,
        size: a.size,
        ...(a.width && a.height ? { width: a.width, height: a.height } : {}),
      })),
    })),
    edges: Object.values(doc.edges).map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceAnchor: { side: e.sourceAnchor.side },
      targetAnchor: { side: e.targetAnchor.side },
      pathPoints: e.pathPoints.map(([u, v]) => [round(u, 5), round(v, 5)]),
      pathMode: e.pathMode,
    })),
    ...(ui ? { ui: { tabs: ui.tabs.filter((id) => doc.nodes[id]), activeTab: ui.activeTab, panelOpen: ui.panelOpen } } : {}),
  };
  return JSON.stringify(data, null, 2);
}

export class FileFormatError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 파일 내용을 검증하며 읽는다. 복구 가능한 문제(깨진 Route 등)는 건너뛰고, 치명적이면 예외. */
export function parseBoard(text: string): {
  doc: Doc;
  viewport: Viewport | null;
  ui: BoardUiState | null;
  warnings: string[];
} {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FileFormatError('파일을 읽을 수 없습니다. ThoughtFlow 보드 파일(JSON)이 아닙니다.');
  }
  if (!isObj(data) || data.format !== FILE_FORMAT) throw new FileFormatError('ThoughtFlow 보드 파일이 아닙니다.');
  if (!isNum(data.version) || data.version > FILE_VERSION) {
    throw new FileFormatError('더 새로운 버전의 ThoughtFlow에서 만든 파일입니다. 프로그램을 업데이트해 주세요.');
  }
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new FileFormatError('보드 데이터가 손상되었습니다.');

  const warnings: string[] = [];

  // ── 태그 (v3). 이름이 같은(대소문자·앞뒤 공백 무시) 태그가 여럿이면 하나로 합친다.
  const tags: Record<string, Tag> = {};
  const tagAlias = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const raw of Array.isArray(data.tags) ? data.tags : []) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.name !== 'string' || tagAlias.has(raw.id)) continue;
    const name = raw.name.trim().slice(0, 60);
    const normalizedName = normalizeTagName(name);
    if (!normalizedName) continue;
    const same = byName.get(normalizedName);
    if (same) {
      tagAlias.set(raw.id, same);
      if (raw.active !== false) tags[same] = { ...tags[same], active: true };
      continue;
    }
    byName.set(normalizedName, raw.id);
    tagAlias.set(raw.id, raw.id);
    tags[raw.id] = { id: raw.id, name, normalizedName, active: raw.active !== false };
  }

  const nodes: Record<string, BoxNode> = {};
  for (const raw of data.nodes) {
    if (!isObj(raw) || typeof raw.id !== 'string' || !isNum(raw.x) || !isNum(raw.y) || nodes[raw.id]) {
      warnings.push('잘못된 Box 하나를 건너뛰었습니다.');
      continue;
    }
    nodes[raw.id] = {
      id: raw.id,
      x: raw.x,
      y: raw.y,
      width: isNum(raw.width) && raw.width > 0 ? raw.width : DEFAULT_BOX_WIDTH,
      height: isNum(raw.height) && raw.height > 0 ? raw.height : DEFAULT_BOX_HEIGHT,
      text: typeof raw.text === 'string' ? raw.text : '',
      note: typeof raw.note === 'string' ? raw.note : '',
      ...(typeof raw.origin === 'string' && raw.origin ? { origin: raw.origin.slice(0, 40) } : {}),
    };
    const tagIds = Array.isArray(raw.tagIds)
      ? [...new Set(raw.tagIds.map((id) => (typeof id === 'string' ? tagAlias.get(id) : undefined)).filter((id): id is string => !!id))]
      : [];
    if (tagIds.length) nodes[raw.id].tagIds = tagIds;
    const attachments = Array.isArray(raw.attachments) ? raw.attachments.map(parseAttachment).filter((a): a is Attachment => !!a) : [];
    if (Array.isArray(raw.attachments) && attachments.length < raw.attachments.length) warnings.push('잘못된 첨부 정보를 건너뛰었습니다.');
    if (attachments.length) nodes[raw.id].attachments = [...new Map(attachments.map((a) => [a.id, a])).values()];
  }

  const edges: Record<string, RouteEdge> = {};
  for (const raw of data.edges) {
    const ok =
      isObj(raw) &&
      typeof raw.id === 'string' &&
      !edges[raw.id] &&
      typeof raw.sourceNodeId === 'string' &&
      typeof raw.targetNodeId === 'string' &&
      raw.sourceNodeId !== raw.targetNodeId &&
      nodes[raw.sourceNodeId] &&
      nodes[raw.targetNodeId];
    if (!ok) {
      warnings.push('연결이 끊어진 Route 하나를 건너뛰었습니다.');
      continue;
    }
    const r = raw as Record<string, unknown>;
    const side = (a: unknown): Side => (isObj(a) && SIDES.includes(a.side as Side) ? (a.side as Side) : 'right');
    const pathPoints: ChordPoint[] = Array.isArray(r.pathPoints)
      ? r.pathPoints.filter((p): p is ChordPoint => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))
      : [];
    const mode = PATH_MODES.includes(r.pathMode as PathMode) ? (r.pathMode as PathMode) : null;
    edges[r.id as string] = {
      id: r.id as string,
      sourceNodeId: r.sourceNodeId as string,
      targetNodeId: r.targetNodeId as string,
      sourceAnchor: { side: side(r.sourceAnchor) },
      targetAnchor: { side: side(r.targetAnchor) },
      pathPoints,
      pathMode: pathPoints.length === 0 ? (mode === 'auto' ? 'auto' : 'straight') : (mode ?? 'freehand'),
    };
  }

  let viewport: Viewport | null = null;
  if (isObj(data.board) && isNum(data.board.zoom) && isNum(data.board.panX) && isNum(data.board.panY)) {
    viewport = {
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, data.board.zoom)),
      panX: data.board.panX,
      panY: data.board.panY,
    };
  }
  let ui: BoardUiState | null = null;
  if (isObj(data.ui) && Array.isArray(data.ui.tabs)) {
    const tabs = data.ui.tabs.filter((id): id is string => typeof id === 'string' && !!nodes[id]);
    const activeTab = typeof data.ui.activeTab === 'string' && tabs.includes(data.ui.activeTab) ? data.ui.activeTab : (tabs[0] ?? null);
    ui = { tabs, activeTab, panelOpen: data.ui.panelOpen === true && tabs.length > 0 };
  }
  return { doc: { nodes, edges, tags }, viewport, ui, warnings };
}

const ATTACHMENT_PATH = /^assets\/[^/\\]+$/;

/** 첨부 정보 하나를 검사하며 읽는다. 자료 폴더 밖을 가리키는 경로 등 이상하면 null. */
function parseAttachment(raw: unknown): Attachment | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id || typeof raw.relativePath !== 'string') return null;
  const rel = raw.relativePath;
  if (!ATTACHMENT_PATH.test(rel) || rel.endsWith('/..') || rel === 'assets/.' || rel === 'assets/..') return null;
  const name = typeof raw.name === 'string' && raw.name ? raw.name.slice(0, 255) : rel.slice('assets/'.length);
  const mimeType = typeof raw.mimeType === 'string' && raw.mimeType ? raw.mimeType.slice(0, 100) : 'application/octet-stream';
  return {
    id: raw.id,
    type: raw.type === 'image' ? 'image' : 'file',
    name,
    relativePath: rel,
    mimeType,
    size: isNum(raw.size) && raw.size >= 0 ? raw.size : 0,
    ...(isNum(raw.width) && isNum(raw.height) && raw.width > 0 && raw.height > 0 ? { width: raw.width, height: raw.height } : {}),
  };
}

/** Doc 안에서 쓰는 모든 자료 파일 경로: 첨부 + 메모 안의 그림 (자료 폴더 정리 때 지우지 않도록) */
export function attachmentPaths(doc: Doc): string[] {
  const out = new Set<string>();
  for (const n of Object.values(doc.nodes)) {
    for (const a of n.attachments ?? []) out.add(a.relativePath);
    if (n.note.includes('](')) for (const p of noteImagePaths(n.note)) out.add(p);
  }
  return [...out];
}
