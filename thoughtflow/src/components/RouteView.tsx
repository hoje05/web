import { memo } from 'react';
import type { RouteGeom } from '../routing/routeGeometry';
import type { RouteRole } from './highlight';

interface Props {
  geom: RouteGeom;
  role: RouteRole;
  hovered: boolean;
  arrowHovered: boolean;
}

/** 진행 방향(+x)을 가리키는 화살표. 경로 중앙에 하나만 그린다. */
export const ARROW_PATH = 'M6.5 0 L-5 -5.5 L-2.6 0 L-5 5.5 Z';

export const RouteView = memo(function RouteView({ geom, role, hovered, arrowHovered }: Props) {
  const glow = role === 'outgoing' || role === 'incoming';
  const className = ['route', `role-${role}`, hovered && 'is-hover', arrowHovered && 'is-arrow-hover']
    .filter(Boolean)
    .join(' ');
  const { x, y, angle } = geom.arrow;
  return (
    <g className={className} data-edge-id={geom.id} data-testid="route">
      {glow && <path className="route-glow" d={geom.d} filter="url(#route-glow)" />}
      <path className="route-line" d={geom.d} />
      <g transform={`translate(${x} ${y}) rotate(${angle})`}>
        <path className="route-arrow" d={ARROW_PATH} />
      </g>
    </g>
  );
});
