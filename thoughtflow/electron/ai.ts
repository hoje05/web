/**
 * AI 연결 (main process).
 *
 *  Claude 데스크톱 ─stdio─▶ 확장(.mcpb) ─HTTP 127.0.0.1 + 토큰─▶ [로컬 브리지]  ─┐
 *  ChatGPT ─HTTPS─▶ Cloudflare 터널 ─▶ [ChatGPT용 MCP 엔드포인트 /mcp/<비밀>] ────┼─▶ IPC ─▶ 앱 화면(보드)
 *
 *  - 로컬 브리지: 앱이 켜져 있는 동안 항상 이 PC 안(127.0.0.1)에서만 열린다. 실행할 때마다 새 토큰.
 *    주소·토큰·실행 파일 위치는 사용자 데이터 폴더의 bridge.json에 적는다 (확장이 읽는다).
 *  - ChatGPT 엔드포인트: 설정에서 켰을 때만 연다. 인터넷에서 닿아야 하므로 cloudflared 빠른 터널을 띄운다.
 *    주소의 비밀 경로(128비트)를 아는 쪽만 쓸 수 있다.
 *  - 지우기 도구는 설정에서 허용했을 때만 통과시킨다.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { spawn, type ChildProcess } from 'child_process';
import { randomBytes, timingSafeEqual } from 'crypto';
import { app, dialog, ipcMain, shell, type BrowserWindow, type WebContents } from 'electron';
import { existsSync, promises as fs, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { createMcpServer } from '../mcp/server';
import {
  AI_TOOL_NAMES,
  DEFAULT_AI_SETTINGS,
  DESTRUCTIVE_TOOLS,
  type AiRequest,
  type AiResponse,
  type AiSettings,
  type AiState,
  type AiToolName,
  type TunnelState,
} from '../src/ai/protocol';

/** settings.json의 "ai" */
export interface StoredAi extends Partial<AiSettings> {
  /** ChatGPT 주소의 비밀 경로 */
  secret?: string;
  /** ChatGPT 엔드포인트 포트 (터널이 이 포트로 연결) */
  port?: number;
}

interface Deps {
  getWindow: () => BrowserWindow | null;
  readAi: () => Promise<StoredAi>;
  writeAi: (patch: StoredAi) => Promise<void>;
}

type Channel = 'claude' | 'chatgpt';

const DEFAULT_CHATGPT_PORT = 38517;
const RENDERER_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 20000;
const TUNNEL_TIMEOUT_MS = 45000;
const MAX_BODY = 2 * 1024 * 1024;

const bridgeFile = () => path.join(app.getPath('userData'), 'bridge.json');

let deps: Deps;
let settings: AiSettings = { ...DEFAULT_AI_SETTINGS };
let secret = '';
const lastUsed: Record<Channel, number | null> = { claude: null, chatgpt: null };

// ───────────── 앱 화면(renderer)에 요청 전달 ─────────────

let rendererReady = false;
let readyWaiters: (() => void)[] = [];
let requestSeq = 0;
const pending = new Map<number, (res: AiResponse) => void>();

const errorRes = (text: string): AiResponse => ({ text, isError: true });

function waitRendererReady(): Promise<boolean> {
  if (rendererReady) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter((w) => w !== done);
      resolve(false);
    }, READY_TIMEOUT_MS);
    readyWaiters.push(done);
  });
}

async function callRenderer(req: AiRequest): Promise<AiResponse> {
  if (!(await waitRendererReady())) return errorRes('ThoughtFlow 화면이 아직 준비되지 않았습니다. 잠시 후 다시 시도하세요.');
  const win = deps.getWindow();
  if (!win || win.isDestroyed()) return errorRes('ThoughtFlow 창이 닫혀 있습니다.');
  return new Promise((resolve) => {
    const id = ++requestSeq;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(
        errorRes(
          'ThoughtFlow가 30초 안에 응답하지 않았습니다. 사용자에게 ThoughtFlow 창을 열어 저장 상태(위쪽 "저장 실패" 표시)를 확인하고, 계속되면 ThoughtFlow를 껐다 켠 뒤 다시 시도해 달라고 안내하세요.',
        ),
      );
    }, RENDERER_TIMEOUT_MS);
    pending.set(id, (res) => {
      clearTimeout(timer);
      if (!res.isError && CHANGING_TOOLS.includes(req.tool)) attention(win);
      resolve(res);
    });
    win.webContents.send('ai-request', { id, ...req });
  });
}

/** 보드나 화면을 바꾸는 도구 */
const CHANGING_TOOLS: readonly AiToolName[] = ['add_flow', 'update_box', 'connect_boxes', 'delete_items', 'focus_box', 'open_project', 'create_project'];

/** AI가 보드를 바꿨는데 사용자가 다른 창(Claude)을 보고 있으면 작업 표시줄의 ThoughtFlow를 깜빡여 알린다 */
function attention(win: BrowserWindow) {
  if (win.isDestroyed() || win.isFocused()) return;
  win.flashFrame(true);
  win.once('focus', () => {
    if (!win.isDestroyed()) win.flashFrame(false);
  });
}

/** 모든 AI 요청이 지나는 문: 연결 켜짐 여부, 도구 이름, 지우기 허용 확인 */
async function dispatch(channel: Channel, tool: unknown, args: unknown, client: unknown): Promise<AiResponse> {
  if (!settings[channel]) {
    const name = channel === 'claude' ? 'Claude' : 'ChatGPT';
    return errorRes(`ThoughtFlow의 AI 연결 설정에서 ${name} 연결이 꺼져 있습니다. 사용자에게 켜 달라고 안내하세요.`);
  }
  if (typeof tool !== 'string' || !AI_TOOL_NAMES.includes(tool as AiToolName)) return errorRes(`알 수 없는 도구입니다: ${String(tool)}`);
  if (DESTRUCTIVE_TOOLS.includes(tool as AiToolName) && !settings.allowDelete) {
    return errorRes(
      '지우기는 허용되지 않았습니다. 사용자에게 직접 지워 달라고 하거나, ThoughtFlow의 "AI 연결" 설정에서 "AI가 Box·Route를 지울 수 있게 허용"을 켜 달라고 안내하세요.',
    );
  }
  lastUsed[channel] = Date.now();
  pushState();
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  return callRenderer({ tool: tool as AiToolName, args: safeArgs, client: typeof client === 'string' && client ? client : channel });
}

// ───────────── HTTP 공통 ─────────────

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

// ───────────── 로컬 브리지 (Claude 데스크톱 확장용) ─────────────

let bridge: Server | null = null;
let bridgePort = 0;
let bridgeToken = '';

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** 확장이 꺼진 앱을 다시 켤 때 쓸 실행 명령 */
function launchCommand(): { exe: string; args: string[] } {
  if (app.isPackaged) return { exe: process.execPath, args: [] };
  const args = [app.getAppPath()];
  if (process.argv.includes('--no-sandbox')) args.unshift('--no-sandbox');
  return { exe: process.execPath, args };
}

function writeBridgeFile(running: boolean) {
  const info = {
    app: 'ThoughtFlow',
    version: app.getVersion(),
    pid: running ? process.pid : null,
    port: running ? bridgePort : null,
    token: running ? bridgeToken : null,
    enabled: settings.claude,
    ...launchCommand(),
  };
  try {
    writeFileSync(bridgeFile(), JSON.stringify(info, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error('bridge.json write failed', err);
  }
}

async function handleBridge(req: IncomingMessage, res: ServerResponse) {
  // 브라우저에서 오는 요청(DNS rebinding 등)은 거절: Host가 정확히 이 주소여야 하고 Origin이 없어야 한다
  const host = req.headers.host ?? '';
  if ((host !== `127.0.0.1:${bridgePort}` && host !== `localhost:${bridgePort}`) || req.headers.origin) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  const auth = req.headers.authorization ?? '';
  if (!sameSecret(auth, `Bearer ${bridgeToken}`)) return sendJson(res, 401, { error: 'unauthorized' });

  const url = req.url ?? '/';
  if (req.method === 'GET' && url === '/v1/status') {
    return sendJson(res, 200, { text: 'ok', app: 'ThoughtFlow', version: app.getVersion(), claude: settings.claude });
  }
  if (req.method === 'POST' && url === '/v1/call') {
    let body: { tool?: unknown; args?: unknown; client?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { text: '잘못된 요청입니다.', isError: true });
    }
    const result = await dispatch('claude', body.tool, body.args, body.client);
    return sendJson(res, 200, withExtensionNotice(result, req.headers['x-thoughtflow-extension']));
  }
  sendJson(res, 404, { error: 'not found' });
}

/** "0.5.0" < "0.6.0" */
function olderVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

let extensionNoticeShown = false;

/** Claude 데스크톱에 설치된 확장이 앱보다 옛 버전이면 (앱 실행마다 한 번) Claude에게 업데이트 안내를 덧붙인다 */
function withExtensionNotice(result: AiResponse, header: string | string[] | undefined): AiResponse {
  const ext = typeof header === 'string' ? header : '0.5.0';
  if (extensionNoticeShown || !olderVersion(ext, app.getVersion())) return result;
  extensionNoticeShown = true;
  return {
    ...result,
    text: `${result.text}\n\n(참고: Claude 데스크톱에 설치된 ThoughtFlow 확장이 옛 버전(${ext})입니다. 앱은 ${app.getVersion()}입니다. 사용자에게 ThoughtFlow의 ✦ AI → "Claude 데스크톱에 설치"를 한 번 더 눌러 확장을 업데이트해 달라고 알려 주세요.)`,
  };
}

async function startBridge() {
  if (bridge) return;
  bridgeToken = randomBytes(24).toString('hex');
  const server = createServer((req, res) => {
    handleBridge(req, res).catch((err) => sendJson(res, 500, errorRes(String(err))));
  });
  try {
    bridgePort = await listen(server, 0);
    bridge = server;
    writeBridgeFile(true);
  } catch (err) {
    console.error('AI bridge failed to start', err);
  }
}

// ───────────── ChatGPT용 MCP 엔드포인트 + 터널 ─────────────

let chat: Server | null = null;
let chatPort = 0;
let chatError: string | null = null;
let tunnel: ChildProcess | null = null;
let tunnelInfo: { state: TunnelState; url: string | null; message: string | null } = { state: 'off', url: null, message: null };

async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!secret || !sameSecret(pathname, `/mcp/${secret}`)) return sendJson(res, 404, { error: 'not found' });
  if (req.method !== 'POST') {
    // 세션 없는(stateless) 서버: GET(SSE 스트림)·DELETE는 지원하지 않는다
    res.setHeader('allow', 'POST');
    return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
  }
  const server = createMcpServer((tool, args, client) => dispatch('chatgpt', tool, args, client), app.getVersion());
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

async function startChatgpt() {
  if (chat) return;
  const server = createServer((req, res) => {
    handleChat(req, res).catch((err) => {
      console.error('chatgpt endpoint error', err);
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
    });
  });
  const stored = await deps.readAi();
  const wanted = stored.port ?? DEFAULT_CHATGPT_PORT;
  try {
    try {
      chatPort = await listen(server, wanted);
    } catch {
      chatPort = await listen(server, 0); // 포트를 다른 프로그램이 쓰는 중
    }
    if (chatPort !== stored.port) await deps.writeAi({ port: chatPort });
    chat = server;
    chatError = null;
    startTunnel();
  } catch (err) {
    chatError = `ChatGPT 연결을 열지 못했습니다: ${String(err)}`;
  }
  pushState();
}

function stopChatgpt() {
  stopTunnel();
  chat?.close();
  chat = null;
  chatPort = 0;
  pushState();
}

/**
 * cloudflared 실행 명령. PATH에 없을 때를 대비해 Windows 기본 설치 위치도 찾는다.
 * THOUGHTFLOW_CLOUDFLARED: 다른 실행 파일 경로, 또는 JSON 배열 ["명령", "인자"…] (테스트용)
 */
function cloudflaredCommand(): [string, string[]] {
  const override = process.env.THOUGHTFLOW_CLOUDFLARED;
  if (override) {
    try {
      const cmd = JSON.parse(override);
      if (Array.isArray(cmd) && cmd.length && cmd.every((c) => typeof c === 'string')) return [cmd[0], cmd.slice(1)];
    } catch {
      // 그냥 경로
    }
    return [override, []];
  }
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'cloudflared', 'cloudflared.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
    ];
    const found = candidates.find((c) => existsSync(c));
    if (found) return [found, []];
  }
  return ['cloudflared', []];
}

function setTunnel(state: TunnelState, url: string | null = null, message: string | null = null) {
  tunnelInfo = { state, url, message };
  pushState();
}

function startTunnel() {
  stopTunnel();
  if (!chat) return;
  setTunnel('starting');
  let child: ChildProcess;
  try {
    const [cmd, pre] = cloudflaredCommand();
    child = spawn(cmd, [...pre, 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${chatPort}`], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    setTunnel('missing');
    return;
  }
  tunnel = child;
  const timer = setTimeout(() => {
    if (tunnel === child && tunnelInfo.state === 'starting') {
      setTunnel('error', null, 'Cloudflare 터널 주소를 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.');
      child.kill();
    }
  }, TUNNEL_TIMEOUT_MS);
  const onData = (buf: Buffer) => {
    const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (m && tunnel === child && tunnelInfo.state !== 'running') {
      clearTimeout(timer);
      setTunnel('running', m[0]);
    }
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.on('error', (err: NodeJS.ErrnoException) => {
    clearTimeout(timer);
    if (tunnel !== child) return;
    tunnel = null;
    if (err.code === 'ENOENT') setTunnel('missing');
    else setTunnel('error', null, `cloudflared를 실행하지 못했습니다: ${err.message}`);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (tunnel !== child) return;
    tunnel = null;
    if (tunnelInfo.state !== 'missing') setTunnel('error', null, `터널이 멈췄습니다 (코드 ${code ?? '?'}). 다시 시도하세요.`);
  });
}

function stopTunnel() {
  const child = tunnel;
  tunnel = null;
  child?.kill();
  if (tunnelInfo.state !== 'off') setTunnel('off');
}

// ───────────── 상태 / 설정 ─────────────

function extensionPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ThoughtFlow.mcpb')
    : path.join(app.getAppPath(), 'dist-mcp', 'ThoughtFlow.mcpb');
}

function mcpScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'thoughtflow-mcp.js')
    : path.join(app.getAppPath(), 'dist-mcp', 'bundle', 'server', 'index.js');
}

export function aiState(): AiState {
  const localUrl = chat && secret ? `http://127.0.0.1:${chatPort}/mcp/${secret}` : null;
  return {
    settings: { ...settings },
    claude: { running: !!bridge && settings.claude, lastUsed: lastUsed.claude, extensionAvailable: existsSync(extensionPath()) },
    chatgpt: {
      running: !!chat,
      localUrl,
      tunnel: { ...tunnelInfo },
      publicUrl: tunnelInfo.state === 'running' && tunnelInfo.url ? `${tunnelInfo.url}/mcp/${secret}` : null,
      lastUsed: lastUsed.chatgpt,
      error: chatError,
    },
  };
}

function pushState() {
  const win = deps?.getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ai-state', aiState());
}

async function applySettings(patch: Partial<AiSettings>) {
  const next: AiSettings = { ...settings };
  for (const k of ['claude', 'chatgpt', 'allowDelete'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  settings = next;
  await deps.writeAi({ claude: next.claude, chatgpt: next.chatgpt, allowDelete: next.allowDelete });
  writeBridgeFile(!!bridge);
  if (next.chatgpt) await startChatgpt();
  else stopChatgpt();
  pushState();
}

const newSecret = () => randomBytes(16).toString('hex');

// ───────────── 시작 ─────────────

export async function setupAi(d: Deps) {
  deps = d;
  const stored = await deps.readAi();
  settings = {
    claude: stored.claude ?? DEFAULT_AI_SETTINGS.claude,
    chatgpt: stored.chatgpt ?? DEFAULT_AI_SETTINGS.chatgpt,
    allowDelete: stored.allowDelete ?? DEFAULT_AI_SETTINGS.allowDelete,
  };
  secret = stored.secret && /^[0-9a-f]{32}$/.test(stored.secret) ? stored.secret : newSecret();
  if (secret !== stored.secret) await deps.writeAi({ secret });

  ipcMain.on('ai:ready', (e) => {
    if (e.sender !== deps.getWindow()?.webContents) return;
    rendererReady = true;
    const waiters = readyWaiters;
    readyWaiters = [];
    waiters.forEach((w) => w());
  });
  ipcMain.on('ai:response', (_e, id: number, res: AiResponse) => {
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    done(res && typeof res.text === 'string' ? { text: res.text, ...(res.isError ? { isError: true } : {}) } : errorRes('잘못된 응답'));
  });
  ipcMain.handle('ai:get-state', () => aiState());
  ipcMain.handle('ai:set', async (_e, patch: Partial<AiSettings>) => {
    await applySettings(patch ?? {});
    return aiState();
  });
  ipcMain.handle('ai:regenerate-secret', async () => {
    secret = newSecret();
    await deps.writeAi({ secret });
    pushState();
    return aiState();
  });
  ipcMain.handle('ai:restart-tunnel', () => {
    if (chat) startTunnel();
    return aiState();
  });
  ipcMain.handle('ai:install-claude', async () => {
    const src = extensionPath();
    if (!existsSync(src)) return { ok: false, error: 'Claude 확장 파일이 앱에 없습니다. (개발 중이라면 npm run build를 먼저 실행하세요)' };
    const dst = path.join(app.getPath('userData'), 'ThoughtFlow.mcpb');
    await fs.copyFile(src, dst);
    const err = await shell.openPath(dst);
    return err ? { ok: false, error: `Claude 데스크톱으로 열지 못했습니다: ${err}` } : { ok: true };
  });
  ipcMain.handle('ai:save-extension', async () => {
    const src = extensionPath();
    if (!existsSync(src)) return { ok: false, error: 'Claude 확장 파일이 앱에 없습니다.' };
    const win = deps.getWindow();
    const opts = {
      title: 'Claude 데스크톱 확장 저장',
      defaultPath: path.join(app.getPath('downloads'), 'ThoughtFlow.mcpb'),
      filters: [{ name: 'Claude 확장', extensions: ['mcpb'] }],
    };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false };
    await fs.copyFile(src, r.filePath);
    shell.showItemInFolder(r.filePath);
    return { ok: true };
  });
  /** Claude 데스크톱 설정 파일에 직접 넣는 방법 (확장 설치가 안 될 때) */
  ipcMain.handle('ai:claude-config', () =>
    JSON.stringify(
      {
        mcpServers: {
          thoughtflow: { command: process.execPath, args: [mcpScriptPath()], env: { ELECTRON_RUN_AS_NODE: '1' } },
        },
      },
      null,
      2,
    ),
  );

  await startBridge();
  if (settings.chatgpt) await startChatgpt();
}

/** 창을 새로 불러오면 화면이 다시 준비될 때까지 요청을 기다리게 한다 */
export function watchRenderer(contents: WebContents) {
  contents.on('did-start-loading', () => {
    rendererReady = false;
  });
  contents.on('render-process-gone', () => {
    rendererReady = false;
    for (const done of pending.values()) done(errorRes('ThoughtFlow 화면이 닫혔습니다.'));
    pending.clear();
  });
}

export function shutdownAi() {
  stopTunnel();
  chat?.close();
  bridge?.close();
  if (bridge) writeBridgeFile(false);
  bridge = null;
}
