/**
 * 단축키와 메뉴가 공유하는 명령.
 */
import { flushAndClose, openBoard, saveBoard, saveBoardAs } from '../persistence/fileService';
import { useStore } from '../store/store';
import { flushEditing } from './editing';

export type Command =
  | 'new'
  | 'projects'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'flushAndClose'
  | 'find'
  | 'undo'
  | 'redo'
  | 'delete'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'zoomFit'
  | 'aiSettings';

export function runCommand(command: string) {
  const s = useStore.getState();
  switch (command as Command) {
    case 'new':
      // 새 프로젝트: 왼쪽 프로젝트 창을 열고 이름 입력칸으로
      return s.setDrawer(true, true);
    case 'projects':
      return s.setDrawer(!s.drawerOpen);
    case 'open':
      return void openBoard();
    case 'save':
      return void saveBoard();
    case 'saveAs':
      return void saveBoardAs();
    case 'flushAndClose':
      return void flushAndClose();
    case 'find':
      return s.openSearch();
    case 'undo':
      flushEditing();
      return useStore.getState().undo();
    case 'redo':
      flushEditing();
      return useStore.getState().redo();
    case 'delete':
      if (s.editingNodeId) return;
      return s.deleteSelection();
    case 'zoomIn':
      return s.zoomBy(1.2);
    case 'zoomOut':
      return s.zoomBy(1 / 1.2);
    case 'zoomReset':
      return s.zoomBy(1 / s.viewport.zoom);
    case 'zoomFit':
      return s.fitView();
    case 'aiSettings':
      return s.setAiSettingsOpen(true);
  }
}
