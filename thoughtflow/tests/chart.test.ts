import { describe, expect, it } from 'vitest';
import { formatValue, niceTicks, parseChart, parseNumber } from '../src/editor/chart';

describe('chart text', () => {
  it('reads settings, header and values', () => {
    const c = parseChart('type: line\ntitle: 정확도\nunit: %\n크기, 정확도, 속도\n256, 71, 120\n512, 78, 140');
    expect(c).toMatchObject({ type: 'line', title: '정확도', unit: '%', series: ['정확도', '속도'], labels: ['256', '512'] });
    expect(c.values).toEqual([
      [71, 78],
      [120, 140],
    ]);
  });

  it('works without a header, with tabs or a Markdown table, and Korean words', () => {
    expect(parseChart('A, 1\nB, 2').series).toEqual(['값']);
    expect(parseChart('종류: 막대그래프\n월\t식비\n1월\t32\n2월\t28').values).toEqual([[32, 28]]);
    const t = parseChart('| 항목 | 값 |\n|---|---|\n| 사과 | 3 |\n| 배 | 5 |');
    expect(t.labels).toEqual(['사과', '배']);
    expect(t.values).toEqual([[3, 5]]);
    expect(parseChart('종류: 꺾은선\nA,1').type).toBe('line');
  });

  it('reads numbers with units and quotes', () => {
    expect(parseNumber('78%')).toBe(78);
    expect(parseNumber('1,200원')).toBe(1200);
    expect(parseNumber('-3.5')).toBe(-3.5);
    expect(parseNumber('많음')).toBeNull();
    expect(parseChart('항목, 값\n"서울, 강남", "1,200"').values).toEqual([[1200]]);
    expect(parseChart('항목, 값\n"서울, 강남", "1,200"').labels).toEqual(['서울, 강남']);
  });

  it('pie: up to 6 non-negative parts, otherwise bars', () => {
    expect(parseChart('type: pie\nA, 1\nB, 2').type).toBe('pie');
    const many = parseChart(`type: pie\n${Array.from({ length: 7 }, (_, i) => `x${i}, 1`).join('\n')}`);
    expect(many.type).toBe('bar');
    expect(many.notes.length).toBe(1);
    expect(parseChart('type: pie\nA, -1\nB, 2').type).toBe('bar');
  });

  it('caps series at 8', () => {
    const c = parseChart(`x,${Array.from({ length: 10 }, (_, i) => `s${i}`).join(',')}\na,${Array(10).fill(1).join(',')}`);
    expect(c.series.length).toBe(8);
  });

  it('nice ticks and compact values', () => {
    expect(niceTicks(0, 78)).toEqual([0, 20, 40, 60, 80]);
    expect(niceTicks(-12, 30)).toEqual([-20, -10, 0, 10, 20, 30]);
    expect(niceTicks(0, 0.71)).toEqual([0, 0.2, 0.4, 0.6, 0.8]);
    expect(formatValue(1284)).toBe('1,284');
    expect(formatValue(12900)).toBe('12.9K');
    expect(formatValue(4200000)).toBe('4.2M');
    expect(formatValue(0.712)).toBe('0.712');
  });
});
