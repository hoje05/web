// v0.9 문서용 화면: 태그·첨부가 있는 오른쪽 창, 들어오는 흐름 중심 정렬 (검증용 데모, run-all에는 없음)
// 결과: e2e/out/showcase-tags-attachments.png, e2e/out/showcase-arrange-incoming.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, shutdown } from './harness.mjs';

const { app, win, sandbox } = await launch([], { autoPanel: true });
try {
  // 그림 파일 두 개 (그래프 모양, 화면 캡처 모양)
  const fx = join(sandbox.dir, 'fx');
  mkdirSync(fx, { recursive: true });
  const pics = await win.evaluate(async () => {
    const draw = (w, h, paint) => {
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      paint(c.getContext('2d'), w, h);
      return c.toDataURL('image/png').split(',')[1];
    };
    const chart = draw(480, 300, (g, w, h) => {
      g.fillStyle = '#f7f8fa';
      g.fillRect(0, 0, w, h);
      const bars = [0.35, 0.55, 0.42, 0.78, 0.66, 0.9];
      bars.forEach((v, i) => {
        g.fillStyle = i === 5 ? '#22a35a' : '#5b8def';
        g.fillRect(40 + i * 70, h - 30 - v * (h - 60), 44, v * (h - 60));
      });
      g.strokeStyle = '#9aa0a6';
      g.beginPath();
      g.moveTo(30, h - 30);
      g.lineTo(w - 20, h - 30);
      g.stroke();
    });
    const shot = draw(480, 320, (g, w, h) => {
      g.fillStyle = '#1f2430';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2d3445';
      g.fillRect(0, 0, w, 34);
      g.fillStyle = '#e8eaed';
      for (let i = 0; i < 7; i++) g.fillRect(28, 60 + i * 34, 120 + ((i * 53) % 260), 12);
      g.fillStyle = '#f5c451';
      g.fillRect(28, 60 + 2 * 34, 90, 12);
    });
    return { chart, shot };
  });
  const files = {
    chart: join(fx, '검색 정확도 비교.png'),
    shot: join(fx, '실험 화면.png'),
    csv: join(fx, 'results.csv'),
    pdf: join(fx, 'RAG 논문 정리.pdf'),
  };
  writeFileSync(files.chart, Buffer.from(pics.chart, 'base64'));
  writeFileSync(files.shot, Buffer.from(pics.shot, 'base64'));
  writeFileSync(files.csv, 'chunk,recall@5,latency\n256,0.71,120ms\n512,0.78,140ms\n1024,0.74,190ms\n');
  writeFileSync(files.pdf, '%PDF-1.4\n%%EOF\n');

  await win.evaluate(() => {
    const s = window.__tf.getState();
    const box = (id, x, y, text) => ({ id, x, y, width: 180, height: 56, text, note: '' });
    const route = (id, a, b) => ({ id, sourceNodeId: a, targetNodeId: b, sourceAnchor: { side: 'right' }, targetAnchor: { side: 'left' }, pathPoints: [], pathMode: 'auto' });
    s.commit({
      ...s.doc,
      nodes: {
        a: box('a', -520, -120, '답변이 자꾸 틀린다'),
        b: box('b', -240, -40, 'RAG 구조 다시 설계'),
        c: box('c', 40, -40, '청크 크기 실험'),
        d: box('d', 320, -40, '512로 정함'),
      },
      edges: { r1: route('r1', 'a', 'b'), r2: route('r2', 'b', 'c'), r3: route('r3', 'c', 'd') },
    });
    s.select({ kind: 'node', id: 'c' });
    s.openPage('c', { force: true });
    s.fitView();
  });
  for (const t of ['AI', 'RAG', '실험', '중요']) {
    if (!(await win.isVisible('[data-testid=tag-input]'))) await win.click('[data-testid=tag-add]');
    await win.fill('[data-testid=tag-input]', t);
    await win.keyboard.press('Enter');
  }
  await win.keyboard.press('Escape');
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, Object.values(files));
  await win.click('[data-testid=attach-add]');
  await win.waitForFunction(() => (window.__tf.getState().doc.nodes.c.attachments ?? []).length === 4);
  await win.click('.note-editor');
  await win.keyboard.type('청크 크기를 256 / 512 / 1024로 바꿔 가며 검색 정확도를 비교했다.\n');
  await win.keyboard.type('- 512가 정확도와 속도 모두 무난\n');
  await win.mouse.click(300, 650);
  await win.waitForTimeout(600);
  await win.screenshot({ path: 'e2e/out/showcase-tags-attachments.png' });

  // 들어오는 흐름 중심: "결정"으로 모여드는 여러 갈래
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.closePanel();
    s.setPanelDismissed(true);
    const box = (id, x, y, text) => ({ id, x, y, width: 180, height: 56, text, note: '' });
    const route = (id, a, b) => ({ id, sourceNodeId: a, targetNodeId: b, sourceAnchor: { side: 'bottom' }, targetAnchor: { side: 'top' }, pathPoints: [], pathMode: 'auto' });
    s.commit({
      ...s.doc,
      nodes: {
        q: box('q', 300, 400, '이직할까?'),
        p1: box('p1', -200, 0, '연봉 비교'),
        p2: box('p2', 500, -100, '출퇴근 시간'),
        p3: box('p3', 0, 500, '배울 수 있는 것'),
        p4: box('p4', -400, 300, '지인 후기'),
        s1: box('s1', 700, 300, '채용 공고 확인'),
        s2: box('s2', 100, -200, '면접 일정'),
      },
      edges: {
        e1: route('e1', 'p1', 'q'),
        e2: route('e2', 'p2', 'q'),
        e3: route('e3', 'p3', 'q'),
        e4: route('e4', 'p4', 'p3'),
        e5: route('e5', 's1', 'p1'),
        e6: route('e6', 'q', 's2'),
      },
    });
    s.select({ kind: 'node', id: 'q' });
    s.fitView();
  });
  await win.waitForTimeout(300);
  for (let i = 0; i < 2; i++) {
    const seq = await win.evaluate(() => window.__tf.getState().aiActivity?.seq ?? 0);
    await win.click('[data-testid=tool-arrange]');
    await win.waitForFunction((b) => (window.__tf.getState().aiActivity?.seq ?? 0) > b, seq);
    await win.waitForTimeout(900);
  }
  await win.screenshot({ path: 'e2e/out/showcase-arrange-incoming.png' });
  console.log('SHOWCASE v0.9 OK', await win.evaluate(() => window.__tf.getState().aiActivity?.message));
} finally {
  await shutdown(app);
}
