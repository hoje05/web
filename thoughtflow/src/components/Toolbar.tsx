import { arrangeBoard } from '../interaction/arrange';
import { beginBoxPlacement } from '../interaction/boxPlacement';
import { nextSortMode, useStore } from '../store/store';
import { ArrangeIcon, BoxIcon, RouteIcon } from './icons';

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const boxes = useStore((s) => Object.keys(s.doc.nodes).length);
  // 이번에 누르면 할 정렬: → 나가는 흐름 / ← 들어오는 흐름 중심 (누를 때마다 번갈아)
  const sortMode = useStore(nextSortMode);

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
      <div className="toolbar-sep" />
      <button
        className="tool-button"
        data-testid="tool-arrange"
        data-sort-mode={sortMode}
        title={
          sortMode === 'out'
            ? '정렬 → 나가는 흐름 (Outgoing Flow) — Box와 Route를 흐름 순서대로 보기 좋게 놓기.\n한 번 더 누르면 ← 들어오는 흐름 중심. Ctrl+Z로 되돌리기'
            : '정렬 ← 들어오는 흐름 (Incoming Flow) — 선택한 Box(없으면 흐름의 끝 Box)로 들어오는 흐름을 중심으로 놓기.\n한 번 더 누르면 → 나가는 흐름. Ctrl+Z로 되돌리기'
        }
        aria-label={sortMode === 'out' ? '정렬: 나가는 흐름' : '정렬: 들어오는 흐름 중심'}
        disabled={boxes < 2}
        onClick={arrangeBoard}
      >
        <ArrangeIcon />
        <span>
          정렬 <span className="sort-dir" data-testid="sort-dir">{sortMode === 'out' ? '→' : '←'}</span>
        </span>
      </button>
    </div>
  );
}
