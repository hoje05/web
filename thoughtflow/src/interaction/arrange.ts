/**
 * 정렬 버튼: 보드의 Box와 Route를 흐름 순서대로 다시 놓는다.
 * 누를 때마다 번갈아: → 나가는 흐름 순서대로(기존 정렬) / ← 선택한 Box(없으면 흐름의 끝)로 들어오는 흐름 중심.
 * Box들은 새 자리로 부드럽게 움직이고(동작 줄이기 설정이면 바로), 되돌리기 한 번(Ctrl+Z)이면 원래대로.
 * 정렬한 결과가 화면 밖으로 나가면 화면도 함께 맞춘다. 바꾸는 것은 Box 위치와 Route 모양뿐.
 */
import { arrangeDoc } from '../layout/arrange';
import type { Doc, Viewport } from '../model/types';
import { getRouteGeometry } from '../routing/routeGeometry';
import { nextSortMode, useStore } from '../store/store';
import { fitBounds } from '../viewport/viewport';
import { flushEditing } from './editing';

const DURATION = 380;
/** 화면 왼쪽의 도구 막대가 차지하는 폭 */
const TOOLBAR_SPACE = 96;
let running = false;

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** 정렬한 내용 전체가 지금 화면에 보이지 않으면, 다 보이는 화면 */
function viewportFor(doc: Doc): Viewport | null {
  const { viewport: v, boardSize } = useStore.getState();
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (x: number, y: number, w: number, h: number) => {
    b.minX = Math.min(b.minX, x);
    b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x + w);
    b.maxY = Math.max(b.maxY, y + h);
  };
  for (const n of Object.values(doc.nodes)) include(n.x, n.y, n.width, n.height);
  for (const g of getRouteGeometry(doc).values()) include(g.bbox.x, g.bbox.y, g.bbox.width, g.bbox.height);
  const m = 24;
  const visible =
    b.minX * v.zoom + v.panX >= TOOLBAR_SPACE &&
    b.minY * v.zoom + v.panY >= m &&
    b.maxX * v.zoom + v.panX <= boardSize.width - m &&
    b.maxY * v.zoom + v.panY <= boardSize.height - m;
  if (visible) return null;
  // 왼쪽 도구 막대에 가리지 않게, 그 오른쪽 영역에 맞춘다
  const fit = fitBounds(b, { width: boardSize.width - TOOLBAR_SPACE, height: boardSize.height });
  return { ...fit, panX: fit.panX + TOOLBAR_SPACE };
}

const firstLine = (text: string) => text.split('\n')[0].trim() || '제목 없음';

export function arrangeBoard() {
  if (running) return;
  flushEditing();
  const s = useStore.getState();
  const before = s.doc;
  const count = Object.keys(before.nodes).length;
  if (count === 0) return;
  const mode = nextSortMode(s);
  const center = s.selection?.kind === 'node' && before.nodes[s.selection.id] ? s.selection.id : null;
  const target = arrangeDoc(before, { mode, center });
  const centerName = center && mode === 'in' ? ` · 중심: ‘${firstLine(before.nodes[center].text)}’` : '';
  if (target === before) {
    useStore.setState({
      lastSort: { mode, doc: before },
      aiActivity: {
        seq: Date.now(),
        message: mode === 'out' ? '이미 보기 좋게 정렬되어 있습니다' : `들어오는 흐름(←) 중심으로도 이미 보기 좋게 정렬되어 있습니다${centerName}`,
        before: null,
      },
    });
    return;
  }
  const v0 = s.viewport;
  const v1 = viewportFor(target);

  const finish = () => {
    if (!running) return;
    running = false;
    const now = useStore.getState();
    // 움직이는 사이 다른 변경(글 고치기, AI)이 있었으면 그것은 살리고 위치·Route 모양만 정렬 결과로
    const nodes = { ...now.doc.nodes };
    for (const [id, n] of Object.entries(target.nodes)) if (nodes[id]) nodes[id] = { ...nodes[id], x: n.x, y: n.y };
    const edges = { ...now.doc.edges };
    for (const [id, e] of Object.entries(target.edges)) if (edges[id]) edges[id] = e;
    now.setDocLive({ ...now.doc, nodes, edges });
    now.commitFrom(before);
    if (v1) now.setViewport(v1);
    const routes = Object.keys(target.edges).length;
    const what = `Box ${count}개${routes ? `와 Route ${routes}개` : ''}를`;
    useStore.setState({
      lastSort: { mode, doc: useStore.getState().doc },
      aiActivity: {
        seq: Date.now(),
        message:
          mode === 'out'
            ? `${what} 흐름 순서대로 정렬했습니다`
            : `${what} 들어오는 흐름(←) 중심으로 정렬했습니다${centerName}`,
        before,
      },
    });
  };

  running = true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return finish();
  const t0 = performance.now();
  const step = (time: number) => {
    if (!running) return;
    const p = Math.min(1, (time - t0) / DURATION);
    if (p >= 1) return finish();
    const k = ease(p);
    const cur = useStore.getState();
    const nodes = { ...cur.doc.nodes };
    for (const [id, to] of Object.entries(target.nodes)) {
      const from = before.nodes[id];
      if (nodes[id] && from) nodes[id] = { ...nodes[id], x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
    }
    cur.setDocLive({ ...cur.doc, nodes, edges: target.edges });
    if (v1) {
      cur.setViewport({
        zoom: v0.zoom + (v1.zoom - v0.zoom) * k,
        panX: v0.panX + (v1.panX - v0.panX) * k,
        panY: v0.panY + (v1.panY - v0.panY) * k,
      });
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // 화면이 그려지지 않는 동안(창이 가려짐 등)에도 반드시 끝나도록
  setTimeout(finish, DURATION + 400);
}
