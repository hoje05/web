import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from 'electron';
import { promises as fs } from 'fs';
import * as path from 'path';

const FILE_FILTERS = [
  { name: 'ThoughtFlow Board', extensions: ['tflow'] },
  { name: 'JSON', extensions: ['json'] },
];

let mainWindow: BrowserWindow | null = null;
/** Renderer가 알려주는 "저장되지 않은 변경 있음" 상태. 창 닫기 확인에 사용한다. */
let isDirty = false;
/** 저장 확인을 이미 거쳤으면 true — 다시 묻지 않고 닫는다. */
let forceClose = false;

function sendMenuCommand(command: string) {
  mainWindow?.webContents.send('menu-command', command);
}

/**
 * 단축키는 renderer에서 직접 처리한다(텍스트 편집 중인지 등 문맥을 알아야 하므로).
 * 메뉴에는 단축키를 표시만 하고(registerAccelerator: false), 클릭 시 renderer로 명령을 보낸다.
 */
function item(label: string, command: string, accelerator?: string): MenuItemConstructorOptions {
  return { label, accelerator, registerAccelerator: false, click: () => sendMenuCommand(command) };
}

function buildMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '파일',
      submenu: [
        item('새 보드', 'new', 'CmdOrCtrl+N'),
        item('열기…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('저장', 'save', 'CmdOrCtrl+S'),
        item('다른 이름으로 저장…', 'saveAs', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        { label: '종료', role: 'quit' },
      ],
    },
    {
      label: '편집',
      submenu: [
        item('실행 취소', 'undo', 'CmdOrCtrl+Z'),
        item('다시 실행', 'redo', 'CmdOrCtrl+Y'),
        { type: 'separator' },
        { label: '잘라내기', role: 'cut' },
        { label: '복사', role: 'copy' },
        { label: '붙여넣기', role: 'paste' },
        { type: 'separator' },
        item('삭제', 'delete', 'Delete'),
      ],
    },
    {
      label: '보기',
      submenu: [
        item('확대', 'zoomIn', 'CmdOrCtrl+='),
        item('축소', 'zoomOut', 'CmdOrCtrl+-'),
        item('100%', 'zoomReset', 'CmdOrCtrl+0'),
        item('전체 보기', 'zoomFit', 'Shift+1'),
        ...(app.isPackaged
          ? []
          : ([{ type: 'separator' }, { label: '개발자 도구', role: 'toggleDevTools' }] as MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#f7f7f5',
    title: 'ThoughtFlow',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 트랙패드 pinch로 페이지 전체가 확대되지 않게 막는다 (Board 자체 zoom만 사용).
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // 외부 링크/새 창 열기 차단
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('close', (e) => {
    if (!isDirty || forceClose) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      title: 'ThoughtFlow',
      message: '저장하지 않은 변경 사항이 있습니다.',
      detail: '닫기 전에 저장하시겠습니까?',
    });
    if (choice === 0) {
      // renderer가 저장에 성공하면 app:close-now 로 다시 닫는다.
      sendMenuCommand('saveAndClose');
    } else if (choice === 1) {
      forceClose = true;
      mainWindow?.close();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/** 명령행/파일 연결로 전달된 .tflow 파일 경로 (Windows에서 파일 더블클릭 시) */
function fileArgFromArgv(argv: string[]): string | null {
  const found = argv.slice(1).find((a) => /\.(tflow|json)$/i.test(a) && !a.startsWith('-'));
  return found ? path.resolve(found) : null;
}

function registerIpc() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '보드 열기',
      filters: FILE_FILTERS,
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    return { canceled: false, filePath, content };
  });

  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const content = await fs.readFile(filePath, 'utf-8');
    return { filePath, content };
  });

  ipcMain.handle(
    'file:save',
    async (_e, args: { filePath: string | null; content: string; suggestedName: string }) => {
      let target = args.filePath;
      if (!target) {
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: '보드 저장',
          defaultPath: args.suggestedName,
          filters: FILE_FILTERS,
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        target = result.filePath;
      }
      // 임시 파일에 먼저 쓰고 교체 → 저장 도중 문제가 생겨도 기존 파일이 깨지지 않는다.
      const tmp = `${target}.tmp`;
      await fs.writeFile(tmp, args.content, 'utf-8');
      await fs.rename(tmp, target);
      return { canceled: false, filePath: target };
    },
  );

  ipcMain.handle('app:confirm-discard', async () => {
    const choice = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['저장', '저장 안 함', '취소'],
      defaultId: 0,
      cancelId: 2,
      title: 'ThoughtFlow',
      message: '저장하지 않은 변경 사항이 있습니다.',
      detail: '계속하기 전에 저장하시겠습니까?',
    });
    return (['save', 'discard', 'cancel'] as const)[choice.response];
  });

  ipcMain.handle('app:alert', async (_e, message: string) => {
    await dialog.showMessageBox(mainWindow!, { type: 'error', title: 'ThoughtFlow', message });
  });

  ipcMain.on('app:set-dirty', (_e, dirty: boolean) => {
    isDirty = dirty;
    mainWindow?.setDocumentEdited(dirty);
  });

  ipcMain.on('app:close-now', () => {
    forceClose = true;
    mainWindow?.close();
  });

  ipcMain.handle('app:initial-file', () => fileArgFromArgv(process.argv));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = fileArgFromArgv(argv);
    if (file) mainWindow?.webContents.send('open-path', file);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
