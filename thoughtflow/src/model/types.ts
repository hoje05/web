import type { Vec } from '../geometry/vec';

/** Box의 네 면. Route는 한 면에 연결되고, 면 위의 정확한 위치는 Anchor Distribution이 계산한다. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** 사용자 용어: Box */
export interface BoxNode {
  id: string;
  /** world 좌표 (좌상단) */
  x: number;
  y: number;
  /** DOM에서 측정한 실제 크기. Anchor 계산에 사용한다. */
  width: number;
  height: number;
  /** Box에 보이는 짧은 내용 (제목) */
  text: string;
  /** 오른쪽 창에서 쓰는 긴 생각 메모 */
  note: string;
  /** AI가 만든 Box면 그 AI 이름 (Claude, ChatGPT …). 사람이 만든 Box는 없음. */
  origin?: string;
  /** 붙인 태그 (Doc.tags의 id). 없으면 태그 없음. */
  tagIds?: string[];
  /** 첨부한 이미지·파일 (내용은 프로젝트의 자료 폴더에, 여기에는 위치와 정보만). 없으면 첨부 없음. */
  attachments?: Attachment[];
  /** 계획 블록이면 그 설정과 진행 상태 (src/workflow). 없으면 그냥 생각 Box. */
  step?: StepInfo;
}

// ───────────── 워크플로우 (계획 블록) ─────────────
// 계획은 사람이 쓰고 Claude는 그대로 실행한다: 할 일·완료 기준·만들 것·도구는 사람만 고치고,
// AI는 상태·결과·질문·수정 제안만 적는다 (규칙은 src/workflow/transitions.ts).

/**
 * 계획 블록의 상태. "할 수 있음(ready)"·"막힘(blocked)"은 앞 단계를 보고 계산하므로 저장하지 않는다.
 *  todo 할 일 · running 진행 중 · waiting 승인 대기 · asking 질문에 답을 기다림 · review 검토 대기
 *  done 완료 · failed 실패 · skipped 건너뜀
 */
export type StepStatus = 'todo' | 'running' | 'waiting' | 'asking' | 'review' | 'done' | 'failed' | 'skipped';

/** 단계에서 쓸 도구 (이름만 — 실제 도구는 Claude 쪽에 있다) */
export interface StepResources {
  /** 스킬 이름 (예: dataviz, my-team:release-check) */
  skills: string[];
  /** 슬래시 명령어 (예: /review) */
  commands: string[];
  /** 커넥터·MCP 서버 이름 (예: Gmail, github) */
  connectors: string[];
  /** 이 단계를 맡길 서브 에이전트 */
  subagent?: { type: string; model?: string; instructions?: string };
  /** 이 단계에서 하면 안 되는 것 */
  avoid?: string[];
}

/** 만들 것 하나: 경로(선택) + 조건 */
export interface Deliverable {
  path?: string;
  spec: string;
}

/** Claude가 단계를 끝내며 보고한 결과 */
export interface StepResult {
  summary: string;
  /** 만들 것 각 항목(번호) → 실제로 만든 위치 */
  outputs: { deliverable: number; path: string }[];
  /** 완료 기준 각 항목(번호)의 확인 결과 */
  criteria: { item: number; pass: boolean; evidence: string }[];
  /** 실제로 쓴 도구 (지정한 것과 비교) */
  used: StepResources;
  /** 실행할 때의 계획 지문 (planFingerprint) */
  planVersion: string;
  at: string;
  by: string;
}

export interface StepLogEntry {
  at: string;
  by: string;
  status: StepStatus;
  note?: string;
}

export interface StepQuestion {
  id: string;
  at: string;
  by: string;
  question: string;
  answer?: string;
  answeredAt?: string;
}

export interface StepInfo {
  status: StepStatus;
  /** 할 일 (한 줄 지시 — 자세한 설계는 메모에) */
  goal: string;
  /** 완료 기준 체크리스트 — 모두 통과해야 완료 */
  doneWhen: string[];
  /** 만들 것 */
  deliverables: Deliverable[];
  /** 꼭 읽고 따를 참고 자료 (파일 경로, 링크, 다른 단계 이름 등) */
  references: string[];
  /** 누가 하는가 */
  assignee: 'claude' | 'human';
  /** 시작 전에 사람 승인이 필요한가 */
  approval: 'auto' | 'ask';
  /** 승인을 받았는가 (approval = ask일 때. 단계가 끝나면 다시 false) */
  approved?: boolean;
  /** Claude가 끝내도 사람이 검토해야 완료 */
  review: boolean;
  resources: StepResources;
  result?: StepResult;
  questions: StepQuestion[];
  log: StepLogEntry[];
}

/** Claude가 낸 계획 수정 제안 (사람이 받아들여야 반영) */
export interface ChangeProposal {
  id: string;
  at: string;
  by: string;
  stepId?: string;
  change: string;
  why: string;
  state: 'open' | 'accepted' | 'rejected';
}

/** 보드 전체의 계획 설정 */
export interface WorkflowMeta {
  /** 계획 전체 목표 */
  goal: string;
  /** Claude Code가 작업할 폴더 (선택) */
  workingDir?: string;
  /** 모든 단계에 기본으로 붙는 도구 */
  defaults: StepResources;
  /** AI가 할 수 있는 일: read 읽기만, status 상태·결과·질문·제안 적기 (계획 자체는 고치지 못함) */
  stepPermission: 'read' | 'status';
  /** 계획 잠금: 켜져 있으면 사람도 실수로 계획 내용을 바꾸지 않도록 막는다 */
  locked: boolean;
  /** 동시에 진행할 수 있는 단계 수 (기본 1) */
  parallel: number;
  proposals: ChangeProposal[];
}

/**
 * Box에 첨부한 이미지·파일.
 * 실제 파일은 프로젝트 파일 옆의 자료 폴더(“프로젝트 이름.assets”)에 겹치지 않는 이름으로 복사해 둔다.
 * relativePath = "assets/<고유 이름>" → 자료 폴더 안의 그 파일. 첨부 하나는 한 Box만 쓴다 (다른 Box와 나눠 쓰지 않음).
 */
export interface Attachment {
  id: string;
  /** image = PNG/JPG/WebP (창 안에서 미리보기), file = 그 밖의 모든 파일 */
  type: 'image' | 'file';
  /** 원래 파일 이름 (보여 주는 이름) */
  name: string;
  relativePath: string;
  mimeType: string;
  /** 바이트 */
  size: number;
  width?: number;
  height?: number;
}

/**
 * 프로젝트에 저장해 두는 태그 (다시 쓰기·자동 완성용).
 * 이름은 처음 쓴 모양 그대로 보여 주고, 같은 태그인지는 normalizedName(앞뒤 공백 제거·소문자)으로 가린다.
 * 지운 태그는 active=false로만 바꾼다 → 이미 붙어 있는 Box에는 그대로 남고, 추천 목록에서만 빠진다.
 */
export interface Tag {
  id: string;
  name: string;
  normalizedName: string;
  active: boolean;
}

export interface Anchor {
  side: Side;
}

/**
 * Chord 좌표 [u, v].
 * 시작 Anchor S → 끝 Anchor E 선분(d = E - S)에 대해 world = S + u·d + v·perp(d).
 * Box가 움직여도 곡선의 상대적인 형태(닮음)가 유지된다.
 */
export type ChordPoint = [number, number];

/**
 * auto     = 두 Box 위치에 맞춰 자동으로 그리는 부드러운 연결선 (Box를 옮기면 항상 이 모드)
 * smoothed = 그린 곡선을 자동 보정한 것 (Box를 옮기기 전까지 그린 모양 유지)
 * straight / freehand = 예전 버전 파일 호환용
 */
export type PathMode = 'auto' | 'smoothed' | 'straight' | 'freehand';

/**
 * 사용자 용어: Route.
 * 방향은 source → target 순서 자체로 표현한다 (반전 = source/target 교환).
 */
export interface RouteEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceAnchor: Anchor;
  targetAnchor: Anchor;
  /** 곡선 내부 점 (시작/끝점 제외), source → target 순서 */
  pathPoints: ChordPoint[];
  pathMode: PathMode;
}

export interface Doc {
  nodes: Record<string, BoxNode>;
  edges: Record<string, RouteEdge>;
  /** 저장된 태그 (만든 순서). Undo 기록에 함께 들어가도록 Doc에 둔다. */
  tags: Record<string, Tag>;
  /** 계획 설정 (계획 블록이 있는 보드). 없으면 기본값 (src/workflow/defaults.ts) */
  workflow?: WorkflowMeta;
}

/** screen = world * zoom + pan */
export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

export type Tool = 'select' | 'route';

export const EMPTY_DOC: Doc = { nodes: {}, edges: {}, tags: {} };

export const DEFAULT_BOX_WIDTH = 180;
export const DEFAULT_BOX_HEIGHT = 64;

export type { Vec };
