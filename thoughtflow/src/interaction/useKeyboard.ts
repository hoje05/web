import { useEffect } from 'react';
import { useStore } from '../store/store';
import { flushEditing } from './editing';

/** 텍스트 입력 중인 element 인지 (전역 단축키를 막기 위해) */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

export function useKeyboard() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isEditableTarget(e.target)) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) s.setSpaceHeld(true);
        return;
      }
      if (mod) return;

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          flushEditing();
          s.deleteSelection();
          break;
        case 'Enter':
          if (s.selection?.kind === 'node') {
            e.preventDefault();
            s.startEditing(s.selection.id);
          }
          break;
        case 'Escape':
          if (s.tool !== 'select') s.setTool('select');
          else s.select(null);
          break;
        case 'r':
        case 'R':
          s.setTool(s.tool === 'route' ? 'select' : 'route');
          break;
      }
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
