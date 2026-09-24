import { useEffect, type RefObject } from 'react';
import { dist, type Vec } from '../geometry/vec';
import { setNodePosition } from '../model/docOps';
import type { Doc } from '../model/types';
import { useStore } from '../store/store';
import { screenToWorld } from '../viewport/viewport';
import { flushEditing } from './editing';
import { hitTest, type Hit } from './hitTest';

/** 이 거리(화면 px) 이상 움직여야 클릭이 아니라 드래그로 본다 */
const DRAG_THRESHOLD = 3;

type Gesture =
  | { kind: 'idle' }
  | { kind: 'panning'; pointerId: number; startScreen: Vec; startPan: Vec; moved: boolean; clearOnClick: boolean }
  | {
      kind: 'movingNode';
      pointerId: number;
      nodeId: string;
      startScreen: Vec;
      startWorld: Vec;
      origin: Vec;
      startDoc: Doc;
      moved: boolean;
    };

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
    const worldPoint = (e: { clientX: number; clientY: number }): Vec =>
      screenToWorld(useStore.getState().viewport, localPoint(e));

    const isInsideEditor = (target: EventTarget | null) =>
      target instanceof Element && target.closest('.box-editor') !== null;

    const startPan = (e: PointerEvent, clearOnClick: boolean) => {
      const { viewport } = useStore.getState();
      gesture = {
        kind: 'panning',
        pointerId: e.pointerId,
        startScreen: localPoint(e),
        startPan: { x: viewport.panX, y: viewport.panY },
        moved: false,
        clearOnClick,
      };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (gesture.kind !== 'idle') return;
      // 편집 중인 Box 내부 클릭은 브라우저 기본 동작(커서 이동, 텍스트 선택)에 맡긴다
      if (isInsideEditor(e.target)) return;
      if (e.button !== 0 && e.button !== 1) return;

      e.preventDefault();
      flushEditing();
      board.setPointerCapture(e.pointerId);
      const s = useStore.getState();

      if (e.button === 1 || s.spaceHeld) {
        startPan(e, false);
        board.classList.add('is-panning');
        return;
      }

      const p = worldPoint(e);
      const hit = hitTest(s.doc, p, s.viewport.zoom);

      if (hit.kind === 'node-body' || hit.kind === 'node-border') {
        const node = s.doc.nodes[hit.nodeId];
        s.select({ kind: 'node', id: node.id });
        gesture = {
          kind: 'movingNode',
          pointerId: e.pointerId,
          nodeId: node.id,
          startScreen: localPoint(e),
          startWorld: p,
          origin: { x: node.x, y: node.y },
          startDoc: s.doc,
          moved: false,
        };
        return;
      }

      // 빈 곳: 드래그하면 Pan, 그냥 클릭이면 선택 해제
      startPan(e, true);
    };

    const updateHover = (e: PointerEvent) => {
      const s = useStore.getState();
      const hit: Hit = hitTest(s.doc, worldPoint(e), s.viewport.zoom);
      s.setHover(hit);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (gesture.kind === 'idle') {
        if (!isInsideEditor(e.target)) updateHover(e);
        return;
      }
      if (e.pointerId !== gesture.pointerId) return;
      const screen = localPoint(e);
      const s = useStore.getState();

      if (gesture.kind === 'panning') {
        if (!gesture.moved && dist(screen, gesture.startScreen) < DRAG_THRESHOLD) return;
        if (!gesture.moved) board.classList.add('is-panning');
        gesture.moved = true;
        s.setViewport({
          ...s.viewport,
          panX: gesture.startPan.x + (screen.x - gesture.startScreen.x),
          panY: gesture.startPan.y + (screen.y - gesture.startScreen.y),
        });
        return;
      }

      if (gesture.kind === 'movingNode') {
        if (!gesture.moved && dist(screen, gesture.startScreen) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        const p = worldPoint(e);
        const x = Math.round(gesture.origin.x + (p.x - gesture.startWorld.x));
        const y = Math.round(gesture.origin.y + (p.y - gesture.startWorld.y));
        s.setDocLive(setNodePosition(s.doc, gesture.nodeId, x, y));
      }
    };

    const endGesture = (e: PointerEvent) => {
      if (gesture.kind === 'idle' || e.pointerId !== gesture.pointerId) return;
      const g = gesture;
      gesture = { kind: 'idle' };
      board.classList.remove('is-panning');
      const s = useStore.getState();

      if (g.kind === 'panning') {
        if (!g.moved && g.clearOnClick) s.select(null);
      } else if (g.kind === 'movingNode') {
        if (g.moved) s.commitFrom(g.startDoc);
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      if (isInsideEditor(e.target)) return;
      const s = useStore.getState();
      const p = worldPoint(e);
      const hit = hitTest(s.doc, p, s.viewport.zoom);
      if (hit.kind === 'node-body' || hit.kind === 'node-border') {
        s.startEditing(hit.nodeId);
      } else if (hit.kind === 'empty') {
        s.addBoxAt(p);
      }
    };

    const onPointerLeave = () => useStore.getState().setHover({ kind: 'empty' });

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
    board.addEventListener('pointerleave', onPointerLeave);
    board.addEventListener('dblclick', onDoubleClick);
    board.addEventListener('wheel', onWheel, { passive: false });
    board.addEventListener('mousedown', onMouseDown);
    return () => {
      board.removeEventListener('pointerdown', onPointerDown);
      board.removeEventListener('pointermove', onPointerMove);
      board.removeEventListener('pointerup', endGesture);
      board.removeEventListener('pointercancel', endGesture);
      board.removeEventListener('pointerleave', onPointerLeave);
      board.removeEventListener('dblclick', onDoubleClick);
      board.removeEventListener('wheel', onWheel);
      board.removeEventListener('mousedown', onMouseDown);
    };
  }, [boardRef]);
}
