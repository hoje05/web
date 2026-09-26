/**
 * 파일 저장/열기 + 자동 저장.
 *
 *  - Box 추가·이동·글쓰기 등 Doc이 바뀔 때마다 잠시(0.4초) 뒤 자동 저장한다.
 *  - 아직 이름이 없는 보드는 문서/ThoughtFlow 폴더에 자동으로 파일을 만든다.
 *  - Ctrl+S는 즉시 저장, Ctrl+Shift+S는 위치를 골라 저장.
 *  - 창을 닫을 때 마지막 내용을 저장하고, 다음 실행 때 마지막 보드를 다시 연다.
 *
 * OS 접근은 Electron preload가 노출한 window.thoughtflow API로만 한다.
 */
import { flushEditing } from '../interaction/editing';
import type { Doc } from '../model/types';
import { useStore } from '../store/store';
import { FILE_EXTENSION, parseBoard, serializeBoard } from './fileFormat';

type SaveResult = { canceled: true } | { canceled: false; filePath: string };
type Api = {
  openFile: () => Promise<{ canceled: true } | { canceled: false; filePath: string; content: string }>;
  readFile: (filePath: string) => Promise<{ filePath: string; content: string }>;
  newBoardPath: () => Promise<string>;
  saveFile: (args: { filePath: string | null; content: string; suggestedName: string }) => Promise<SaveResult>;
  alert: (message: string) => Promise<void>;
  confirm: (message: string) => Promise<boolean>;
  startupFile: () => Promise<string | null>;
  setLastFile: (filePath: string | null) => void;
  closeNow: () => void;
  closeCancelled: () => void;
  onMenuCommand: (cb: (command: string) => void) => () => void;
  onOpenPath: (cb: (filePath: string) => void) => () => void;
};

export const desktopApi: Api | undefined = (window as unknown as { thoughtflow?: Api }).thoughtflow;

async function alertUser(message: string) {
  if (desktopApi) await desktopApi.alert(message);
  else window.alert(message);
}

export const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '제목 없음');

const isEmptyDoc = (doc: Doc) => Object.keys(doc.nodes).length === 0 && Object.keys(doc.edges).length === 0;

/** 자동 저장 대기 시간 (마지막 행동 후) */
export const AUTOSAVE_DELAY = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<boolean> | null = null;
let again = false;

/**
 * 지금 저장한다. 저장할 변경이 없으면 아무것도 하지 않는다 (force면 viewport까지 다시 기록).
 * 동시에 여러 번 불려도 파일 쓰기는 한 번에 하나씩, 마지막 상태가 반드시 기록되도록 한다.
 */
export function saveNow(force = false): Promise<boolean> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let ok = true;
    do {
      again = false;
      ok = await writeCurrent(force);
      force = false;
    } while (again && ok);
    running = null;
    return ok;
  })();
  return running;
}

async function writeCurrent(force: boolean): Promise<boolean> {
  if (!desktopApi) return true;
  const s = useStore.getState();
  const doc = s.doc;
  if (doc === s.savedDoc && !(force && s.filePath)) return true;
  // 아무것도 없는 새 보드는 파일을 만들지 않는다
  if (!s.filePath && isEmptyDoc(doc)) {
    s.markSaved(null, doc);
    return true;
  }
  s.setSaveState('saving');
  try {
    const path = s.filePath ?? (await desktopApi.newBoardPath());
    const res = await desktopApi.saveFile({ filePath: path, content: serializeBoard(doc, s.viewport), suggestedName: '' });
    if (res.canceled) throw new Error('저장이 취소되었습니다.');
    const now = useStore.getState();
    // 저장하는 동안 다른 보드를 열었다면 상태를 덮어쓰지 않는다
    if (now.filePath === s.filePath || now.filePath === null) {
      now.markSaved(res.filePath, doc);
      now.setSaveState('saved');
    }
    desktopApi.setLastFile(res.filePath);
    return true;
  } catch (err) {
    useStore.getState().setSaveState('error');
    console.error('autosave failed', err);
    return false;
  }
}

/** Doc이 바뀔 때마다 잠시 뒤 자동 저장 */
export function startAutosave(): () => void {
  return useStore.subscribe((s, prev) => {
    if (s.doc === prev.doc || s.doc === s.savedDoc) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveNow();
    }, AUTOSAVE_DELAY);
  });
}

/** Ctrl+S: 지금 바로 저장 */
export async function saveBoard(): Promise<boolean> {
  flushEditing();
  const ok = await saveNow(true);
  if (!ok) await alertUser('저장하지 못했습니다. 디스크 공간이나 파일 권한을 확인해 주세요.');
  return ok;
}

/** Ctrl+Shift+S: 위치를 골라 저장 → 이후 자동 저장도 그 파일에 */
export async function saveBoardAs(): Promise<boolean> {
  if (!desktopApi) return false;
  flushEditing();
  const s = useStore.getState();
  try {
    const res = await desktopApi.saveFile({
      filePath: null,
      content: serializeBoard(s.doc, s.viewport),
      suggestedName: s.filePath ? fileName(s.filePath) : `생각 흐름.${FILE_EXTENSION}`,
    });
    if (res.canceled) return false;
    useStore.getState().markSaved(res.filePath, s.doc);
    useStore.getState().setSaveState('saved');
    desktopApi.setLastFile(res.filePath);
    return true;
  } catch (err) {
    await alertUser(`저장하지 못했습니다.\n${String(err)}`);
    return false;
  }
}

/** 현재 보드를 저장한 뒤 새 보드 */
export async function newBoard() {
  flushEditing();
  if (!(await saveNow())) return;
  useStore.getState().resetBoard();
  desktopApi?.setLastFile(null);
}

function loadContent(filePath: string, content: string) {
  const { doc, viewport, warnings } = parseBoard(content);
  useStore.getState().loadBoard(doc, viewport, filePath);
  desktopApi?.setLastFile(filePath);
  if (warnings.length) void alertUser(`파일 일부를 복구하지 못했습니다.\n${[...new Set(warnings)].join('\n')}`);
}

export async function openBoard() {
  if (!desktopApi) return;
  flushEditing();
  if (!(await saveNow())) return;
  try {
    const res = await desktopApi.openFile();
    if (res.canceled) return;
    loadContent(res.filePath, res.content);
  } catch (err) {
    await alertUser(err instanceof Error ? err.message : String(err));
  }
}

export async function openPath(filePath: string) {
  if (!desktopApi) return;
  flushEditing();
  if (!(await saveNow())) return;
  try {
    const res = await desktopApi.readFile(filePath);
    loadContent(res.filePath, res.content);
  } catch (err) {
    await alertUser(err instanceof Error ? err.message : `파일을 열 수 없습니다.\n${String(err)}`);
  }
}

/** 시작할 때: 명령행으로 받은 파일 또는 마지막으로 쓰던 보드를 연다 */
export async function openStartupBoard() {
  if (!desktopApi) return;
  const p = await desktopApi.startupFile();
  if (!p) return;
  try {
    const res = await desktopApi.readFile(p);
    loadContent(res.filePath, res.content);
  } catch {
    desktopApi.setLastFile(null);
  }
}

/** 창을 닫기 전 마지막 저장 */
export async function flushAndClose() {
  flushEditing();
  const ok = await saveNow(true);
  if (ok || (await desktopApi?.confirm('저장하지 못했습니다. 그래도 닫을까요? (마지막 변경이 사라질 수 있습니다)'))) {
    desktopApi?.closeNow();
  } else {
    desktopApi?.closeCancelled();
  }
}
