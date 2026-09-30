// AI 연결 화면 스크린샷 (README용): Claude가 대화를 보드에 정리한 모습 + AI 연결 설정 창
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, makeSandbox, shutdown } from './harness.mjs';

const sandbox = makeSandbox();
const { app, win } = await launch([], { sandbox });
const claude = new Client({ name: 'claude-ai', version: '1.0.0' });
await claude.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['dist-mcp/bundle/server/index.js'],
    env: { ...process.env, THOUGHTFLOW_BRIDGE_FILE: join(sandbox.userData, 'bridge.json') },
  }),
);
const call = (name, args) => claude.callTool({ name, arguments: args });
mkdirSync('e2e/out', { recursive: true });

try {
  // 사용자가 직접 적어 둔 생각
  await win.mouse.dblclick(300, 300);
  await win.keyboard.type('주말에 사이드 프로젝트를 시작하고 싶다');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  const start = Object.values(await win.evaluate(() => window.__tf.getState().doc.nodes))[0];

  // Claude와의 대화를 Claude가 정리
  await call('add_flow', {
    after: start.id,
    boxes: [
      { key: 'q', title: '무엇을 만들까?', note: 'Claude와 이야기: 매일 쓰는 불편함에서 출발하자' },
      { key: 'a', title: '가계부 앱', note: '이미 좋은 앱이 많음' },
      { key: 'b', title: '독서 기록 앱', note: '읽은 문장을 모아 두는 곳이 없다' },
      { key: 'd', title: '독서 기록 앱으로 결정' },
      { key: 'e', title: '이번 주: 화면 3개 스케치' },
    ],
    routes: [
      { from: 'q', to: 'a' },
      { from: 'q', to: 'b' },
      { from: 'b', to: 'd' },
      { from: 'd', to: 'e' },
    ],
  });
  await win.evaluate(() => window.__tf.getState().fitView());
  await win.waitForTimeout(700);
  await win.screenshot({ path: 'e2e/out/ai-board.png' });

  await win.click('[data-testid=ai-button]');
  await win.waitForSelector('[data-testid=ai-settings]');
  await win.waitForTimeout(400);
  await win.screenshot({ path: 'e2e/out/ai-settings.png' });
  console.log('saved e2e/out/ai-board.png, ai-settings.png');
} finally {
  await claude.close().catch(() => {});
  await shutdown(app);
}
