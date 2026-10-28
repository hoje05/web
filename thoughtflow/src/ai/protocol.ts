/**
 * AI 연결(MCP)과 앱 화면 사이에 오가는 요청/응답 형식.
 * MCP 서버(mcp/)와 Electron main, renderer가 함께 쓰는 순수 타입이다.
 */

export const AI_TOOL_NAMES = [
  'get_board',
  'read_box',
  'search_boxes',
  'add_flow',
  'update_box',
  'connect_boxes',
  'delete_items',
  'focus_box',
  'list_projects',
  'open_project',
  'create_project',
] as const;

export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** Box나 Route를 지우는 도구 — 설정에서 허용해야 동작한다 */
export const DESTRUCTIVE_TOOLS: readonly AiToolName[] = ['delete_items'];

export interface AiRequest {
  tool: AiToolName;
  args: Record<string, unknown>;
  /** 요청한 AI 이름 (Claude, ChatGPT …) — 알림과 Box 표시에 쓴다 */
  client: string;
}

export interface AiResponse {
  text: string;
  isError?: boolean;
}

export interface FlowBoxInput {
  /** 이번 요청 안에서만 쓰는 이름 (routes에서 참조) */
  key?: string;
  title: string;
  note?: string;
}

export interface FlowRouteInput {
  /** 새 Box의 key 또는 기존 Box id(또는 정확한 제목) */
  from: string;
  to: string;
}

export interface AddFlowArgs {
  boxes: FlowBoxInput[];
  routes?: FlowRouteInput[];
  /** 기존 Box id(또는 정확한 제목): 새 흐름을 이 Box 뒤에 잇는다 */
  after?: string;
}

/** MCP 클라이언트 이름 → 사용자에게 보여 줄 AI 이름 */
export function aiDisplayName(clientName: string | undefined): string {
  const n = (clientName ?? '').toLowerCase();
  if (n.includes('claude')) return 'Claude';
  if (n.includes('openai') || n.includes('chatgpt') || n.includes('gpt')) return 'ChatGPT';
  return 'AI';
}

// ───────────── AI 연결 설정 (settings.json의 "ai") ─────────────

export interface AiSettings {
  /** Claude 데스크톱 연결 (이 PC 안에서만) */
  claude: boolean;
  /** 인터넷 주소 연결: ChatGPT 플러그인 · Claude 웹 커넥터 (HTTPS 터널로 공개되는 주소) */
  chatgpt: boolean;
  /** AI가 Box·Route를 지울 수 있게 허용 */
  allowDelete: boolean;
  /** 인터넷 주소를 만드는 방법: Cloudflare 임시 주소(가입 없음, 켤 때마다 바뀜) / ngrok 고정 주소(무료 가입) */
  tunnel: TunnelProvider;
}

export type TunnelProvider = 'cloudflare' | 'ngrok';

export const DEFAULT_AI_SETTINGS: AiSettings = { claude: true, chatgpt: false, allowDelete: false, tunnel: 'cloudflare' };

/**
 * missing = 터널 프로그램이 없음 (받기 버튼), downloading = 받는 중,
 * needs-token = ngrok 인증 토큰을 넣어야 함
 */
export type TunnelState = 'off' | 'starting' | 'running' | 'missing' | 'downloading' | 'needs-token' | 'error';

/** 설정 창에 보여 줄 연결 상태 */
export interface AiState {
  settings: AiSettings;
  claude: {
    running: boolean;
    lastUsed: number | null;
    /** Claude 데스크톱 확장 파일(.mcpb)이 앱에 들어 있음 */
    extensionAvailable: boolean;
  };
  chatgpt: {
    running: boolean;
    /** 이 PC 안의 주소 (직접 터널을 쓸 때) */
    localUrl: string | null;
    tunnel: { state: TunnelState; url: string | null; message: string | null };
    /** ChatGPT에 넣을 주소 (터널 주소 + 비밀 경로) */
    publicUrl: string | null;
    lastUsed: number | null;
    error: string | null;
    provider: TunnelProvider;
    ngrok: { hasToken: boolean; domain: string | null };
    /** 지난번에 쓰던 주소와 달라졌으면 지난 주소 (플러그인·커넥터의 주소를 바꿔야 함) */
    previousUrl: string | null;
    /** 터널 프로그램을 받는 중이면 0~1 */
    download: number | null;
  };
}

/** "연결 점검" 결과 한 줄 */
export interface DiagnosisItem {
  status: 'ok' | 'warn' | 'error' | 'info';
  title: string;
  detail?: string;
}

export interface Diagnosis {
  items: DiagnosisItem[];
  /** 그대로 복사해 보낼 수 있는 글 */
  report: string;
  claude: {
    /** Claude 데스크톱이 이 PC에 있음 (설정 폴더 기준) */
    installed: boolean;
    /** 확장(.mcpb)으로 설치되어 있음 */
    extension: { version: string; enabled: boolean | null } | null;
    /** claude_desktop_config.json에 등록되어 있음 (ok = 가리키는 프로그램이 있음) */
    config: { ok: boolean } | null;
  };
}
