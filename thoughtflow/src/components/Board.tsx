import { useEffect, useRef } from 'react';
import { DEFAULT_BOX_HEIGHT, DEFAULT_BOX_WIDTH } from '../model/types';
import { useBoardInteraction } from '../interaction/useBoardInteraction';
import { getRouteGeometry } from '../routing/routeGeometry';
import { useStore } from '../store/store';
import { BoxView } from './BoxView';
import { DraftRoute } from './DraftRoute';
import { routeRole, type RouteRole } from './highlight';
import { RouteView } from './RouteView';

/** 강조된 Route가 다른 선에 가려지지 않도록 나중에 그린다 */
const ROLE_ORDER: Record<RouteRole, number> = { dim: 0, normal: 1, incoming: 2, outgoing: 2, selected: 3 };

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
  if (hoverKind === 'arrow' || hoverKind === 'edge') return 'pointer';
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
  const draft = useStore((s) => s.draft);
  useBoardInteraction(boardRef);
  const geoms = getRouteGeometry(doc);
  const routes = Object.values(doc.edges)
    .map((e) => ({ edge: e, geom: geoms.get(e.id), role: routeRole(e, selection) }))
    .filter((r) => r.geom)
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const hoverEdgeId = hover.kind === 'edge' || hover.kind === 'arrow' ? hover.edgeId : null;

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
        <g transform={svgTransform}>
          {routes.map(({ edge, geom, role }) => (
            <RouteView
              key={edge.id}
              geom={geom!}
              role={role}
              hovered={hoverEdgeId === edge.id && tool === 'select'}
              arrowHovered={hover.kind === 'arrow' && hover.edgeId === edge.id && tool === 'select'}
            />
          ))}
        </g>
      </svg>
      <div className="layer layer-nodes" style={{ transform: cssTransform }}>
        {Object.values(doc.nodes).map((n) => (
          <BoxView
            key={n.id}
            node={n}
            selected={selection?.kind === 'node' && selection.id === n.id}
            editing={editingNodeId === n.id}
            borderHover={hoverNodeId === n.id && (hover.kind === 'node-border' || tool === 'route')}
            dropTarget={draft?.targetNodeId === n.id}
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
        <g transform={svgTransform}>{draft && <DraftRoute doc={doc} draft={draft} />}</g>
      </svg>
      {Object.keys(doc.nodes).length === 0 && !ghost && (
        <div className="empty-hint">
          <b>Box</b>를 Board로 끌어다 놓거나, 빈 곳을 <b>더블클릭</b>해 첫 생각을 적어 보세요.
        </div>
      )}
    </div>
  );
}
