/**
 * 메모 편집기(Tiptap/ProseMirror — 화면 코드의 절반)는 따로 불러온다.
 * 시작할 때 보드를 먼저 그리고, 편집기는 그 뒤에 (오른쪽 창이 열려 있으면 바로, 아니면 한가할 때 미리) 불러온다.
 * 불러오기 전에 들어온 포커스 요청(더블클릭 → 메모로)은 기억해 두었다가 편집기가 뜨면 적용한다.
 */
import { forwardRef, lazy, Suspense, useCallback, useImperativeHandle, useRef, useState } from 'react';
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

const Deferred = lazy(() => loadNoteEditor().then((C) => ({ default: C })));

export const LazyNoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(function LazyNoteEditor(props, ref) {
  // 이미 불러왔으면 기다림 없이 바로 그린다 (한 번 정한 것은 바꾸지 않는다 — 바꾸면 편집기가 새로 만들어짐)
  const [Editor] = useState(() => loaded ?? Deferred);
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

  return (
    <Suspense fallback={<div className="panel-note" />}>
      <Editor ref={attach} {...props} />
    </Suspense>
  );
});
