// 메모(글쓰기 칸) 안에 그림·그래프 넣기.
//  그림: 붙여 넣기 · 끌어다 놓기 · "/그림"(파일 고르기) → 메모의 그 자리에, 크기 S/M/L, 두 번 누르면 크게 보기.
//  그래프: "/그래프" → 자료를 글로 적으면 바로 막대·선·원 그래프, 표로 보기, 마우스를 올리면 값.
//  저장은 Markdown 글 (![…](assets/…), ```chart), AI도 같은 형식으로 그래프를 넣는다. Undo, 다시 열기, 자료 폴더 정리.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { assert, launch, shutdown } from './harness.mjs';

let { app, win, sandbox } = await launch([], { autoPanel: true });
const note = () => win.evaluate(() => window.__tf.getState().doc.nodes.A.note);
const past = () => win.evaluate(() => window.__tf.getState().past.length);
const pngFile = (name, w, h) =>
  win.evaluate(
    async ([name, w, h]) => {
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = c.getContext('2d');
      g.fillStyle = '#3987e5';
      g.fillRect(0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      window.__file = new File([await blob.arrayBuffer()], name, { type: 'image/png' });
    },
    [name, w, h],
  );
const loaded = () =>
  win.$$eval('[data-testid=note-image] img', (imgs) =>
    Promise.all(imgs.map((i) => (i.complete ? i.naturalWidth : new Promise((r) => (i.onload = i.onerror = () => r(i.naturalWidth)))))),
  );

try {
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, nodes: { A: { id: 'A', x: 0, y: 0, width: 180, height: 56, text: '실험 결과', note: '첫 줄' } } });
    s.setPanelWidth(560);
    s.openPage('A', { force: true });
  });
  await win.waitForSelector('.note-editor');

  // ── 그림 붙여 넣기 (메모를 쓰는 중에 Ctrl+V)
  await win.click('.note-editor');
  await win.keyboard.press('Control+End');
  await win.keyboard.press('Enter');
  await win.keyboard.type('아래는 화면 캡처');
  await pngFile('캡처.png', 320, 200);
  await win.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(window.__file);
    document.querySelector('.note-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await win.waitForSelector('[data-testid=note-image] img');
  assert((await loaded())[0] === 320, 'a pasted picture shows inside the note');
  let md = await note();
  assert(/^!\[캡처\]\(assets\/[0-9a-f]{8}-캡처\.png\)$/m.test(md), `stored as a Markdown picture line (${md.split('\n').find((l) => l.startsWith('!['))})`);
  assert(!(await win.evaluate(() => window.__tf.getState().doc.nodes.A.attachments?.length)), 'it is part of the note, not a box attachment');
  const filePath = await win.evaluate(() => window.__tf.getState().filePath);
  const assetDir = join(dirname(filePath), `${basename(filePath, '.tflow')}.assets`);
  const picFile = join(assetDir, md.match(/\(assets\/([^)]+)\)/)[1]);
  assert(existsSync(picFile), 'the picture file is copied into the project asset folder');
  await win.keyboard.type('계속 쓰기');
  assert((await note()).includes('계속 쓰기'), 'typing continues after the picture');

  // 크기 바꾸기: S → 33%
  await win.hover('[data-testid=note-image] .note-image-frame');
  await win.click('[data-testid=note-image-size-S]');
  assert((await note()).includes('"width=33%")'), 'size S is saved in the note');
  const w = await win.$eval('[data-testid=note-image] .note-image-frame', (el) => el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width);
  assert(w > 0.3 && w < 0.36, `the picture shrinks to a third (${w.toFixed(2)})`);

  // 두 번 누르면 크게 보기
  await win.dblclick('[data-testid=note-image] img');
  await win.waitForSelector('[data-testid=preview-image]');
  assert((await win.textContent('.preview-meta')).includes('메모 안의 그림'), 'double-click opens the picture large');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid=attachment-preview]', { state: 'detached' });

  // ── 끌어다 놓기: 그림은 메모 안에, 그림이 아닌 파일은 Box 첨부로
  await pngFile('놓은 그림.png', 200, 120);
  await win.evaluate(() => {
    const ed = document.querySelector('.note-editor');
    const r = ed.getBoundingClientRect();
    const dt = new DataTransfer();
    dt.items.add(window.__file);
    dt.items.add(new File(['a,b\n1,2'], 'data.csv', { type: 'text/csv' }));
    ed.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 10 }));
  });
  await win.waitForFunction(() => document.querySelectorAll('[data-testid=note-image]').length === 2);
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A.attachments?.length === 1);
  md = await note();
  assert(md.includes('](<assets/') && md.includes('놓은 그림.png>)'), 'a dropped picture goes into the note (file names with spaces are kept)');
  assert((await win.evaluate(() => window.__tf.getState().doc.nodes.A.attachments[0].name)) === 'data.csv', 'a dropped data file becomes a box attachment');

  // ── "/그림" → 파일 고르기
  const fx = join(sandbox.dir, 'fx');
  mkdirSync(fx, { recursive: true });
  await pngFile('x.png', 10, 10);
  const bytes = await win.evaluate(async () => [...new Uint8Array(await window.__file.arrayBuffer())]);
  writeFileSync(join(fx, '그래프 사진.png'), Buffer.from(bytes));
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, join(fx, '그래프 사진.png'));
  await win.click('.note-editor');
  await win.keyboard.press('Control+End');
  await win.keyboard.press('Enter');
  await win.keyboard.type('/그림');
  await win.waitForSelector('[data-testid=slash-menu]');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => document.querySelectorAll('[data-testid=note-image]').length === 3);
  assert((await note()).includes('![그래프 사진]'), '"/그림" picks a picture file and puts it in the note');

  // ── "/그래프" → 자료를 적으면 바로 그래프
  const pastBefore = await past();
  await win.click('.note-editor');
  await win.keyboard.press('Control+End');
  await win.keyboard.press('Enter');
  await win.keyboard.type('/그래프');
  await win.waitForSelector('[data-testid=slash-menu]');
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-testid=note-chart-source]');
  assert(await win.evaluate(() => document.activeElement?.dataset.testid === 'note-chart-source'), 'a new chart opens with its data box focused');
  await win.fill('[data-testid=note-chart-source]', 'type: bar\ntitle: 청크 크기별 정확도\nunit: %\n크기, 정확도\n256, 71\n512, 78\n1024, 74');
  await win.waitForFunction(() => document.querySelectorAll('[data-testid=note-chart] .chart-bar').length === 3);
  assert((await win.textContent('[data-testid=note-chart] .chart-title')) === '청크 크기별 정확도', 'the chart redraws as you type (title, 3 bars)');
  const bar = await win.$eval('[data-testid=note-chart] .chart-bar', (el) => el.getBoundingClientRect().width);
  assert(bar <= 24.5, `bars stay thin (${bar.toFixed(1)}px)`);
  await win.click('[data-testid=note-chart-edit]');
  await win.waitForSelector('[data-testid=note-chart-source]', { state: 'detached' });
  md = await note();
  assert(md.includes('```chart\ntype: bar\ntitle: 청크 크기별 정확도\nunit: %\n크기, 정확도\n256, 71\n512, 78\n1024, 74\n```'), 'the chart is saved as a ```chart block');

  // 마우스를 올리면 값, 표로 보기
  const plot = await win.locator('[data-testid=note-chart] .chart-plot svg rect[fill=transparent]').boundingBox();
  await win.mouse.move(plot.x + plot.width / 6, plot.y + plot.height / 2);
  await win.waitForSelector('[data-testid=chart-tooltip]');
  assert((await win.textContent('[data-testid=chart-tooltip]')).includes('25671'), 'hovering a bar shows its label and value');
  await win.click('[data-testid=note-chart] [data-testid=chart-table-toggle]');
  const cells = await win.$$eval('[data-testid=chart-table] td', (els) => els.map((e) => e.textContent));
  assert(JSON.stringify(cells) === '["71","78","74"]', 'table view shows the same numbers');
  await win.click('[data-testid=note-chart] [data-testid=chart-table-toggle]');

  // Undo: 그래프 자료 고친 것 → 그래프 넣은 것, 차례로
  await win.mouse.click(300, 650);
  await win.keyboard.press('Control+z');
  assert(!(await note()).includes('청크 크기별 정확도') && (await note()).includes('```chart'), 'Ctrl+Z undoes the chart data edit first');
  await win.keyboard.press('Control+z');
  assert(!(await note()).includes('```chart'), 'Ctrl+Z again removes the chart');
  await win.keyboard.press('Control+y');
  await win.keyboard.press('Control+y');
  assert((await note()).includes('청크 크기별 정확도') && (await past()) >= pastBefore + 2, 'Ctrl+Y brings it all back');

  // 그래프로 끝나는 메모도 맨 끝(Ctrl+End)에서 이어 쓰면 그래프 아래에 들어간다
  await win.click('.note-editor p');
  await win.keyboard.press('Control+End');
  await win.keyboard.type('그래프 아래 글');
  assert((await note()).endsWith('1024, 74\n```\n그래프 아래 글'), `typing at the very end goes below the last chart (${JSON.stringify((await note()).slice(-30))})`);

  // ── AI가 그래프를 넣는다 (같은 형식)
  const claude = new Client({ name: 'claude-ai', version: '1.0.0' });
  await claude.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['dist-mcp/bundle/server/index.js'],
      env: { ...process.env, THOUGHTFLOW_BRIDGE_FILE: join(sandbox.userData, 'bridge.json') },
    }),
  );
  const r = await claude.callTool({
    name: 'update_box',
    arguments: { id: 'A', append_note: '```chart\ntype: line\ntitle: 주간 지출\n주, 식비, 교통비\n1주, 32, 10\n2주, 28, 12\n3주, 35, 9\n```' },
  });
  assert(!r.isError, 'AI appends a chart block');
  await win.waitForFunction(() => document.querySelectorAll('[data-testid=note-chart]').length === 2);
  assert((await win.$$eval('[data-testid=note-chart]:nth-of-type(n) .chart-line', (els) => els.length)) === 2, 'the AI chart is drawn as a 2-series line chart with a legend');
  const instructions = (await claude.getInstructions?.()) ?? '';
  assert(!instructions || instructions.includes('```chart'), 'the AI is told how to write charts');
  await claude.close();

  // ── 다시 실행: 그림·그래프 그대로, 메모 안의 그림 파일은 정리되지 않는다
  await win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved';
  });
  const old = new Date(Date.now() - 600_000);
  for (const f of readdirSync(assetDir)) utimesSync(join(assetDir, f), old, old);
  await shutdown(app);
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A);
  await win.evaluate(() => window.__tf.getState().openPage('A', { force: true }));
  await win.waitForSelector('[data-testid=note-image] img');
  await win.waitForTimeout(500);
  const widths = await loaded();
  assert(widths.length === 3 && widths.every((x) => x > 0), `pictures load again after restart (${widths})`);
  assert(existsSync(picFile), 'pictures used in notes are kept when the asset folder is cleaned');
  assert((await win.locator('[data-testid=note-chart]').count()) === 2, 'charts are drawn again after restart');
  console.log('PHASE 25 OK');
} finally {
  await shutdown(app);
}
