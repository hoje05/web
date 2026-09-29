// 메모 편집기 (Notion식 1단계): 바로 입력(# - [] 1. >), "/" 메뉴, 글자 꾸미기·서식 막대, 체크박스,
// 메모는 Markdown 글자로 저장, 기존 단축키는 편집기 안에서도 전과 같다 (겹치는 편집기 단축키 없음).
import { readFileSync } from 'node:fs';
import { assert, launch, shutdown } from './harness.mjs';

let { app, win, sandbox } = await launch([], { autoPanel: true });
const EDITOR = '[data-testid=panel-note]';
const note = () =>
  win.evaluate(() => {
    const s = window.__tf.getState();
    return s.doc.nodes[s.activeTab]?.note;
  });
const focused = () => win.evaluate(() => document.activeElement?.dataset?.testid === 'panel-note');
const count = (sel) => win.$$eval(sel, (els) => els.length);
const press = async (...keys) => {
  for (const k of keys) await win.keyboard.press(k);
};
const typeLine = async (text) => {
  await win.keyboard.type(text);
  await win.keyboard.press('Enter');
};
const toEnd = () =>
  win.evaluate(() => {
    const el = document.querySelector('[data-testid=panel-note]');
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el.lastElementChild ?? el);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });

try {
  // Box를 만들고 오른쪽 창의 메모 칸으로
  await win.mouse.dblclick(420, 330);
  await win.keyboard.type('여행 준비');
  await win.keyboard.press('Escape');
  await win.mouse.click(420, 330);
  await win.waitForSelector(EDITOR);
  assert((await win.getAttribute(`${EDITOR} p`, 'data-placeholder'))?.includes("'/'"), 'empty note tells how to open the "/" menu');
  await win.click(EDITOR);

  // ── 1) 바로 입력: # 제목, - 목록, [] 할 일, 1. 번호, > 인용
  await typeLine('# 준비물');
  await typeLine('- 여권');
  await typeLine('충전기');
  await win.keyboard.press('Enter'); // 빈 항목에서 Enter → 목록 끝
  await typeLine('[] 환전하기');
  await typeLine('휴가 신청');
  await win.keyboard.press('Enter');
  await typeLine('1. 표 사기');
  await typeLine('숙소 예약');
  await win.keyboard.press('Enter');
  await typeLine('> 가장 싼 날은 화요일');
  await win.keyboard.press('Enter');
  const md1 = '# 준비물\n- 여권\n- 충전기\n- [ ] 환전하기\n- [ ] 휴가 신청\n1. 표 사기\n2. 숙소 예약\n> 가장 싼 날은 화요일\n';
  assert((await note()) === md1, 'markdown shortcuts make heading, bullet, to-do, numbered list and quote (saved as Markdown)');
  assert(
    (await count(`${EDITOR} h1`)) === 1 &&
      (await count(`${EDITOR} ul:not([data-type]) > li`)) === 2 &&
      (await count(`${EDITOR} input[type=checkbox]`)) === 2 &&
      (await count(`${EDITOR} ol > li`)) === 2 &&
      (await count(`${EDITOR} blockquote`)) === 1,
    'blocks look like blocks',
  );

  // ── 2) 체크박스
  await win.click(`${EDITOR} ul[data-type=taskList] input`);
  assert((await note()).includes('- [x] 환전하기') && (await count(`${EDITOR} li[data-checked=true]`)) === 1, 'clicking a checkbox checks the to-do');

  // ── 3) "/" 메뉴
  await toEnd();
  await win.keyboard.type('/');
  await win.waitForSelector('[data-testid=slash-menu]');
  assert((await count('[data-testid=slash-item]')) === 10, '"/" opens the block menu (10 kinds)');
  await win.screenshot({ path: 'e2e/out/phase18-slash.png' });
  await win.keyboard.type('할');
  const filtered = await win.$$eval('[data-testid=slash-item]', (els) => els.map((e) => e.querySelector('.slash-label').textContent));
  assert(filtered.join() === '할 일 목록', `typing filters the menu (${filtered.join(', ')})`);
  await win.keyboard.press('Enter');
  await win.keyboard.type('짐 싸기');
  assert((await note()).endsWith('\n- [ ] 짐 싸기') && !(await win.isVisible('[data-testid=slash-menu]')), 'Enter picks the block; "/할" is removed');
  await press('Enter', 'Enter');

  await win.keyboard.type('/');
  await press('ArrowDown', 'ArrowDown');
  assert((await win.textContent('[data-testid=slash-item].is-active .slash-label')) === '제목 2', 'arrow keys move in the menu');
  await win.keyboard.press('Enter');
  await typeLine('메모');
  assert((await win.textContent(`${EDITOR} h2`)) === '메모', 'heading 2 from the menu');

  await win.keyboard.type('/');
  await win.click('[data-testid=slash-item]:has-text("구분선")');
  assert((await count(`${EDITOR} hr`)) === 1 && (await focused()), 'clicking a menu item works and keeps the cursor in the note');

  // Esc: 메뉴만 닫고 메모 칸에 남는다 → 한 번 더 Esc = 전처럼 메모 칸에서 나가기
  await toEnd();
  await win.keyboard.type('/');
  await win.waitForSelector('[data-testid=slash-menu]');
  await win.keyboard.press('Escape');
  assert(!(await win.isVisible('[data-testid=slash-menu]')) && (await focused()), 'Esc closes only the menu');
  await win.keyboard.press('Backspace');
  await win.keyboard.press('Escape');
  assert(!(await focused()), 'Esc again leaves the note (as before)');

  // ── 4) 글자 꾸미기: **바로 입력**, Ctrl+B, 서식 막대
  await toEnd();
  await win.keyboard.type('**굵게** 그리고 ');
  await win.keyboard.press('Control+b');
  await win.keyboard.type('진하게');
  await win.keyboard.press('Control+b');
  await win.keyboard.type(' 끝 취소');
  await press('Shift+ArrowLeft', 'Shift+ArrowLeft');
  await win.waitForSelector('[data-testid=format-bar]');
  await win.click('[data-testid=format-strike]');
  assert((await note()).endsWith('**굵게** 그리고 **진하게** 끝 ~~취소~~'), 'bold by **…** and Ctrl+B, strike from the format bar');
  assert(
    (await count(`${EDITOR} strong`)) === 2 &&
      (await win.$eval(`${EDITOR} s`, (e) => getComputedStyle(e).textDecorationLine)) === 'line-through',
    'formatting is shown',
  );
  await win.screenshot({ path: 'e2e/out/phase18-format.png' });

  // ── 5) 기존 단축키는 편집기 안에서도 전과 같다
  await app.evaluate(({ dialog }) => {
    globalThis.__saveAs = 0;
    dialog.showSaveDialog = async () => {
      globalThis.__saveAs++;
      return { canceled: true };
    };
  });
  await press('Shift+ArrowLeft', 'Shift+ArrowLeft');
  const before = await note();
  await win.keyboard.press('Control+Shift+s');
  await win.waitForFunction(() => true);
  await win.waitForTimeout(200);
  assert((await app.evaluate(() => globalThis.__saveAs)) === 1 && (await note()) === before, 'Ctrl+Shift+S is still "save as" (no strike shortcut)');

  await win.keyboard.press('Control+=');
  const zoomed = await win.evaluate(() => window.__tf.getState().viewport.zoom);
  await win.click(`${EDITOR} h2`);
  await win.keyboard.press('Control+Alt+0');
  assert(zoomed > 1 && (await win.evaluate(() => window.__tf.getState().viewport.zoom)) === 1, 'Ctrl+= / Ctrl+0 still zoom while writing');
  assert((await count(`${EDITOR} h2`)) === 1, 'Ctrl+Alt+0 does not turn the heading into text (would clash with Ctrl+0)');

  await win.click(`${EDITOR} ul:not([data-type]) > li:last-child p`);
  await win.keyboard.press('End');
  const beforeTab = await note();
  await win.keyboard.press('Tab');
  assert((await count(`${EDITOR} li ul`)) === 0 && (await note()) === beforeTab, 'Tab does not indent list items');

  await toEnd();
  const boxes = await win.evaluate(() => Object.keys(window.__tf.getState().doc.nodes).length);
  const beforeUndo = await note();
  await win.keyboard.type('지울 글');
  await win.keyboard.press('Control+z');
  assert(
    (await note()) === beforeUndo && (await win.evaluate(() => Object.keys(window.__tf.getState().doc.nodes).length)) === boxes,
    'Ctrl+Z while writing undoes the typing (as before)',
  );

  await win.keyboard.press('Control+f');
  assert(await win.isVisible('[data-testid=search-input]'), 'Ctrl+F still opens search from the note');
  await win.keyboard.press('Escape');

  // ── 6) 붙여넣기(Markdown → 블록), 복사(블록 → Markdown)
  await toEnd();
  await win.keyboard.press('Enter');
  await win.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', '- 붙인 하나\n- [ ] 붙인 할 일');
    document.querySelector('[data-testid=panel-note]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert((await note()).endsWith('~~취소~~\n- 붙인 하나\n- [ ] 붙인 할 일'), 'pasted Markdown becomes a list and a to-do');
  await win.keyboard.press('Control+a');
  const copied = await win.evaluate(() => {
    const el = document.querySelector('[data-testid=panel-note]');
    const dt = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    return dt.getData('text/plain');
  });
  assert(copied.startsWith('# 준비물\n- 여권') && copied.includes('- [x] 환전하기'), 'copying gives Markdown');
  await win.keyboard.press('Escape');

  // ── 7) AI·되돌리기로 바깥에서 바뀐 메모도 바로 보인다
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.setNoteLive(s.activeTab, `${s.doc.nodes[s.activeTab].note}\n- [ ] AI가 추가한 일`);
  });
  assert((await win.textContent(`${EDITOR}`)).includes('AI가 추가한 일') && (await count(`${EDITOR} input[type=checkbox]`)) === 5, 'note changed from outside shows up as blocks');

  // ── 8) 파일에는 Markdown 글자, 다시 열어도 같은 모양
  await waitSaved();
  const file = await win.evaluate(() => window.__tf.getState().filePath);
  const saved = JSON.parse(readFileSync(file, 'utf-8')).nodes.find((n) => n.text === '여행 준비').note;
  assert(saved.startsWith('# 준비물\n- 여권\n- 충전기\n- [x] 환전하기') && saved.includes('## 메모\n---'), 'the file keeps the note as Markdown text');
  await win.screenshot({ path: 'e2e/out/phase18-editor.png' });

  await shutdown(app);
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  await win.waitForFunction(() => Object.keys(window.__tf.getState().doc.nodes).length === 1);
  const id = await win.evaluate(() => Object.keys(window.__tf.getState().doc.nodes)[0]);
  await win.evaluate((nid) => window.__tf.getState().openPage(nid, { force: true }), id);
  await win.waitForSelector(`${EDITOR} h1`);
  assert(
    (await count(`${EDITOR} li[data-checked=true]`)) === 1 && (await count(`${EDITOR} h2`)) === 1 && (await count(`${EDITOR} strong`)) === 2,
    'reopened note shows the same blocks',
  );
  assert((await note()) === saved, 'opening a note does not change it');
  await win.screenshot({ path: 'e2e/out/phase18-reopened.png' });

  // ── 9) 한글 입력(IME 조합): 빈 줄 안내 글, "/" 메뉴 거르기, 목록 안에서도 글자가 깨지지 않는다
  const cdp = await win.context().newCDPSession(win);
  const compose = async (steps) => {
    for (const t of steps) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
    await cdp.send('Input.insertText', { text: steps[steps.length - 1] });
  };
  await toEnd();
  await press('Enter', 'Enter'); // 마지막 할 일 목록에서 빠져나와 빈 줄로
  await compose(['ㅎ', '하', '한']);
  await compose(['ㄱ', '그', '글']);
  await win.keyboard.press('Enter');
  await win.keyboard.type('/');
  await compose(['ㅎ', '하', '할']);
  const imeMenu = await win.$$eval('[data-testid=slash-item] .slash-label', (els) => els.map((e) => e.textContent));
  await win.keyboard.press('Enter');
  await compose(['ㅈ', '지', '짐']);
  assert(imeMenu.join() === '할 일 목록' && (await note()).endsWith('\n한글\n- [ ] 짐'), 'Korean IME input works on empty lines, in the "/" menu and in lists');
  console.log('PHASE 18 OK');
} finally {
  await shutdown(app);
}
