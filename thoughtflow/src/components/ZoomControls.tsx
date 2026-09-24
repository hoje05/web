import { useStore } from '../store/store';

export function ZoomControls() {
  const zoom = useStore((s) => s.viewport.zoom);
  const zoomBy = useStore((s) => s.zoomBy);
  return (
    <div className="zoom-controls">
      <button title="축소 (Ctrl -)" onClick={() => zoomBy(1 / 1.2)}>−</button>
      <button className="zoom-value" data-testid="zoom-value" title="100% (Ctrl 0)" onClick={() => zoomBy(1 / zoom)}>
        {Math.round(zoom * 100)}%
      </button>
      <button title="확대 (Ctrl +)" onClick={() => zoomBy(1.2)}>+</button>
    </div>
  );
}
