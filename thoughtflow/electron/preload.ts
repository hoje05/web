import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { AiRequest, AiResponse, AiSettings, AiState, Diagnosis } from '../src/ai/protocol';

type AttachResult = {
  attachments: {
    id: string;
    type: 'image' | 'file';
    name: string;
    relativePath: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
  }[];
  errors: string[];
};

/**
 * Renderer가 사용할 수 있는 유일한 OS API.
 * (src/persistence/ 에서만 사용한다)
 */
const api = {
  openFile: (): Promise<{ canceled: true } | { canceled: false; filePath: string; content: string }> =>
    ipcRenderer.invoke('file:open'),
  readFile: (filePath: string): Promise<{ filePath: string; content: string }> =>
    ipcRenderer.invoke('file:read', filePath),
  /** 이름 없는 보드를 자동 저장할 새 경로 (사용자 폴더/ThoughtFlow) */
  newBoardPath: (): Promise<string> => ipcRenderer.invoke('file:new-path'),
  /** filePath가 null이면 저장 위치를 묻는다 (다른 이름으로 저장) */
  saveFile: (args: {
    filePath: string | null;
    content: string;
    suggestedName: string;
    /** 다른 이름으로 저장할 때 첨부 자료 폴더를 복사해 올 원래 프로젝트 */
    assetsFrom?: string | null;
  }): Promise<{ canceled: true } | { canceled: false; filePath: string }> => ipcRenderer.invoke('file:save', args),
  alert: (message: string): Promise<void> => ipcRenderer.invoke('app:alert', message),
  /** 안내에 나오는 사이트(ChatGPT·Claude·ngrok)만 기본 브라우저로 연다 */
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('app:open-external', url),
  confirm: (message: string): Promise<boolean> => ipcRenderer.invoke('app:confirm', message),
  startupBoard: (): Promise<{ filePath: string; content: string } | null> => ipcRenderer.invoke('app:startup-board'),
  setLastFile: (filePath: string | null) => ipcRenderer.send('app:set-last-file', filePath),
  closeNow: () => ipcRenderer.send('app:close-now'),
  closeCancelled: () => ipcRenderer.send('app:close-cancelled'),
  onMenuCommand: (callback: (command: string) => void) => {
    const listener = (_e: IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on('menu-command', listener);
    return () => ipcRenderer.removeListener('menu-command', listener);
  },
  // ── 프로그램 바 ──
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('win:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:is-maximized'),
  onWindowState: (callback: (state: { maximized: boolean }) => void) => {
    const listener = (_e: IpcRendererEvent, state: { maximized: boolean }) => callback(state);
    ipcRenderer.on('window-state', listener);
    return () => ipcRenderer.removeListener('window-state', listener);
  },
  showMenu: (x: number, y: number) => ipcRenderer.send('app:show-menu', { x, y }),

  // ── 프로젝트 ──
  listProjects: (): Promise<{ filePath: string; name: string; modifiedAt: number; boxCount: number | null }[]> =>
    ipcRenderer.invoke('projects:list'),
  createProjectFile: (name: string, content: string): Promise<{ filePath: string } | { error: string }> =>
    ipcRenderer.invoke('projects:create', name, content),
  projectsDir: (): Promise<string> => ipcRenderer.invoke('projects:dir'),
  renameProject: (filePath: string, name: string): Promise<{ filePath: string } | { error: string }> =>
    ipcRenderer.invoke('projects:rename', filePath, name),
  deleteProject: (filePath: string): Promise<{ deleted: boolean }> => ipcRenderer.invoke('projects:delete', filePath),
  revealProjects: (): Promise<void> => ipcRenderer.invoke('projects:reveal'),

  // ── Box 첨부 (프로젝트 옆 "이름.assets" 폴더, 이 PC 안) ──
  attachPick: (projectPath: string, kind: 'image' | 'any'): Promise<AttachResult> => ipcRenderer.invoke('attach:pick', projectPath, kind),
  attachPaths: (projectPath: string, paths: string[]): Promise<AttachResult> => ipcRenderer.invoke('attach:paths', projectPath, paths),
  attachData: (projectPath: string, items: { name: string; mimeType: string; data: Uint8Array }[]): Promise<AttachResult> =>
    ipcRenderer.invoke('attach:data', projectPath, items),
  attachOpen: (projectPath: string, relativePath: string): Promise<{ ok: true } | { error: string }> =>
    ipcRenderer.invoke('attach:open', projectPath, relativePath),
  attachReveal: (projectPath: string, relativePath: string): Promise<{ ok: true } | { error: string }> =>
    ipcRenderer.invoke('attach:reveal', projectPath, relativePath),
  attachReadText: (projectPath: string, relativePath: string): Promise<{ text: string; truncated: boolean } | { error: string }> =>
    ipcRenderer.invoke('attach:read-text', projectPath, relativePath),
  attachGc: (projectPath: string, keep: string[]): Promise<{ removed: number }> => ipcRenderer.invoke('attach:gc', projectPath, keep),
  /** 끌어다 놓은 파일의 실제 경로 (없으면 빈 문자열) */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // ── AI 연결 (Claude · ChatGPT) ──
  onAiRequest: (callback: (req: AiRequest & { id: number }) => void) => {
    const listener = (_e: IpcRendererEvent, req: AiRequest & { id: number }) => callback(req);
    ipcRenderer.on('ai-request', listener);
    return () => ipcRenderer.removeListener('ai-request', listener);
  },
  aiRespond: (id: number, res: AiResponse) => ipcRenderer.send('ai:response', id, res),
  /** 보드를 불러와 AI 요청을 받을 준비가 됨 */
  aiReady: () => ipcRenderer.send('ai:ready'),
  aiGetState: (): Promise<AiState> => ipcRenderer.invoke('ai:get-state'),
  aiSetSettings: (patch: Partial<AiSettings>): Promise<AiState> => ipcRenderer.invoke('ai:set', patch),
  onAiState: (callback: (state: AiState) => void) => {
    const listener = (_e: IpcRendererEvent, state: AiState) => callback(state);
    ipcRenderer.on('ai-state', listener);
    return () => ipcRenderer.removeListener('ai-state', listener);
  },
  aiRegenerateSecret: (): Promise<AiState> => ipcRenderer.invoke('ai:regenerate-secret'),
  aiRestartTunnel: (): Promise<AiState> => ipcRenderer.invoke('ai:restart-tunnel'),
  aiInstallClaude: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ai:install-claude'),
  aiSaveExtension: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ai:save-extension'),
  aiClaudeConfig: (): Promise<string> => ipcRenderer.invoke('ai:claude-config'),
  aiSetNgrok: (patch: { token?: string; domain?: string }): Promise<AiState> => ipcRenderer.invoke('ai:set-ngrok', patch),
  aiDownloadTunnel: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('ai:download-tunnel'),
  aiAckUrl: (): Promise<AiState> => ipcRenderer.invoke('ai:ack-url'),
  aiDiagnose: (): Promise<Diagnosis> => ipcRenderer.invoke('ai:diagnose'),
  aiClaudeRegister: (): Promise<{ ok: true; files: string[] } | { ok: false; error: string }> => ipcRenderer.invoke('ai:claude-register'),
  aiClaudeUnregister: (): Promise<{ ok: true; removed: number } | { ok: false; error: string }> => ipcRenderer.invoke('ai:claude-unregister'),

  onOpenPath: (callback: (filePath: string) => void) => {
    const listener = (_e: IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('open-path', listener);
    return () => ipcRenderer.removeListener('open-path', listener);
  },
};

export type ThoughtFlowApi = typeof api;

contextBridge.exposeInMainWorld('thoughtflow', api);
