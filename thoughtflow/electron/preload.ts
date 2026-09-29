import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AiRequest, AiResponse, AiSettings, AiState } from '../src/ai/protocol';

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
  }): Promise<{ canceled: true } | { canceled: false; filePath: string }> => ipcRenderer.invoke('file:save', args),
  alert: (message: string): Promise<void> => ipcRenderer.invoke('app:alert', message),
  confirm: (message: string): Promise<boolean> => ipcRenderer.invoke('app:confirm', message),
  startupFile: (): Promise<string | null> => ipcRenderer.invoke('app:startup-file'),
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

  onOpenPath: (callback: (filePath: string) => void) => {
    const listener = (_e: IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('open-path', listener);
    return () => ipcRenderer.removeListener('open-path', listener);
  },
};

export type ThoughtFlowApi = typeof api;

contextBridge.exposeInMainWorld('thoughtflow', api);
