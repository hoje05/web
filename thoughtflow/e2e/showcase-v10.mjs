// v0.10 문서용 화면: 메모 안의 그림과 그래프 (검증용 데모, run-all에는 없음)
// 결과: e2e/out/showcase-note-media.png
import { launch, shutdown } from './harness.mjs';

const { app, win } = await launch([], { autoPanel: true });
try {
  await win.evaluate(() => {
    const s = window.__tf.getState();
    const box = (id, x, y, text) => ({ id, x, y, width: 180, height: 56, text, note: '' });
    const route = (id, a, b) => ({ id, sourceNodeId: a, targetNodeId: b, sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' }, pathPoints: [], pathMode: 'auto' });
    s.commit({
      ...s.doc,
      nodes: {
        a: box('a', -520, -40, '답변이 자꾸 틀린다'),
        b: box('b', -240, -40, 'RAG 구조 다시 설계'),
        c: { ...box('c', 40, -40, '청크 크기 실험'), note: '## 실험 결과' },
        d: box('d', 320, -40, '512로 정함'),
      },
      edges: { r1: route('r1', 'a', 'b'), r2: route('r2', 'b', 'c'), r3: route('r3', 'c', 'd') },
    });
    s.setPanelWidth(620);
    s.select({ kind: 'node', id: 'c' });
    s.openPage('c', { force: true });
    s.fitView();
  });
  await win.waitForSelector('.note-editor');

  // 실험 화면 캡처를 붙여 넣은 것처럼
  await win.click('.note-editor');
  await win.keyboard.press('Control+End');
  await win.keyboard.press('Enter');
  await win.keyboard.type('청크 크기를 바꿔 가며 같은 질문 50개로 비교했다.');
  await win.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 960, height: 400 });
    const g = c.getContext('2d');
    g.fillStyle = '#1f2430';
    g.fillRect(0, 0, 960, 400);
    g.fillStyle = '#2d3445';
    g.fillRect(0, 0, 960, 48);
    g.fillStyle = '#e66767';
    g.beginPath();
    g.arc(30, 24, 7, 0, 7);
    g.fill();
    g.fillStyle = '#c98500';
    g.beginPath();
    g.arc(54, 24, 7, 0, 7);
    g.fill();
    g.fillStyle = '#199e70';
    g.beginPath();
    g.arc(78, 24, 7, 0, 7);
    g.fill();
    g.font = '22px monospace';
    const lines = ['$ python eval.py --chunk 256  → recall@5 0.71', '$ python eval.py --chunk 512  → recall@5 0.78', '$ python eval.py --chunk 1024 → recall@5 0.74', '', '✓ 50 questions · 3 runs'];
    lines.forEach((l, i) => {
      g.fillStyle = i === 1 ? '#f5c451' : '#c9ced6';
      g.fillText(l, 36, 108 + i * 52);
    });
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([await blob.arrayBuffer()], '실험 화면.png', { type: 'image/png' }));
    document.querySelector('.note-editor').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await win.waitForSelector('[data-testid=note-image] img');
  await win.hover('[data-testid=note-image] .note-image-frame');
  await win.click('[data-testid=note-image-size-M]');

  // 그래프는 "/그래프"로 넣고 자료를 적는다
  await win.click('.note-editor p');
  await win.keyboard.press('Control+End');
  await win.keyboard.type('/그래프');
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-testid=note-chart-source]');
  await win.fill(
    '[data-testid=note-chart-source]',
    'type: line\ntitle: 청크 크기별 정확도\nunit: %\n청크, 정확도, 재현율\n128, 64, 58\n256, 71, 66\n512, 78, 75\n1024, 74, 73\n2048, 69, 70',
  );
  await win.click('[data-testid=note-chart-edit]');
  await win.click('.note-editor p');
  await win.keyboard.press('Control+End');
  await win.keyboard.type('→ 512가 정확도와 속도 모두 무난');

  // 그래프 위에 마우스 → 값
  const plot = await win.$('[data-testid=note-chart] .chart-plot');
  const box = await plot.boundingBox();
  await win.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await win.waitForSelector('[data-testid=chart-tooltip]');
  await win.evaluate(() => document.querySelector('.note-editor h2')?.scrollIntoView({ block: 'start' }));
  await win.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5 + 1);
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'e2e/out/showcase-note-media.png' });
  console.log('saved e2e/out/showcase-note-media.png');
} finally {
  await shutdown(app);
}
