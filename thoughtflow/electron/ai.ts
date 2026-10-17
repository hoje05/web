/**
 * AI 연결 (main process).
 *
 *  Claude 데스크톱 ─stdio─▶ 확장(.mcpb) 또는 설정 파일 등록 ─HTTP 127.0.0.1 + 토큰─▶ [로컬 브리지]  ─┐
 *  ChatGPT 플러그인 · Claude 웹 커넥터 ─HTTPS─▶ 터널(Cloudflare / ngrok) ─▶ [MCP 엔드포인트 /mcp/<비밀>] ─┼─▶ IPC ─▶ 앱 화면(보드)
 *
 *  - 로컬 브리지: 앱이 켜져 있는 동안 항상 이 PC 안(127.0.0.1)에서만 열린다. 실행할 때마다 새 토큰.
 *    주소·토큰·실행 파일 위치는 사용자 데이터 폴더의 bridge.json에 적는다 (확장이 읽는다).
 *  - 인터넷 주소: 설정에서 켰을 때만 연다. Cloudflare 빠른 터널(가입 없음, 켤 때마다 주소가 바뀜) 또는
 *    ngrok(무료 계정 토큰, 계정의 고정 주소) — electron/tunnel.ts. 주소의 비밀 경로(128비트)를 아는 쪽만 쓸 수 있다.
 *  - 지우기 도구는 설정에서 허용했을 때만 통과시킨다.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomBytes, timingSafeEqual } from 'crypto';
import { app, dialog, ipcMain, net, safeStorage, shell, type BrowserWindow, type WebContents } from 'electron';
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
  type Diagnosis,
  type DiagnosisItem,
  type TunnelProvider,
} from '../src/ai/protocol';
import { inspectClaude, registerInClaude, selfTest, unregisterFromClaude } from './claudeDesktop';
import { downloadTunnel, startTunnel, type TunnelHandle, type TunnelInfo } from './tunnel';

/** settings.json의 "ai" */
export interface StoredAi extends Partial<AiSettings> {
  /** ChatGPT 주소의 비밀 경로 */
  secret?: string;
  /** ChatGPT 엔드포인트 포트 (터널이 이 포트로 연결) */
  port?: number;
  /** ngrok 인증 토큰 (이 PC의 사용자 계정으로 암호화 — Windows DPAPI. 암호화를 못 쓰면 그대로) */
  ngrokToken?: { enc?: string; plain?: string } | null;
  /** ngrok 고정 주소(도메인). 비우면 계정 기본 주소 */
  ngrokDomain?: string | null;
  /** 지난번에 쓴 인터넷 주소 (바뀌면 알려 주려고) */
  lastUrl?: string | null;
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
const MAX_BODY = 2 * 1024 * 1024;
/** "연결 점검"이 쓰는 클라이언트 이름 — 사용 기록에 넣지 않는다 */
const SELF_TEST_CLIENT = 'thoughtflow-self-test';

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
  if (client !== SELF_TEST_CLIENT) {
    lastUsed[channel] = Date.now();
    pushState();
  }
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

// ───────────── 인터넷 주소용 MCP 엔드포인트 + 터널 (ChatGPT 플러그인 · Claude 웹 커넥터) ─────────────

let chat: Server | null = null;
let chatPort = 0;
let chatError: string | null = null;
let tunnel: TunnelHandle | null = null;
let tunnelInfo: TunnelInfo = { state: 'off', url: null, message: null };
let ngrokToken: string | null = null;
let ngrokDomain: string | null = null;
/** 지난 실행 때 쓰던 주소와 달라졌으면 그 주소 (사용자가 확인할 때까지) */
let previousUrl: string | null = null;
let downloadProgress: number | null = null;

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
    restartTunnel();
  } catch (err) {
    chatError = `인터넷 주소 연결을 열지 못했습니다: ${String(err)}`;
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

/** 지금 터널의 번호 — 예전 터널이 늦게 알려 오는 상태는 무시한다 */
let tunnelGen = 0;

function restartTunnel() {
  stopTunnel();
  if (!chat) return;
  const gen = ++tunnelGen;
  // (터널은 'starting' 상태를 곧바로 알려 오므로 handle을 받기 전에 불릴 수 있다)
  tunnel = startTunnel(settings.tunnel, chatPort, { ngrokToken, ngrokDomain }, (info) => {
    if (gen !== tunnelGen) return;
    tunnelInfo = info;
    if (info.state === 'running' && info.url) void noteUrl(`${info.url}/mcp/${secret}`);
    pushState();
  });
}

function stopTunnel() {
  const t = tunnel;
  tunnel = null;
  tunnelGen++;
  t?.stop();
  if (tunnelInfo.state !== 'off') {
    tunnelInfo = { state: 'off', url: null, message: null };
    pushState();
  }
}

/** 새 주소가 지난번 주소와 다르면 알려 준다 (플러그인·커넥터에 넣은 주소를 바꿔야 하므로) */
async function noteUrl(url: string) {
  const stored = await deps.readAi();
  if (stored.lastUrl && stored.lastUrl !== url) previousUrl = stored.lastUrl;
  else if (stored.lastUrl === url) previousUrl = null;
  if (stored.lastUrl !== url) await deps.writeAi({ lastUrl: url });
  pushState();
}

function publicUrl(): string | null {
  return tunnelInfo.state === 'running' && tunnelInfo.url ? `${tunnelInfo.url}/mcp/${secret}` : null;
}

/** ngrok 토큰은 이 PC의 사용자 계정으로만 풀 수 있게 암호화해 둔다 */
function sealToken(token: string | null): StoredAi['ngrokToken'] {
  if (!token) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(token).toString('base64') };
  } catch {
    // 암호화를 못 쓰는 환경
  }
  return { plain: token };
}

function openToken(stored: StoredAi['ngrokToken']): string | null {
  if (!stored) return null;
  if (stored.plain) return stored.plain;
  if (stored.enc) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
    } catch {
      return null;
    }
  }
  return null;
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
      publicUrl: publicUrl(),
      lastUsed: lastUsed.chatgpt,
      error: chatError,
      provider: settings.tunnel,
      ngrok: { hasToken: !!ngrokToken, domain: ngrokDomain },
      previousUrl: publicUrl() ? previousUrl : null,
      download: downloadProgress,
    },
  };
}

function pushState() {
  const win = deps?.getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('ai-state', aiState());
}

const isProvider = (v: unknown): v is TunnelProvider => v === 'cloudflare' || v === 'ngrok';

async function applySettings(patch: Partial<AiSettings>) {
  const next: AiSettings = { ...settings };
  for (const k of ['claude', 'chatgpt', 'allowDelete'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  if (isProvider(patch.tunnel)) next.tunnel = patch.tunnel;
  const providerChanged = next.tunnel !== settings.tunnel;
  settings = next;
  await deps.writeAi({ claude: next.claude, chatgpt: next.chatgpt, allowDelete: next.allowDelete, tunnel: next.tunnel });
  writeBridgeFile(!!bridge);
  if (next.chatgpt) {
    if (chat && providerChanged) restartTunnel();
    else await startChatgpt();
  } else stopChatgpt();
  pushState();
}

const newSecret = () => randomBytes(16).toString('hex');

// ───────────── 연결 점검 ─────────────

const ago = (ms: number) => {
  const s = (Date.now() - ms) / 1000;
  return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`;
};

/** 인터넷 주소가 바깥에서 실제로 닿는지: 그 주소로 GET → 이 앱이 405로 답하면 터널까지 정상 */
async function probePublicUrl(url: string): Promise<string | null> {
  try {
    const res = await net.fetch(url, { method: 'GET', signal: AbortSignal.timeout(12000), cache: 'no-store' } as RequestInit);
    if (res.status === 405) return null;
    return `주소로 들어가 봤지만 ThoughtFlow가 아닌 곳에서 답했습니다 (HTTP ${res.status}). 터널을 다시 시작해 보세요.`;
  } catch (err) {
    return `이 PC에서 주소로 들어가지 못했습니다 (${err instanceof Error ? err.message : String(err)}). 방금 만든 주소라면 몇 초 뒤 다시 점검하세요.`;
  }
}

/** 연결이 안 될 때 원인을 찾는 점검 (설정 창의 "연결 점검") */
async function diagnose(): Promise<Diagnosis> {
  const items: DiagnosisItem[] = [];
  const add = (status: DiagnosisItem['status'], title: string, detail?: string) => items.push({ status, title, ...(detail ? { detail } : {}) });

  add(bridge ? 'ok' : 'error', bridge ? `ThoughtFlow 연결 창구가 열려 있습니다 (이 PC 안, 포트 ${bridgePort})` : 'ThoughtFlow 연결 창구가 열리지 않았습니다', bridge ? undefined : 'ThoughtFlow를 껐다 켜 보세요.');
  if (!settings.claude) add('error', 'Claude 연결이 꺼져 있습니다', '위의 Claude 데스크톱 스위치를 켜 주세요.');
  const test = await selfTest(mcpScriptPath(), bridgeFile());
  if (test.ok) add('ok', `Claude가 쓰는 연결 프로그램이 이 PC에서 정상 동작합니다 (도구 ${test.tools}개, ${(test.ms / 1000).toFixed(1)}초)`);
  else add('error', 'Claude가 쓰는 연결 프로그램 시험이 실패했습니다', test.error);

  const claude = await inspectClaude();
  const ext = claude.extension;
  const installed = claude.dirs.length > 0;
  if (!installed) {
    add('warn', 'Claude 데스크톱을 찾지 못했습니다', 'claude.ai/download 에서 Claude 데스크톱을 설치하고 한 번 실행하세요. 웹(claude.ai)이나 휴대폰에서 쓰려면 아래 "인터넷 주소"로 커넥터를 추가하세요.');
  } else {
    add('ok', 'Claude 데스크톱이 설치되어 있습니다', claude.dirs.join(' · '));
  }
  if (ext) {
    if (ext.enabled === false) add('error', 'ThoughtFlow 확장이 꺼져 있습니다', 'Claude → 설정 → 확장 프로그램(Extensions)에서 ThoughtFlow를 켜 주세요.');
    else if (olderVersion(ext.version, app.getVersion())) add('warn', `ThoughtFlow 확장이 옛 버전(${ext.version})입니다`, '"Claude 데스크톱에 설치"를 한 번 더 눌러 업데이트하세요.');
    else add('ok', `ThoughtFlow 확장이 설치되어 있습니다 (버전 ${ext.version}${ext.enabled ? ', 켜짐' : ''})`);
  }
  if (claude.config) {
    if (claude.config.ok) add('ok', 'Claude 설정 파일에 ThoughtFlow가 등록되어 있습니다', claude.config.file);
    else add('error', 'Claude 설정 파일의 ThoughtFlow 등록이 깨졌습니다', `${claude.config.problem} → "설정 파일에 직접 등록"을 다시 누르세요.`);
  }
  if (claude.configError) add('warn', 'Claude 설정 파일을 읽지 못했습니다', claude.configError);
  if (installed && !ext && !claude.config) {
    add('error', 'Claude 데스크톱에 ThoughtFlow가 아직 등록되지 않았습니다', '"Claude 데스크톱에 설치"를 누르거나, 설치 창이 뜨지 않으면 "설정 파일에 직접 등록"을 누른 뒤 Claude를 완전히 껐다 켜세요.');
  }
  if (ext && ext.enabled !== false && claude.config) {
    add('warn', '확장과 설정 파일 등록이 둘 다 있습니다', 'ThoughtFlow 도구가 두 번 보일 수 있습니다. 확장이 잘 되면 "설정 파일 등록 해제"를 누르세요.');
  }
  if (claude.logs.length) add('info', 'Claude 로그에 남은 ThoughtFlow 관련 오류', claude.logs.join('\n'));
  if (lastUsed.claude) add('ok', `마지막 Claude 요청: ${ago(lastUsed.claude)}`);
  else if (installed && (ext || claude.config)) add('info', '이번 실행에서는 아직 Claude의 요청이 없었습니다', '등록한 뒤에는 Claude를 완전히 종료(작업 표시줄 오른쪽 트레이의 Claude 아이콘 → 종료)하고 다시 켜야 합니다.');

  if (settings.chatgpt) {
    const url = publicUrl();
    if (url) {
      const problem = await probePublicUrl(url);
      add(problem ? 'error' : 'ok', problem ? '인터넷 주소가 바깥에서 닿지 않습니다' : '인터넷 주소가 바깥에서 잘 닿습니다 (ChatGPT 플러그인 · Claude 웹 커넥터)', problem ?? url);
    } else if (chatError) add('error', '인터넷 주소 연결을 열지 못했습니다', chatError);
    else add('warn', '인터넷 주소가 아직 없습니다', tunnelInfo.message ?? (tunnelInfo.state === 'missing' ? '터널 프로그램을 받아야 합니다.' : tunnelInfo.state === 'needs-token' ? 'ngrok 인증 토큰을 넣어 주세요.' : '만드는 중입니다.'));
    if (lastUsed.chatgpt) add('ok', `마지막 인터넷 주소 요청 (ChatGPT · Claude 웹): ${ago(lastUsed.chatgpt)}`);
  }

  const mark = { ok: '✓', warn: '⚠', error: '✗', info: '·' } as const;
  // 복사해서 남에게 보내는 글이므로 비밀 주소·토큰은 가린다
  const hide = (t: string) => [secret, bridgeToken, ngrokToken ?? ''].reduce<string>((acc, k) => (k ? acc.split(k).join('••••') : acc), t);
  const report = hide(
    [
      `ThoughtFlow ${app.getVersion()} 연결 점검 — ${new Date().toLocaleString('ko-KR')}`,
      `${process.platform} ${process.arch}`,
      ...items.map((i) => `${mark[i.status]} ${i.title}${i.detail ? `\n    ${i.detail.replace(/\n/g, '\n    ')}` : ''}`),
    ].join('\n'),
  );
  return {
    items,
    report,
    claude: {
      installed,
      extension: ext ? { version: ext.version, enabled: ext.enabled } : null,
      config: claude.config ? { ok: claude.config.ok } : null,
    },
  };
}

// ───────────── 시작 ─────────────

export async function setupAi(d: Deps) {
  deps = d;
  const stored = await deps.readAi();
  settings = {
    claude: stored.claude ?? DEFAULT_AI_SETTINGS.claude,
    chatgpt: stored.chatgpt ?? DEFAULT_AI_SETTINGS.chatgpt,
    allowDelete: stored.allowDelete ?? DEFAULT_AI_SETTINGS.allowDelete,
    tunnel: isProvider(stored.tunnel) ? stored.tunnel : DEFAULT_AI_SETTINGS.tunnel,
  };
  ngrokToken = openToken(stored.ngrokToken);
  ngrokDomain = stored.ngrokDomain ?? null;
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
    if (chat) restartTunnel();
    return aiState();
  });
  /** ngrok 인증 토큰·고정 주소 저장 → ngrok이면 다시 연결 */
  ipcMain.handle('ai:set-ngrok', async (_e, patch: { token?: unknown; domain?: unknown }) => {
    if (typeof patch?.token === 'string') ngrokToken = patch.token.trim().replace(/^ngrok config add-authtoken\s+/i, '') || null;
    if (typeof patch?.domain === 'string') ngrokDomain = patch.domain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '') || null;
    await deps.writeAi({ ngrokToken: sealToken(ngrokToken), ngrokDomain });
    if (chat && settings.tunnel === 'ngrok') restartTunnel();
    return aiState();
  });
  /** 터널 프로그램 받기 (사용자가 눌렀을 때만) */
  ipcMain.handle('ai:download-tunnel', async () => {
    if (downloadProgress !== null) return { ok: false, error: '받는 중입니다.' };
    const provider = settings.tunnel;
    downloadProgress = 0;
    tunnelInfo = { state: 'downloading', url: null, message: null };
    pushState();
    let last = 0;
    try {
      await downloadTunnel(provider, (p) => {
        downloadProgress = p;
        if (p - last >= 0.05 || p === 1) {
          last = p;
          pushState();
        }
      });
      downloadProgress = null;
      if (chat) restartTunnel();
      pushState();
      return { ok: true };
    } catch (err) {
      downloadProgress = null;
      const message = err instanceof Error ? err.message : String(err);
      tunnelInfo = { state: 'error', url: null, message: `터널 프로그램을 받지 못했습니다. ${message}` };
      pushState();
      return { ok: false, error: message };
    }
  });
  /** "주소가 바뀌었습니다" 알림 확인 */
  ipcMain.handle('ai:ack-url', () => {
    previousUrl = null;
    pushState();
    return aiState();
  });
  ipcMain.handle('ai:diagnose', () => diagnose());
  /** 확장 설치가 안 될 때: Claude 데스크톱 설정 파일에 직접 등록 */
  ipcMain.handle('ai:claude-register', async () => {
    try {
      return await registerInClaude(mcpScriptPath());
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('ai:claude-unregister', async () => {
    try {
      return await unregisterFromClaude();
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
