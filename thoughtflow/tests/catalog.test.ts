import { describe, expect, it } from 'vitest';
import { dedupeCatalog, findInCatalog, firstLine, parseFrontmatter, searchCatalog, type CatalogItem } from '../src/workflow/catalog';

describe('front matter', () => {
  it('reads simple keys, quotes and block values', () => {
    const md = ['---', 'name: report-writer', 'description: "보고서를 쓴다: 표와 그래프"', 'allowed-tools:', '  - Read', 'notes: >', '  여러 줄', '  설명', '---', '# 본문'].join('\n');
    expect(parseFrontmatter(md)).toEqual({ name: 'report-writer', description: '보고서를 쓴다: 표와 그래프', 'allowed-tools': '', notes: '여러 줄 설명' });
    expect(parseFrontmatter('﻿---\r\nname: a\r\n---\r\n')).toEqual({ name: 'a' });
    expect(parseFrontmatter('# 머리말 없음')).toEqual({});
  });

  it('takes the first sentence of a command file without a description', () => {
    expect(firstLine('---\nargument-hint: [pr]\n---\n# 리뷰\n\nPR을 검토한다\n다음 줄')).toBe('PR을 검토한다');
    expect(firstLine('')).toBe('');
  });
});

const item = (kind: CatalogItem['kind'], name: string, source: CatalogItem['source'] = 'user', description = ''): CatalogItem => ({ kind, name, description, source });

describe('catalog search', () => {
  const items = [
    item('skill', 'report-writer', 'user', '보고서 작성'),
    item('skill', 'myplug:deploy-check', 'plugin', '배포 전 점검'),
    item('skill', 'pdf', 'user', 'PDF 만들기 — report도'),
    item('command', '/review-pr', 'user'),
    item('subagent', 'Explore', 'builtin'),
  ];

  it('ranks prefix matches, then name matches, then descriptions', () => {
    expect(searchCatalog(items, 'skill', 'rep').map((i) => i.name)).toEqual(['report-writer', 'pdf']);
    expect(searchCatalog(items, 'skill', 'deploy').map((i) => i.name)).toEqual(['myplug:deploy-check']);
    expect(searchCatalog(items, 'skill', '배포').map((i) => i.name)).toEqual(['myplug:deploy-check']);
    expect(searchCatalog(items, 'command', '/rev').map((i) => i.name)).toEqual(['/review-pr']);
    expect(searchCatalog(items, 'skill', '', ['PDF']).map((i) => i.name)).toEqual(['report-writer', 'myplug:deploy-check']);
  });

  it('finds names regardless of case and "/"', () => {
    expect(findInCatalog(items, 'command', 'review-pr')?.name).toBe('/review-pr');
    expect(findInCatalog(items, 'subagent', 'explore')?.source).toBe('builtin');
    expect(findInCatalog(items, 'skill', 'made-up')).toBeUndefined();
  });

  it('keeps one entry per name, preferring the working folder', () => {
    const out = dedupeCatalog([item('skill', 'pdf', 'plugin'), item('skill', 'PDF', 'project'), item('skill', 'pdf', 'user')]);
    expect(out).toEqual([item('skill', 'PDF', 'project')]);
  });
});
