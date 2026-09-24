/**
 * 파일 새로 만들기 / 열기 / 저장.
 * OS 접근은 Electron preload가 노출한 window.thoughtflow API로만 한다.
 */
import { flushEditing } from '../interaction/editing';
import { useStore } from '../store/store';
import { FILE_EXTENSION, parseBoard, serializeBoard } from './fileFormat';

type Api = {
  openFile: () => Promise<{ canceled: true } | { canceled: false; filePath: string; content: string }>;
  readFile: (filePath: string) => Promise<{ filePath: string; content: string }>;
  saveFile: (args: {
    filePath: string | null;
    content: string;
    suggestedName: string;
  }) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  confirmDiscard: () => Promise<'save' | 'discard' | 'cancel'>;
  alert: (message: string) => Promise<void>;
  initialFile: () => Promise<string | null>;
  setDirty: (dirty: boolean) => void;
  closeNow: () => void;
  onMenuCommand: (cb: (command: string) => void) => () => void;
  onOpenPath: (cb: (filePath: string) => void) => () => void;
};

export const desktopApi: Api | undefined = (window as unknown as { thoughtflow?: Api }).thoughtflow;

async function alertUser(message: string) {
  if (desktopApi) await desktopApi.alert(message);
  else window.alert(message);
}

export const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : '제목 없음');

/** 저장. saveAs면 항상 위치를 묻는다. 성공하면 true */
export async function saveBoard(saveAs = false): Promise<boolean> {
  if (!desktopApi) {
    await alertUser('저장은 데스크톱 앱에서만 지원합니다.');
    return false;
  }
  flushEditing();
  const s = useStore.getState();
  const doc = s.doc;
  const content = serializeBoard(doc, s.viewport);
  try {
    const res = await desktopApi.saveFile({
      filePath: saveAs ? null : s.filePath,
      content,
      suggestedName: s.filePath ? fileName(s.filePath) : `생각 흐름.${FILE_EXTENSION}`,
    });
    if (res.canceled) return false;
    useStore.getState().markSaved(res.filePath, doc);
    return true;
  } catch (err) {
    await alertUser(`저장하지 못했습니다.\n${String(err)}`);
    return false;
  }
}

/** 저장하지 않은 변경이 있으면 물어본다. 계속 진행해도 되면 true */
async function confirmDiscardIfDirty(): Promise<boolean> {
  const s = useStore.getState();
  if (s.doc === s.savedDoc || !desktopApi) return true;
  const choice = await desktopApi.confirmDiscard();
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveBoard();
  return true;
}

export async function newBoard() {
  flushEditing();
  if (!(await confirmDiscardIfDirty())) return;
  useStore.getState().resetBoard();
}

function loadContent(filePath: string, content: string) {
  const { doc, viewport, warnings } = parseBoard(content);
  useStore.getState().loadBoard(doc, viewport, filePath);
  if (warnings.length) void alertUser(`파일 일부를 복구하지 못했습니다.\n${[...new Set(warnings)].join('\n')}`);
}

export async function openBoard() {
  if (!desktopApi) return;
  flushEditing();
  if (!(await confirmDiscardIfDirty())) return;
  try {
    const res = await desktopApi.openFile();
    if (res.canceled) return;
    loadContent(res.filePath, res.content);
  } catch (err) {
    await alertUser(err instanceof Error ? err.message : String(err));
  }
}

export async function openPath(filePath: string, askFirst = true) {
  if (!desktopApi) return;
  flushEditing();
  if (askFirst && !(await confirmDiscardIfDirty())) return;
  try {
    const res = await desktopApi.readFile(filePath);
    loadContent(res.filePath, res.content);
  } catch (err) {
    await alertUser(err instanceof Error ? err.message : `파일을 열 수 없습니다.\n${String(err)}`);
  }
}

export async function saveAndClose() {
  if (await saveBoard()) desktopApi?.closeNow();
}
