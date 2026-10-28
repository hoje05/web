/**
 * 인터넷 주소(HTTPS 터널): ChatGPT 플러그인·Claude 웹 커넥터가 이 PC의 ThoughtFlow에 닿게 한다.
 *
 *  - cloudflare: Cloudflare 빠른 터널. 가입이 필요 없지만 켤 때마다 주소가 바뀐다.
 *  - ngrok: 무료 ngrok 계정의 인증 토큰을 넣으면 계정마다 정해진 주소(고정 도메인)를 쓴다 → 한 번 등록하면 그대로.
 *
 * 터널 프로그램이 없으면 사용자가 누를 때 공식 배포처에서 받아 사용자 데이터 폴더(bin)에 둔다.
 * 테스트용: THOUGHTFLOW_CLOUDFLARED / THOUGHTFLOW_NGROK = 실행 파일 경로 또는 JSON 배열 ["명령", "인자"…],
 *          THOUGHTFLOW_TUNNEL_DOWNLOAD = JSON {"cloudflare": 주소, "ngrok": 주소} (받을 곳 바꾸기)
 */
import { app, net } from 'electron';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { chmodSync, existsSync, promises as fs } from 'fs';
import * as path from 'path';
import type { TunnelProvider, TunnelState } from '../src/ai/protocol';

export interface TunnelInfo {
  state: TunnelState;
  url: string | null;
  message: string | null;
}

const TUNNEL_TIMEOUT_MS = 45000;
const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);
export const binDir = () => path.join(app.getPath('userData'), 'bin');

/** 환경 변수로 바꾼 실행 명령 (테스트용) */
function override(provider: TunnelProvider): [string, string[]] | null {
  const raw = process.env[provider === 'cloudflare' ? 'THOUGHTFLOW_CLOUDFLARED' : 'THOUGHTFLOW_NGROK'];
  if (!raw) return null;
  try {
    const cmd = JSON.parse(raw);
    if (Array.isArray(cmd) && cmd.length && cmd.every((c) => typeof c === 'string')) return [cmd[0], cmd.slice(1)];
  } catch {
    // 그냥 경로
  }
  return [raw, []];
}

/**
 * 터널 프로그램 실행 명령: 테스트 지정 → 앱이 받아 둔 것 → Windows 기본 설치 위치 → PATH.
 * (PATH에서 찾는 경우 없으면 실행할 때 ENOENT로 알게 된다)
 */
export function tunnelCommand(provider: TunnelProvider): [string, string[]] {
  const o = override(provider);
  if (o) return o;
  const name = provider === 'cloudflare' ? 'cloudflared' : 'ngrok';
  const candidates = [path.join(binDir(), exe(name))];
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const local = process.env.LOCALAPPDATA ?? '';
    if (provider === 'cloudflare') candidates.push(path.join(pf86, 'cloudflared', 'cloudflared.exe'), path.join(pf, 'cloudflared', 'cloudflared.exe'));
    candidates.push(path.join(local, 'Microsoft', 'WinGet', 'Links', exe(name)));
  }
  const found = candidates.find((c) => c && existsSync(c));
  return [found ?? name, []];
}

// ───────────── 받기 ─────────────

/** 공식 배포처 (Cloudflare: GitHub 릴리스, ngrok: 공식 다운로드 서버) */
function downloadUrl(provider: TunnelProvider): { url: string; kind: 'exe' | 'zip' | 'tgz' } | null {
  try {
    const custom = JSON.parse(process.env.THOUGHTFLOW_TUNNEL_DOWNLOAD ?? 'null');
    if (custom?.[provider]) {
      const u: string = custom[provider];
      return { url: u, kind: u.endsWith('.zip') ? 'zip' : u.endsWith('.tgz') ? 'tgz' : 'exe' };
    }
  } catch {
    // 무시
  }
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? '386' : 'amd64';
  if (provider === 'cloudflare') {
    const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
    if (process.platform === 'win32') return { url: `${base}/cloudflared-windows-${arch === 'arm64' ? 'amd64' : arch}.exe`, kind: 'exe' };
    if (process.platform === 'linux') return { url: `${base}/cloudflared-linux-${arch}`, kind: 'exe' };
    if (process.platform === 'darwin') return { url: `${base}/cloudflared-darwin-${arch}.tgz`, kind: 'tgz' };
    return null;
  }
  const base = 'https://bin.equinox.io/c/bNyj1mQVY4c';
  if (process.platform === 'win32') return { url: `${base}/ngrok-v3-stable-windows-${arch}.zip`, kind: 'zip' };
  if (process.platform === 'linux') return { url: `${base}/ngrok-v3-stable-linux-${arch}.tgz`, kind: 'tgz' };
  if (process.platform === 'darwin') return { url: `${base}/ngrok-v3-stable-darwin-${arch}.zip`, kind: 'zip' };
  return null;
}

/** 압축 풀기: Windows는 PowerShell, 그 밖에는 tar / unzip */
function extract(archive: string, kind: 'zip' | 'tgz', dir: string) {
  const r =
    kind === 'zip' && process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`],
          { windowsHide: true, encoding: 'utf-8' },
        )
      : kind === 'zip'
        ? spawnSync('unzip', ['-o', archive, '-d', dir], { encoding: 'utf-8' })
        : spawnSync('tar', ['-xzf', archive, '-C', dir], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`압축을 풀지 못했습니다. ${(r.stderr || r.error?.message || '').toString().slice(0, 200)}`);
}

/** 터널 프로그램을 받아 사용자 데이터 폴더(bin)에 둔다. onProgress(0~1) */
export async function downloadTunnel(provider: TunnelProvider, onProgress: (p: number) => void): Promise<void> {
  const src = downloadUrl(provider);
  if (!src) throw new Error('이 운영체제에서는 자동으로 받을 수 없습니다. 직접 설치해 주세요.');
  const dir = binDir();
  await fs.mkdir(dir, { recursive: true });
  const name = exe(provider === 'cloudflare' ? 'cloudflared' : 'ngrok');
  const target = path.join(dir, name);
  const tmp = path.join(dir, `${name}.download`);
  const res = await net.fetch(src.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`받지 못했습니다 (HTTP ${res.status}). 인터넷 연결을 확인해 주세요.`);
  const total = Number(res.headers.get('content-length')) || 0;
  const h = await fs.open(tmp, 'w');
  let got = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await h.write(value);
      got += value.length;
      if (total) onProgress(Math.min(0.99, got / total));
    }
  } finally {
    await h.close();
  }
  if (src.kind === 'exe') {
    await fs.rm(target, { force: true });
    await fs.rename(tmp, target);
  } else {
    const archive = `${tmp}.${src.kind === 'zip' ? 'zip' : 'tgz'}`;
    await fs.rename(tmp, archive);
    try {
      extract(archive, src.kind, dir);
    } finally {
      await fs.rm(archive, { force: true });
    }
    if (!existsSync(target)) throw new Error('받은 파일 안에 실행 파일이 없습니다.');
  }
  if (process.platform !== 'win32') chmodSync(target, 0o755);
  onProgress(1);
}

// ───────────── 실행 ─────────────

/** ngrok 오류 코드 → 사용자에게 보여 줄 말 */
function ngrokHint(text: string): string {
  if (/ERR_NGROK_(4018|302)/.test(text)) return 'ngrok 인증 토큰이 없습니다. 아래에 토큰을 넣어 주세요.';
  if (/ERR_NGROK_(105|107|106)|authentication failed|invalid authtoken/i.test(text)) return 'ngrok 인증 토큰이 맞지 않습니다. ngrok 사이트의 “Your Authtoken”을 다시 복사해 넣어 주세요.';
  if (/ERR_NGROK_108/.test(text)) return '다른 곳에서 ngrok이 이미 실행 중입니다 (무료 계정은 한 번에 하나). 다른 ngrok을 끈 뒤 다시 시도하세요.';
  if (/ERR_NGROK_334|already online/i.test(text)) return '이 주소를 다른 ngrok이 쓰는 중입니다. 다른 ngrok을 끄거나 잠시 뒤 다시 시도하세요.';
  if (/ERR_NGROK_(320|313|314|315|319)|domain/i.test(text)) return '고정 주소(도메인)를 쓸 수 없습니다. ngrok 사이트의 Domains 화면에 있는 주소를 그대로 넣었는지 확인해 주세요.';
  return '';
}

export interface TunnelHandle {
  stop: () => void;
}

/**
 * 터널을 띄우고 주소를 알려 준다. onState로 starting → running(url) / missing / error(message)
 */
export function startTunnel(
  provider: TunnelProvider,
  port: number,
  opts: { ngrokToken?: string | null; ngrokDomain?: string | null },
  onState: (info: TunnelInfo) => void,
): TunnelHandle {
  let child: ChildProcess | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastError = '';
  let triedLegacyFlag = false;

  const finish = (info: TunnelInfo) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    onState(info);
  };

  const run = (legacyDomainFlag: boolean) => {
    const [cmd, pre] = tunnelCommand(provider);
    let args: string[];
    const env = { ...process.env };
    if (provider === 'cloudflare') {
      args = [...pre, 'tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`];
    } else {
      const domain = (opts.ngrokDomain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
      args = [...pre, 'http', `127.0.0.1:${port}`, '--log', 'stdout', '--log-format', 'json'];
      if (domain) args.push(...(legacyDomainFlag ? ['--domain', domain] : ['--url', `https://${domain}`]));
      // 토큰은 명령줄 대신 환경 변수로 (다른 프로그램의 프로세스 목록에 보이지 않게)
      if (opts.ngrokToken) env.NGROK_AUTHTOKEN = opts.ngrokToken;
    }
    let c: ChildProcess;
    try {
      c = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    } catch {
      finish({ state: 'missing', url: null, message: null });
      return;
    }
    child = c;
    let buffer = '';
    const onData = (buf: Buffer) => {
      if (child !== c) return;
      const text = buf.toString();
      if (provider === 'cloudflare') {
        const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m) finish({ state: 'running', url: m[0], message: null });
        return;
      }
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        let rec: Record<string, unknown> | null = null;
        try {
          rec = JSON.parse(line);
        } catch {
          if (/unknown flag: --url/.test(line)) lastError = 'unknown flag: --url';
          else if (line.trim()) lastError = line.trim();
          continue;
        }
        if (!rec) continue;
        const url = typeof rec.url === 'string' ? rec.url : '';
        if (/^https:\/\//.test(url) && /started tunnel|tunnel session started|endpoint/i.test(String(rec.msg ?? ''))) {
          finish({ state: 'running', url: url.replace(/\/+$/, ''), message: null });
        } else if (rec.err && rec.err !== '<nil>') lastError = String(rec.err);
        else if (rec.lvl === 'eror' || rec.lvl === 'crit') lastError = String(rec.msg ?? lastError);
      }
    };
    c.stdout?.on('data', onData);
    c.stderr?.on('data', onData);
    c.on('error', (err: NodeJS.ErrnoException) => {
      if (child !== c) return;
      child = null;
      if (err.code === 'ENOENT') finish({ state: 'missing', url: null, message: null });
      else finish({ state: 'error', url: null, message: `터널 프로그램을 실행하지 못했습니다: ${err.message}` });
    });
    c.on('exit', (code) => {
      if (child !== c) return;
      child = null;
      if (stopped) return;
      // 옛 ngrok(--url 없음)이면 --domain으로 한 번 더
      if (provider === 'ngrok' && /unknown flag: --url/.test(lastError) && !triedLegacyFlag) {
        triedLegacyFlag = true;
        lastError = '';
        run(true);
        return;
      }
      const hint = provider === 'ngrok' ? ngrokHint(lastError) : '';
      finish({
        state: 'error',
        url: null,
        message: hint || `터널이 멈췄습니다 (코드 ${code ?? '?'}).${lastError ? ` ${lastError.slice(0, 200)}` : ''} 다시 시도하세요.`,
      });
    });
  };

  if (provider === 'ngrok' && !opts.ngrokToken) {
    onState({ state: 'needs-token', url: null, message: null });
    return { stop: () => undefined };
  }
  onState({ state: 'starting', url: null, message: null });
  timer = setTimeout(() => {
    if (stopped) return;
    const hint = provider === 'ngrok' ? ngrokHint(lastError) : '';
    onState({ state: 'error', url: null, message: hint || '터널 주소를 받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.' });
    child?.kill();
    child = null;
  }, TUNNEL_TIMEOUT_MS);
  run(false);
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      const c = child;
      child = null;
      c?.kill();
    },
  };
}
