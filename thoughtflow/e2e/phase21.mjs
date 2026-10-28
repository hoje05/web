// Box 첨부: 이미지(PNG/JPG/WebP)와 자료 파일(CSV, PDF …).
// 파일 고르기 / 끌어다 놓기 / 붙여 넣기 → 프로젝트 옆 "이름.assets" 폴더에 복사, 프로젝트 파일에는 경로와 정보만.
// 미리보기(이미지 크게, CSV 표), 기본 프로그램으로 열기, 빼기 + Undo, 다시 실행해도 그대로, 이름 바꾸기·정리.
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { assert, launch, shutdown } from './harness.mjs';

// ── 테스트용 파일
function png(w, h, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3).map((_, i) => rgb[i % 3])]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let { app, win, sandbox } = await launch([], { autoPanel: true });
const fx = join(sandbox.dir, 'fixtures');
const { mkdirSync } = await import('node:fs');
mkdirSync(fx, { recursive: true });
const files = {
  graph: join(fx, 'graph.png'),
  csv: join(fx, 'results.csv'),
  pdf: join(fx, 'experiment.pdf'),
  json: join(fx, 'data.json'),
};
writeFileSync(files.graph, png(320, 200, [60, 140, 220]));
writeFileSync(files.csv, 'name,score,note\n"Kim, A",91,"좋음"\nLee,78,보통\n');
writeFileSync(files.pdf, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
writeFileSync(files.json, '{"a":1,"b":[1,2,3]}');

const doc = () => win.evaluate(() => window.__tf.getState().doc);
const atts = async () => (await doc()).nodes.A.attachments ?? [];
const pickReturns = (paths) =>
  app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, paths);
const waitSaved = () =>
  win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved' && s.filePath;
  });
const loadedImages = () =>
  win.$$eval('.attach-thumb img', (imgs) => Promise.all(imgs.map((i) => (i.complete ? i : new Promise((r) => (i.onload = i.onerror = () => r(i)))))).then(() => imgs.map((i) => i.naturalWidth)));

try {
  // Box A (이름 없는 새 보드 → 첨부하는 순간 프로젝트 파일이 생긴다)
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, nodes: { A: { id: 'A', x: 0, y: 0, width: 180, height: 56, text: '실험 결과', note: '' } } });
    s.openPage('A', { force: true });
  });
  await win.waitForSelector('[data-testid=attach-add]');

  // ── Scenario 4: 파일 고르기로 PNG 추가 → 미리보기
  await pickReturns([files.graph]);
  const past0 = await win.evaluate(() => window.__tf.getState().past.length);
  await win.click('[data-testid=attach-add]');
  await win.waitForFunction(() => (window.__tf.getState().doc.nodes.A.attachments ?? []).length === 1);
  let a = (await atts())[0];
  assert(a.type === 'image' && a.name === 'graph.png' && a.mimeType === 'image/png' && a.size > 0, `image attached (${a.name}, ${a.size} B)`);
  assert(a.width === 320 && a.height === 200, `image size read from the file header (${a.width}×${a.height})`);
  assert(/^assets\/[0-9a-f]{8}-graph\.png$/.test(a.relativePath), `stored under a unique name (${a.relativePath})`);
  assert((await win.evaluate(() => window.__tf.getState().past.length)) === past0 + 1, 'adding an attachment is one undo step');
  const filePath = await win.evaluate(() => window.__tf.getState().filePath);
  const assetDir = join(dirname(filePath), basename(filePath, '.tflow') + '.assets');
  assert(existsSync(join(assetDir, a.relativePath.slice(7))), `file copied into ${basename(assetDir)}`);
  assert((await loadedImages())[0] === 320, 'thumbnail shows in the detail view');
  assert((await win.locator('[data-testid=box-images]').textContent()).trim() === '1', 'board box shows only a small image count');
  assert((await win.$$eval('[data-testid=box] img', (x) => x.length)) === 0, 'no image is drawn on the board');

  // 저장: JSON에는 경로와 정보만 (Base64 없음)
  await waitSaved();
  const saved = JSON.parse(readFileSync(filePath, 'utf-8'));
  assert(saved.version === 3 && saved.nodes[0].attachments[0].relativePath === a.relativePath, 'project file keeps relativePath + metadata');
  assert(!/base64|iVBOR/.test(readFileSync(filePath, 'utf-8')), 'no binary data inside the project JSON');

  // ── 끌어다 놓기 (경로 없는 파일 → 데이터로 복사)
  await win.evaluate(async () => {
    const page = document.querySelector('[data-testid=panel-page]');
    const c = Object.assign(document.createElement('canvas'), { width: 320, height: 200 });
    c.getContext('2d').fillRect(0, 0, 320, 200);
    const bytes = await new Promise((r) => c.toBlob((b) => r(b.arrayBuffer()), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([await bytes], 'dropped.png', { type: 'image/png' }));
    page.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    page.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A.attachments.length === 2);
  assert((await atts())[1].name === 'dropped.png' && (await atts())[1].width === 320, 'drag & drop adds an image');

  // Board 위 Box에 바로 끌어다 놓아도 그 Box에 첨부 (빈 곳에 놓으면 아무 일 없음)
  const dropOnBoard = (where) =>
    win.evaluate(async (where) => {
      const board = document.querySelector('[data-testid=board]');
      const box = document.querySelector('[data-testid=box][data-node-id=A]').getBoundingClientRect();
      const [x, y] = where === 'box' ? [box.left + box.width / 2, box.top + box.height / 2] : [box.right + 200, box.bottom + 200];
      const dt = new DataTransfer();
      dt.items.add(new File(['hello board'], `${where}.txt`, { type: 'text/plain' }));
      const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y });
      board.dispatchEvent(over);
      board.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      return over.defaultPrevented;
    }, where);
  assert((await dropOnBoard('empty')) === false, 'dropping on an empty board spot is not accepted');
  assert(await dropOnBoard('box'), 'a box on the board accepts dropped files');
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A.attachments.length === 3);
  const boardDrop = (await atts())[2];
  assert(boardDrop.name === 'box.txt' && boardDrop.type === 'file', 'file dropped on the board box is attached to it');
  await win.evaluate((id) => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, nodes: { ...s.doc.nodes, A: { ...s.doc.nodes.A, attachments: s.doc.nodes.A.attachments.filter((x) => x.id !== id) } } });
  }, boardDrop.id);

  // ── 붙여 넣기: 제목 칸에서 Ctrl+V로 이미지 → Box의 첨부 (메모 칸에 붙이면 메모 안의 그림 — phase25)
  await win.click('[data-testid=panel-title]');
  const titleBefore = await win.inputValue('[data-testid=panel-title]');
  await win.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 320, height: 200 });
    c.getContext('2d').fillRect(0, 0, 320, 200);
    const bytes = await new Promise((r) => c.toBlob((b) => r(b.arrayBuffer()), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([await bytes], 'image.png', { type: 'image/png' }));
    document.querySelector('[data-testid=panel-title]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A.attachments.length === 3);
  assert((await atts())[2].type === 'image', 'pasting an image (outside the note) attaches it');
  assert((await win.inputValue('[data-testid=panel-title]')) === titleBefore, 'the pasted image does not go into the title text');
  await win.keyboard.type(' 2차');
  assert((await win.inputValue('[data-testid=panel-title]')) === `${titleBefore} 2차`, 'typing continues after pasting');

  // ── Scenario 5: CSV와 PDF
  await pickReturns([files.csv, files.pdf, files.json]);
  await win.click('[data-testid=attach-add]');
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A.attachments.length === 6);
  const kinds = (await atts()).map((x) => `${x.type}:${x.mimeType}`);
  assert(kinds.slice(3).join() === 'file:text/csv,file:application/pdf,file:application/json', `data files attached (${kinds.slice(3).join(', ')})`);
  assert((await win.locator('[data-testid=attachment][data-type=file]').count()) === 3, 'attachment list shows the files');
  assert((await win.locator('[data-testid=box-files]').textContent()).trim() === '3', 'board shows a file count');

  // CSV → 표로 미리보기
  await win.click('[data-testid=attachment][data-type=file]:has-text("results.csv") .attach-file-open');
  await win.waitForSelector('[data-testid=preview-table]');
  const cells = await win.$$eval('[data-testid=preview-table] tr', (rows) => rows.map((r) => [...r.children].map((c) => c.textContent)));
  assert(JSON.stringify(cells) === JSON.stringify([['name', 'score', 'note'], ['Kim, A', '91', '좋음'], ['Lee', '78', '보통']]), 'CSV preview as a table');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid=attachment-preview]', { state: 'detached' });
  // JSON → 보기 좋게
  await win.click('[data-testid=attachment][data-type=file]:has-text("data.json") .attach-file-open');
  await win.waitForSelector('[data-testid=preview-pre]');
  assert((await win.locator('[data-testid=preview-pre]').textContent()).includes('"b": [\n    1,'), 'JSON preview is pretty-printed');
  await win.keyboard.press('Escape');

  // PDF → 이 PC의 기본 프로그램으로
  await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openPath = async (p) => (globalThis.__opened.push(p), '');
  });
  await win.click('[data-testid=attachment][data-type=file]:has-text("experiment.pdf") .attach-file-open');
  await win.waitForTimeout(300);
  const opened = await app.evaluate(() => globalThis.__opened);
  const pdf = (await atts()).find((x) => x.name === 'experiment.pdf');
  assert(opened.length === 1 && opened[0] === join(assetDir, pdf.relativePath.slice(7)), 'PDF opens with the default program (the copy in the asset folder)');

  // ── 이미지 크게 보기: ← → 로 다음 이미지, Esc로 닫기
  await win.click('.attach-thumb-open >> nth=0');
  await win.waitForSelector('[data-testid=preview-image]');
  const big = () => win.$eval('[data-testid=preview-image]', (i) => (i.complete ? i.naturalWidth : new Promise((r) => (i.onload = () => r(i.naturalWidth)))));
  assert((await big()) === 320, 'lightbox shows the full image');
  await win.keyboard.press('ArrowRight');
  assert((await win.locator('.preview-name').textContent()) === 'dropped.png', 'arrow key moves to the next image');
  await win.evaluate(() => window.__tf.getState().select({ kind: 'node', id: 'A' }));
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid=attachment-preview]', { state: 'detached' });
  const after = await win.evaluate(() => ({ sel: window.__tf.getState().selection?.id, panel: window.__tf.getState().panelOpen }));
  assert(after.sel === 'A' && after.panel, 'Esc only closes the preview (selection and panel stay)');

  // ── 빼기 + Undo/Redo
  const csv = (await atts()).find((x) => x.name === 'results.csv');
  await win.click('[data-testid=attachment][data-type=file]:has-text("results.csv") [data-testid=attachment-remove]');
  assert(!(await atts()).some((x) => x.id === csv.id), 'removing takes it off the box');
  const csvFile = join(assetDir, csv.relativePath.slice(7));
  assert(existsSync(csvFile), '…the file stays for undo');
  await win.mouse.click(300, 400); // Board 빈 곳 (입력칸 밖)
  await win.keyboard.press('Control+z');
  assert((await atts()).some((x) => x.id === csv.id), 'Ctrl+Z brings the attachment back');
  await win.keyboard.press('Control+y');
  assert(!(await atts()).some((x) => x.id === csv.id), 'Ctrl+Y removes it again');
  await waitSaved();

  // ── 다시 실행: 이미지·파일 그대로. 어디에서도 쓰지 않는 파일(뺀 CSV)은 열 때 정리된다.
  const before = (await atts()).map((x) => x.relativePath);
  utimesSync(csvFile, new Date(Date.now() - 600_000), new Date(Date.now() - 600_000));
  await shutdown(app);
  ({ app, win } = await launch([], { sandbox, autoPanel: true }));
  await win.waitForFunction(() => window.__tf.getState().doc.nodes.A);
  assert(JSON.stringify((await atts()).map((x) => x.relativePath)) === JSON.stringify(before), 'attachments restored after restart');
  await win.evaluate(() => window.__tf.getState().openPage('A', { force: true }));
  await win.waitForSelector('.attach-thumb img');
  const widths = await loadedImages();
  assert(widths.length === 3 && widths.every((w) => w === 320), `images load again after restart (${widths})`);
  await win.waitForTimeout(500);
  assert(!existsSync(csvFile), 'the removed attachment file was cleaned up on open');
  const left = readdirSync(assetDir);
  assert(before.every((r) => left.includes(r.slice(7))), 'files still in use are kept');
  assert(left.some((n) => n.endsWith('-box.txt')), 'a file added less than a minute ago is never cleaned up');

  // ── 프로젝트 이름 바꾸기: 자료 폴더도 함께
  await win.evaluate(() => window.__tf.getState().setDrawer(true));
  await win.waitForSelector('li.is-current [data-testid=project-rename]');
  await win.click('li.is-current [data-testid=project-rename]');
  await win.fill('[data-testid=project-name-input]', '실험 노트');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => window.__tf.getState().filePath?.endsWith('실험 노트.tflow'));
  const newDir = join(dirname(filePath), '실험 노트.assets');
  assert(existsSync(newDir) && !existsSync(assetDir), 'renaming the project renames its asset folder');
  await win.evaluate(() => window.__tf.getState().setDrawer(false));
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.closePanel();
    s.openPage('A', { force: true });
  });
  await win.waitForSelector('.attach-thumb img');
  assert((await loadedImages()).every((w) => w === 320), 'images still show after renaming');

  // ── 다른 이름으로 저장: 자료 폴더도 새 위치로 복사 (원래 것은 그대로)
  const copyPath = join(dirname(filePath), '사본.tflow');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, copyPath);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu-command', 'saveAs'));
  await win.waitForFunction((p) => window.__tf.getState().filePath === p, copyPath);
  const copyDir = join(dirname(filePath), '사본.assets');
  assert(existsSync(copyDir) && readdirSync(newDir).every((n) => existsSync(join(copyDir, n))), 'Save As copies the asset folder');
  assert(readdirSync(newDir).length > 0, '…and keeps the original');
  await win.waitForSelector('.attach-thumb img');
  assert((await loadedImages()).every((w) => w === 320), 'images show in the saved copy');
  console.log('PHASE 21 OK');
} finally {
  await shutdown(app);
}
