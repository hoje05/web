import { dist, type Vec } from '../geometry/vec';
import { useStore, viewportCenterWorld } from '../store/store';
import { screenToWorld } from '../viewport/viewport';
import { flushEditing } from './editing';

/**
 * Toolbar의 Box 버튼에서 시작하는 "끌어다 놓기" 생성.
 * 버튼 위에서 그냥 클릭하면 화면 중앙에 만든다.
 */
export function beginBoxPlacement(e: React.PointerEvent, board: HTMLElement | null) {
  if (e.button !== 0 || !board) return;
  e.preventDefault();
  flushEditing();
  const button = e.currentTarget as HTMLElement;
  const start: Vec = { x: e.clientX, y: e.clientY };
  let dragging = false;

  const boardPoint = (ev: PointerEvent): Vec | null => {
    const r = board.getBoundingClientRect();
    const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    const overButton = button.closest('.toolbar')?.contains(document.elementFromPoint(ev.clientX, ev.clientY));
    if (!inside || overButton) return null;
    return screenToWorld(useStore.getState().viewport, { x: ev.clientX - r.left, y: ev.clientY - r.top });
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragging && dist(start, { x: ev.clientX, y: ev.clientY }) < 4) return;
    dragging = true;
    useStore.getState().setGhost(boardPoint(ev));
  };

  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    const s = useStore.getState();
    s.setGhost(null);
    if (!dragging) {
      s.addBoxAt(freeSpotNear(viewportCenterWorld()));
      return;
    }
    const p = boardPoint(ev);
    if (p) s.addBoxAt(p);
  };

  const onCancel = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    useStore.getState().setGhost(null);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

/** 같은 자리에 Box가 이미 있으면 조금씩 비켜서 놓는다 */
function freeSpotNear(p: Vec): Vec {
  const nodes = Object.values(useStore.getState().doc.nodes);
  let q = p;
  for (let i = 0; i < 20; i++) {
    const taken = nodes.some((n) => Math.abs(n.x + n.width / 2 - q.x) < 12 && Math.abs(n.y + n.height / 2 - q.y) < 12);
    if (!taken) break;
    q = { x: q.x + 28, y: q.y + 28 };
  }
  return q;
}
