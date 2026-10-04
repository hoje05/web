/**
 * 정렬 버튼: 보드의 Box와 Route를 흐름 순서대로 다시 놓는다.
 * Box들은 새 자리로 부드럽게 움직이고(동작 줄이기 설정이면 바로), 되돌리기 한 번(Ctrl+Z)이면 원래대로.
 * 정렬한 결과가 화면 밖으로 나가면 화면도 함께 맞춘다.
 */
import { arrangeDoc } from '../layout/arrange';
import type { Doc, Viewport } from '../model/types';
import { getRouteGeometry } from '../routing/routeGeometry';
import { useStore } from '../store/store';
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

export function arrangeBoard() {
  if (running) return;
  flushEditing();
  const s = useStore.getState();
  const before = s.doc;
  const count = Object.keys(before.nodes).length;
  if (count === 0) return;
  const target = arrangeDoc(before);
  if (target === before) {
    useStore.setState({ aiActivity: { seq: Date.now(), message: '이미 보기 좋게 정렬되어 있습니다', before: null } });
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
    now.setDocLive({ nodes, edges });
    now.commitFrom(before);
    if (v1) now.setViewport(v1);
    const routes = Object.keys(target.edges).length;
    useStore.setState({
      aiActivity: {
        seq: Date.now(),
        message: `Box ${count}개${routes ? `와 Route ${routes}개` : ''}를 흐름 순서대로 정렬했습니다`,
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
    cur.setDocLive({ nodes, edges: target.edges });
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
