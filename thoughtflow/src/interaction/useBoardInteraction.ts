import { useEffect, type RefObject } from 'react';
import { dist, type Vec } from '../geometry/vec';
import type { Doc } from '../model/types';
import { moveNode } from '../routing/routeOps';
import { appendSample } from '../routing/sampling';
import { useStore } from '../store/store';
import { screenToWorld } from '../viewport/viewport';
import { flushEditing } from './editing';
import { hitTest, nodeAt, type Hit } from './hitTest';

/** 이 거리(화면 px) 이상 움직여야 클릭이 아니라 드래그로 본다 */
const DRAG_THRESHOLD = 3;
/** Route 경로 샘플 간격 (화면 px) */
const SAMPLE_SPACING = 3;

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
    }
  | {
      kind: 'drawingRoute';
      pointerId: number;
      sourceNodeId: string | null;
      points: Vec[];
      startScreen: Vec;
      moved: boolean;
    }
  | { kind: 'pressArrow'; pointerId: number; edgeId: string; startScreen: Vec; startPan: Vec };

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
      const onNode = hit.kind === 'node-body' || hit.kind === 'node-border' ? hit.nodeId : null;

      // Route 그리기: Route 도구(어디서든) 또는 Box 테두리에서 드래그
      if (s.tool === 'route' || hit.kind === 'node-border') {
        gesture = {
          kind: 'drawingRoute',
          pointerId: e.pointerId,
          sourceNodeId: onNode,
          points: [p],
          startScreen: localPoint(e),
          moved: false,
        };
        return;
      }

      if (hit.kind === 'arrow') {
        gesture = {
          kind: 'pressArrow',
          pointerId: e.pointerId,
          edgeId: hit.edgeId,
          startScreen: localPoint(e),
          startPan: { x: s.viewport.panX, y: s.viewport.panY },
        };
        return;
      }

      if (hit.kind === 'edge') {
        s.select({ kind: 'edge', id: hit.edgeId });
        startPan(e, false);
        return;
      }

      if (hit.kind === 'node-body') {
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
        s.setDocLive(moveNode(s.doc, gesture.nodeId, x, y));
        return;
      }

      if (gesture.kind === 'pressArrow') {
        // 화살표를 누른 채 끌면 클릭이 아니라 Pan으로 전환
        if (dist(screen, gesture.startScreen) < DRAG_THRESHOLD) return;
        gesture = {
          kind: 'panning',
          pointerId: gesture.pointerId,
          startScreen: gesture.startScreen,
          startPan: gesture.startPan,
          moved: false,
          clearOnClick: false,
        };
        onPointerMove(e);
        return;
      }

      if (gesture.kind === 'drawingRoute') {
        // 빠른 마우스 이동도 놓치지 않도록 coalesced event까지 샘플링
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        const minDist = SAMPLE_SPACING / s.viewport.zoom;
        for (const ev of events.length ? events : [e]) appendSample(gesture.points, worldPoint(ev), minDist);
        if (!gesture.moved && dist(screen, gesture.startScreen) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        const last = gesture.points[gesture.points.length - 1];
        s.setDraft({
          sourceNodeId: gesture.sourceNodeId,
          points: gesture.points.slice(),
          targetNodeId: nodeAt(s.doc, last, s.viewport.zoom, gesture.sourceNodeId),
        });
      }
    };

    const endGesture = (e: PointerEvent) => {
      if (gesture.kind === 'idle' || e.pointerId !== gesture.pointerId) return;
      const g = gesture;
      gesture = { kind: 'idle' };
      board.classList.remove('is-panning');
      const s = useStore.getState();
      if (e.type === 'pointercancel') {
        s.setDraft(null);
        if (g.kind === 'movingNode' && g.moved) s.commitFrom(g.startDoc);
        return;
      }

      if (g.kind === 'panning') {
        if (!g.moved && g.clearOnClick) s.select(null);
      } else if (g.kind === 'movingNode') {
        if (g.moved) s.commitFrom(g.startDoc);
      } else if (g.kind === 'pressArrow') {
        s.reverseEdge(g.edgeId);
        s.select({ kind: 'edge', id: g.edgeId });
      } else if (g.kind === 'drawingRoute') {
        s.setDraft(null);
        const release = worldPoint(e);
        if (!g.moved) {
          // 그냥 클릭: Box면 선택, 빈 곳이면 선택 해제
          s.select(g.sourceNodeId ? { kind: 'node', id: g.sourceNodeId } : null);
          return;
        }
        g.points.push(release);
        const target = nodeAt(s.doc, release, s.viewport.zoom, g.sourceNodeId);
        if (!s.finishRoute({ sourceNodeId: g.sourceNodeId, points: g.points }, target) && g.sourceNodeId) {
          s.select({ kind: 'node', id: g.sourceNodeId });
        }
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
