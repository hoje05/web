import { useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatValue, niceTicks, type ChartSpec } from './chart';

/**
 * 메모 안의 그래프 그리기 (SVG). 데이터 시각화 원칙:
 *  - 막대: 24px 이하의 가는 막대, 끝만 4px 둥글게(바닥은 반듯), 맞닿는 막대 사이 2px 틈
 *  - 선: 2px, 끝점은 8px 점 + 바탕색 2px 테두리 / 격자·축: 1px 실선, 눈에 띄지 않게
 *  - 색: 정해진 순서의 범주색(어두운 화면용, 검사 통과) — 계열이 하나면 한 색. 글자는 글자색(계열색으로 칠하지 않음)
 *  - 계열이 둘 이상이면 범례, 숫자는 골라서만 (막대가 적을 때 끝에, 선은 끝값), 나머지는 마우스를 올리면 / 표 보기
 */

const SERIES = 8;
const PLOT_H = 168;
const TOP = 20;
const BOTTOM = 24;
const BAR_MAX = 24;
const GAP = 2;

/** 글자 폭 어림 (한글은 넓게) */
const textWidth = (s: string, size = 11) => [...s].reduce((w, c) => w + (/[ㄱ-힣一-鿿]/.test(c) ? size : size * 0.6), 0);
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export function ChartFigure({ spec }: { spec: ChartSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [table, setTable] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(220, Math.floor(el.clientWidth)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasData = spec.labels.length > 0 && spec.values.some((s) => s.some((v) => v !== null));
  return (
    <div className="chart" ref={ref} data-testid="note-chart-figure">
      {(spec.title || spec.unit) && (
        <div className="chart-head">
          {spec.title && <span className="chart-title">{spec.title}</span>}
          {spec.unit && <span className="chart-unit">단위: {spec.unit}</span>}
        </div>
      )}
      {spec.series.length > 1 && spec.type !== 'pie' && (
        <div className="chart-legend">
          {spec.series.map((name, k) => (
            <span key={k} className="chart-legend-item">
              <span className={`chart-key ${spec.type === 'line' ? 'is-line' : ''}`} style={{ ['--k' as string]: `var(--series-${(k % SERIES) + 1})` }} />
              {name}
            </span>
          ))}
        </div>
      )}
      {!hasData ? (
        <div className="chart-empty">그래프로 그릴 숫자가 없습니다. “편집”을 눌러 자료를 넣어 주세요.</div>
      ) : table ? (
        <DataTable spec={spec} />
      ) : spec.type === 'pie' ? (
        <Donut spec={spec} />
      ) : (
        <XYChart spec={spec} width={width} />
      )}
      <div className="chart-foot">
        {spec.notes.map((n) => (
          <span key={n} className="chart-note">
            {n}
          </span>
        ))}
        {hasData && (
          <button className="chart-table-toggle" data-testid="chart-table-toggle" onClick={() => setTable(!table)}>
            {table ? '그래프 보기' : '표로 보기'}
          </button>
        )}
      </div>
    </div>
  );
}

interface Hover {
  i: number;
  x: number;
  y: number;
}

function XYChart({ spec, width }: { spec: ChartSpec; width: number }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const isLine = spec.type === 'line';
  const all = spec.values.flat().filter((v): v is number => v !== null);
  const dataMin = Math.min(...all);
  const dataMax = Math.max(...all);
  const lo = isLine ? (dataMin >= 0 && dataMin <= dataMax * 0.6 ? 0 : dataMin) : Math.min(0, dataMin);
  const hi = isLine ? dataMax : Math.max(0, dataMax);
  const ticks = niceTicks(lo, hi);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const tickW = Math.max(...ticks.map((t) => textWidth(formatValue(t), 10.5)));
  const left = Math.ceil(tickW) + 10;

  const n = spec.labels.length;
  const S = spec.series.length;
  // 선 끝값 이름표 (계열 3개 이하이고 서로 겹치지 않을 때만)
  const lastIdx = (k: number) => {
    for (let i = n - 1; i >= 0; i--) if (spec.values[k][i] !== null) return i;
    return -1;
  };
  const endLabels = isLine && S <= 3 ? spec.series.map((_, k) => ({ k, i: lastIdx(k) })).filter((e) => e.i >= 0) : [];
  const endW = endLabels.length ? Math.max(...endLabels.map((e) => textWidth(formatValue(spec.values[e.k][e.i]!), 10.5))) + 12 : 0;
  const right = Math.max(10, endW);
  const plotW = Math.max(60, width - left - right);
  const H = TOP + PLOT_H + BOTTOM;
  const y = (v: number) => TOP + PLOT_H - ((v - yMin) / (yMax - yMin || 1)) * PLOT_H;
  const band = plotW / n;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const cx = (i: number) => (isLine ? left + (n > 1 ? i * step : plotW / 2) : left + band * (i + 0.5));
  const y0 = y(Math.max(yMin, Math.min(yMax, 0)));

  // 막대 크기: 묶음이 칸의 72%를 넘지 않게, 막대 하나는 24px까지
  const groupW = Math.min(band * 0.72, S * BAR_MAX + (S - 1) * GAP);
  const barW = Math.max(1.5, Math.min(BAR_MAX, (groupW - (S - 1) * GAP) / S));
  const groupReal = S * barW + (S - 1) * GAP;

  // x축 이름: 넘치면 몇 칸 걸러, 길면 줄여서
  const maxChars = 12;
  const labelW = Math.max(...spec.labels.map((l) => textWidth(clip(l, maxChars), 10.5)));
  const room = isLine ? Math.max(step, 1) : band;
  const every = Math.max(1, Math.ceil((labelW + 8) / room));
  const capLabels = !isLine && S === 1 && n <= 10 && barW >= 10;

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = isLine ? (n > 1 ? Math.round((px - left) / step) : 0) : Math.floor((px - left) / band);
    if (i < 0 || i >= n) return setHover(null);
    setHover({ i, x: cx(i), y: e.clientY - box.top });
  };

  return (
    <div className="chart-plot">
      <svg width={width} height={H} role="img" aria-label={spec.title || '그래프'}>
        {/* 격자: 1px 실선 */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart-axis' : 'chart-grid'} />
            <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="chart-tick">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {/* x축 이름 */}
        {spec.labels.map((l, i) =>
          i % every === 0 ? (
            <text key={i} x={cx(i)} y={TOP + PLOT_H + 16} textAnchor="middle" className="chart-tick">
              <title>{l}</title>
              {clip(l, maxChars)}
            </text>
          ) : null,
        )}
        {/* 막대 */}
        {!isLine &&
          spec.values.map((vals, k) =>
            vals.map((v, i) => {
              if (v === null) return null;
              const x = cx(i) - groupReal / 2 + k * (barW + GAP);
              return (
                <path
                  key={`${k}-${i}`}
                  d={barPath(x, barW, y0, y(v))}
                  className={`chart-bar${hover?.i === i ? ' is-hover' : ''}`}
                  style={{ fill: `var(--series-${S === 1 ? 1 : (k % SERIES) + 1})` }}
                />
              );
            }),
          )}
        {capLabels &&
          spec.values[0].map((v, i) =>
            v === null ? null : (
              <text key={i} x={cx(i)} y={v >= 0 ? y(v) - 5 : y(v) + 12} textAnchor="middle" className="chart-value">
                {formatValue(v)}
              </text>
            ),
          )}
        {/* 선 */}
        {isLine &&
          spec.values.map((vals, k) => (
            <g key={k} style={{ ['--k' as string]: `var(--series-${(k % SERIES) + 1})` }}>
              {segments(vals).map((seg, j) => (
                <path key={j} d={seg.map((i, m) => `${m ? 'L' : 'M'}${cx(i)},${y(vals[i]!)}`).join('')} className="chart-line" />
              ))}
              {vals.map((v, i) =>
                v === null || (n > 16 && i !== lastIdx(k) && hover?.i !== i) ? null : (
                  <circle key={i} cx={cx(i)} cy={y(v)} r={hover?.i === i ? 5 : 4} className="chart-dot" />
                ),
              )}
            </g>
          ))}
        {isLine &&
          endLabelsFit(endLabels.map((e) => y(spec.values[e.k][e.i]!))) &&
          endLabels.map((e) => (
            <text key={e.k} x={cx(e.i) + 8} y={y(spec.values[e.k][e.i]!)} dy="0.32em" className="chart-value">
              {formatValue(spec.values[e.k][e.i]!)}
            </text>
          ))}
        {/* 마우스: 선은 세로 기준선, 막대는 칸 전체가 닿는 곳 */}
        {hover && isLine && <line x1={hover.x} x2={hover.x} y1={TOP} y2={TOP + PLOT_H} className="chart-crosshair" />}
        <rect x={left} y={TOP} width={plotW} height={PLOT_H} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover && <Tooltip spec={spec} i={hover.i} x={hover.x} width={width} />}
    </div>
  );
}

/** 끝만 둥근 막대 (위로 / 아래로) */
function barPath(x: number, w: number, base: number, top: number): string {
  const h = Math.abs(base - top);
  const r = Math.min(4, w / 2, h);
  if (h < 0.5) return `M${x},${base}h${w}v-0.5h${-w}Z`;
  if (top <= base) {
    return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${base}Z`;
  }
  return `M${x},${base}V${top - r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top - r}V${base}Z`;
}

/** 빈 값(null)에서 끊긴 선 조각들 */
function segments(vals: (number | null)[]): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  vals.forEach((v, i) => {
    if (v === null) {
      if (cur.length) out.push(cur);
      cur = [];
    } else cur.push(i);
  });
  if (cur.length) out.push(cur);
  return out;
}

/** 끝값 이름표끼리 13px 안으로 붙으면 쓰지 않는다 (범례와 마우스로) */
function endLabelsFit(ys: number[]): boolean {
  const s = [...ys].sort((a, b) => a - b);
  return s.every((v, i) => i === 0 || v - s[i - 1] >= 13);
}

function Tooltip({ spec, i, x, width }: { spec: ChartSpec; i: number; x: number; width: number }) {
  const rows = spec.series.map((name, k) => ({ name, k, v: spec.values[k][i] })).filter((r) => r.v !== null);
  const left = Math.min(Math.max(8, x + 12), width - 168);
  return (
    <div className="chart-tooltip" style={{ left }} data-testid="chart-tooltip">
      <div className="chart-tooltip-label">{spec.labels[i]}</div>
      {rows.map((r) => (
        <div key={r.k} className="chart-tooltip-row">
          <span className="chart-key is-line" style={{ ['--k' as string]: `var(--series-${spec.series.length === 1 ? 1 : (r.k % SERIES) + 1})` }} />
          <b>{formatValue(r.v!)}</b>
          {spec.series.length > 1 && <span className="chart-tooltip-name">{r.name}</span>}
        </div>
      ))}
    </div>
  );
}

/** 원(도넛): 6조각까지, 조각 사이 2px 바탕색 틈, 옆에 이름·값·비율 */
function Donut({ spec }: { spec: ChartSpec }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = spec.values[0].map((v) => v ?? 0);
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const R = 64;
  const r = 40;
  const c = R + 4;
  const arcs = useMemo(() => {
    let a = -Math.PI / 2;
    return vals.map((v) => {
      const sweep = (v / total) * Math.PI * 2;
      const start = a;
      a += sweep;
      return { start, end: a };
    });
  }, [vals.join(','), total]);
  return (
    <div className="chart-donut">
      <svg width={c * 2} height={c * 2} role="img" aria-label={spec.title || '원 그래프'}>
        {arcs.map((arc, i) =>
          vals[i] <= 0 ? null : (
            <path
              key={i}
              d={donutPath(c, c, R, r, arc.start, arc.end)}
              className={`chart-slice${hover === i ? ' is-hover' : ''}`}
              style={{ fill: `var(--series-${(i % SERIES) + 1})` }}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              <title>{`${spec.labels[i]}: ${formatValue(vals[i])} (${Math.round((vals[i] / total) * 100)}%)`}</title>
            </path>
          ),
        )}
        <text x={c} y={c} dy="0.32em" textAnchor="middle" className="chart-donut-total">
          {formatValue(total)}
        </text>
      </svg>
      <ul className="chart-donut-legend">
        {spec.labels.map((l, i) => (
          <li key={i} className={hover === i ? 'is-hover' : undefined} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span className="chart-key" style={{ ['--k' as string]: `var(--series-${(i % SERIES) + 1})` }} />
            <span className="chart-donut-name">{l}</span>
            <b>{formatValue(vals[i])}</b>
            <span className="chart-donut-pct">{Math.round((vals[i] / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function donutPath(cx: number, cy: number, R: number, r: number, a0: number, a1: number): string {
  // 한 조각이 전부면 원 두 개로
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    return `M${cx - R},${cy}a${R},${R} 0 1,0 ${R * 2},0a${R},${R} 0 1,0 ${-R * 2},0ZM${cx - r},${cy}a${r},${r} 0 1,1 ${r * 2},0a${r},${r} 0 1,1 ${-r * 2},0Z`;
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
  return `M${p(R, a0)}A${R},${R} 0 ${large},1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${large},0 ${p(r, a0)}Z`;
}

/** 표 보기 (그래프와 같은 내용을 글자로) */
function DataTable({ spec }: { spec: ChartSpec }) {
  return (
    <div className="chart-table-wrap">
      <table className="chart-table" data-testid="chart-table">
        <thead>
          <tr>
            <th />
            {spec.series.map((s, k) => (
              <th key={k}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {spec.labels.map((l, i) => (
            <tr key={i}>
              <th>{l}</th>
              {spec.series.map((_, k) => (
                <td key={k}>{spec.values[k][i] === null ? '–' : formatValue(spec.values[k][i]!)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
