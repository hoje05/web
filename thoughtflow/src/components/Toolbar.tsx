import { beginBoxPlacement } from '../interaction/boxPlacement';
import { useStore } from '../store/store';
import { BoxIcon, CorrectIcon, RouteIcon } from './icons';

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

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
      <button className="tool-button" data-testid="tool-correct" title="선택한 Route 보정" disabled>
        <CorrectIcon />
        <span>보정</span>
      </button>
    </div>
  );
}
