import { useEffect, useState, type ReactNode } from 'react';
import type { AiSettings as Settings, AiState } from '../ai/protocol';
import { desktopApi } from '../persistence/fileService';
import { useStore } from '../store/store';
import { SparkIcon } from './AiToast';

const EXAMPLES = [
  '지금까지 대화를 ThoughtFlow에 흐름으로 정리해줘',
  "ThoughtFlow의 '여행 계획' 프로젝트를 열고, 내가 적어 둔 생각을 바탕으로 다음 행동을 같이 정해줘",
  "'비행기 표' Box 뒤에 우리가 방금 정한 결정을 이어서 적어줘",
  '내 보드에서 아직 결과가 없는 행동이 뭐가 있는지 알려줘',
];

/**
 * AI 연결 설정 창: Claude 데스크톱 / ChatGPT를 이 앱에 연결한다.
 * 사용자의 구독 계정(Claude Pro, ChatGPT Plus 등)을 그대로 쓰고, API 키는 필요 없다.
 */
export function AiSettings() {
  const open = useStore((s) => s.aiSettingsOpen);
  const setOpen = useStore((s) => s.setAiSettingsOpen);
  const [state, setState] = useState<AiState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !desktopApi) return;
    void desktopApi.aiGetState().then(setState);
    return desktopApi.onAiState(setState);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setNotice(null);
      setConfig(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.isComposing && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const set = async (patch: Partial<Settings>) => {
    if (desktopApi) setState(await desktopApi.aiSetSettings(patch));
  };
  const s = state?.settings;
  const gpt = state?.chatgpt;

  return (
    <>
      <div className="modal-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="ai-settings" role="dialog" aria-label="AI 연결" data-testid="ai-settings">
        <div className="ai-head">
          <SparkIcon size={16} />
          <span>AI 연결</span>
          <button className="drawer-icon-btn" title="닫기 (Esc)" onClick={() => setOpen(false)}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        <div className="ai-body">
          <p className="ai-intro">
            Claude나 ChatGPT와 대화하면 AI가 <b>대화의 흐름을 이 보드에 Box와 Route로 정리</b>하고, <b>보드에 적힌 생각을 바탕으로</b>{' '}
            대화합니다. 지금 열려 있는 프로젝트가 대상이며, 쓰고 있는 구독 계정을 그대로 씁니다 (API 키 필요 없음).
          </p>
          {!desktopApi && <p className="ai-warn">데스크톱 앱에서만 사용할 수 있습니다.</p>}
          {notice && <p className="ai-notice" data-testid="ai-notice">{notice}</p>}

          {/* ── Claude ── */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span className="ai-section-title">Claude 데스크톱</span>
              <Status on={!!state?.claude.running} lastUsed={state?.claude.lastUsed ?? null} />
              <Toggle testId="ai-toggle-claude" checked={!!s?.claude} onChange={(v) => void set({ claude: v })} />
            </div>
            <ol className="ai-steps">
              <li>Claude 데스크톱 앱을 설치하고 평소 계정으로 로그인합니다.</li>
              <li>
                <button
                  className="ai-primary"
                  data-testid="ai-install-claude"
                  disabled={!state?.claude.extensionAvailable}
                  onClick={async () => {
                    const r = await desktopApi!.aiInstallClaude();
                    setNotice(r.ok ? 'Claude 데스크톱에서 설치 창이 열리면 "설치"를 누르세요.' : (r.error ?? '열지 못했습니다.'));
                  }}
                >
                  Claude 데스크톱에 설치
                </button>{' '}
                → Claude에 설치 창이 뜨면 <b>설치</b>.
                <div className="ai-sub">
                  설치 창이 뜨지 않으면{' '}
                  <button
                    className="ai-link"
                    disabled={!state?.claude.extensionAvailable}
                    onClick={async () => {
                      const r = await desktopApi!.aiSaveExtension();
                      if (r.ok) setNotice('저장한 파일을 Claude 설정 → 확장 프로그램(Extensions) 화면으로 끌어다 놓으세요.');
                      else if (r.error) setNotice(r.error);
                    }}
                  >
                    확장 파일 저장…
                  </button>{' '}
                  후 Claude 설정 → 확장 프로그램(Extensions)에 끌어다 놓으세요.
                </div>
              </li>
              <li>Claude 채팅에서 아래 예시처럼 말합니다. ThoughtFlow가 꺼져 있으면 자동으로 켜집니다.</li>
            </ol>
            <details
              className="ai-details"
              onToggle={(e) => {
                if ((e.target as HTMLDetailsElement).open && !config) void desktopApi?.aiClaudeConfig().then(setConfig);
              }}
            >
              <summary>직접 설정하기 (확장 설치가 안 될 때)</summary>
              <p>
                Claude 설정 → 개발자(Developer) → 설정 편집(Edit Config)으로 <code>claude_desktop_config.json</code>을 열고 아래 내용을 넣은 뒤
                Claude를 다시 시작하세요.
              </p>
              {config && <CopyBlock text={config} />}
            </details>
          </section>

          {/* ── ChatGPT ── */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span className="ai-section-title">ChatGPT</span>
              <Status on={!!gpt?.publicUrl} lastUsed={gpt?.lastUsed ?? null} />
              <Toggle testId="ai-toggle-chatgpt" checked={!!s?.chatgpt} onChange={(v) => void set({ chatgpt: v })} />
            </div>
            {!s?.chatgpt ? (
              <p className="ai-sub">
                ChatGPT는 인터넷 주소(HTTPS)로만 연결할 수 있어, 켜면 이 PC의 ThoughtFlow에 임시 공개 주소가 만들어집니다. 주소를 아는 사람만 쓸 수
                있으니 다른 사람과 공유하지 마세요. (ChatGPT 개발자 모드가 되는 요금제 필요)
              </p>
            ) : (
              <>
                <TunnelView state={state} onRetry={async () => desktopApi && setState(await desktopApi.aiRestartTunnel())} />
                <ol className="ai-steps">
                  <li>ChatGPT 설정 → 앱 및 커넥터(Apps &amp; Connectors) → 고급 설정에서 <b>개발자 모드</b>를 켭니다.</li>
                  <li>
                    <b>커넥터 만들기</b>: 이름 <code>ThoughtFlow</code>, MCP 서버 URL = 위 주소, 인증 = <b>인증 없음</b>.
                  </li>
                  <li>새 채팅에서 ThoughtFlow 커넥터를 켜고 아래 예시처럼 말합니다.</li>
                </ol>
                <p className="ai-sub">
                  ThoughtFlow를 다시 켜면 주소가 바뀌므로 ChatGPT 커넥터의 주소도 새 주소로 바꿔 주세요.{' '}
                  <button
                    className="ai-link"
                    onClick={async () => {
                      if (!desktopApi) return;
                      setState(await desktopApi.aiRegenerateSecret());
                      setNotice('새 주소를 만들었습니다. 예전 주소는 더 이상 쓸 수 없습니다.');
                    }}
                  >
                    주소 새로 만들기
                  </button>
                </p>
                {gpt?.localUrl && (
                  <details className="ai-details">
                    <summary>직접 터널을 쓰는 경우</summary>
                    <p>이 PC 안의 주소입니다. ngrok 등 다른 HTTPS 터널을 이 주소로 연결해도 됩니다.</p>
                    <CopyBlock text={gpt.localUrl} testId="ai-local-url" />
                  </details>
                )}
              </>
            )}
          </section>

          {/* ── 권한 ── */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span className="ai-section-title">AI가 Box·Route를 지울 수 있게 허용</span>
              <Toggle testId="ai-toggle-delete" checked={!!s?.allowDelete} onChange={(v) => void set({ allowDelete: v })} />
            </div>
            <p className="ai-sub">
              꺼져 있으면 AI는 추가하고 고치기만 합니다. AI가 바꾼 내용은 알림의 <b>되돌리기</b>나 <kbd>Ctrl+Z</kbd>로 언제든 되돌릴 수 있습니다.
            </p>
          </section>

          <section className="ai-section">
            <div className="ai-section-title">이렇게 말해 보세요</div>
            <ul className="ai-examples">
              {EXAMPLES.map((e) => (
                <li key={e}>“{e}”</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function TunnelView({ state, onRetry }: { state: AiState | null; onRetry: () => void }) {
  const gpt = state?.chatgpt;
  if (!gpt) return null;
  if (gpt.error) return <p className="ai-warn">{gpt.error}</p>;
  const t = gpt.tunnel;
  if (gpt.publicUrl) {
    return (
      <div className="ai-url">
        <div className="ai-label">ChatGPT에 넣을 주소</div>
        <CopyBlock text={gpt.publicUrl} testId="ai-public-url" />
      </div>
    );
  }
  if (t.state === 'missing') {
    return (
      <div className="ai-warn" data-testid="ai-tunnel-missing">
        공개 주소를 만들려면 <b>cloudflared</b>(무료)가 필요합니다. 명령 프롬프트에서 아래 명령을 실행해 설치한 뒤{' '}
        <button className="ai-link" onClick={onRetry}>
          다시 시도
        </button>
        를 누르세요.
        <CopyBlock text="winget install --id Cloudflare.cloudflared" />
      </div>
    );
  }
  if (t.state === 'error') {
    return (
      <div className="ai-warn">
        {t.message}{' '}
        <button className="ai-link" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }
  return <p className="ai-sub" data-testid="ai-tunnel-starting">공개 주소를 만드는 중…</p>;
}

function Status({ on, lastUsed }: { on: boolean; lastUsed: number | null }) {
  return (
    <span className={`ai-status${on ? ' is-on' : ''}`}>
      {on ? (lastUsed ? `연결됨 · ${ago(lastUsed)} 사용` : '연결 준비됨') : '꺼짐'}
    </span>
  );
}

function Toggle({ checked, onChange, testId }: { checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <button role="switch" aria-checked={checked} className="ai-toggle" data-testid={testId} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function CopyBlock({ text, testId }: { text: string; testId?: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre data-testid={testId}>{text}</pre>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(text).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? '복사됨' : '복사'}
      </button>
    </div>
  );
}

function ago(ms: number): string {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  return `${Math.floor(s / 3600)}시간 전`;
}
