/**
 * Claude 데스크톱 쪽 상태 살피기와 직접 등록.
 *
 *  - 찾기: Claude 설정 폴더, ThoughtFlow 확장(.mcpb) 설치·켜짐 여부, claude_desktop_config.json 등록 여부, Claude의 MCP 로그.
 *  - 직접 등록: 확장 설치가 안 될 때 claude_desktop_config.json의 mcpServers에 ThoughtFlow를 넣는다.
 *    (원래 파일은 .thoughtflow-backup으로 남기고, 다른 서버 설정은 그대로 둔다. Node 설치가 필요 없도록 ThoughtFlow.exe를 Node로 실행)
 *  - 자체 시험: Claude가 실행하는 것과 같은 MCP 프로그램을 이 앱이 직접 실행해 도구 목록과 도구 호출이 되는지 본다.
 *
 * 경로는 Claude 데스크톱의 기본 위치를 따른다 (Windows: %APPDATA%\Claude, Microsoft Store판은 %LOCALAPPDATA%\Packages\Claude_…).
 * 테스트용: THOUGHTFLOW_CLAUDE_DIR = Claude 설정 폴더
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { app } from 'electron';
import { existsSync, readdirSync, promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export const SERVER_KEY = 'thoughtflow';
const CONFIG = 'claude_desktop_config.json';

/** Claude 데스크톱 설정 폴더 후보 (있는 것만) */
export function claudeDirs(): string[] {
  if (process.env.THOUGHTFLOW_CLAUDE_DIR) return existsSync(process.env.THOUGHTFLOW_CLAUDE_DIR) ? [process.env.THOUGHTFLOW_CLAUDE_DIR] : [];
  const out: string[] = [];
  if (process.platform === 'win32') {
    out.push(path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Claude'));
    const pkgs = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Packages');
    try {
      for (const n of readdirSync(pkgs)) if (/claude/i.test(n)) out.push(path.join(pkgs, n, 'LocalCache', 'Roaming', 'Claude'));
    } catch {
      // Microsoft Store판 없음
    }
  } else if (process.platform === 'darwin') {
    out.push(path.join(os.homedir(), 'Library', 'Application Support', 'Claude'));
  } else {
    out.push(path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Claude'));
  }
  return out.filter((d) => existsSync(d));
}

function logDirs(dirs: string[]): string[] {
  const out = dirs.map((d) => path.join(d, 'logs'));
  if (process.platform === 'darwin' && !process.env.THOUGHTFLOW_CLAUDE_DIR) out.push(path.join(os.homedir(), 'Library', 'Logs', 'Claude'));
  return out.filter((d) => existsSync(d));
}

/** Claude 데스크톱 설정 파일에 넣을 ThoughtFlow 서버 */
export function serverEntry(scriptPath: string) {
  return { command: process.execPath, args: [scriptPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

interface ConfigEntry {
  command?: unknown;
  args?: unknown;
}

const looksLikeOurs = (key: string, e: ConfigEntry) =>
  key === SERVER_KEY || (Array.isArray(e?.args) && e.args.some((a) => typeof a === 'string' && /thoughtflow-mcp\.js|thoughtflow[\\/].*server[\\/]index\.js/i.test(a)));

export interface ClaudeFindings {
  dirs: string[];
  extension: { id: string; version: string; enabled: boolean | null; dir: string } | null;
  config: { file: string; key: string; command: string; args: string[]; ok: boolean; problem: string | null } | null;
  configError: string | null;
  logs: string[];
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf-8'));
}

/** 설치된 ThoughtFlow 확장 찾기: "Claude Extensions/<id>/manifest.json"의 name이 thoughtflow */
async function findExtension(dirs: string[]): Promise<ClaudeFindings['extension']> {
  for (const d of dirs) {
    const root = path.join(d, 'Claude Extensions');
    let ids: string[] = [];
    try {
      ids = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const id of ids) {
      try {
        const m = (await readJson(path.join(root, id, 'manifest.json'))) as { name?: string; version?: string };
        if (m?.name !== SERVER_KEY) continue;
        let enabled: boolean | null = null;
        try {
          const s = (await readJson(path.join(d, 'Claude Extensions Settings', `${id}.json`))) as { isEnabled?: boolean };
          if (typeof s?.isEnabled === 'boolean') enabled = s.isEnabled;
        } catch {
          // 설정 파일 없음 → 알 수 없음
        }
        return { id, version: String(m.version ?? '?'), enabled, dir: path.join(root, id) };
      } catch {
        // 다른 확장
      }
    }
  }
  return null;
}

/** Claude의 MCP 로그에서 ThoughtFlow에 관한 마지막 몇 줄 */
async function recentLogs(dirs: string[]): Promise<string[]> {
  const files: { file: string; mtime: number }[] = [];
  for (const d of logDirs(dirs)) {
    try {
      for (const n of await fs.readdir(d)) {
        if (!/^mcp.*\.log$/i.test(n)) continue;
        const st = await fs.stat(path.join(d, n));
        files.push({ file: path.join(d, n), mtime: st.mtimeMs });
      }
    } catch {
      // 없음
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const lines: string[] = [];
  for (const { file } of files.slice(0, 4)) {
    try {
      const h = await fs.open(file, 'r');
      const st = await h.stat();
      const size = Math.min(st.size, 96 * 1024);
      const buf = Buffer.alloc(size);
      await h.read(buf, 0, size, st.size - size);
      await h.close();
      const all = buf.toString('utf-8').split(/\r?\n/);
      const ours = /thoughtflow/i.test(path.basename(file)) ? all : all.filter((l) => /thoughtflow/i.test(l));
      lines.push(...ours.filter((l) => /error|fail|disconnect|exit|refus|not found|cannot|timeout|ENOENT|EACCES/i.test(l)).slice(-6));
    } catch {
      // 읽을 수 없음
    }
  }
  return lines.map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l)).slice(-10);
}

export async function inspectClaude(): Promise<ClaudeFindings> {
  const dirs = claudeDirs();
  const findings: ClaudeFindings = { dirs, extension: null, config: null, configError: null, logs: [] };
  findings.extension = await findExtension(dirs);
  for (const d of dirs) {
    const file = path.join(d, CONFIG);
    if (!existsSync(file)) continue;
    try {
      const data = (await readJson(file)) as { mcpServers?: Record<string, ConfigEntry> };
      for (const [key, e] of Object.entries(data?.mcpServers ?? {})) {
        if (!looksLikeOurs(key, e)) continue;
        const command = typeof e.command === 'string' ? e.command : '';
        const args = Array.isArray(e.args) ? e.args.filter((a): a is string => typeof a === 'string') : [];
        const missing = [command, ...args.filter((a) => /\.js$/i.test(a))].find((p) => path.isAbsolute(p) && !existsSync(p));
        findings.config = {
          file,
          key,
          command,
          args,
          ok: !missing,
          problem: missing ? `등록된 프로그램이 없습니다: ${missing} (ThoughtFlow를 다른 폴더에 다시 설치했을 수 있습니다)` : null,
        };
        break;
      }
    } catch (err) {
      findings.configError = `${file}을(를) 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (findings.config) break;
  }
  findings.logs = await recentLogs(dirs);
  return findings;
}

/**
 * claude_desktop_config.json에 ThoughtFlow를 넣는다 (또는 고친다). 다른 설정은 그대로.
 * 원래 파일은 처음 한 번 .thoughtflow-backup으로 남긴다.
 */
export async function registerInClaude(scriptPath: string): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> {
  const dirs = claudeDirs();
  if (!dirs.length) {
    return { ok: false, error: 'Claude 데스크톱을 찾지 못했습니다. claude.ai/download 에서 Claude 데스크톱을 설치하고 한 번 실행한 뒤 다시 눌러 주세요.' };
  }
  const files: string[] = [];
  for (const d of dirs) {
    const file = path.join(d, CONFIG);
    let data: Record<string, unknown> = {};
    if (existsSync(file)) {
      const text = await fs.readFile(file, 'utf-8');
      if (text.trim()) {
        try {
          const parsed = JSON.parse(text);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
          data = parsed;
        } catch {
          return { ok: false, error: `Claude 설정 파일의 형식이 잘못되어 고치지 않았습니다. 파일을 직접 확인해 주세요: ${file}` };
        }
      }
      const backup = `${file}.thoughtflow-backup`;
      if (!existsSync(backup)) await fs.writeFile(backup, text, 'utf-8');
    }
    const servers = data.mcpServers && typeof data.mcpServers === 'object' && !Array.isArray(data.mcpServers) ? { ...(data.mcpServers as Record<string, ConfigEntry>) } : {};
    // 예전에 다른 이름으로 넣어 둔 ThoughtFlow 항목은 하나로 정리
    for (const [key, e] of Object.entries(servers)) if (key !== SERVER_KEY && looksLikeOurs(key, e)) delete servers[key];
    servers[SERVER_KEY] = serverEntry(scriptPath);
    data.mcpServers = servers;
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, file);
    files.push(file);
  }
  return { ok: true, files };
}

/** claude_desktop_config.json에서 ThoughtFlow만 뺀다 */
export async function unregisterFromClaude(): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  let removed = 0;
  for (const d of claudeDirs()) {
    const file = path.join(d, CONFIG);
    if (!existsSync(file)) continue;
    let data: { mcpServers?: Record<string, ConfigEntry> };
    try {
      data = JSON.parse(await fs.readFile(file, 'utf-8'));
    } catch {
      return { ok: false, error: `Claude 설정 파일을 읽지 못했습니다: ${file}` };
    }
    const servers = { ...(data.mcpServers ?? {}) };
    const before = Object.keys(servers).length;
    for (const [key, e] of Object.entries(servers)) if (looksLikeOurs(key, e)) delete servers[key];
    if (Object.keys(servers).length === before) continue;
    removed += before - Object.keys(servers).length;
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ ...data, mcpServers: servers }, null, 2), 'utf-8');
    await fs.rename(tmp, file);
  }
  return { ok: true, removed };
}

/**
 * 자체 시험: Claude가 실행하는 것과 똑같이 MCP 프로그램을 띄워 도구 목록을 받고, 읽기 도구 하나를 불러 본다.
 * (도구 호출은 이 앱의 로컬 브리지를 거쳐 화면까지 갔다 온다)
 */
export async function selfTest(scriptPath: string, bridgeFile: string): Promise<{ ok: true; tools: number; ms: number } | { ok: false; error: string }> {
  if (!existsSync(scriptPath)) return { ok: false, error: `Claude용 연결 프로그램이 앱에 없습니다: ${scriptPath}` };
  const t0 = Date.now();
  const client = new Client({ name: 'thoughtflow-self-test', version: app.getVersion() });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') env[k] = v;
  env.ELECTRON_RUN_AS_NODE = '1';
  env.THOUGHTFLOW_BRIDGE_FILE = bridgeFile;
  const transport = new StdioClientTransport({ command: process.execPath, args: [scriptPath], env, stderr: 'pipe' });
  let stderr = '';
  transport.stderr?.on('data', (b: Buffer) => (stderr = (stderr + b.toString()).slice(-600)));
  try {
    await withTimeout(client.connect(transport), 15000, '연결 프로그램이 15초 안에 응답하지 않았습니다.');
    const { tools } = await withTimeout(client.listTools(), 10000, '도구 목록을 받지 못했습니다.');
    const r = (await withTimeout(client.callTool({ name: 'list_projects', arguments: {} }), 40000, '도구 호출이 끝나지 않았습니다.')) as {
      isError?: boolean;
      content?: { text?: string }[];
    };
    if (r.isError) return { ok: false, error: (r.content ?? []).map((c) => c.text ?? '').join(' ').slice(0, 300) || '도구 호출이 실패했습니다.' };
    return { ok: true, tools: tools.length, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: `${err instanceof Error ? err.message : String(err)}${stderr ? ` (${stderr.trim()})` : ''}` };
  } finally {
    await client.close().catch(() => undefined);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
