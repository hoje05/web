import { useEffect, useState, type ReactNode } from 'react';
import type { AiSettings as Settings, AiState, Diagnosis, TunnelProvider } from '../ai/protocol';
import { desktopApi } from '../persistence/fileService';
import { useStore } from '../store/store';
import { SparkIcon } from './AiToast';

const EXAMPLES = [
  '지금까지 대화를 ThoughtFlow에 정리해줘 (새 프로젝트로 만들어져요)',
  "ThoughtFlow의 '여행 계획' 프로젝트를 열고, 내가 적어 둔 생각을 바탕으로 다음 행동을 같이 정해줘",
  "'비행기 표' Box 뒤에 우리가 방금 정한 결정을 이어서 적어줘",
  "'실험 결과' Box 메모에 방금 숫자들을 막대그래프로 넣어줘",
];

const LINKS = {
  chatgptPlugins: 'https://chatgpt.com/plugins',
  claudeConnectors: 'https://claude.ai/settings/connectors',
  claudeDownload: 'https://claude.ai/download',
  ngrokSignup: 'https://dashboard.ngrok.com/signup',
  ngrokToken: 'https://dashboard.ngrok.com/get-started/your-authtoken',
  ngrokDomains: 'https://dashboard.ngrok.com/domains',
};

const openLink = (url: string) => void desktopApi?.openExternal(url);

/**
 * AI 연결 설정 창.
 *  - Claude 데스크톱: 이 PC 안에서 바로 (확장 설치 또는 설정 파일에 직접 등록) + 연결 점검
 *  - 인터넷 주소: ChatGPT 플러그인 · Claude 웹/휴대폰 커넥터 (Cloudflare 임시 주소 또는 ngrok 고정 주소)
 * 사용자의 구독 계정(Claude Pro, ChatGPT Plus 등)을 그대로 쓰고, API 키는 필요 없다.
 */
export function AiSettings() {
  const open = useStore((s) => s.aiSettingsOpen);
  const setOpen = useStore((s) => s.setAiSettingsOpen);
  const [state, setState] = useState<AiState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diagnosis | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open || !desktopApi) return;
    void desktopApi.aiGetState().then(setState);
    return desktopApi.onAiState(setState);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setNotice(null);
      setConfig(null);
      setDiag(null);
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
  const runCheck = async () => {
    if (!desktopApi) return;
    setChecking(true);
    try {
      setDiag(await desktopApi.aiDiagnose());
    } finally {
      setChecking(false);
    }
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
          {notice && (
            <p className="ai-notice" data-testid="ai-notice">
              {notice}
            </p>
          )}

          {/* ── Claude 데스크톱 ── */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span className="ai-section-title">Claude 데스크톱</span>
              <Status on={!!state?.claude.running} lastUsed={state?.claude.lastUsed ?? null} />
              <Toggle testId="ai-toggle-claude" checked={!!s?.claude} onChange={(v) => void set({ claude: v })} />
            </div>
            <ol className="ai-steps">
              <li>
                Claude 데스크톱 앱을 설치하고 평소 계정으로 로그인합니다.{' '}
                <button className="ai-link" onClick={() => openLink(LINKS.claudeDownload)}>
                  Claude 데스크톱 받기
                </button>
              </li>
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
                  설치 창이 뜨지 않거나 설치해도 연결이 안 되면{' '}
                  <button
                    className="ai-link"
                    data-testid="ai-claude-register"
                    onClick={async () => {
                      const r = await desktopApi!.aiClaudeRegister();
                      setNotice(
                        r.ok
                          ? 'Claude 설정 파일에 ThoughtFlow를 등록했습니다. Claude를 완전히 종료(작업 표시줄 오른쪽 트레이의 Claude 아이콘 → 종료)한 뒤 다시 켜세요.'
                          : r.error,
                      );
                      if (diag) void runCheck();
                    }}
                  >
                    설정 파일에 직접 등록
                  </button>
                  을 누른 뒤 Claude를 완전히 껐다 켜세요 (확장 설치가 필요 없습니다). 확장 파일을 직접 넣으려면{' '}
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
                  </button>
                </div>
              </li>
              <li>Claude 채팅에서 아래 예시처럼 말합니다. ThoughtFlow가 꺼져 있으면 자동으로 켜집니다.</li>
            </ol>

            <div className="ai-check">
              <button className="ai-secondary" data-testid="ai-diagnose" disabled={checking || !desktopApi} onClick={() => void runCheck()}>
                {checking ? '점검하는 중…' : '연결 점검'}
              </button>
              <span className="ai-sub">연결이 안 되면 눌러 보세요. 무엇이 문제인지 알려 줍니다.</span>
            </div>
            {diag && (
              <DiagnosisView
                diag={diag}
                onUnregister={async () => {
                  const r = await desktopApi!.aiClaudeUnregister();
                  setNotice(r.ok ? 'Claude 설정 파일에서 ThoughtFlow 등록을 뺐습니다. Claude를 다시 켜면 적용됩니다.' : r.error);
                  void runCheck();
                }}
              />
            )}

            <details
              className="ai-details"
              onToggle={(e) => {
                if ((e.target as HTMLDetailsElement).open && !config) void desktopApi?.aiClaudeConfig().then(setConfig);
              }}
            >
              <summary>설정 파일을 손으로 고치려면</summary>
              <p>
                Claude 설정 → 개발자(Developer) → 설정 편집(Edit Config)으로 <code>claude_desktop_config.json</code>을 열고 아래 내용을 넣은 뒤
                Claude를 다시 시작하세요. (“설정 파일에 직접 등록” 버튼이 하는 일과 같습니다)
              </p>
              {config && <CopyBlock text={config} />}
            </details>
          </section>

          {/* ── 인터넷 주소: ChatGPT 플러그인 · Claude 웹 ── */}
          <section className="ai-section">
            <div className="ai-section-head">
              <span className="ai-section-title">ChatGPT 플러그인 · Claude 웹</span>
              <Status on={!!gpt?.publicUrl} lastUsed={gpt?.lastUsed ?? null} />
              <Toggle testId="ai-toggle-chatgpt" checked={!!s?.chatgpt} onChange={(v) => void set({ chatgpt: v })} />
            </div>
            {!s?.chatgpt ? (
              <p className="ai-sub">
                ChatGPT와 웹·휴대폰의 Claude는 인터넷 주소(HTTPS)로만 연결할 수 있어, 켜면 이 PC의 ThoughtFlow로 들어오는 <b>비밀 주소</b>가
                만들어집니다. 주소를 아는 쪽만 쓸 수 있으니 다른 사람과 공유하지 마세요. 보드 파일은 계속 이 PC에만 있습니다.
              </p>
            ) : (
              <>
                <div className="ai-seg" role="radiogroup" aria-label="주소 만드는 방법">
                  <ProviderOption
                    provider="cloudflare"
                    current={gpt?.provider}
                    title="임시 주소"
                    sub="Cloudflare · 가입 없음 · 켤 때마다 바뀜"
                    onPick={(p) => void set({ tunnel: p })}
                  />
                  <ProviderOption
                    provider="ngrok"
                    current={gpt?.provider}
                    title="고정 주소"
                    sub="ngrok 무료 계정 · 한 번 등록하면 그대로"
                    onPick={(p) => void set({ tunnel: p })}
                  />
                </div>
                {gpt?.provider === 'ngrok' && <NgrokSetup state={state} onSaved={setState} />}
                <TunnelView state={state} onRetry={async () => desktopApi && setState(await desktopApi.aiRestartTunnel())} onNotice={setNotice} />
                {gpt?.previousUrl && (
                  <div className="ai-warn" data-testid="ai-url-changed">
                    <b>주소가 바뀌었습니다.</b> ChatGPT 플러그인과 Claude 커넥터에 넣어 둔 주소를 위의 새 주소로 바꿔 주세요.
                    <div className="ai-old-url">예전 주소: {gpt.previousUrl}</div>
                    {gpt.provider === 'cloudflare' && <div>매번 바꾸기 번거로우면 위에서 “고정 주소”를 고르세요.</div>}
                    <button className="ai-link" onClick={async () => desktopApi && setState(await desktopApi.aiAckUrl())}>
                      바꿨어요
                    </button>
                  </div>
                )}

                <div className="ai-label">ChatGPT 플러그인으로 쓰기</div>
                <ol className="ai-steps">
                  <li>
                    <button className="ai-link" data-testid="ai-open-chatgpt" onClick={() => openLink(LINKS.chatgptPlugins)}>
                      ChatGPT 플러그인 화면 열기
                    </button>{' '}
                    (chatgpt.com/plugins) → <b>추가(Add)</b> → <b>사용자 지정 MCP 서버 추가(Add custom MCP server)</b>
                  </li>
                  <li>
                    이름 <code>ThoughtFlow</code>, MCP 서버 URL = 위 주소, 인증 = <b>없음(No authentication)</b> → 안내를 읽고 “이해했습니다” 체크 →{' '}
                    <b>만들기</b>
                  </li>
                  <li>새 채팅의 + 메뉴에서 ThoughtFlow 플러그인을 고르고 아래 예시처럼 말합니다.</li>
                </ol>
                <p className="ai-sub">사용자 지정 MCP 플러그인을 만들 수 있는 요금제(Plus·Pro 등)가 필요하고, 회사 계정은 관리자가 허용해야 할 수 있습니다.</p>

                <div className="ai-label">Claude 웹·휴대폰에서 쓰기 (커넥터)</div>
                <ol className="ai-steps">
                  <li>
                    <button className="ai-link" onClick={() => openLink(LINKS.claudeConnectors)}>
                      Claude 커넥터 화면 열기
                    </button>{' '}
                    → <b>커넥터 추가(Add custom connector)</b>
                  </li>
                  <li>
                    이름 <code>ThoughtFlow</code>, 원격 MCP 서버 URL = 위 주소 → <b>추가</b>. 채팅 화면의 도구 메뉴에서 ThoughtFlow를 켭니다.
                  </li>
                </ol>

                <p className="ai-sub">
                  주소가 다른 사람에게 알려졌다면{' '}
                  <button
                    className="ai-link"
                    onClick={async () => {
                      if (!desktopApi) return;
                      setState(await desktopApi.aiRegenerateSecret());
                      setNotice('새 주소를 만들었습니다. 예전 주소는 더 이상 쓸 수 없습니다. 플러그인·커넥터의 주소도 바꿔 주세요.');
                    }}
                  >
                    주소 새로 만들기
                  </button>
                </p>
                {gpt?.localUrl && (
                  <details className="ai-details">
                    <summary>직접 터널을 쓰는 경우</summary>
                    <p>이 PC 안의 주소입니다. 다른 HTTPS 터널을 이 주소로 연결해도 됩니다.</p>
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

function ProviderOption(props: { provider: TunnelProvider; current?: TunnelProvider; title: string; sub: string; onPick: (p: TunnelProvider) => void }) {
  const on = props.current === props.provider;
  return (
    <button
      role="radio"
      aria-checked={on}
      className={`ai-seg-option${on ? ' is-on' : ''}`}
      data-testid={`ai-provider-${props.provider}`}
      onClick={() => !on && props.onPick(props.provider)}
    >
      <span className="ai-seg-title">{props.title}</span>
      <span className="ai-seg-sub">{props.sub}</span>
    </button>
  );
}

/** ngrok: 무료 가입 → 인증 토큰 붙여 넣기 (고정 주소는 비워 두면 계정 기본 주소) */
function NgrokSetup({ state, onSaved }: { state: AiState | null; onSaved: (s: AiState) => void }) {
  const ngrok = state?.chatgpt.ngrok;
  const [token, setToken] = useState('');
  const [domain, setDomain] = useState(ngrok?.domain ?? '');
  const [editing, setEditing] = useState(!ngrok?.hasToken);
  useEffect(() => setDomain(ngrok?.domain ?? ''), [ngrok?.domain]);
  if (!ngrok) return null;
  const save = async () => {
    if (!desktopApi) return;
    onSaved(await desktopApi.aiSetNgrok({ ...(token.trim() ? { token: token.trim() } : {}), domain }));
    setToken('');
    setEditing(false);
  };
  if (!editing) {
    return (
      <p className="ai-sub" data-testid="ai-ngrok-saved">
        ngrok 인증 토큰이 저장되어 있습니다{ngrok.domain ? ` · 고정 주소 ${ngrok.domain}` : ''}.{' '}
        <button className="ai-link" onClick={() => setEditing(true)}>
          바꾸기
        </button>
      </p>
    );
  }
  return (
    <div className="ai-ngrok" data-testid="ai-ngrok-setup">
      <ol className="ai-steps">
        <li>
          <button className="ai-link" onClick={() => openLink(LINKS.ngrokSignup)}>
            ngrok에 무료 가입
          </button>{' '}
          (구글 계정으로도 됩니다)
        </li>
        <li>
          <button className="ai-link" onClick={() => openLink(LINKS.ngrokToken)}>
            Your Authtoken 화면
          </button>
          에서 토큰을 복사해 아래에 붙여 넣기
        </li>
        <li>
          (선택){' '}
          <button className="ai-link" onClick={() => openLink(LINKS.ngrokDomains)}>
            Domains 화면
          </button>
          에 보이는 내 주소(예: <code>my-name.ngrok-free.dev</code>)를 넣으면 그 주소로 고정됩니다
        </li>
      </ol>
      <div className="ai-form">
        <input
          className="ai-input"
          type="password"
          placeholder={ngrok.hasToken ? '새 토큰 (비워 두면 그대로)' : '인증 토큰 (Authtoken)'}
          value={token}
          spellCheck={false}
          autoComplete="off"
          data-testid="ai-ngrok-token"
          onChange={(e) => setToken(e.target.value)}
        />
        <input
          className="ai-input"
          placeholder="고정 주소 (선택) 예: my-name.ngrok-free.dev"
          value={domain}
          spellCheck={false}
          data-testid="ai-ngrok-domain"
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        <button className="ai-primary" data-testid="ai-ngrok-save" disabled={!token.trim() && !ngrok.hasToken} onClick={() => void save()}>
          저장하고 연결
        </button>
      </div>
      <p className="ai-sub">토큰은 이 PC 안에만, 이 Windows 사용자만 풀 수 있게 암호화해 저장합니다.</p>
    </div>
  );
}

function TunnelView({ state, onRetry, onNotice }: { state: AiState | null; onRetry: () => void; onNotice: (n: string) => void }) {
  const gpt = state?.chatgpt;
  if (!gpt) return null;
  if (gpt.error) return <p className="ai-warn">{gpt.error}</p>;
  const t = gpt.tunnel;
  const program = gpt.provider === 'ngrok' ? 'ngrok' : 'cloudflared';
  if (gpt.publicUrl) {
    return (
      <div className="ai-url">
        <div className="ai-label">ChatGPT·Claude에 넣을 주소{gpt.provider === 'ngrok' ? ' (고정)' : ' (이번 실행 동안)'}</div>
        <CopyBlock text={gpt.publicUrl} testId="ai-public-url" />
      </div>
    );
  }
  if (t.state === 'downloading') {
    const pct = Math.round((gpt.download ?? 0) * 100);
    return (
      <div className="ai-sub" data-testid="ai-tunnel-downloading">
        {program}를 받는 중… {pct}%
        <div className="ai-progress">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (t.state === 'missing') {
    return (
      <div className="ai-warn" data-testid="ai-tunnel-missing">
        인터넷 주소를 만들려면 <b>{program}</b>(무료, {gpt.provider === 'ngrok' ? 'ngrok' : 'Cloudflare'} 제공)가 필요합니다.{' '}
        <button
          className="ai-primary"
          data-testid="ai-tunnel-download"
          onClick={async () => {
            const r = await desktopApi?.aiDownloadTunnel();
            if (r && !r.ok && r.error) onNotice(r.error);
          }}
        >
          자동으로 받기
        </button>
        <div className="ai-sub">
          직접 설치하려면 명령 프롬프트에서 아래 명령을 실행한 뒤{' '}
          <button className="ai-link" onClick={onRetry}>
            다시 시도
          </button>
          를 누르세요.
        </div>
        <CopyBlock text={gpt.provider === 'ngrok' ? 'winget install --id ngrok.ngrok' : 'winget install --id Cloudflare.cloudflared'} />
      </div>
    );
  }
  if (t.state === 'needs-token') {
    return (
      <p className="ai-warn" data-testid="ai-tunnel-needs-token">
        위에 ngrok 인증 토큰을 넣으면 고정 주소가 만들어집니다.
      </p>
    );
  }
  if (t.state === 'error') {
    return (
      <div className="ai-warn" data-testid="ai-tunnel-error">
        {t.message}{' '}
        <button className="ai-link" onClick={onRetry}>
          다시 시도
        </button>
      </div>
    );
  }
  return (
    <p className="ai-sub" data-testid="ai-tunnel-starting">
      인터넷 주소를 만드는 중…
    </p>
  );
}

function DiagnosisView({ diag, onUnregister }: { diag: Diagnosis; onUnregister: () => void }) {
  const icon = { ok: '✓', warn: '!', error: '✕', info: 'i' } as const;
  return (
    <div className="ai-diag" data-testid="ai-diagnosis">
      <ul>
        {diag.items.map((it, i) => (
          <li key={i} className={`is-${it.status}`} data-testid="ai-diag-item" data-status={it.status}>
            <span className="ai-diag-icon">{icon[it.status]}</span>
            <div>
              <div className="ai-diag-title">{it.title}</div>
              {it.detail && <div className="ai-diag-detail">{it.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
      <div className="ai-diag-actions">
        <CopyButton text={diag.report} label="점검 결과 복사" />
        {diag.claude.config && (
          <button className="ai-link" data-testid="ai-claude-unregister" onClick={onUnregister}>
            설정 파일 등록 해제
          </button>
        )}
      </div>
    </div>
  );
}

function Status({ on, lastUsed }: { on: boolean; lastUsed: number | null }) {
  return <span className={`ai-status${on ? ' is-on' : ''}`}>{on ? (lastUsed ? `연결됨 · ${ago(lastUsed)} 사용` : '연결 준비됨') : '꺼짐'}</span>;
}

function Toggle({ checked, onChange, testId }: { checked: boolean; onChange: (v: boolean) => void; testId: string }) {
  return (
    <button role="switch" aria-checked={checked} className="ai-toggle" data-testid={testId} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="ai-secondary"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '복사됨' : label}
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
