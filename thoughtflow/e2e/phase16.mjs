// AI 연결: Claude 데스크톱(확장 = stdio MCP 서버 → 로컬 브리지)과 ChatGPT(HTTP MCP 엔드포인트)가
// 실제 앱의 보드를 읽고 고치는지, 권한·되돌리기·자동 저장·앱 자동 실행까지 확인한다.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assert, launch, makeSandbox, shutdown, state } from './harness.mjs';

const sandbox = makeSandbox();
const fakeCloudflared = resolve('e2e/fixtures/fake-cloudflared.mjs');
process.env.THOUGHTFLOW_CLOUDFLARED = JSON.stringify([process.execPath, fakeCloudflared]);
let { app, win } = await launch([], { sandbox });
const bridgeFile = join(sandbox.userData, 'bridge.json');
const readBridge = () => JSON.parse(readFileSync(bridgeFile, 'utf-8'));
const text = (r) => r.content.map((c) => c.text).join('\n');
const nodes = async () => Object.values((await state(win)).doc.nodes);
const byTitle = async (t) => (await nodes()).find((n) => n.text === t);

// Claude 데스크톱이 확장을 실행하는 것과 같은 방식 (stdio)
const claude = new Client({ name: 'claude-ai', version: '1.0.0' });
await claude.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['dist-mcp/bundle/server/index.js'],
    env: {
      ...process.env,
      THOUGHTFLOW_BRIDGE_FILE: bridgeFile,
      THOUGHTFLOW_USER_DATA: sandbox.userData,
      THOUGHTFLOW_BOARDS_DIR: sandbox.boards,
    },
  }),
);
const call = async (name, args = {}, client = claude) => client.callTool({ name, arguments: args });
let relaunchedPid = null;

try {
  // ── 로컬 브리지
  await win.waitForFunction(() => true);
  const bridge = readBridge();
  assert(bridge.port > 0 && /^[0-9a-f]{48}$/.test(bridge.token) && bridge.pid > 0, 'app writes bridge.json (port, token, pid)');
  assert(bridge.exe && bridge.args.includes('--no-sandbox'), 'bridge.json records how to relaunch the app');
  const base = `http://127.0.0.1:${bridge.port}`;
  assert((await fetch(`${base}/v1/status`)).status === 401, 'bridge rejects requests without the token');
  const fromBrowser = await fetch(`${base}/v1/status`, { headers: { authorization: `Bearer ${bridge.token}`, origin: 'https://evil.example' } });
  assert(fromBrowser.status === 403, 'bridge rejects browser (Origin) requests');

  // ── 도구 목록
  const tools = (await claude.listTools()).tools.map((t) => t.name);
  assert(tools.length === 11 && tools.includes('add_flow') && tools.includes('get_board'), `extension lists tools (${tools.length})`);
  assert((claude.getInstructions() ?? '').includes('thinking map'), 'server instructions tell the AI how to use the board');

  // ── 빈 보드 읽기
  const empty = await call('get_board');
  assert(!empty.isError && text(empty).includes('보드가 비어 있습니다'), 'get_board on an empty board');

  // ── 흐름 추가
  const added = await call('add_flow', {
    boxes: [
      { title: '제주도 여행 가고 싶다', note: '10월 연휴' },
      { title: '비행기 표 알아보기' },
      { title: '표가 너무 비쌈', note: '왕복 40만원' },
    ],
  });
  assert(!added.isError && text(added).includes('Box 3개와 Route 2개를 추가했습니다'), 'add_flow adds a chained flow');
  let s = await state(win);
  assert(Object.keys(s.doc.nodes).length === 3 && Object.keys(s.doc.edges).length === 2, 'boxes and routes appear on the board');
  assert((await nodes()).every((n) => n.origin === 'Claude'), 'boxes remember they were made by Claude');
  await win.waitForSelector('[data-testid=ai-toast]');
  assert((await win.textContent('[data-testid=ai-toast]')).includes('Claude: Box 3개와 Route 2개를 추가했습니다'), 'toast tells what Claude did');
  assert((await win.$$('[data-testid=box-ai-mark]')).length === 3, 'AI badge on each new box');
  assert((await win.$$('.box.is-ai-new')).length === 3, 'new boxes glow briefly');
  await win.waitForTimeout(300); // 새 Box 크기 측정 뒤에도
  assert(await win.isVisible('[data-testid=ai-toast-undo]'), "toast offers '되돌리기'");
  await win.waitForFunction(() => {
    const s = window.__tf.getState();
    return s.doc === s.savedDoc && s.saveState === 'saved' && !!s.filePath;
  });
  const file = (await state(win)).filePath;
  assert(JSON.parse(readFileSync(file, 'utf-8')).nodes.filter((n) => n.origin === 'Claude').length === 3, 'AI changes are autosaved (with origin)');

  // 가지치기: 기존 Box 뒤에 두 갈래
  const ticket = await byTitle('표가 너무 비쌈');
  const branch = await call('add_flow', {
    after: ticket.id,
    boxes: [{ key: 'q', title: '다른 방법은?' }, { key: 'a', title: '기차 + 배' }, { key: 'b', title: '날짜 바꾸기' }],
    routes: [{ from: 'q', to: 'a' }, { from: 'q', to: 'b' }],
  });
  assert(!branch.isError, 'add_flow with after + branching routes');
  const rects = await win.$$eval('[data-testid=box]', (els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  assert(rects.length === 6 && rects.every((a, i) => rects.every((b, j) => i === j || !overlap(a, b))), 'auto layout: no boxes overlap');
  const q = await byTitle('다른 방법은?');
  const [ba, bb] = [await byTitle('기차 + 배'), await byTitle('날짜 바꾸기')];
  assert(q.x > ticket.x && ba.x > q.x && bb.x === ba.x && bb.y > ba.y, 'flow reads left → right, branches stack downward');

  // ── 보드를 바탕으로 대화
  const board = text(await call('get_board'));
  assert(
    board.includes('프로젝트: 생각 흐름') && /- 제주도 여행 가고 싶다 \[n_\w+\]\n {2}→ 비행기 표 알아보기/.test(board) && board.includes('왕복 40만원'),
    'get_board returns the flow outline with notes',
  );
  const found = text(await call('search_boxes', { query: '40만원' }));
  assert(found.includes(`표가 너무 비쌈 [${ticket.id}]`), 'search_boxes finds boxes by note');
  const read = text(await call('read_box', { id: q.id }));
  assert(read.includes(`← 표가 너무 비쌈 [${ticket.id}]`) && read.includes('→ 기차 + 배'), 'read_box shows incoming/outgoing');

  const upd = await call('update_box', { id: '날짜 바꾸기', append_note: '평일 출발이면 반값' });
  assert(!upd.isError && (await byTitle('날짜 바꾸기')).note === '평일 출발이면 반값', 'update_box appends to a note (box found by title)');
  const con = await call('connect_boxes', { from: ba.id, to: bb.id });
  assert(!con.isError && Object.keys((await state(win)).doc.edges).length === 6, 'connect_boxes adds a route');

  // 사용자가 보고 있는 Box가 get_board에 나온다
  const focus = await call('focus_box', { id: q.id });
  s = await state(win);
  assert(!focus.isError && s.panelOpen && s.activeTab === q.id && s.selection?.id === q.id, 'focus_box opens that box in the side panel');
  assert(text(await call('get_board', { include_notes: false })).includes(`사용자가 지금 보고 있는 Box: 다른 방법은? [${q.id}]`), 'get_board tells which box the user is looking at');

  // ── 지우기 권한
  const denied = await call('delete_items', { box_ids: [bb.id] });
  assert(denied.isError && text(denied).includes('지우기는 허용되지 않았습니다') && (await byTitle('날짜 바꾸기')), 'delete is blocked by default');
  await win.click('[data-testid=ai-button]');
  await win.waitForSelector('[data-testid=ai-settings]');
  assert((await win.getAttribute('[data-testid=ai-toggle-claude]', 'aria-checked')) === 'true', 'settings: Claude on by default');
  assert((await win.getAttribute('[data-testid=ai-toggle-chatgpt]', 'aria-checked')) === 'false', 'settings: ChatGPT off by default');
  await win.click('[data-testid=ai-toggle-delete]');
  await win.waitForSelector('[data-testid=ai-toggle-delete][aria-checked=true]');
  const del = await call('delete_items', { box_ids: [bb.id] });
  assert(!del.isError && !(await byTitle('날짜 바꾸기')), 'delete works after the user allows it');
  await win.click('[data-testid=ai-toggle-delete]');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-testid=ai-settings]', { state: 'detached' });

  // 알림의 되돌리기
  await win.click('[data-testid=ai-toast-undo]');
  assert(!!(await byTitle('날짜 바꾸기')), "toast '되돌리기' restores the deleted box");
  // Ctrl+Z 한 번 = AI 요청 하나
  const before = (await nodes()).length;
  await call('add_flow', { after: ba.id, boxes: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] });
  assert((await nodes()).length === before + 3, 'another flow added');
  await win.mouse.click(700, 700);
  await win.keyboard.press('Control+z');
  assert((await nodes()).length === before, 'one Ctrl+Z undoes a whole AI step');

  // 잘못된 요청은 아무것도 바꾸지 않는다
  const bad = await call('add_flow', { boxes: [{ key: 'x', title: 'X' }], routes: [{ from: 'x', to: 'n_nothing' }] });
  assert(bad.isError && (await nodes()).length === before, 'bad references change nothing');

  // ── 프로젝트
  const created = await call('create_project', { name: 'AI 프로젝트' });
  assert(!created.isError && (await win.textContent('[data-testid=project-name]')) === 'AI 프로젝트', 'create_project opens a new project');
  await call('add_flow', { boxes: [{ title: '새 주제' }] });
  const list = text(await call('list_projects'));
  assert(list.includes('AI 프로젝트') && list.includes('← 지금 열린 프로젝트') && /생각 흐름/.test(list), 'list_projects');
  const opened = await call('open_project', { name: '생각 흐름' });
  assert(!opened.isError && text(opened).includes('제주도 여행 가고 싶다'), 'open_project switches back and returns its board');

  // ── Claude 연결 끄기
  await win.evaluate(() => window.thoughtflow.aiSetSettings({ claude: false }));
  const off = await call('get_board');
  assert(off.isError && text(off).includes('Claude 연결이 꺼져 있습니다'), 'turning Claude off blocks it');
  await win.evaluate(() => window.thoughtflow.aiSetSettings({ claude: true }));

  // ── Claude 데스크톱에 설치 (확장 파일을 연다)
  const stubbed = await app.evaluate(({ shell }) => {
    try {
      shell.openPath = async (p) => {
        globalThis.__opened = p;
        return '';
      };
      return true;
    } catch {
      return false;
    }
  });
  if (stubbed) {
    await win.click('[data-testid=ai-button]');
    await win.click('[data-testid=ai-install-claude]');
    await win.waitForSelector('[data-testid=ai-notice]');
    const opened = await app.evaluate(() => globalThis.__opened);
    assert(opened.endsWith('ThoughtFlow.mcpb') && existsSync(opened), 'install button opens the .mcpb extension');
    await win.keyboard.press('Escape');
  }

  // ── ChatGPT: 켜면 터널 주소가 생긴다
  await win.click('[data-testid=ai-button]');
  await win.click('[data-testid=ai-toggle-chatgpt]');
  await win.waitForSelector('[data-testid=ai-public-url]');
  const publicUrl = await win.textContent('[data-testid=ai-public-url]');
  assert(/^https:\/\/fake-tunnel-test\.trycloudflare\.com\/mcp\/[0-9a-f]{32}$/.test(publicUrl), `ChatGPT gets an HTTPS tunnel URL`);
  const localUrl = await win.textContent('[data-testid=ai-local-url]');
  const settings = JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf-8'));
  assert(settings.ai.chatgpt === true && localUrl.endsWith(`/mcp/${settings.ai.secret}`), 'secret path is stored in settings');

  const gpt = new Client({ name: 'openai-mcp', version: '1.0.0' });
  await gpt.connect(new StreamableHTTPClientTransport(new URL(localUrl)));
  assert((await gpt.listTools()).tools.length === 11, 'ChatGPT endpoint lists the same tools');
  const gptBoard = await call('get_board', {}, gpt);
  assert(text(gptBoard).includes('제주도 여행 가고 싶다'), 'ChatGPT reads the same board');
  await call('add_flow', { after: '기차 + 배', boxes: [{ title: '배편 시간 확인' }] }, gpt);
  assert((await byTitle('배편 시간 확인'))?.origin === 'ChatGPT', 'ChatGPT adds boxes (marked ChatGPT)');
  await win.waitForFunction(() => document.querySelector('[data-testid=ai-toast]')?.textContent.includes('ChatGPT:'));
  assert(true, 'toast names ChatGPT');
  await gpt.close();
  const wrong = await fetch(localUrl.replace(/[0-9a-f]{32}$/, '0'.repeat(32)), { method: 'POST', body: '{}' });
  assert(wrong.status === 404, 'wrong secret path is rejected');

  // cloudflared가 없으면 설치 안내
  await app.evaluate(() => (process.env.THOUGHTFLOW_CLOUDFLARED = '/nonexistent/cloudflared'));
  await win.evaluate(() => window.thoughtflow.aiRestartTunnel());
  await win.waitForSelector('[data-testid=ai-tunnel-missing]');
  assert((await win.textContent('[data-testid=ai-tunnel-missing]')).includes('winget install --id Cloudflare.cloudflared'), 'missing cloudflared shows how to install it');
  await win.click('[data-testid=ai-toggle-chatgpt]');
  await win.keyboard.press('Escape');

  // ── 앱이 꺼져 있으면 확장이 앱을 켠다
  await shutdown(app);
  app = null;
  const closed = readBridge();
  assert(closed.port === null && closed.token === null && closed.exe, 'on quit bridge.json keeps only the launch command');
  const relaunched = await call('get_board');
  relaunchedPid = readBridge().pid;
  assert(!relaunched.isError && text(relaunched).includes('제주도 여행 가고 싶다'), 'extension relaunches the app and reads the last project');

  console.log('PHASE 16 OK');
} finally {
  await claude.close().catch(() => {});
  if (app) await shutdown(app);
  if (relaunchedPid) {
    try {
      process.kill(relaunchedPid, 'SIGTERM');
    } catch {
      // 이미 종료
    }
  }
}
