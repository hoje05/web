/**
 * Claude 데스크톱 확장(.mcpb)의 MCP 서버 (stdio).
 *
 * Claude 데스크톱이 이 파일을 Node로 실행하고, 표준 입출력으로 MCP 대화를 한다.
 * 도구 호출은 이 PC의 ThoughtFlow 앱이 연 로컬 브리지(127.0.0.1)로 넘긴다.
 * 브리지 주소와 비밀 토큰은 앱이 사용자 데이터 폴더의 bridge.json에 적어 둔다.
 * 앱이 꺼져 있으면 bridge.json에 적힌 실행 파일로 앱을 켠 뒤 다시 시도한다.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AiResponse, AiToolName } from '../src/ai/protocol';
import { createMcpServer } from './server';

declare const __APP_VERSION__: string;

interface BridgeInfo {
  port: number | null;
  token: string | null;
  pid: number | null;
  exe?: string;
  args?: string[];
  enabled?: boolean;
}

const LAUNCH_WAIT_MS = 30000;

/** ThoughtFlow 사용자 데이터 폴더의 bridge.json (Electron app.getPath('userData')와 같은 위치) */
function bridgeFile(): string {
  if (process.env.THOUGHTFLOW_BRIDGE_FILE) return process.env.THOUGHTFLOW_BRIDGE_FILE;
  const home = homedir();
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? join(home, 'AppData', 'Roaming'))
      : process.platform === 'darwin'
        ? join(home, 'Library', 'Application Support')
        : (process.env.XDG_CONFIG_HOME ?? join(home, '.config'));
  return join(base, 'ThoughtFlow', 'bridge.json');
}

function readBridge(): BridgeInfo | null {
  try {
    return JSON.parse(readFileSync(bridgeFile(), 'utf-8'));
  } catch {
    return null;
  }
}

class NotRunning extends Error {}

async function post(info: BridgeInfo | null, path: string, body?: unknown): Promise<AiResponse> {
  if (!info?.port || !info.token) throw new NotRunning();
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    // 연결 거부 = 앱이 꺼져 있음 (bridge.json은 지난 실행 것)
    if ((err as Error)?.name === 'TimeoutError') return { text: 'ThoughtFlow가 응답하지 않습니다. 앱 화면을 확인해 주세요.', isError: true };
    throw new NotRunning();
  }
  if (res.status === 401 || res.status === 404) throw new NotRunning(); // 다른 실행의 토큰 / 다른 프로그램의 포트
  const data = (await res.json().catch(() => null)) as AiResponse | null;
  if (!data || typeof data.text !== 'string') throw new NotRunning();
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 앱을 켜고 새 브리지가 응답할 때까지 기다린다 */
async function launchApp(info: BridgeInfo | null): Promise<BridgeInfo | null> {
  const exe = info?.exe ?? process.env.THOUGHTFLOW_EXE;
  if (!exe) return null;
  // 이 서버가 ThoughtFlow.exe(ELECTRON_RUN_AS_NODE)로 실행 중이어도, 앱은 평소처럼 켜지게
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const child = spawn(exe, info?.args ?? [], { detached: true, stdio: 'ignore', env, windowsHide: false });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    return null;
  }
  const until = Date.now() + LAUNCH_WAIT_MS;
  while (Date.now() < until) {
    await sleep(500);
    const next = readBridge();
    if (!next?.port || !next.token) continue;
    try {
      await post(next, '/v1/status');
      return next;
    } catch {
      // 아직 준비 중
    }
  }
  return null;
}

let launching: Promise<BridgeInfo | null> | null = null;

async function call(tool: AiToolName, args: Record<string, unknown>, client: string): Promise<AiResponse> {
  const body = { tool, args, client: client || 'claude' };
  try {
    return await post(readBridge(), '/v1/call', body);
  } catch (err) {
    if (!(err instanceof NotRunning)) throw err;
  }
  launching ??= launchApp(readBridge()).finally(() => (launching = null));
  const info = await launching;
  if (!info) {
    return {
      text: 'ThoughtFlow 앱에 연결하지 못했습니다. 사용자에게 ThoughtFlow를 실행해 달라고 안내한 뒤 다시 시도하세요. (앱을 한 번도 실행하지 않았다면 먼저 실행해야 합니다)',
      isError: true,
    };
  }
  return post(info, '/v1/call', body).catch(() => ({ text: 'ThoughtFlow 앱에 연결하지 못했습니다.', isError: true }));
}

const server = createMcpServer(call, typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0');
server.connect(new StdioServerTransport()).catch((err) => {
  console.error('[thoughtflow-mcp]', err);
  process.exit(1);
});
