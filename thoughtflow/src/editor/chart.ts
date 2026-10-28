/**
 * 메모 안의 그래프: ```chart 블록의 글 ↔ 그릴 자료.
 *
 * 사람과 AI가 그대로 읽고 쓰기 쉬운 형식 (맨 위의 설정 줄은 모두 선택):
 *
 *   type: bar            ← bar(막대, 기본) · line(꺾은선) · pie(원, 6조각까지)
 *   title: 청크 크기별 정확도
 *   unit: %
 *   크기, 정확도, 속도     ← 첫 줄이 이름이면 열 이름 (첫 칸 = 항목 이름, 나머지 = 계열)
 *   256, 71, 120
 *   512, 78, 140
 *
 * 쉼표 대신 탭이나 Markdown 표(| a | b |)도 된다. 숫자 안의 %, 원, 쉼표 천 단위(따옴표 안) 등은 떼고 읽는다.
 */

export type ChartType = 'bar' | 'line' | 'pie';

export interface ChartSpec {
  type: ChartType;
  title: string;
  unit: string;
  /** 계열 이름 (막대 묶음 / 선) */
  series: string[];
  /** 항목 이름 (x축) */
  labels: string[];
  /** values[계열][항목] (숫자가 아니면 null) */
  values: (number | null)[][];
  /** 그리면서 바꾼 점 (예: 원 그래프 → 막대) */
  notes: string[];
}

export const MAX_SERIES = 8;
export const MAX_ROWS = 200;
export const MAX_PIE = 6;

export const SAMPLE_CHART = `type: bar
title: 제목을 적어 주세요
항목, 값
A, 12
B, 19
C, 7`;

const TYPE_WORDS: Record<string, ChartType> = {
  bar: 'bar',
  column: 'bar',
  막대: 'bar',
  막대그래프: 'bar',
  line: 'line',
  선: 'line',
  꺾은선: 'line',
  꺾은선그래프: 'line',
  pie: 'pie',
  donut: 'pie',
  원: 'pie',
  원그래프: 'pie',
  도넛: 'pie',
};

const META = /^(type|종류|title|제목|unit|단위)\s*[:：]\s*(.*)$/i;

/** 한 줄을 칸으로: 탭 → Markdown 표 → 쉼표(따옴표 안의 쉼표는 글자) */
function cells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.trim().startsWith('|')) {
    return line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  }
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && !cur.trim()) quoted = true;
    else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** "1,200원" "78%" "-3.5" → 숫자, 아니면 null */
export function parseNumber(raw: string): number | null {
  const t = raw.replace(/[\s,_%‰₩$€£¥]|원|개|명|건|회|점|시간|분|초|kg|km|ms/gi, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const isSeparatorRow = (row: string[]) => row.every((c) => /^:?-{2,}:?$/.test(c) || c === '');

export function parseChart(source: string): ChartSpec {
  const spec: ChartSpec = { type: 'bar', title: '', unit: '', series: [], labels: [], values: [], notes: [] };
  const rows: string[][] = [];
  let dataStarted = false;
  for (const rawLine of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const meta = !dataStarted ? line.match(META) : null;
    if (meta) {
      const key = meta[1].toLowerCase();
      const value = meta[2].trim();
      if (key === 'type' || key === '종류') spec.type = TYPE_WORDS[value.toLowerCase().replace(/\s+/g, '')] ?? 'bar';
      else if (key === 'title' || key === '제목') spec.title = value.slice(0, 120);
      else spec.unit = value.slice(0, 20);
      continue;
    }
    dataStarted = true;
    const row = cells(line);
    if (isSeparatorRow(row)) continue;
    rows.push(row);
  }
  if (!rows.length) return spec;

  // 첫 줄의 값 칸이 숫자가 아니면 머리줄 (열 이름)
  const first = rows[0];
  const header = first.length > 1 && first.slice(1).some((c) => c !== '' && parseNumber(c) === null);
  const body = header ? rows.slice(1) : rows;
  const width = Math.max(2, ...rows.map((r) => r.length));
  let seriesCount = width - 1;
  if (seriesCount > MAX_SERIES) {
    spec.notes.push(`계열은 ${MAX_SERIES}개까지만 그립니다.`);
    seriesCount = MAX_SERIES;
  }
  spec.series = Array.from({ length: seriesCount }, (_, k) => (header ? first[k + 1] : '') || (seriesCount === 1 ? '값' : `값 ${k + 1}`));
  const used = body.slice(0, MAX_ROWS);
  if (body.length > MAX_ROWS) spec.notes.push(`항목은 ${MAX_ROWS}개까지만 그립니다.`);
  spec.labels = used.map((r, i) => r[0] || `${i + 1}`);
  spec.values = spec.series.map((_, k) => used.map((r) => parseNumber(r[k + 1] ?? '')));

  if (spec.type === 'pie') {
    const vals = spec.values[0] ?? [];
    const ok = vals.length > 0 && vals.length <= MAX_PIE && vals.every((v) => v !== null && v >= 0) && vals.some((v) => (v ?? 0) > 0);
    if (!ok) {
      spec.type = 'bar';
      spec.notes.push(`원 그래프는 0 이상의 값 ${MAX_PIE}개까지만 그릴 수 있어 막대로 그렸습니다.`);
    } else if (spec.series.length > 1) {
      spec.notes.push('원 그래프는 첫 번째 계열만 그립니다.');
      spec.series = spec.series.slice(0, 1);
      spec.values = spec.values.slice(0, 1);
    }
  }
  return spec;
}

/** 축 눈금: 깔끔한 숫자 몇 개 (0 포함) */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (min === max) {
    if (min === 0) return [0, 1];
    if (min > 0) min = 0;
    else max = 0;
  }
  const span = max - min;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= target + 0.5) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out.map((v) => (Math.abs(v) < step / 1e6 ? 0 : Number(v.toPrecision(12))));
}

/** 1,284 · 12.9K · 4.2M · 0.71 */
export function formatValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${trim(v / 1e9)}B`;
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e4) return `${trim(v / 1e3)}K`;
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return String(Number(v.toPrecision(3)));
}

const trim = (v: number) => String(Number(v.toFixed(Math.abs(v) >= 100 ? 0 : 1)));
