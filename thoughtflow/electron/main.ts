import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { setupAi, shutdownAi, watchRenderer, type StoredAi } from './ai';

const FILE_FILTERS = [
  { name: 'ThoughtFlow Board', extensions: ['tflow'] },
  { name: 'JSON', extensions: ['json'] },
];

// 테스트에서 사용자 데이터/보드 폴더를 분리하기 위한 환경 변수
if (process.env.THOUGHTFLOW_USER_DATA) app.setPath('userData', process.env.THOUGHTFLOW_USER_DATA);

/**
 * 프로젝트(보드 파일) 폴더: 사용자 폴더/ThoughtFlow (예: C:\Users\이름\ThoughtFlow).
 * 문서 폴더는 OneDrive·iCloud로 인터넷에 동기화되거나 Windows 보안(제어된 폴더 액세스)이 쓰기를 막는 일이 많아 쓰지 않는다.
 */
const boardsDir = () => process.env.THOUGHTFLOW_BOARDS_DIR ?? path.join(app.getPath('home'), 'ThoughtFlow');
/** v0.5까지 쓰던 폴더: 문서/ThoughtFlow. 처음 실행할 때 새 폴더로 복사한다. */
const legacyBoardsDir = () =>
  process.env.THOUGHTFLOW_LEGACY_BOARDS_DIR ?? (process.env.THOUGHTFLOW_BOARDS_DIR ? null : path.join(app.getPath('documents'), 'ThoughtFlow'));
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
        item('새 프로젝트…', 'new', 'CmdOrCtrl+N'),
        item('프로젝트 목록', 'projects'),
        item('다른 위치에서 열기…', 'open', 'CmdOrCtrl+O'),
        { type: 'separator' },
        item('AI 연결 (Claude · ChatGPT)…', 'aiSettings'),
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
        { type: 'separator' },
        item('정렬 (Box·Route를 흐름 순서대로)', 'arrange'),
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
    // 기본 제목 표시줄 대신 앱 위쪽의 프로그램 바(최소화/최대화/닫기)를 쓴다
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Claude 창 뒤에 가려져 있어도 AI 요청 처리·자동 저장이 늦춰지지 않게
      backgroundThrottling: false,
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
  // AI 요청은 화면이 다시 준비될 때까지 기다리게
  watchRenderer(mainWindow.webContents);
  // 화면 프로세스가 죽었으면 저장을 기다리지 않고 닫을 수 있게
  mainWindow.webContents.on('render-process-gone', () => {
    closeReady = true;
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  const sendWindowState = () => mainWindow?.webContents.send('window-state', { maximized: mainWindow.isMaximized() });
  mainWindow.on('maximize', sendWindowState);
  mainWindow.on('unmaximize', sendWindowState);

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

interface Settings {
  lastFile?: string | null;
  /** 프로젝트 폴더 밖에서 열었던 보드들 (프로젝트 목록에 함께 표시) */
  recent?: string[];
  /** AI 연결 설정 */
  ai?: StoredAi;
  /** 문서/ThoughtFlow → 사용자 폴더/ThoughtFlow 복사를 마쳤음 */
  boardsMigrated?: boolean;
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
  } catch {
    return {};
  }
}

/** 설정 쓰기는 한 번에 하나씩 (동시에 읽고 쓰다 서로 덮어쓰지 않도록) */
let settingsQueue: Promise<void> = Promise.resolve();
function updateSettings(fn: (cur: Settings) => Settings): Promise<void> {
  settingsQueue = settingsQueue.then(async () => {
    const next = fn(await readSettings());
    // 쓰는 도중 앱이 끝나도 설정 파일이 비지 않도록 임시 파일 → 교체
    await writeAtomic(settingsPath(), JSON.stringify(next, null, 2));
  }, () => undefined);
  return settingsQueue;
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);

function rememberFile(filePath: string | null) {
  return updateSettings((cur) => {
    const recent = (cur.recent ?? []).filter((r) => !filePath || !samePath(r, filePath));
    if (filePath) recent.unshift(path.resolve(filePath));
    return { ...cur, lastFile: filePath, recent: recent.slice(0, 30) };
  });
}

function forgetFile(filePath: string) {
  return updateSettings((cur) => ({
    ...cur,
    lastFile: cur.lastFile && samePath(cur.lastFile, filePath) ? null : cur.lastFile,
    recent: (cur.recent ?? []).filter((r) => !samePath(r, filePath)),
  }));
}

/** 프로젝트(보드 파일) 이름 검사. 문제가 있으면 이유를 돌려준다. */
function nameProblem(name: string): string | null {
  if (!name) return '이름을 입력해 주세요.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return '이름에 < > : " / \\ | ? * 는 쓸 수 없습니다.';
  if (/[. ]$/.test(name)) return '이름 끝에 마침표나 공백은 쓸 수 없습니다.';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) return '사용할 수 없는 이름입니다.';
  if (name.length > 120) return '이름이 너무 깁니다.';
  return null;
}

const cleanName = (name: string) => name.trim().replace(/\.tflow$/i, '').trim();

/** 새 프로젝트 이름: 파일 이름에 못 쓰는 글자는 공백으로 바꾼다 (AI가 "여행: 계획"처럼 지어도 만들어지게) */
function safeProjectName(raw: string): string {
  let n = cleanName(raw)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = `${n} 프로젝트`;
  return n;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Windows에서 백신·동기화 프로그램이 파일을 잠깐 잡고 있을 때 나는 오류 */
const BUSY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * 임시 파일에 먼저 쓰고 교체 → 저장 도중 문제가 생겨도 기존 파일이 깨지지 않는다.
 * 교체가 잠깐 막히면 몇 번 다시 시도하고, 끝까지 막히면 파일에 바로 쓴다.
 */
async function writeAtomic(target: string, content: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(tmp, target);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (BUSY_CODES.has(code) && attempt < 8) {
        await sleep(60 * attempt);
        continue;
      }
      try {
        if (!BUSY_CODES.has(code)) throw err;
        await fs.writeFile(target, content, 'utf-8');
        return;
      } finally {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
      }
    }
  }
}

/** 파일 오류를 사용자에게 보여 줄 말로 */
function fsErrorText(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'EPERM' || code === 'EACCES') return '폴더에 쓸 권한이 없습니다. 백신이나 Windows 보안의 "제어된 폴더 액세스"가 막고 있는지 확인해 주세요.';
  if (code === 'ENOSPC') return '디스크 공간이 부족합니다.';
  if (code === 'EBUSY') return '다른 프로그램이 파일을 쓰고 있습니다. 잠시 후 다시 시도해 주세요.';
  return err instanceof Error ? err.message : String(err);
}

const normPath = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));

/**
 * v0.5까지 문서/ThoughtFlow에 있던 보드를 사용자 폴더/ThoughtFlow로 한 번 복사한다.
 * 원본은 그대로 두고(백업), 마지막 보드·최근 목록은 새 위치를 가리키게 바꾼다.
 * 문서 폴더가 클라우드 전용 파일이라 느리더라도 시작이 오래 멈추지 않도록 시간 한도를 둔다.
 */
let migration: Promise<void> | null = null;
function migrateBoards(): Promise<void> {
  migration ??= (async () => {
    const from = legacyBoardsDir();
    if (!from || (await readSettings()).boardsMigrated) return;
    const to = boardsDir();
    const copied = new Map<string, string>();
    const deadline = Date.now() + 10000;
    try {
      const names = (await fs.readdir(from)).filter((n) => n.toLowerCase().endsWith('.tflow'));
      await fs.mkdir(to, { recursive: true });
      for (const n of names) {
        const src = path.join(from, n);
        const dst = path.join(to, n);
        const left = deadline - Date.now();
        if (left <= 0) break;
        if (existsSync(dst)) continue;
        const copy = (async () => {
          const st = await fs.stat(src);
          await fs.copyFile(src, `${dst}.tmp`);
          await fs.utimes(`${dst}.tmp`, st.atime, st.mtime);
          await fs.rename(`${dst}.tmp`, dst);
          return true;
        })().catch(() => false);
        if (await Promise.race([copy, sleep(left).then(() => false)])) copied.set(normPath(src), dst);
      }
    } catch {
      // 예전 폴더가 없음
    }
    const remap = (p: string) => copied.get(normPath(p)) ?? p;
    await updateSettings((cur) => ({
      ...cur,
      boardsMigrated: true,
      lastFile: cur.lastFile ? remap(cur.lastFile) : cur.lastFile,
      recent: (cur.recent ?? []).map(remap),
    }));
  })().catch((err) => console.error('board migration failed', err));
  return migration;
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
    // 방금 보낸 "마지막 파일" 기록까지 끝낸 뒤 닫는다
    void settingsQueue.finally(() => mainWindow?.close());
  });

  ipcMain.on('app:close-cancelled', () => {
    closeRequestedAt = 0;
  });

  /** 시작할 때 열 파일: 명령행 인자 → 마지막으로 쓰던 파일 */
  ipcMain.handle('app:startup-file', async () => {
    const arg = fileArgFromArgv(process.argv);
    if (arg) return allow(arg);
    await migrateBoards();
    const { lastFile } = await readSettings();
    return lastFile && existsSync(lastFile) ? allow(lastFile) : null;
  });

  ipcMain.on('app:set-last-file', (_e, filePath: string | null) => {
    void rememberFile(filePath);
  });

  // ── 프로그램 바: 창 조작 ──
  ipcMain.on('win:minimize', () => mainWindow?.minimize());
  ipcMain.on('win:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('win:close', () => mainWindow?.close());
  ipcMain.handle('win:is-maximized', () => mainWindow?.isMaximized() ?? false);
  /** 프로그램 바의 ⋯ 버튼: 파일/편집/보기 메뉴를 그 자리에 띄운다 */
  ipcMain.on('app:show-menu', (_e, pos: { x: number; y: number }) => {
    if (!mainWindow) return;
    Menu.getApplicationMenu()?.popup({ window: mainWindow, x: Math.round(pos.x), y: Math.round(pos.y) });
  });

  // ── 프로젝트 = 보드 파일 ──
  /** 문서/ThoughtFlow의 보드 + 다른 위치에서 열었던 보드. 최근 수정 순. */
  ipcMain.handle('projects:list', async () => {
    await migrateBoards();
    const dir = boardsDir();
    await fs.mkdir(dir, { recursive: true });
    const files = new Map<string, string>();
    for (const e of await fs.readdir(dir)) {
      if (e.toLowerCase().endsWith('.tflow')) files.set(path.join(dir, e).toLowerCase(), path.join(dir, e));
    }
    for (const r of (await readSettings()).recent ?? []) {
      if (existsSync(r) && !files.has(path.resolve(r).toLowerCase())) files.set(path.resolve(r).toLowerCase(), path.resolve(r));
    }
    const out: { filePath: string; name: string; modifiedAt: number; boxCount: number | null }[] = [];
    for (const p of files.values()) {
      try {
        const st = await fs.stat(p);
        if (!st.isFile()) continue;
        let boxCount: number | null = null;
        try {
          const data = JSON.parse(await fs.readFile(p, 'utf-8'));
          boxCount = Array.isArray(data.nodes) ? data.nodes.length : null;
        } catch {
          // 읽을 수 없는 파일도 목록에는 보여 준다 (열 때 오류 안내)
        }
        out.push({ filePath: allow(p), name: path.basename(p, path.extname(p)), modifiedAt: st.mtimeMs, boxCount });
      } catch {
        // 목록을 만드는 사이 지워진 파일
      }
    }
    return out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  });

  /**
   * 새 프로젝트 = 빈 보드 파일을 바로 만든다. 같은 이름이 있으면 "이름 2", "이름 3"…
   * 파일을 먼저 만들고 나서 화면을 바꾸므로, 만들지 못하면 지금 보드가 그대로 남는다.
   */
  ipcMain.handle('projects:create', async (_e, rawName: unknown, content: string) => {
    await migrateBoards();
    const base = safeProjectName(typeof rawName === 'string' ? rawName : '') || '새 프로젝트';
    const dir = boardsDir();
    try {
      await fs.mkdir(dir, { recursive: true });
      for (let i = 1; i < 1000; i++) {
        const target = path.join(dir, `${i === 1 ? base : `${base} ${i}`}.tflow`);
        if (existsSync(target)) continue;
        try {
          await fs.writeFile(target, content, { encoding: 'utf-8', flag: 'wx' });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
          throw err;
        }
        return { filePath: allow(target) };
      }
      return { error: '같은 이름의 프로젝트가 너무 많습니다. 다른 이름을 써 주세요.' };
    } catch (err) {
      return { error: `프로젝트 파일을 만들지 못했습니다. ${fsErrorText(err)}` };
    }
  });

  /** 프로젝트가 저장되는 폴더 (프로젝트 창 아래에 보여 준다) */
  ipcMain.handle('projects:dir', () => boardsDir());

  ipcMain.handle('projects:rename', async (_e, filePath: string, rawName: string) => {
    const from = path.resolve(filePath);
    if (!allowedPaths.has(from)) return { error: '허용되지 않은 파일입니다.' };
    const name = cleanName(rawName);
    const problem = nameProblem(name);
    if (problem) return { error: problem };
    const to = path.join(path.dirname(from), `${name}${path.extname(from) || '.tflow'}`);
    if (samePath(from, to) && from === to) return { filePath: from };
    if (existsSync(to) && !samePath(from, to)) return { error: '같은 이름의 프로젝트가 이미 있습니다.' };
    await fs.rename(from, to);
    allow(to);
    await updateSettings((cur) => ({
      ...cur,
      lastFile: cur.lastFile && samePath(cur.lastFile, from) ? to : cur.lastFile,
      recent: (cur.recent ?? []).map((r) => (samePath(r, from) ? to : r)),
    }));
    return { filePath: to };
  });

  /** 휴지통으로 옮긴다 (확인 후). 완전히 지우지 않으므로 휴지통에서 되살릴 수 있다. */
  ipcMain.handle('projects:delete', async (_e, filePath: string) => {
    const target = path.resolve(filePath);
    if (!allowedPaths.has(target)) return { deleted: false };
    const r = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      title: 'ThoughtFlow',
      message: `‘${path.basename(target, path.extname(target))}’ 프로젝트를 휴지통으로 옮길까요?`,
      detail: '휴지통에서 다시 꺼낼 수 있습니다.',
      buttons: ['휴지통으로 이동', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    if (r.response !== 0) return { deleted: false };
    try {
      await shell.trashItem(target);
    } catch (err) {
      await dialog.showMessageBox(mainWindow!, { type: 'error', title: 'ThoughtFlow', message: `휴지통으로 옮기지 못했습니다.\n${String(err)}` });
      return { deleted: false };
    }
    await forgetFile(target);
    return { deleted: true };
  });

  ipcMain.handle('projects:reveal', async () => {
    await fs.mkdir(boardsDir(), { recursive: true });
    await shell.openPath(boardsDir());
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
    void migrateBoards();
    registerIpc();
    buildMenu();
    createWindow();
    void setupAi({
      getWindow: () => mainWindow,
      readAi: async () => (await readSettings()).ai ?? {},
      writeAi: (patch) => updateSettings((cur) => ({ ...cur, ai: { ...cur.ai, ...patch } })),
    });
  });

  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', shutdownAi);
}
