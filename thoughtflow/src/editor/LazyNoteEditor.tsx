/**
 * 메모 편집기(Tiptap/ProseMirror — 화면 코드의 절반)는 따로 불러온다.
 * 시작할 때 보드를 먼저 그리고, 편집기는 그 뒤에 (오른쪽 창이 열려 있으면 바로, 아니면 한가할 때 미리) 불러온다.
 * 불러오기 전에 들어온 포커스 요청(더블클릭 → 메모로)은 기억해 두었다가 편집기가 뜨면 적용한다.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { NoteEditor as NoteEditorComponent, NoteEditorHandle, NoteEditorProps } from './NoteEditor';

let loaded: typeof NoteEditorComponent | null = null;
let loading: Promise<typeof NoteEditorComponent> | null = null;

/** 편집기 코드 불러오기 (여러 번 불러도 한 번만) */
export function loadNoteEditor(): Promise<typeof NoteEditorComponent> {
  loading ??= import('./NoteEditor').then((m) => {
    performance.mark('tf:editor');
    return (loaded = m.NoteEditor);
  });
  return loading;
}

export const LazyNoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function LazyNoteEditor(props, ref) {
  // 이미 불러왔으면 기다림 없이 바로 그린다. 아니면 빈 메모 칸을 보여 주다가 불러오는 즉시 바꾼다.
  // (React Suspense는 다 불러온 뒤에도 300ms쯤 늦게 보여 주므로 쓰지 않는다)
  const [Editor, setEditor] = useState(() => loaded);
  useEffect(() => {
    if (Editor) return;
    let alive = true;
    void loadNoteEditor().then((C) => alive && setEditor(() => C));
    return () => {
      alive = false;
    };
  }, [Editor]);
  const inner = useRef<NoteEditorHandle | null>(null);
  const pending = useRef<'start' | 'end' | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: (where) => {
        if (inner.current?.focus(where)) return true;
        pending.current = where;
        return false;
      },
    }),
    [],
  );
  // 편집기가 (새로) 준비될 때마다 불린다 — 기다리던 포커스가 있으면 이때 적용
  const attach = useCallback((h: NoteEditorHandle | null) => {
    inner.current = h;
    if (h && pending.current && h.focus(pending.current)) pending.current = null;
  }, []);

  return Editor ? <Editor ref={attach} {...props} /> : <div className="panel-note" />;
});
