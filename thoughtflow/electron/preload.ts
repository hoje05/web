import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

/**
 * Renderer가 사용할 수 있는 유일한 OS API.
 * (src/persistence/fileService.ts 에서만 사용한다)
 */
const api = {
  openFile: (): Promise<{ canceled: true } | { canceled: false; filePath: string; content: string }> =>
    ipcRenderer.invoke('file:open'),
  readFile: (filePath: string): Promise<{ filePath: string; content: string }> =>
    ipcRenderer.invoke('file:read', filePath),
  saveFile: (args: {
    filePath: string | null;
    content: string;
    suggestedName: string;
  }): Promise<{ canceled: true } | { canceled: false; filePath: string }> => ipcRenderer.invoke('file:save', args),
  confirmDiscard: (): Promise<'save' | 'discard' | 'cancel'> => ipcRenderer.invoke('app:confirm-discard'),
  alert: (message: string): Promise<void> => ipcRenderer.invoke('app:alert', message),
  initialFile: (): Promise<string | null> => ipcRenderer.invoke('app:initial-file'),
  setDirty: (dirty: boolean) => ipcRenderer.send('app:set-dirty', dirty),
  closeNow: () => ipcRenderer.send('app:close-now'),
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
