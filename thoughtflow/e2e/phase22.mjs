// Box 태그: 만들기 → 붙이기 → 저장된 태그로 다시 쓰기(자동 완성) → Box에서 떼기 → 저장된 태그 지우기(보관) → 같은 이름으로 되살리기.
// Board에는 몇 개만(+N), 오른쪽 창에는 전부. 모두 Undo 가능, 저장·다시 열기에도 그대로. 예전 프로젝트도 그대로 열린다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, launch, shutdown } from './harness.mjs';

let { app, win, sandbox } = await launch([], { autoPanel: true });
const doc = () => win.evaluate(() => window.__tf.getState().doc);
const past = () => win.evaluate(() => window.__tf.getState().past.length);
const open = (id) =>
  win.evaluate((id) => {
    const s = window.__tf.getState();
    s.select({ kind: 'node', id });
    s.openPage(id, { force: true });
  }, id);
const chips = () => win.$$eval('[data-testid=tag-chip] .tag-chip-name', (els) => els.map((e) => e.textContent));
const suggestions = () => win.$$eval('[data-testid=tag-option]', (els) => els.map((e) => e.textContent));
const typeTag = async (text) => {
  if (!(await win.isVisible('[data-testid=tag-input]'))) await win.click('[data-testid=tag-add]');
  await win.fill('[data-testid=tag-input]', text);
};
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved' && s.filePath;
  });

try {
  await win.evaluate(() => {
    const s = window.__tf.getState();
    const box = (id, x, text) => ({ id, x, y: 0, width: 180, height: 56, text, note: '' });
    s.commit({ ...s.doc, nodes: { A: box('A', 0, 'AI 프로젝트'), B: box('B', 260, 'RAG 다시 설계'), C: box('C', 520, '데이터 모으기'), D: box('D', 780, '새 생각') } });
  });

  // ── Scenario 6: Box A에 새 태그 "AI" → 붙고, 저장된 태그에도
  await open('A');
  let p0 = await past();
  await typeTag('AI');
  await win.keyboard.press('Enter');
  let d = await doc();
  const ai = Object.values(d.tags).find((t) => t.name === 'AI');
  assert(ai && ai.active && ai.normalizedName === 'ai', 'new tag "AI" saved in the registry');
  assert(JSON.stringify(d.nodes.A.tagIds) === JSON.stringify([ai.id]) && JSON.stringify(await chips()) === '["AI"]', 'and applied to box A');
  assert((await past()) === p0 + 1, 'creating + applying is one undo step');
  assert(await win.isVisible('[data-testid=tag-input]'), 'the tag input stays open for the next tag');
  for (const name of ['Project', 'Important', 'Research']) {
    await win.fill('[data-testid=tag-input]', name);
    await win.keyboard.press('Enter');
  }
  assert(JSON.stringify(await chips()) === '["AI","Project","Important","Research"]', 'detail view shows every tag of the box');
  // Board: 앞의 두 개 + "+2"
  const boardTags = await win.$$eval('[data-node-id=A] .box-tag', (els) => els.map((e) => e.textContent));
  assert(JSON.stringify(boardTags) === '["AI","Project","+2"]', `board box shows a few chips + "+N" (${boardTags})`);
  await win.keyboard.press('Escape');
  assert(!(await win.isVisible('[data-testid=tag-input]')), 'Esc closes the tag input');

  // 같은 이름(대소문자·공백만 다른)을 넣으면 새로 만들지 않는다
  await typeTag('  ai ');
  await win.keyboard.press('Enter');
  d = await doc();
  assert(Object.values(d.tags).filter((t) => t.normalizedName === 'ai').length === 1 && d.nodes.A.tagIds.length === 4, '"ai" does not create a duplicate of "AI"');

  // ── Scenario 7: Box B에서 "a" 입력 → 저장된 "AI" 추천 → 클릭하면 붙는다
  await open('B');
  await typeTag('a');
  const sug = await suggestions();
  assert(sug[0] === 'AI', `typing "a" suggests AI first (prefix match) (${sug.join(' | ')})`);
  assert(JSON.stringify(sug) === JSON.stringify(['AI', 'Important', 'Research', '새 태그a']), 'case-insensitive: prefix match first, then names that include it, then "new tag"');
  await win.click('[data-testid=tag-option]:has-text("AI")');
  d = await doc();
  assert(JSON.stringify(d.nodes.B.tagIds) === JSON.stringify([ai.id]), 'clicking the suggestion applies the same AI tag to box B');
  assert(Object.keys(d.tags).length === 4, 'no new tag was created');
  // 빈 입력에서도 저장된 태그 목록이 보이고, 이미 붙은 태그는 빠진다
  await win.fill('[data-testid=tag-input]', '');
  const all = await suggestions();
  assert(JSON.stringify(all) === JSON.stringify(['Research', 'Important', 'Project']), `empty input lists saved tags, newest first, except ones already on the box (${all})`);
  assert(await win.isVisible('.tag-manage-link'), 'the list links to the tag manager');
  // 화살표로 고르고 Enter
  await win.fill('[data-testid=tag-input]', 'pro');
  await win.keyboard.press('ArrowDown');
  await win.keyboard.press('Enter');
  assert(JSON.stringify(await chips()) === '["AI","Project"]', 'arrow keys + Enter pick a suggestion');
  await win.keyboard.press('Escape');

  // ── Scenario 8: Box B에서 AI 떼기 → B에서만 사라지고, 저장된 태그는 그대로 → C에서 다시 쓸 수 있다
  p0 = await past();
  await win.click('[data-testid=tag-chip]:has-text("AI") .tag-chip-remove');
  d = await doc();
  assert(JSON.stringify(d.nodes.B.tagIds) !== undefined && !d.nodes.B.tagIds.includes(ai.id), 'AI removed from box B');
  assert(d.tags[ai.id].active && d.nodes.A.tagIds.includes(ai.id), 'saved AI tag and box A keep it');
  assert((await past()) === p0 + 1, 'removing a tag is one undo step');
  await open('C');
  await typeTag('A');
  assert((await suggestions())[0] === 'AI', 'box C can still use AI');
  await win.keyboard.press('Escape');

  // ── Scenario 9: 저장된 태그 관리에서 AI 지우기 → A에는 남고, 추천에서는 사라진다
  await win.click('[data-testid=tag-add]');
  await win.fill('[data-testid=tag-input]', '');
  await win.click('.tag-manage-link');
  await win.waitForSelector('[data-testid=tag-manager]');
  const rows = await win.$$eval('[data-testid=saved-tag]', (els) => els.map((e) => e.textContent));
  assert(rows.some((r) => r.startsWith('AIBox 1개')), `tag manager lists saved tags with usage (${rows.join(' | ')})`);
  p0 = await past();
  await win.click(`[data-testid=saved-tag][data-tag-id="${ai.id}"] [data-testid=saved-tag-delete]`);
  d = await doc();
  assert(d.tags[ai.id].active === false, 'deleting a saved tag archives it (active=false)');
  assert(d.nodes.A.tagIds.includes(ai.id), 'box A keeps its AI tag');
  assert((await win.locator('[data-testid=archived-tag]').count()) === 1, 'archived tag listed separately');
  assert((await past()) === p0 + 1, 'archiving is one undo step');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid=tag-manager]', { state: 'detached' });
  await open('D');
  await typeTag('a');
  const after = await suggestions();
  assert(!after.includes('AI'), `AI no longer suggested for a new box (${after.join(' | ')})`);
  assert(after.some((x) => x.includes('지운 태그 다시 쓰기')) === false, 'a partial name does not offer the archived tag');
  await open('A');
  assert((await chips()).includes('AI') && (await win.$$eval('.tag-chip.is-archived', (e) => e.length)) === 1, 'box A still shows AI (marked as archived)');

  // ── Scenario 10: 다시 "AI"를 쓰면 보관된 태그가 되살아난다 (id 그대로)
  await open('D');
  await typeTag('AI');
  assert((await suggestions()).some((x) => x.includes('지운 태그 다시 쓰기')), 'typing the full name offers to revive the archived tag');
  await win.keyboard.press('Enter');
  d = await doc();
  assert(d.tags[ai.id].active && JSON.stringify(d.nodes.D.tagIds) === JSON.stringify([ai.id]), 'archived AI revived and applied (same id)');
  assert(Object.values(d.tags).filter((t) => t.normalizedName === 'ai').length === 1, 'still exactly one AI tag');
  await win.keyboard.press('Escape');

  // ── Undo / Redo: 되살리기 → 보관 → …
  await win.mouse.click(300, 600);
  await win.keyboard.press('Control+z');
  d = await doc();
  assert(d.tags[ai.id].active === false && !d.nodes.D.tagIds, 'Ctrl+Z undoes the revive');
  await win.keyboard.press('Control+z');
  assert((await doc()).tags[ai.id].active === true, 'Ctrl+Z again undoes the archive');
  await win.keyboard.press('Control+y');
  await win.keyboard.press('Control+y');
  d = await doc();
  assert(d.tags[ai.id].active && JSON.stringify(d.nodes.D.tagIds) === JSON.stringify([ai.id]), 'Ctrl+Y redoes both');

  // ── 저장 → 다시 실행해도 그대로
  await waitSaved();
  const filePath = await win.evaluate(() => window.__tf.getState().filePath);
  const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
  assert(saved.tags.length === 4 && saved.nodes.find((n) => n.id === 'A').tagIds.length === 4, 'tags and tagIds are saved');
  const beforeDoc = await doc();
  await shutdown(app);
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A);
  const reopened = await doc();
  assert(JSON.stringify(reopened.tags) === JSON.stringify(beforeDoc.tags), 'saved tags restored after restart');
  assert(['A', 'B', 'C', 'D'].every((id) => JSON.stringify(reopened.nodes[id].tagIds) === JSON.stringify(beforeDoc.nodes[id].tagIds)), 'box tags restored');

  // ── Box를 지워도 저장된 태그는 남는다 / Ctrl+F 검색은 그대로
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.select({ kind: 'node', id: 'D' });
    s.deleteSelection();
  });
  assert(Object.keys((await doc()).tags).length === 4, 'deleting a box keeps the saved tags');

  // ── Scenario 16: 태그·첨부가 생기기 전(v2)에 저장한 프로젝트도 그대로 열린다
  const legacyDir = join(sandbox.dir, 'legacy');
  mkdirSync(legacyDir, { recursive: true });
  const legacy = join(legacyDir, '예전 프로젝트.tflow');
  writeFileSync(
    legacy,
    JSON.stringify({
      format: 'thoughtflow',
      version: 2,
      savedAt: '2026-09-01T00:00:00.000Z',
      board: { zoom: 1, panX: 300, panY: 200 },
      nodes: [
        { id: 'x', x: 0, y: 0, width: 180, height: 64, text: '예전 생각', note: '메모' },
        { id: 'y', x: 300, y: 0, width: 180, height: 64, text: '이어진 생각', note: '' },
      ],
      edges: [{ id: 'e', sourceNodeId: 'x', targetNodeId: 'y', sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' }, pathPoints: [], pathMode: 'auto' }],
    }),
  );
  // Windows에서 파일을 더블클릭한 것처럼 (이미 실행 중인 앱으로 전달)
  await app.evaluate(({ app }, p) => app.emit('second-instance', {}, ['ThoughtFlow.exe', p]), legacy);
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.x);
  d = await doc();
  assert(d.nodes.x.text === '예전 생각' && Object.keys(d.edges).length === 1, 'legacy (v2) project opens without errors');
  assert(JSON.stringify(d.tags) === '{}' && !d.nodes.x.tagIds && !d.nodes.x.attachments, 'missing tags/attachments default to empty');
  await open('x');
  await typeTag('예전');
  await win.keyboard.press('Enter');
  await waitSaved();
  const upgraded = JSON.parse(readFileSync(legacy, 'utf-8'));
  assert(upgraded.version === 3 && upgraded.tags[0].name === '예전' && upgraded.nodes[0].tagIds.length === 1, 'saving upgrades it to v3');
  console.log('PHASE 22 OK');
} finally {
  await shutdown(app);
}
