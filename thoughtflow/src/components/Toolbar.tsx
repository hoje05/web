import { beginBoxPlacement } from '../interaction/boxPlacement';
import { useStore } from '../store/store';
import { BoxIcon, RouteIcon } from './icons';

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);

  return (
    // 버튼이 키보드 포커스를 가져가면 Space(Pan)/Enter(편집) 단축키와 충돌하므로 포커스를 주지 않는다
    <div className="toolbar" role="toolbar" aria-label="도구" onMouseDown={(e) => e.preventDefault()}>
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
        title="Route 그리기 (R) — 그린 선은 자동으로 매끈하게 정리됩니다"
        onClick={() => setTool(tool === 'route' ? 'select' : 'route')}
      >
        <RouteIcon />
        <span>Route</span>
      </button>
    </div>
  );
}
