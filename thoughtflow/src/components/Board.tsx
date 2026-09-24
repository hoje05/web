import { useEffect, useRef } from 'react';
import { useBoardInteraction } from '../interaction/useBoardInteraction';
import { useStore } from '../store/store';

/** 줌에 따라 점 격자 간격을 조절해 너무 촘촘해지지 않게 한다 */
function gridStyle(zoom: number, panX: number, panY: number): React.CSSProperties {
  let step = 24 * zoom;
  while (step < 12) step *= 2;
  return {
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${panX}px ${panY}px`,
  };
}

export function Board() {
  const boardRef = useRef<HTMLDivElement>(null);
  const viewport = useStore((s) => s.viewport);
  const spaceHeld = useStore((s) => s.spaceHeld);
  const tool = useStore((s) => s.tool);
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

  return (
    <div ref={boardRef} className={className} style={gridStyle(zoom, panX, panY)} data-testid="board">
      <svg className="layer layer-edges">
        <g transform={svgTransform} />
      </svg>
      <div className="layer layer-nodes" style={{ transform: cssTransform }} />
      <svg className="layer layer-overlay">
        <g transform={svgTransform} />
      </svg>
    </div>
  );
}
