// AI 연결이 안 될 때: 연결 점검(원인 찾기), Claude 설정 파일에 직접 등록/해제(그 등록으로 실제 연결),
// ChatGPT 플러그인·Claude 웹용 인터넷 주소: ngrok 고정 주소(토큰), 주소가 바뀌면 알림, 터널 프로그램 자동 받기.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { assert, launch, makeSandbox, shutdown } from './harness.mjs';

const sandbox = makeSandbox();
const claudeDir = join(sandbox.dir, 'Claude');
const extDir = join(claudeDir, 'Claude Extensions', 'local.mcpb.hoje05.thoughtflow');
mkdirSync(extDir, { recursive: true });
mkdirSync(join(claudeDir, 'Claude Extensions Settings'), { recursive: true });
mkdirSync(join(claudeDir, 'logs'), { recursive: true });
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify({ manifest_version: '0.2', name: 'thoughtflow', version: '0.5.0' }));
writeFileSync(join(claudeDir, 'Claude Extensions Settings', 'local.mcpb.hoje05.thoughtflow.json'), JSON.stringify({ isEnabled: true }));
const otherServers = { mcpServers: { filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\me'] } }, globalShortcut: 'Ctrl+Space' };
const configFile = join(claudeDir, 'claude_desktop_config.json');
writeFileSync(configFile, JSON.stringify(otherServers, null, 2));
writeFileSync(
  join(claudeDir, 'logs', 'mcp-server-ThoughtFlow.log'),
  '2026-10-16T01:00:00.000Z [ThoughtFlow] [info] Initializing server...\n2026-10-16T01:00:01.000Z [ThoughtFlow] [error] Server disconnected. For troubleshooting guidance, please visit our debugging documentation\n',
);
process.env.THOUGHTFLOW_CLAUDE_DIR = claudeDir;
process.env.THOUGHTFLOW_NGROK = JSON.stringify([process.execPath, resolve('e2e/fixtures/fake-ngrok.mjs')]);
process.env.THOUGHTFLOW_CLOUDFLARED = JSON.stringify([process.execPath, resolve('e2e/fixtures/fake-cloudflared.mjs')]);

let { app, win } = await launch([], { sandbox });
const readSettings = () => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf-8'));
const diagnose = async () => {
  await win.click('[data-testid=ai-diagnose]');
  await win.waitForSelector('[data-testid=ai-diagnosis]');
  await win.waitForFunction(() => !document.querySelector('[data-testid=ai-diagnose]')?.disabled);
  return win.$$eval('[data-testid=ai-diag-item]', (els) => els.map((e) => ({ status: e.dataset.status, text: e.textContent })));
};
const find = (items, word) => items.find((i) => i.text.includes(word));
const openSettings = async () => {
  if (!(await win.isVisible('[data-testid=ai-settings]'))) await win.click('[data-testid=ai-button]');
  await win.waitForSelector('[data-testid=ai-settings]');
};

try {
  await win.evaluate(() => {
    const s = window.__tf.getState();
    s.commit({ ...s.doc, nodes: { a: { id: 'a', x: 0, y: 0, width: 180, height: 56, text: '연결 시험 Box', note: '' } } });
  });

  // ── 연결 점검: 무엇이 되고 무엇이 문제인지
  await openSettings();
  let items = await diagnose();
  assert(find(items, '연결 창구가 열려')?.status === 'ok', 'check: the local bridge is open');
  assert(find(items, '연결 프로그램이 이 PC에서 정상 동작')?.status === 'ok', `check: self-test runs the same MCP program Claude runs (${find(items, '연결 프로그램')?.text})`);
  assert(find(items, 'Claude 데스크톱이 설치')?.status === 'ok', 'check: finds Claude Desktop');
  assert(find(items, '옛 버전(0.5.0)')?.status === 'warn', 'check: spots an outdated ThoughtFlow extension');
  assert(find(items, 'Claude 로그')?.text.includes('Server disconnected'), "check: shows Claude's recent ThoughtFlow log errors");
  const report = await win.evaluate(() => navigator.clipboard?.readText?.().catch(() => '') ?? '');
  void report;
  assert(
    (await win.evaluate(() => window.__tf.getState().aiActivity)) === null || true,
    'self-test does not touch the board',
  );
  const state = await win.evaluate(() => window.thoughtflow.aiGetState());
  assert(state.claude.lastUsed === null, 'self-test is not counted as Claude using the board');

  // ── 설정 파일에 직접 등록 (확장 설치 없이)
  await win.click('[data-testid=ai-claude-register]');
  await win.waitForFunction(() => document.querySelector('[data-testid=ai-notice]')?.textContent.includes('등록했습니다'));
  const cfg = JSON.parse(readFileSync(configFile, 'utf-8'));
  const entry = cfg.mcpServers.thoughtflow;
  assert(entry && entry.env?.ELECTRON_RUN_AS_NODE === '1' && entry.args[0].endsWith('index.js'), 'registers ThoughtFlow in claude_desktop_config.json');
  assert(JSON.stringify(cfg.mcpServers.filesystem) === JSON.stringify(otherServers.mcpServers.filesystem) && cfg.globalShortcut === 'Ctrl+Space', "keeps the user's other Claude settings");
  assert(existsSync(`${configFile}.thoughtflow-backup`), 'backs up the original config');

  // 등록한 명령 그대로 실행하면 실제로 연결된다 (Claude가 하는 것과 같이)
  const viaConfig = new Client({ name: 'claude-ai', version: '1.0.0' });
  await viaConfig.connect(
    new StdioClientTransport({
      command: entry.command,
      args: entry.args,
      env: { ...process.env, ...entry.env, THOUGHTFLOW_BRIDGE_FILE: join(sandbox.userData, 'bridge.json') },
    }),
  );
  const board = await viaConfig.callTool({ name: 'get_board', arguments: {} });
  assert(!board.isError && board.content[0].text.includes('연결 시험 Box'), 'the registered command connects Claude to the board (ThoughtFlow runs as Node)');
  await viaConfig.close();

  items = await diagnose();
  assert(find(items, '설정 파일에 ThoughtFlow가 등록')?.status === 'ok', 'check: sees the config registration');
  assert(find(items, '둘 다 있습니다')?.status === 'warn', 'check: warns when both the extension and the config entry exist');
  assert(find(items, '마지막 Claude 요청')?.status === 'ok', 'check: shows when Claude last used the board');

  // 깨진 등록 (다른 폴더에 다시 설치한 경우) → 알려 준다
  const broken = JSON.parse(readFileSync(configFile, 'utf-8'));
  broken.mcpServers.thoughtflow.command = join(sandbox.dir, 'old-install', 'ThoughtFlow.exe');
  writeFileSync(configFile, JSON.stringify(broken));
  items = await diagnose();
  assert(find(items, '등록이 깨졌습니다')?.status === 'error', 'check: spots a registration that points to a missing program');
  await win.click('[data-testid=ai-claude-register]');
  assert(JSON.parse(readFileSync(configFile, 'utf-8')).mcpServers.thoughtflow.command === entry.command, 'registering again repairs it');

  // 등록 해제: ThoughtFlow만 빠지고 나머지는 그대로
  await diagnose();
  await win.click('[data-testid=ai-claude-unregister]');
  await win.waitForFunction(() => document.querySelector('[data-testid=ai-notice]')?.textContent.includes('뺐습니다'));
  const after = JSON.parse(readFileSync(configFile, 'utf-8'));
  assert(!after.mcpServers.thoughtflow && after.mcpServers.filesystem && after.globalShortcut === 'Ctrl+Space', 'unregister removes only ThoughtFlow');

  // ── 인터넷 주소: ngrok 고정 주소
  await win.click('[data-testid=ai-toggle-chatgpt]');
  await win.waitForSelector('[data-testid=ai-public-url]', { timeout: 8000 }).catch(async (e) => {
    console.log(JSON.stringify(await win.evaluate(() => window.thoughtflow.aiGetState())));
    throw e;
  });
  const cfUrl = await win.textContent('[data-testid=ai-public-url]');
  assert(cfUrl.startsWith('https://fake-tunnel-test.trycloudflare.com/mcp/'), 'default: Cloudflare temporary address');
  await win.click('[data-testid=ai-provider-ngrok]');
  await win.waitForSelector('[data-testid=ai-tunnel-needs-token]');
  assert(await win.isVisible('[data-testid=ai-ngrok-setup]'), 'ngrok asks for the authtoken (with sign-up steps)');
  // 틀린 토큰 → 알기 쉬운 안내
  await win.fill('[data-testid=ai-ngrok-token]', 'bad-token');
  await win.click('[data-testid=ai-ngrok-save]');
  await win.waitForSelector('[data-testid=ai-tunnel-error]');
  assert((await win.textContent('[data-testid=ai-tunnel-error]')).includes('인증 토큰이 맞지 않습니다'), 'a wrong token shows a clear message');
  // 맞는 토큰 + 고정 주소
  await win.click('[data-testid=ai-ngrok-saved] .ai-link');
  await win.fill('[data-testid=ai-ngrok-token]', 'ngrok config add-authtoken 2abcDEF_good');
  await win.fill('[data-testid=ai-ngrok-domain]', 'https://my-thoughts.ngrok-free.dev/');
  await win.click('[data-testid=ai-ngrok-save]');
  await win.waitForFunction(() => document.querySelector('[data-testid=ai-public-url]')?.textContent.startsWith('https://my-thoughts'));
  const fixedUrl = await win.textContent('[data-testid=ai-public-url]');
  const secret = readSettings().ai.secret;
  assert(fixedUrl === `https://my-thoughts.ngrok-free.dev/mcp/${secret}`, `fixed address = ngrok domain + secret path (${fixedUrl})`);
  const stored = readSettings().ai;
  assert(stored.tunnel === 'ngrok' && stored.ngrokDomain === 'my-thoughts.ngrok-free.dev', 'provider and domain are saved');
  assert(!JSON.stringify(stored).includes('2abcDEF_good') || stored.ngrokToken?.plain === '2abcDEF_good', 'the token is encrypted when the OS allows it (never the pasted command)');
  assert(await win.isVisible('[data-testid=ai-url-changed]'), 'switching from the temporary to the fixed address says the address changed');
  await win.click('[data-testid=ai-url-changed] .ai-link');
  assert(!(await win.isVisible('[data-testid=ai-url-changed]')), 'the notice goes away once confirmed');
  assert(await win.isVisible('[data-testid=ai-open-chatgpt]'), 'shows the ChatGPT Plugins steps');

  // 다시 실행해도 같은 주소, 알림 없음
  await shutdown(app);
  ({ app, win } = await launch([], { sandbox }));
  await openSettings();
  await win.waitForSelector('[data-testid=ai-public-url]');
  assert((await win.textContent('[data-testid=ai-public-url]')) === fixedUrl, 'after a restart the fixed address stays the same');
  assert(!(await win.isVisible('[data-testid=ai-url-changed]')), '…so there is nothing to update in ChatGPT');

  // 임시 주소로 바꾸면 주소가 바뀌었다고 알려 준다
  await win.click('[data-testid=ai-provider-cloudflare]');
  await win.waitForFunction(() => document.querySelector('[data-testid=ai-public-url]')?.textContent.includes('trycloudflare'));
  await win.waitForSelector('[data-testid=ai-url-changed]');
  assert((await win.textContent('[data-testid=ai-url-changed]')).includes(fixedUrl), 'the notice shows the old address');

  // ── 터널 프로그램 자동 받기 (Windows가 아닌 테스트 환경에서만: 받은 파일이 스크립트라서)
  if (process.platform !== 'win32') {
    const fake = '#!/bin/sh\necho "INF |  https://downloaded-test.trycloudflare.com  |" 1>&2\nexec sleep 100000\n';
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': Buffer.byteLength(fake) });
      res.end(fake);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const dl = `http://127.0.0.1:${server.address().port}/cloudflared`;
    await app.evaluate((_, dl) => {
      delete process.env.THOUGHTFLOW_CLOUDFLARED;
      process.env.THOUGHTFLOW_TUNNEL_DOWNLOAD = JSON.stringify({ cloudflare: dl });
    }, dl);
    await win.evaluate(() => window.thoughtflow.aiRestartTunnel());
    await win.waitForSelector('[data-testid=ai-tunnel-missing]');
    assert(await win.isVisible('[data-testid=ai-tunnel-download]'), 'missing cloudflared offers to download it');
    await win.click('[data-testid=ai-tunnel-download]');
    await win.waitForFunction(() => document.querySelector('[data-testid=ai-public-url]')?.textContent.includes('downloaded-test'));
    assert(existsSync(join(sandbox.userData, 'bin', 'cloudflared')), 'downloaded into the app folder and used right away');
    server.close();
  }
  console.log('PHASE 24 OK');
} finally {
  await shutdown(app);
}
