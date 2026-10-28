// 빠른 시작: 창은 바로 보이고, 화면은 app://thoughtflow/ (V8 코드 캐시), 메모 편집기는 따로 불러오고,
// 마지막 보드(오른쪽 창 열림)는 그대로 열리며 편집기도 뜬다. 편집기가 뜨기 전의 포커스 요청도 적용된다. 맞춤법 검사는 꺼져 있다.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, launch, shutdown } from './harness.mjs';

let { app, win, sandbox } = await launch([], { autoPanel: true });
try {
  assert(win.url() === 'app://thoughtflow/index.html', `the screen is served from app://thoughtflow/ (${win.url()})`);
  const main = await app.evaluate(({ BrowserWindow, session }) => ({
    visible: BrowserWindow.getAllWindows()[0].isVisible(),
    spell: session.defaultSession.isSpellCheckerEnabled(),
    times: globalThis.__tfStartup,
  }));
  assert(main.visible, 'the window is visible');
  assert(main.times.window <= main.times.loaded, `the window is shown before the screen finishes loading (${JSON.stringify(main.times)})`);
  assert(main.spell === false, 'spell checking is off (no dictionary download)');
  // 메모 편집기는 처음 불러오는 화면 코드와 따로 (보드를 먼저 그린다)
  const assets = readdirSync('dist/assets');
  const entry = assets.find((f) => /^index-.*\.js$/.test(f));
  const editorChunk = assets.find((f) => /^NoteEditor-.*\.js$/.test(f));
  const entrySize = readFileSync(join('dist/assets', entry)).length;
  assert(editorChunk && !readFileSync('dist/index.html', 'utf-8').includes(editorChunk), 'the note editor is a separate file, not loaded by the page itself');
  assert(entrySize < 500_000, `the code loaded at start stays small (${Math.round(entrySize / 1024)}KB)`);

  // 오른쪽 창을 연 채로 메모를 쓰고 끈다
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, nodes: { A: { id: 'A', x: 0, y: 0, width: 180, height: 56, text: '빠른 시작', note: '# 제목\n메모 내용' } } });
    s.openPage('A', { force: true });
  });
  await win.waitForSelector('.note-editor h1');
  await win.waitForFunction(() => window.__tf.getState().saveState === 'saved' && window.__tf.getState().filePath);
  await shutdown(app);

  // 다시 켜면 보드와 오른쪽 창, 메모 편집기가 그대로
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  // 켜지자마자 메모로 포커스를 요청한다 (편집기가 아직 안 떴을 수도 있다)
  await win.evaluate(() => window.__tf.getState().openPage('A', { force: true, focus: 'note' }));
  await win.waitForSelector('.note-editor h1');
  assert((await win.textContent('.note-editor')).includes('메모 내용'), 'the last board reopens with its note in the editor');
  await win.waitForFunction(() => document.activeElement?.dataset?.testid === 'panel-note', null, { timeout: 5000 }).catch(() => undefined);
  assert(await win.evaluate(() => document.activeElement?.dataset?.testid === 'panel-note'), 'a focus request made while the editor was loading lands in the note');
  const marks = await win.evaluate(() => Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)])));
  assert(marks['tf:js'] < marks['tf:board'] && marks['tf:editor'] > 0, `startup marks in order (${JSON.stringify(marks)})`);

  // 두 번째 실행부터는 화면 코드를 해석한 결과(V8 코드 캐시)를 쓴다
  const jsCache = join(sandbox.userData, 'Code Cache', 'js');
  const cached = existsSync(jsCache)
    ? readdirSync(jsCache).filter((f) => /_0$/.test(f) && readFileSync(join(jsCache, f)).includes('app://thoughtflow/assets/'))
    : [];
  assert(cached.length >= 2, `compiled screen code is cached for the next start (${cached.length} entries)`);
  console.log('PHASE 26 OK');
} finally {
  await shutdown(app);
}
