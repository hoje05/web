import { useEffect, useRef } from 'react';
import { DEFAULT_BOX_HEIGHT, DEFAULT_BOX_WIDTH } from '../model/types';
import { useBoardInteraction } from '../interaction/useBoardInteraction';
import { useStore } from '../store/store';
import { BoxView } from './BoxView';

/** 줌에 따라 점 격자 간격을 조절해 너무 촘촘해지지 않게 한다 */
function gridStyle(zoom: number, panX: number, panY: number): React.CSSProperties {
  let step = 24 * zoom;
  while (step < 12) step *= 2;
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${panX}px ${panY}px`,
  };
}

function cursorFor(hoverKind: string, tool: string): string | undefined {
  if (tool === 'route') return 'crosshair';
  if (hoverKind === 'node-border') return 'crosshair';
  if (hoverKind === 'node-body') return 'move';
  return undefined;
}

export function Board() {
  const boardRef = useRef<HTMLDivElement>(null);
  const viewport = useStore((s) => s.viewport);
  const spaceHeld = useStore((s) => s.spaceHeld);
  const tool = useStore((s) => s.tool);
  const doc = useStore((s) => s.doc);
  const selection = useStore((s) => s.selection);
  const editingNodeId = useStore((s) => s.editingNodeId);
  const hover = useStore((s) => s.hover);
  const ghost = useStore((s) => s.ghost);
  useBoardInteraction(boardRef);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      useStore.getState().setBoardSize({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { zoom, panX, panY } = viewport;
  const svgTransform = `translate(${panX} ${panY}) scale(${zoom})`;
  const cssTransform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  const className = ['board', spaceHeld && 'is-space', tool === 'route' && 'tool-route'].filter(Boolean).join(' ');
  const hoverNodeId = hover.kind === 'node-border' || hover.kind === 'node-body' ? hover.nodeId : null;

  return (
    <div
      ref={boardRef}
      className={className}
      style={{ ...gridStyle(zoom, panX, panY), cursor: cursorFor(hover.kind, tool) }}
      data-testid="board"
    >
      <svg className="layer layer-edges">
        <g transform={svgTransform} />
      </svg>
      <div className="layer layer-nodes" style={{ transform: cssTransform }}>
        {Object.values(doc.nodes).map((n) => (
          <BoxView
            key={n.id}
            node={n}
            selected={selection?.kind === 'node' && selection.id === n.id}
            editing={editingNodeId === n.id}
            borderHover={hoverNodeId === n.id && (hover.kind === 'node-border' || tool === 'route')}
            dropTarget={false}
          />
        ))}
        {ghost && (
          <div
            className="box box-ghost"
            style={{
              transform: `translate(${ghost.x - DEFAULT_BOX_WIDTH / 2}px, ${ghost.y - DEFAULT_BOX_HEIGHT / 2}px)`,
            }}
          />
        )}
      </div>
      <svg className="layer layer-overlay">
        <g transform={svgTransform} />
      </svg>
      {Object.keys(doc.nodes).length === 0 && !ghost && (
        <div className="empty-hint">
          <b>Box</b>를 Board로 끌어다 놓거나, 빈 곳을 <b>더블클릭</b>해 첫 생각을 적어 보세요.
        </div>
      )}
    </div>
  );
}
