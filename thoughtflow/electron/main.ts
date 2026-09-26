import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, type MenuItemConstructorOptions } from 'electron';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';

const FILE_FILTERS = [
  { name: 'ThoughtFlow Board', extensions: ['tflow'] },
  { name: 'JSON', extensions: ['json'] },
];

// 테스트에서 사용자 데이터/보드 폴더를 분리하기 위한 환경 변수
if (process.env.THOUGHTFLOW_USER_DATA) app.setPath('userData', process.env.THOUGHTFLOW_USER_DATA);

/** 이름 없이 만든 보드가 자동 저장되는 폴더: 문서/ThoughtFlow */
const boardsDir = () => process.env.THOUGHTFLOW_BOARDS_DIR ?? path.join(app.getPath('documents'), 'ThoughtFlow');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

let mainWindow: BrowserWindow | null = null;
/** renderer가 마지막 저장을 끝냈으면 true → 그대로 닫는다 */
let closeReady = false;
/** 마지막 저장을 요청한 시각. renderer가 응답하지 않으면 두 번째 닫기 시도에서 그냥 닫는다. */
let closeRequestedAt = 0;

/**
 * renderer가 쓸 수 있는 파일 경로 목록.
 * 사용자가 대화상자에서 고른 파일, 연 파일, 앱이 만든 기본 경로만 허용한다.
 */
const allowedPaths = new Set<string>();
const allow = (p: string) => {
  const abs = path.resolve(p);
  allowedPaths.add(abs);
  return abs;
};

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
        item('찾기', 'find', 'CmdOrCtrl+F'),
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
    width: 1360,
    height: 860,
    minWidth: 760,
    minHeight: 460,
    backgroundColor: '#0e0f11',
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

  // 닫기 전에 renderer에게 마지막 내용을 저장하게 한다 (자동 저장의 마지막 한 번).
  mainWindow.on('close', (e) => {
    if (closeReady) return;
    if (closeRequestedAt && Date.now() - closeRequestedAt > 3000) return;
    e.preventDefault();
    if (!closeRequestedAt) {
      closeRequestedAt = Date.now();
      sendMenuCommand('flushAndClose');
    }
  });
  // 화면 프로세스가 죽었으면 저장을 기다리지 않고 닫을 수 있게
  mainWindow.webContents.on('render-process-gone', () => {
    closeReady = true;
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

async function readSettings(): Promise<{ lastFile?: string }> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

async function writeSettings(patch: { lastFile?: string | null }) {
  const cur = await readSettings();
  const next = { ...cur, ...patch };
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2), 'utf-8');
}

/** 임시 파일에 먼저 쓰고 교체 → 저장 도중 문제가 생겨도 기존 파일이 깨지지 않는다. */
async function writeAtomic(target: string, content: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, target);
}

const pad = (n: number) => String(n).padStart(2, '0');

function registerIpc() {
  ipcMain.handle('file:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '보드 열기',
      defaultPath: boardsDir(),
      filters: FILE_FILTERS,
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    const filePath = allow(result.filePaths[0]);
    const content = await fs.readFile(filePath, 'utf-8');
    return { canceled: false, filePath, content };
  });

  // 앱이 알려 준 경로(시작 파일, 파일 연결로 넘어온 파일)만 읽을 수 있다
  ipcMain.handle('file:read', async (_e, filePath: string) => {
    const abs = path.resolve(filePath);
    if (!allowedPaths.has(abs)) throw new Error('허용되지 않은 파일입니다.');
    const content = await fs.readFile(abs, 'utf-8');
    return { filePath: abs, content };
  });

  /** 이름 없는 새 보드의 자동 저장 경로: 문서/ThoughtFlow/생각 흐름 2026-09-26 14.05.tflow */
  ipcMain.handle('file:new-path', async () => {
    const d = new Date();
    const base = `생각 흐름 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
    const dir = boardsDir();
    await fs.mkdir(dir, { recursive: true });
    let candidate = path.join(dir, `${base}.tflow`);
    for (let i = 2; existsSync(candidate); i++) candidate = path.join(dir, `${base} (${i}).tflow`);
    return allow(candidate);
  });

  ipcMain.handle(
    'file:save',
    async (_e, args: { filePath: string | null; content: string; suggestedName: string }) => {
      let target = args.filePath ? path.resolve(args.filePath) : null;
      if (target && !allowedPaths.has(target)) throw new Error('허용되지 않은 저장 경로입니다.');
      if (!target) {
        const result = await dialog.showSaveDialog(mainWindow!, {
          title: '다른 이름으로 저장',
          defaultPath: path.join(boardsDir(), args.suggestedName),
          filters: FILE_FILTERS,
        });
        if (result.canceled || !result.filePath) return { canceled: true };
        target = allow(result.filePath);
      }
      await writeAtomic(target, args.content);
      return { canceled: false, filePath: target };
    },
  );

  ipcMain.handle('app:alert', async (_e, message: string) => {
    await dialog.showMessageBox(mainWindow!, { type: 'error', title: 'ThoughtFlow', message });
  });

  ipcMain.handle('app:confirm', async (_e, message: string) => {
    const r = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'ThoughtFlow',
      message,
      buttons: ['확인', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    return r.response === 0;
  });

  ipcMain.on('app:close-now', () => {
    closeReady = true;
    mainWindow?.close();
  });

  ipcMain.on('app:close-cancelled', () => {
    closeRequestedAt = 0;
  });

  /** 시작할 때 열 파일: 명령행 인자 → 마지막으로 쓰던 파일 */
  ipcMain.handle('app:startup-file', async () => {
    const arg = fileArgFromArgv(process.argv);
    if (arg) return allow(arg);
    const { lastFile } = await readSettings();
    return lastFile && existsSync(lastFile) ? allow(lastFile) : null;
  });

  ipcMain.on('app:set-last-file', (_e, filePath: string | null) => {
    void writeSettings({ lastFile: filePath });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const file = fileArgFromArgv(argv);
    if (file) mainWindow?.webContents.send('open-path', allow(file));
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // 검은색 테마: 메뉴, 대화상자, Windows 제목 표시줄도 어둡게
    nativeTheme.themeSource = 'dark';
    registerIpc();
    buildMenu();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
