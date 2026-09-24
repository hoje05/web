import { beginBoxPlacement } from '../interaction/boxPlacement';
import { useStore } from '../store/store';
import { BoxIcon, CorrectIcon, RouteIcon } from './icons';

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  // 보정은 곡선 Route가 선택되었을 때만 의미가 있다
  const correctable = useStore((s) => {
    const sel = s.selection;
    if (sel?.kind !== 'edge') return null;
    const e = s.doc.edges[sel.id];
    return e && e.pathMode !== 'straight' ? e.id : null;
  });
  const correctEdge = useStore((s) => s.correctEdge);

  return (
    <div className="toolbar" role="toolbar" aria-label="도구">
      <button
        className="tool-button"
        data-testid="tool-box"
        title="Box — Board로 끌어다 놓기 (클릭하면 화면 중앙에 생성)"
        onPointerDown={(e) => beginBoxPlacement(e, document.querySelector('[data-testid=board]'))}
      >
        <BoxIcon />
        <span>Box</span>
      </button>
      <button
        className="tool-button"
        data-testid="tool-route"
        aria-pressed={tool === 'route'}
        title="Route 그리기 (R)"
        onClick={() => setTool(tool === 'route' ? 'select' : 'route')}
      >
        <RouteIcon />
        <span>Route</span>
      </button>
      <div className="toolbar-sep" />
      <button
        className="tool-button"
        data-testid="tool-correct"
        title={correctable ? '선택한 Route의 흔들림을 정리 (Ctrl+Z로 되돌리기)' : '곡선 Route를 선택하면 보정할 수 있습니다'}
        disabled={!correctable}
        onClick={() => correctable && correctEdge(correctable)}
      >
        <CorrectIcon />
        <span>보정</span>
      </button>
    </div>
  );
}
