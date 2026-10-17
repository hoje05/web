import type { JSONContent } from '@tiptap/core';
import { Fragment, Slice, type ResolvedPos, type Schema } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { NoteHost } from './blocks';
import { findMatches, noteExtensions, searchKey, type SlashView } from './extensions';
import { docToMarkdown, markdownToDoc } from './markdown';

export interface NoteEditorHandle {
  focus: (where: 'start' | 'end') => void;
}

interface Props {
  /** 메모 (Markdown) */
  note: string;
  /** Ctrl+F 검색어 — 메모 안에서 강조하고 첫 위치로 스크롤 */
  query: string;
  onChange: (note: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** 그림 넣기·크게 보기 등 메모 칸 밖의 기능 */
  host?: Omit<NoteHost, 'onFocus' | 'onBlur'>;
}

/**
 * 오른쪽 창의 메모 칸: Notion처럼 한 줄이 한 블록인 편집기.
 * "/" 메뉴, # · - · 1. · [] · > 같은 바로 입력, 글자를 고르면 서식 막대.
 * 내용은 Markdown 글자로 주고받는다 (파일·AI가 보는 메모 형식은 그대로 글).
 */
export const NoteEditor = forwardRef<NoteEditorHandle, Props>(function NoteEditor(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  /** 편집기가 마지막으로 내보낸(또는 받은) 메모 — 바깥에서 바뀐 것만 다시 읽기 위해 */
  const lastNote = useRef(props.note);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [slash, setSlash] = useState<SlashView | null>(null);
  const extensions = useMemo(() => noteExtensions({ onSlash: setSlash }), []);

  /** 그림은 자료 폴더로 복사해 pos 자리에, 그 밖의 파일은 Box의 첨부로 */
  const insertFiles = async (pos: number, files: File[]) => {
    const host = latest.current.host;
    if (!host) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (others.length) host.attachFiles(others);
    const added = images.length ? await host.importImages(images) : [];
    const ed = editorRef.current;
    if (!added.length || !ed || ed.isDestroyed) return;
    ed.chain()
      .focus()
      .insertContentAt(Math.min(pos, ed.state.doc.content.size), added.map((attrs) => ({ type: 'noteImage', attrs: { ...attrs, width: null } })))
      .run();
  };
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor(
    {
      extensions,
      content: markdownToDoc(props.note),
      editorProps: {
        attributes: { class: 'note-editor', 'data-testid': 'panel-note', spellcheck: 'false' },
        clipboardTextParser: (text, $context, plain, view) => pasteSlice(text, $context, plain, view.state.schema),
        clipboardTextSerializer: (slice) => copyText(slice),
        // 그림을 붙여 넣거나 끌어다 놓으면 메모의 그 자리에 (그림이 아닌 파일은 Box의 첨부로)
        handlePaste: (view, event) => {
          const images = [...(event.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
          if (!images.length) return false;
          event.preventDefault();
          void insertFiles(view.state.selection.from, images);
          return true;
        },
        handleDrop: (view, event, _slice, moved) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (moved || !files.length) return false;
          event.preventDefault();
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          void insertFiles(at?.pos ?? view.state.selection.from, files);
          return true;
        },
      },
      onUpdate: ({ editor }) => {
        const md = docToMarkdown(editor.getJSON());
        if (md === lastNote.current) return;
        lastNote.current = md;
        latest.current.onChange(md);
      },
      onFocus: () => latest.current.onFocus(),
      onBlur: () => latest.current.onBlur(),
    },
    [],
  );

  // 메모 칸 밖의 기능을 그림·그래프 블록이 쓸 수 있게
  useEffect(() => {
    editorRef.current = editor;
    if (!editor) return;
    const storage = editor.storage as unknown as { noteHost: { host: NoteHost } };
    storage.noteHost.host = {
      pickImages: () => latest.current.host?.pickImages() ?? Promise.resolve([]),
      importImages: (files) => latest.current.host?.importImages(files) ?? Promise.resolve([]),
      attachFiles: (files) => latest.current.host?.attachFiles(files),
      openImage: (src, alt) => latest.current.host?.openImage(src, alt),
      onFocus: () => latest.current.onFocus(),
      onBlur: () => latest.current.onBlur(),
    };
  }, [editor]);

  // 바깥에서 바뀐 메모 (Undo, AI가 고침) → 편집기에 다시 싣는다 (편집기의 되돌리기 기록에는 넣지 않음)
  useEffect(() => {
    if (!editor || props.note === lastNote.current) return;
    lastNote.current = props.note;
    editor.chain().setMeta('addToHistory', false).setContent(markdownToDoc(props.note), { emitUpdate: false }).run();
  }, [editor, props.note]);

  // 검색어 강조 + 첫 위치로 스크롤
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, props.query));
    const first = findMatches(editor.state.doc, props.query)[0];
    const box = scrollRef.current;
    if (!first || !box) return;
    const top = editor.view.coordsAtPos(first[0]).top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  }, [editor, props.query]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (where) => {
        if (!editor) return;
        const { state, view } = editor;
        view.focus();
        const sel = where === 'end' ? Selection.atEnd(state.doc) : Selection.atStart(state.doc);
        view.dispatch(state.tr.setSelection(sel).scrollIntoView());
      },
    }),
    [editor],
  );

  return (
    <div className="panel-note" ref={scrollRef}>
      <EditorContent editor={editor} className="note-editor-wrap" />
      {editor && slash && <SlashMenu view={slash} />}
      {editor && <FormatBar editor={editor} />}
    </div>
  );
});

/** 붙여넣은 글: Markdown이면 목록·제목 등으로 (Ctrl+Shift+V = 그냥 글), 코드 블록 안에서는 그대로 */
function pasteSlice(text: string, $context: ResolvedPos, plain: boolean, schema: Schema): Slice {
  if (!text) return Slice.empty;
  if ($context.parent.type.spec.code) return new Slice(Fragment.from(schema.text(text)), 0, 0);
  const json: JSONContent = plain
    ? { type: 'doc', content: text.split(/\r?\n/).map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })) }
    : markdownToDoc(text);
  return Slice.maxOpen(schema.nodeFromJSON(json).content);
}

/** 복사한 글은 Markdown으로 (AI 대화창 등에 붙여도 모양이 남도록) */
function copyText(slice: Slice): string {
  const json = slice.content.toJSON() as JSONContent[] | null;
  if (!json) return '';
  if (json.length === 1 && json[0].type === 'codeBlock') return slice.content.textBetween(0, slice.content.size, '\n');
  return docToMarkdown({ type: 'doc', content: json });
}

function SlashMenu({ view }: { view: SlashView }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rect = view.rect;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !rect) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const below = rect.bottom + 6;
    setPos({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)),
      top: below + h > window.innerHeight - 8 ? Math.max(8, rect.top - h - 6) : below,
    });
  }, [rect?.left, rect?.top, rect?.bottom, view.items.length]);

  useEffect(() => {
    ref.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [view.index]);

  return (
    <div
      ref={ref}
      className="slash-menu"
      data-testid="slash-menu"
      role="listbox"
      style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="slash-title">블록</div>
      {view.items.map((item, i) => (
        <button
          key={item.id}
          role="option"
          aria-selected={i === view.index}
          className={i === view.index ? 'is-active' : undefined}
          data-testid="slash-item"
          onClick={() => view.pick(i)}
        >
          <span className="slash-icon">{item.icon}</span>
          <span className="slash-label">{item.label}</span>
          {item.hint && <span className="slash-hint">{item.hint}</span>}
        </button>
      ))}
    </div>
  );
}

const FORMATS = [
  { mark: 'bold', label: 'B', title: '굵게 (Ctrl+B)', toggle: (e: Editor) => e.chain().focus().toggleBold().run() },
  { mark: 'italic', label: 'I', title: '기울임 (Ctrl+I)', toggle: (e: Editor) => e.chain().focus().toggleItalic().run() },
  { mark: 'strike', label: 'S', title: '취소선', toggle: (e: Editor) => e.chain().focus().toggleStrike().run() },
  { mark: 'code', label: '</>', title: '코드 (Ctrl+E)', toggle: (e: Editor) => e.chain().focus().toggleCode().run() },
] as const;

/** 글자를 고르면 위에 뜨는 서식 막대 */
function FormatBar({ editor }: { editor: Editor }) {
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const events = ['selectionUpdate', 'transaction', 'focus', 'blur'] as const;
    events.forEach((ev) => editor.on(ev, redraw));
    return () => events.forEach((ev) => editor.off(ev, redraw));
  }, [editor]);

  const { selection } = editor.state;
  if (selection.empty || !editor.isFocused || editor.isActive('codeBlock') || !selection.$from.parent.inlineContent) return null;
  const a = editor.view.coordsAtPos(selection.from);
  const b = editor.view.coordsAtPos(selection.to);
  const left = a.top === b.top ? (a.left + b.right) / 2 : a.left + 60;
  return (
    <div className="format-bar" data-testid="format-bar" style={{ left, top: Math.min(a.top, b.top) - 8 }} onMouseDown={(e) => e.preventDefault()}>
      {FORMATS.map((f) => (
        <button
          key={f.mark}
          className={`format-${f.mark}${editor.isActive(f.mark) ? ' is-active' : ''}`}
          title={f.title}
          data-testid={`format-${f.mark}`}
          onClick={() => f.toggle(editor)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
