/**
 * AI가 만든 Box의 자동 배치.
 *
 * 흐름은 왼쪽 → 오른쪽으로 읽히게 놓는다.
 *  - 앞 Box(부모)가 있으면 그 오른쪽 열에, 같은 부모의 두 번째 자식부터는 아래로.
 *  - 뒤 Box(자식)만 있으면 그 왼쪽 열에.
 *  - 어디에도 이어지지 않은 새 흐름의 시작은 기존 내용 아래(빈 보드면 화면 가운데).
 *  - 다른 Box와 겹치면 위아래로 한 칸씩 비켜 가며 빈자리를 찾는다.
 * 실제 Box 크기는 화면에 그려진 뒤 측정되므로, 여기서는 글 길이로 크기를 어림한다.
 */
import type { Rect } from '../geometry/rect';
import type { Vec } from '../geometry/vec';
import { DEFAULT_BOX_HEIGHT, DEFAULT_BOX_WIDTH } from '../model/types';

/** Box 사이 가로 간격 (Route가 보일 만큼) */
export const GAP_X = 90;
/** Box 사이 세로 간격 */
export const GAP_Y = 36;
/** 새 흐름을 기존 내용 아래에 놓을 때의 간격 */
const NEW_FLOW_GAP = 110;

const MAX_BOX_WIDTH = 300;
const PAD_X = 30; // 좌우 padding + 테두리
const PAD_Y = 24;
const LINE_H = 21;

/** 글자 폭 어림: 한글·한자 등 넓은 글자 14px, 나머지 7.6px */
function textWidth(line: string): number {
  let w = 0;
  for (const ch of line) w += /[ᄀ-ᇿ　-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 14 : 7.6;
  return w;
}

/** 제목으로 Box 크기 어림 (CSS: 폭 180~300, 글 14px, 줄 높이 21px) */
export function estimateBoxSize(text: string): { width: number; height: number } {
  const inner = MAX_BOX_WIDTH - PAD_X;
  let width = DEFAULT_BOX_WIDTH;
  let lines = 0;
  for (const line of text.split('\n')) {
    const w = textWidth(line);
    width = Math.max(width, Math.min(MAX_BOX_WIDTH, Math.ceil(w + PAD_X)));
    lines += Math.max(1, Math.ceil(w / inner));
  }
  return { width, height: Math.max(DEFAULT_BOX_HEIGHT, Math.ceil(lines * LINE_H + PAD_Y)) };
}

const overlaps = (a: Rect, b: Rect, m: number) =>
  a.x < b.x + b.width + m && b.x < a.x + a.width + m && a.y < b.y + b.height + m && b.y < a.y + a.height + m;

export interface PlaceRequest {
  /** 새 Box의 임시 key */
  key: string;
  width: number;
  height: number;
  /** 이 Box로 들어오는 Box (이미 있는 Box id 또는 새 Box key) */
  parents: string[];
  /** 이 Box에서 나가는 Box */
  children: string[];
}

/**
 * 새 Box들의 좌상단 위치를 정한다.
 * @param existing 이미 보드에 있는 Box들 (id → 영역)
 * @param requests 배치할 새 Box들 (입력 순서 = 흐름 순서)
 * @param origin   보드가 비어 있을 때 첫 Box의 중심 (보통 화면 가운데)
 * @param existingChildren 기존 Box에서 이미 나가고 있는 Box들 → 새 자식은 그 아래에 놓는다
 */
export function placeBoxes(
  existing: Map<string, Rect>,
  requests: PlaceRequest[],
  origin: Vec,
  existingChildren: Map<string, Rect[]> = new Map(),
): Map<string, Vec> {
  const placed = new Map<string, Rect>(existing);
  const obstacles: Rect[] = [...existing.values()];
  const result = new Map<string, Vec>();
  /** 부모별로 마지막에 놓은 자식 (다음 자식은 그 아래) */
  const lastChildOf = new Map<string, Rect>();
  for (const [id, kids] of existingChildren) {
    const parent = existing.get(id);
    // 부모 오른쪽에 있는 자식 중 가장 아래
    const right = kids.filter((k) => parent && k.x > parent.x + parent.width / 2);
    if (right.length) lastChildOf.set(id, right.reduce((a, b) => (b.y + b.height > a.y + a.height ? b : a)));
  }
  const byKey = new Map(requests.map((r) => [r.key, r]));

  const contentBottom = () => {
    let minX = Infinity;
    let maxY = -Infinity;
    for (const r of obstacles) {
      minX = Math.min(minX, r.x);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return Number.isFinite(minX) ? { x: minX, y: maxY + NEW_FLOW_GAP } : null;
  };

  /** 원하는 위치에서 가장 가까운 빈자리. 0, +1, -1, +2, -2 … 칸 (downOnly면 0, +1, +2 …) */
  const freeSpot = (x: number, y: number, w: number, h: number, downOnly: boolean): Vec => {
    const step = Math.max(24, Math.round((h + GAP_Y) / 2));
    for (let i = 0; i < 120; i++) {
      const k = downOnly ? i : i % 2 ? (i + 1) / 2 : -i / 2;
      const cand = { x, y: y + k * step, width: w, height: h };
      if (!obstacles.some((o) => overlaps(o, cand, GAP_Y / 2))) return { x, y: cand.y };
    }
    return { x, y: y + 120 * step };
  };

  const waiting = (r: PlaceRequest) => r.parents.some((p) => byKey.has(p) && !placed.has(p));
  const pick = (pending: PlaceRequest[]) => {
    // 1) 앞 Box가 모두 놓였고 그중 하나 이상에 이어짐  2) 뒤 Box에 이어짐  3) 새 흐름의 시작  4) 순환
    const rules: ((r: PlaceRequest) => boolean)[] = [
      (r) => !waiting(r) && r.parents.some((p) => placed.has(p)),
      (r) => !waiting(r) && r.children.some((c) => placed.has(c)),
      (r) => !waiting(r),
      (r) => r.parents.some((p) => placed.has(p)),
    ];
    for (const rule of rules) {
      const i = pending.findIndex(rule);
      if (i >= 0) return i;
    }
    return 0;
  };

  const pending = [...requests];
  while (pending.length) {
    const idx = pick(pending);
    const req = pending.splice(idx, 1)[0];
    const { width: w, height: h } = req;

    const parent = req.parents.map((p) => placed.get(p)).find(Boolean);
    const child = req.children.map((c) => placed.get(c)).find(Boolean);
    let pos: Vec;
    if (parent) {
      const parentKey = req.parents.find((p) => placed.has(p))!;
      const right = Math.max(...req.parents.map((p) => placed.get(p)).filter((r): r is Rect => !!r).map((r) => r.x + r.width));
      const sibling = lastChildOf.get(parentKey);
      const x = right + GAP_X;
      // 첫 자식은 부모와 같은 높이(가운데 맞춤), 다음 자식은 앞 자식 아래
      const y = sibling ? sibling.y + sibling.height + GAP_Y : parent.y + parent.height / 2 - h / 2;
      pos = freeSpot(x, y, w, h, !!sibling);
    } else if (child) {
      pos = freeSpot(child.x - GAP_X - w, child.y + child.height / 2 - h / 2, w, h, false);
    } else {
      const below = contentBottom();
      pos = below ? freeSpot(below.x, below.y, w, h, true) : { x: origin.x - w / 2, y: origin.y - h / 2 };
    }
    pos = { x: Math.round(pos.x), y: Math.round(pos.y) };
    const rect = { ...pos, width: w, height: h };
    placed.set(req.key, rect);
    obstacles.push(rect);
    result.set(req.key, pos);
    for (const p of req.parents) if (placed.has(p)) lastChildOf.set(p, rect);
  }
  return result;
}
