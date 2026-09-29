import { describe, expect, it } from 'vitest';
import { addFlow, connectBoxes, deleteItems, describeBoard, readBox, resolveBox, searchBoxes, updateBox } from '../src/ai/boardOps';
import { estimateBoxSize, GAP_X, placeBoxes } from '../src/ai/layout';
import { aiDisplayName } from '../src/ai/protocol';
import { EMPTY_DOC, type Doc } from '../src/model/types';

const center = { x: 0, y: 0 };
const ok = (r: ReturnType<typeof addFlow>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};
const byTitle = (doc: Doc, t: string) => Object.values(doc.nodes).find((n) => n.text === t)!;
const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('AI add_flow', () => {
  it('chains boxes left → right in order when routes are omitted', () => {
    const r = ok(addFlow(EMPTY_DOC, { boxes: [{ title: '제주도 가고 싶다' }, { title: '비행기 표 검색' }, { title: '너무 비쌈', note: '왕복 40만원' }] }, 'Claude', center));
    const [a, b, c] = ['제주도 가고 싶다', '비행기 표 검색', '너무 비쌈'].map((t) => byTitle(r.doc, t));
    expect(Object.keys(r.doc.edges)).toHaveLength(2);
    const edges = Object.values(r.doc.edges);
    expect(edges.map((e) => [e.sourceNodeId, e.targetNodeId])).toEqual([[a.id, b.id], [b.id, c.id]]);
    expect(edges.every((e) => e.pathMode === 'auto' && e.sourceAnchor.side === 'right' && e.targetAnchor.side === 'left')).toBe(true);
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.width + GAP_X - 1);
    expect(c.x).toBeGreaterThan(b.x);
    expect(Math.abs(a.y + a.height / 2 - (b.y + b.height / 2))).toBeLessThan(1);
    expect(c.note).toBe('왕복 40만원');
    expect(a.origin).toBe('Claude');
    // 빈 보드: 첫 Box는 화면 가운데
    expect(Math.abs(a.x + a.width / 2)).toBeLessThan(1);
    expect(r.text).toContain('Box 3개와 Route 2개');
    expect(r.created).toHaveLength(3);
  });

  it('branches with explicit routes, attaches to an existing box with after, and never overlaps', () => {
    const base = ok(addFlow(EMPTY_DOC, { boxes: [{ title: '시작' }] }, '', center)).doc;
    const start = byTitle(base, '시작');
    const r = ok(
      addFlow(
        base,
        {
          after: start.id,
          boxes: [{ key: 'q', title: '질문' }, { key: 'a1', title: '답 1' }, { key: 'a2', title: '답 2' }, { key: 'a3', title: '답 3' }],
          routes: [{ from: 'q', to: 'a1' }, { from: 'q', to: 'a2' }, { from: 'q', to: 'a3' }],
        },
        'ChatGPT',
        center,
      ),
    );
    const q = byTitle(r.doc, '질문');
    const e = Object.values(r.doc.edges).map((x) => `${r.doc.nodes[x.sourceNodeId].text}>${r.doc.nodes[x.targetNodeId].text}`);
    expect(e.sort()).toEqual(['시작>질문', '질문>답 1', '질문>답 2', '질문>답 3']);
    const answers = ['답 1', '답 2', '답 3'].map((t) => byTitle(r.doc, t));
    // 답들은 질문 오른쪽 한 열에 위에서 아래로
    expect(answers.every((n) => n.x > q.x + q.width)).toBe(true);
    expect(answers[0].y).toBeLessThan(answers[1].y);
    expect(answers[1].y).toBeLessThan(answers[2].y);
    const all = Object.values(r.doc.nodes);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlap(all[i], all[j])).toBe(false);
    expect(r.text).toContain('(key: q)');
  });

  it('later children of an existing box go below the existing ones', () => {
    let doc = ok(addFlow(EMPTY_DOC, { boxes: [{ title: 'A' }, { title: 'B' }] }, '', center)).doc;
    doc = ok(addFlow(doc, { after: 'A', boxes: [{ title: 'C' }] }, '', center)).doc;
    const [a, b, c] = ['A', 'B', 'C'].map((t) => byTitle(doc, t));
    expect(c.x).toBe(b.x);
    expect(c.y).toBeGreaterThan(b.y + b.height);
    expect(Object.values(doc.edges).some((e) => e.sourceNodeId === a.id && e.targetNodeId === c.id)).toBe(true);
  });

  it('places an unconnected new flow below existing content', () => {
    const doc = ok(addFlow(EMPTY_DOC, { boxes: [{ title: 'A' }, { title: 'B' }] }, '', center)).doc;
    const r = ok(addFlow(doc, { boxes: [{ title: '다른 주제' }] }, '', center));
    const a = byTitle(r.doc, 'A');
    const n = byTitle(r.doc, '다른 주제');
    expect(n.x).toBe(a.x);
    expect(n.y).toBeGreaterThan(a.y + a.height + 50);
  });

  it('is all-or-nothing on bad references and validates input', () => {
    const doc = ok(addFlow(EMPTY_DOC, { boxes: [{ title: 'A' }] }, '', center)).doc;
    const bad = addFlow(doc, { boxes: [{ key: 'x', title: 'X' }], routes: [{ from: 'x', to: 'n_nope' }] }, '', center);
    expect(bad.ok).toBe(false);
    expect(addFlow(doc, { boxes: [] }, '', center).ok).toBe(false);
    expect(addFlow(doc, { boxes: [{ title: '  ' }] }, '', center).ok).toBe(false);
    expect(addFlow(doc, { boxes: [{ key: 'k', title: '1' }, { key: 'k', title: '2' }] }, '', center).ok).toBe(false);
    expect(addFlow(doc, { boxes: [{ title: 'Y' }], after: '없는 제목' }, '', center).ok).toBe(false);
    // 기존 Box는 제목으로도 가리킬 수 있다
    const r = ok(addFlow(doc, { boxes: [{ key: 'y', title: 'Y' }], routes: [{ from: 'A', to: 'y' }] }, '', center));
    expect(Object.keys(r.doc.edges)).toHaveLength(1);
  });
});

describe('AI read / edit', () => {
  const build = () =>
    ok(
      addFlow(
        EMPTY_DOC,
        {
          boxes: [
            { key: 'a', title: '생각', note: '첫 번째 생각의 긴 메모' },
            { key: 'b', title: '행동' },
            { key: 'c', title: '결과', note: '예상과 달랐다' },
          ],
          routes: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }],
        },
        'Claude',
        center,
      ),
    ).doc;

  it('describes the board as an indented flow with notes and cycles', () => {
    const doc = build();
    const a = byTitle(doc, '생각');
    const text = describeBoard(doc, { projectName: '테스트', includeNotes: true, focusId: a.id });
    expect(text).toContain('프로젝트: 테스트');
    expect(text).toContain('Box 3개 · Route 3개');
    expect(text).toContain(`사용자가 지금 보고 있는 Box: 생각 [${a.id}]`);
    expect(text).toMatch(/- 생각 \[n_\w+\]\n {2}→ 행동 \[n_\w+\]\n {4}→ 결과 \[n_\w+\]\n {6}→ 생각 \[n_\w+\] \(위에 나옴\)/);
    expect(text).toContain('[메모]');
    expect(text).toContain('  예상과 달랐다');
    const brief = describeBoard(doc, { projectName: '테스트', includeNotes: false });
    expect(brief).toContain('(메모 있음)');
    expect(brief).not.toContain('예상과 달랐다');
    expect(describeBoard(EMPTY_DOC, { projectName: 'x' })).toContain('보드가 비어 있습니다');
  });

  it('reads, searches, updates, connects and deletes', () => {
    let doc = build();
    const [a, b, c] = ['생각', '행동', '결과'].map((t) => byTitle(doc, t));
    const read = readBox(doc, b.id);
    expect(read.ok && read.text).toContain(`← 생각 [${a.id}]`);
    expect(read.ok && read.text).toContain(`→ 결과 [${c.id}]`);

    const found = searchBoxes(doc, '예상');
    expect(found.ok && found.text).toContain(`결과 [${c.id}]`);
    expect(found.ok && found.text).toContain('메모: …예상과 달랐다');

    const up = updateBox(doc, { id: c.id, append_note: '다음엔 미리 확인' });
    if (!up.ok) throw new Error(up.error);
    doc = up.doc;
    expect(doc.nodes[c.id].note).toBe('예상과 달랐다\n다음엔 미리 확인');
    expect(updateBox(doc, { id: c.id }).ok).toBe(false);
    expect(updateBox(doc, { id: c.id, title: ' ' }).ok).toBe(false);

    const con = connectBoxes(doc, '생각', '결과');
    if (!con.ok) throw new Error(con.error);
    expect(Object.keys(con.doc.edges)).toHaveLength(4);
    const again = connectBoxes(con.doc, a.id, c.id);
    expect(again.ok && again.doc).toBe(con.doc);

    const del = deleteItems(con.doc, { box_ids: [b.id], routes: [{ from: a.id, to: c.id }] });
    if (!del.ok) throw new Error(del.error);
    expect(Object.keys(del.doc.nodes)).toHaveLength(2);
    expect(Object.keys(del.doc.edges)).toHaveLength(1); // 결과 → 생각 만 남음
    expect(deleteItems(con.doc, {}).ok).toBe(false);
  });

  it('resolves boxes by id, [id] or unique title', () => {
    const doc = build();
    const a = byTitle(doc, '생각');
    expect(resolveBox(doc, a.id)).toBe(a);
    expect(resolveBox(doc, `[${a.id}]`)).toBe(a);
    expect(resolveBox(doc, ' 생각 ')).toBe(a);
    expect('error' in resolveBox(doc, '없음')).toBe(true);
  });
});

describe('AI layout helpers', () => {
  it('estimates box size from text', () => {
    expect(estimateBoxSize('짧은 글')).toEqual({ width: 180, height: 64 });
    const long = estimateBoxSize('아주 긴 제목이 여러 줄로 넘어가는 경우에는 Box가 넓어지고 높이도 커진다');
    expect(long.width).toBe(300);
    expect(long.height).toBeGreaterThan(64);
  });

  it('places a cause box to the left of an existing child', () => {
    const existing = new Map([['x', { x: 0, y: 0, width: 180, height: 64 }]]);
    const pos = placeBoxes(existing, [{ key: 'k', width: 180, height: 64, parents: [], children: ['x'] }], center);
    expect(pos.get('k')).toEqual({ x: -180 - GAP_X, y: 0 });
  });

  it('maps MCP client names', () => {
    expect(aiDisplayName('claude-ai')).toBe('Claude');
    expect(aiDisplayName('openai-mcp')).toBe('ChatGPT');
    expect(aiDisplayName(undefined)).toBe('AI');
  });
});
