import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * Renderer가 사용할 수 있는 유일한 OS API.
 * (src/persistence/ 에서만 사용한다)
 */
const api = {
  openFile: (): Promise<{ canceled: true } | { canceled: false; filePath: string; content: string }> =>
    ipcRenderer.invoke('file:open'),
  readFile: (filePath: string): Promise<{ filePath: string; content: string }> =>
    ipcRenderer.invoke('file:read', filePath),
  /** 이름 없는 보드를 자동 저장할 새 경로 (문서/ThoughtFlow) */
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
  onOpenPath: (callback: (filePath: string) => void) => {
    const listener = (_e: IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('open-path', listener);
    return () => ipcRenderer.removeListener('open-path', listener);
  },
};

export type ThoughtFlowApi = typeof api;

contextBridge.exposeInMainWorld('thoughtflow', api);
