import { useEffect, type RefObject } from 'react';
import type { Vec } from '../geometry/vec';
import { useStore } from '../store/store';

type Gesture = { kind: 'idle' } | { kind: 'panning'; pointerId: number; startScreen: Vec; startPan: Vec };

/**
 * Board의 pointer 상태 머신.
 * DOM event target이 아니라 world 좌표 hit test로 무엇을 조작할지 결정한다.
 */
export function useBoardInteraction(boardRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let gesture: Gesture = { kind: 'idle' };

    const localPoint = (e: { clientX: number; clientY: number }): Vec => {
      const r = board.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (gesture.kind !== 'idle') return;
      const s = useStore.getState();
      const p = localPoint(e);
      const wantsPan = e.button === 1 || (e.button === 0 && s.spaceHeld) || e.button === 0;
      if (wantsPan) {
        e.preventDefault();
        board.setPointerCapture(e.pointerId);
        gesture = {
          kind: 'panning',
          pointerId: e.pointerId,
          startScreen: p,
          startPan: { x: s.viewport.panX, y: s.viewport.panY },
        };
        board.classList.add('is-panning');
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (gesture.kind === 'panning' && e.pointerId === gesture.pointerId) {
        const p = localPoint(e);
        const { viewport, setViewport } = useStore.getState();
        setViewport({
          ...viewport,
          panX: gesture.startPan.x + (p.x - gesture.startScreen.x),
          panY: gesture.startPan.y + (p.y - gesture.startScreen.y),
        });
      }
    };

    const endGesture = (e: PointerEvent) => {
      if (gesture.kind === 'panning' && e.pointerId === gesture.pointerId) {
        board.classList.remove('is-panning');
        gesture = { kind: 'idle' };
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // deltaMode 1(line) 인 마우스 휠도 비슷한 속도가 되도록 보정
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const factor = Math.exp(-delta * 0.0015);
      useStore.getState().zoomBy(factor, localPoint(e));
    };

    // Windows에서 휠 버튼 클릭 시 나타나는 autoscroll 방지
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', endGesture);
    board.addEventListener('pointercancel', endGesture);
    board.addEventListener('wheel', onWheel, { passive: false });
    board.addEventListener('mousedown', onMouseDown);
    return () => {
      board.removeEventListener('pointerdown', onPointerDown);
      board.removeEventListener('pointermove', onPointerMove);
      board.removeEventListener('pointerup', endGesture);
      board.removeEventListener('pointercancel', endGesture);
      board.removeEventListener('wheel', onWheel);
      board.removeEventListener('mousedown', onMouseDown);
    };
  }, [boardRef]);
}
