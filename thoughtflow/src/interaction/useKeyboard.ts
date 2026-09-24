import { useEffect } from 'react';
import { useStore } from '../store/store';
import { runCommand } from './commands';
import { flushEditing } from './editing';

/** 텍스트 입력 중인 element 인지 (전역 단축키를 막기 위해) */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

/** Ctrl 조합 단축키. 한글 입력 모드에서도 동작하도록 e.key 대신 물리 키(e.code)로 판정한다. */
function modCommand(e: KeyboardEvent): string | null {
  switch (e.code) {
    case 'KeyZ':
      return e.shiftKey ? 'redo' : 'undo';
    case 'KeyY':
      return 'redo';
    case 'KeyS':
      return e.shiftKey ? 'saveAs' : 'save';
    case 'KeyO':
      return 'open';
    case 'KeyN':
      return 'new';
    case 'Equal':
    case 'NumpadAdd':
      return 'zoomIn';
    case 'Minus':
    case 'NumpadSubtract':
      return 'zoomOut';
    case 'Digit0':
    case 'Numpad0':
      return 'zoomReset';
  }
  return null;
}

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      const editing = isEditableTarget(e.target);

      if (mod) {
        const cmd = modCommand(e);
        // 편집 중 Ctrl+Z/Y는 입력 중인 글자의 되돌리기(브라우저 기본)에 맡긴다
        if (!cmd || (editing && (cmd === 'undo' || cmd === 'redo'))) return;
        e.preventDefault();
        runCommand(cmd);
        return;
      }
      if (editing) return;

      const s = useStore.getState();
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) s.setSpaceHeld(true);
        return;
      }

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          flushEditing();
          s.deleteSelection();
          return;
        case 'Enter':
          if (s.selection?.kind === 'node') {
            e.preventDefault();
            s.startEditing(s.selection.id);
          }
          return;
        case 'Escape':
          if (s.tool !== 'select') s.setTool('select');
          else s.select(null);
          return;
      }
      if (e.code === 'KeyR' && !e.altKey) s.setTool(s.tool === 'route' ? 'select' : 'route');
      else if (e.code === 'Digit1' && e.shiftKey) runCommand('zoomFit');
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') useStore.getState().setSpaceHeld(false);
    };
    const onBlur = () => useStore.getState().setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
}
