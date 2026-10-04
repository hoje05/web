/**
 * 메모 편집기(Notion식 블록 편집)의 구성.
 *
 * 단축키 원칙: ThoughtFlow에 이미 있는 단축키와 겹치는 편집기 단축키는 쓰지 않는다.
 *   - Ctrl+Shift+S(다른 이름으로 저장)와 겹치는 취소선 단축키, Ctrl+0(100%)과 겹치는 Ctrl+Alt+0(문단)은 뺐다.
 *   - Tab/Shift+Tab은 목록 들여쓰기로 쓰지 않는다 (전처럼 다음 칸으로 이동).
 *   - Ctrl+Z/Y는 전처럼 "입력 중인 글자 되돌리기", Esc는 전처럼 "메모 칸에서 나가기".
 * 남은 편집기 단축키(겹치지 않음): Ctrl+B 굵게, Ctrl+I 기울임, Ctrl+E 코드, Ctrl+Alt+1~3 제목,
 * Ctrl+Shift+7/8/9 번호·글머리·할 일 목록, Ctrl+Shift+B 인용, Ctrl+Alt+C 코드 블록.
 */
import { Extension, type ChainedCommands, type Editor } from '@tiptap/core';
import Blockquote from '@tiptap/extension-blockquote';
import Bold from '@tiptap/extension-bold';
import Code from '@tiptap/extension-code';
import CodeBlock from '@tiptap/extension-code-block';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import Italic from '@tiptap/extension-italic';
import { BulletList, ListItem, ListKeymap, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';

// ───────────── "/" 메뉴 ─────────────

export interface SlashItem {
  id: string;
  label: string;
  /** 바로 입력하는 방법 (메뉴 오른쪽에 작게) */
  hint: string;
  icon: string;
  keywords: string[];
  run: (chain: ChainedCommands) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', label: '텍스트', hint: '', icon: 'T', keywords: ['text', 'paragraph', '본문', '글'], run: (c) => c.clearNodes().run() },
  { id: 'h1', label: '제목 1', hint: '#', icon: 'H1', keywords: ['h1', 'heading', 'title', '제목', '큰'], run: (c) => c.clearNodes().setHeading({ level: 1 }).run() },
  { id: 'h2', label: '제목 2', hint: '##', icon: 'H2', keywords: ['h2', 'heading', '제목', '중간'], run: (c) => c.clearNodes().setHeading({ level: 2 }).run() },
  { id: 'h3', label: '제목 3', hint: '###', icon: 'H3', keywords: ['h3', 'heading', '제목', '작은'], run: (c) => c.clearNodes().setHeading({ level: 3 }).run() },
  { id: 'bullet', label: '글머리 기호 목록', hint: '-', icon: '•', keywords: ['bullet', 'list', 'ul', '목록', '글머리'], run: (c) => c.toggleBulletList().run() },
  { id: 'ordered', label: '번호 목록', hint: '1.', icon: '1.', keywords: ['number', 'ordered', 'ol', 'list', '번호', '숫자', '목록'], run: (c) => c.toggleOrderedList().run() },
  { id: 'todo', label: '할 일 목록', hint: '[]', icon: '☑', keywords: ['todo', 'task', 'check', '할일', '체크', '목록'], run: (c) => c.toggleTaskList().run() },
  { id: 'quote', label: '인용', hint: '>', icon: '❝', keywords: ['quote', 'blockquote', '인용'], run: (c) => c.toggleBlockquote().run() },
  { id: 'code', label: '코드', hint: '```', icon: '</>', keywords: ['code', 'codeblock', '코드'], run: (c) => c.toggleCodeBlock().run() },
  { id: 'divider', label: '구분선', hint: '---', icon: '—', keywords: ['divider', 'hr', 'line', 'separator', '구분', '선'], run: (c) => c.setHorizontalRule().run() },
];

export function filterSlash(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((it) => it.label.toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q)));
}

/** 화면에 보여 줄 "/" 메뉴 상태 */
export interface SlashView {
  items: SlashItem[];
  index: number;
  rect: DOMRect | null;
  pick: (index: number) => void;
}

const SlashCommand = Extension.create<{ onState: (view: SlashView | null) => void }>({
  name: 'slashCommand',
  addOptions() {
    return { onState: () => undefined };
  },
  addProseMirrorPlugins() {
    const onState = (v: SlashView | null) => this.options.onState(v);
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        // 코드 블록 안에서는 그냥 글자
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => filterSlash(query),
        command: ({ editor, range, props }) => props.run(editor.chain().focus().deleteRange(range)),
        render: () => {
          let current: SuggestionProps<SlashItem, SlashItem> | null = null;
          let index = 0;
          const emit = () => {
            const p = current;
            onState(p && p.items.length ? { items: p.items, index, rect: p.clientRect?.() ?? null, pick: (i) => p.command(p.items[i]) } : null);
          };
          return {
            onStart: (p) => {
              current = p;
              index = 0;
              emit();
            },
            onUpdate: (p) => {
              current = p;
              index = Math.min(index, Math.max(0, p.items.length - 1));
              emit();
            },
            onKeyDown: ({ event }) => {
              const p = current;
              if (!p) return false;
              if (event.key === 'Escape') {
                // 메뉴만 닫는다 (메모 칸에서 나가지 않음). 다시 Esc를 누르면 전처럼 나간다.
                current = null;
                onState(null);
                return true;
              }
              const n = p.items.length;
              if (!n) return false;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                index = (index + (event.key === 'ArrowDown' ? 1 : n - 1)) % n;
                emit();
                return true;
              }
              if (event.key === 'Enter') {
                p.command(p.items[index]);
                return true;
              }
              return false;
            },
            onExit: () => {
              current = null;
              onState(null);
            },
          };
        },
      }),
    ];
  },
});

// ───────────── 검색어 강조 (Ctrl+F) ─────────────

export const searchKey = new PluginKey<string>('noteSearch');

/** 문서 안의 검색어 위치들 [from, to] */
export function findMatches(doc: PmNode, query: string): [number, number][] {
  const q = query.trim().toLowerCase();
  const out: [number, number][] = [];
  if (!q) return out;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const t = node.textContent.toLowerCase();
    for (let j = t.indexOf(q); j >= 0; j = t.indexOf(q, j + q.length)) out.push([pos + 1 + j, pos + 1 + j + q.length]);
    return false;
  });
  return out;
}

const SearchHighlight = Extension.create({
  name: 'noteSearch',
  addProseMirrorPlugins() {
    return [
      new Plugin<string>({
        key: searchKey,
        state: {
          init: () => '',
          apply: (tr, value) => {
            const q = tr.getMeta(searchKey);
            return typeof q === 'string' ? q : value;
          },
        },
        props: {
          decorations(state) {
            const hits = findMatches(state.doc, searchKey.getState(state) ?? '');
            if (!hits.length) return null;
            return DecorationSet.create(
              state.doc,
              hits.map(([from, to]) => Decoration.inline(from, to, { nodeName: 'mark', class: 'note-search-hit' })),
            );
          },
        },
      }),
    ];
  },
});

// ───────────── 키 ─────────────

const NoteKeys = Extension.create({
  name: 'noteKeys',
  // "/" 메뉴가 먼저 Esc를 받도록 낮은 우선순위
  priority: 50,
  addKeyboardShortcuts() {
    return {
      // 전과 같이 Esc = 메모 칸에서 나가기
      Escape: () => {
        (this.editor.view.dom as HTMLElement).blur();
        return true;
      },
      // 줄 안의 줄바꿈 대신 새 블록 (한 줄 = 한 블록)
      'Shift-Enter': () => this.editor.commands.keyboardShortcut('Enter'),
    };
  },
});

const noShortcuts = () => ({});

export function noteExtensions(opts: { onSlash: (view: SlashView | null) => void }) {
  return [
    Document,
    Text,
    // Ctrl+Alt+0(문단)은 Ctrl+0(100%)과 겹쳐서 뺌
    Paragraph.extend({ addKeyboardShortcuts: noShortcuts }),
    Heading.configure({ levels: [1, 2, 3] }),
    Bold,
    Italic,
    Code,
    // Ctrl+Shift+S(취소선)는 "다른 이름으로 저장"과 겹쳐서 뺌 — 취소선은 ~~글~~ 또는 서식 막대로
    Strike.extend({ addKeyboardShortcuts: noShortcuts }),
    Blockquote,
    CodeBlock,
    HorizontalRule,
    BulletList,
    OrderedList,
    // Tab/Shift+Tab 들여쓰기는 쓰지 않음
    ListItem.extend({
      addKeyboardShortcuts() {
        return { Enter: () => this.editor.commands.splitListItem(this.name) };
      },
    }),
    TaskList,
    TaskItem.extend({
      addKeyboardShortcuts() {
        return { Enter: () => this.editor.commands.splitListItem(this.name) };
      },
    }).configure({ nested: true }),
    ListKeymap,
    UndoRedo,
    Gapcursor,
    Placeholder.configure({
      placeholder: ({ editor, node }: { editor: Editor; node: PmNode }) => {
        if (editor.isEmpty) return "이 생각에 대해 자유롭게 적어 보세요…  ( '/' 를 누르면 제목·목록·체크박스 )";
        if (!editor.isFocused) return '';
        if (node.type.name === 'heading') return `제목 ${node.attrs.level}`;
        return "'/' 를 눌러 블록 선택";
      },
    }),
    SlashCommand.configure({ onState: opts.onSlash }),
    SearchHighlight,
    NoteKeys,
  ];
}
