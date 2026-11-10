/**
 * 메모 안의 그림·그래프 블록.
 *  - noteImage: 프로젝트 자료 폴더의 그림 (Markdown: ![설명](assets/…) ). 크기 작게·중간·원래, 두 번 누르면 크게 보기.
 *  - noteChart: 글로 적은 자료를 그래프로 (Markdown: ```chart … ``` — 형식은 chart.ts). "편집"으로 자료를 고치면 바로 다시 그린다.
 * 메모 칸 바깥(오른쪽 창)과의 연결은 noteHost 저장소로: 그림 고르기·붙여 넣기, 크게 보기, 입력 묶음(Undo) 열고 닫기.
 */
import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetUrlFor } from '../persistence/attachments';
import { useStore } from '../store/store';
import { ChartFigure } from './ChartFigure';
import { parseChart } from './chart';
import { BLOCK_ATOMS } from './markdown';

/** 오른쪽 창이 넣어 주는 기능 */
export interface NoteHost {
  /** 그림 파일 고르기 → 자료 폴더로 복사 → 넣을 그림들 */
  pickImages: () => Promise<{ src: string; alt: string }[]>;
  /** 크게 보기 */
  openImage: (src: string, alt: string) => void;
  /** 붙여 넣거나 끌어다 놓은 그림 파일 → 자료 폴더로 복사 → 넣을 그림들 */
  importImages: (files: File[]) => Promise<{ src: string; alt: string }[]>;
  /** 메모 칸에 놓은 그림이 아닌 파일 → Box의 첨부로 */
  attachFiles: (files: File[]) => void;
  /** 그래프 자료 칸에 들어가고 나올 때 (입력을 Undo 한 칸으로 묶기) */
  onFocus: () => void;
  onBlur: () => void;
}

const noHost: NoteHost = {
  pickImages: async () => [],
  importImages: async () => [],
  attachFiles: () => undefined,
  openImage: () => undefined,
  onFocus: () => undefined,
  onBlur: () => undefined,
};

export const NoteHostExtension = Extension.create<Record<string, never>, { host: NoteHost }>({
  name: 'noteHost',
  addStorage() {
    return { host: noHost };
  },
});

/** 그림·그래프가 메모 맨 끝에 오면 그 아래에 빈 줄을 둔다 (Ctrl+End·클릭으로 그 뒤에 이어 쓰기). 저장할 때는 빠진다. */
export const TrailingLine = Extension.create({
  name: 'noteTrailingLine',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('noteTrailingLine'),
        appendTransaction: (trs, _old, state) => {
          const last = state.doc.lastChild;
          if (!trs.some((tr) => tr.docChanged) || !last || !BLOCK_ATOMS.includes(last.type.name)) return null;
          return state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create());
        },
      }),
    ];
  },
});

const hostOf = (editor: ReactNodeViewProps['editor']): NoteHost =>
  (editor.storage as unknown as { noteHost?: { host: NoteHost } }).noteHost?.host ?? noHost;

/** 노드 보기 안의 단추·입력칸에서 일어난 일은 편집기가 가져가지 않게 */
const stopInside = ({ event }: { event: Event }) => {
  const t = event.target as HTMLElement | null;
  return !!t?.closest?.('textarea, input, button, .chart-plot, .chart-donut, .chart-table-wrap');
};

// ───────────── 그림 ─────────────

const SIZES: { width: string | null; label: string; title: string }[] = [
  { width: '33%', label: 'S', title: '작게' },
  { width: '66%', label: 'M', title: '중간' },
  { width: null, label: 'L', title: '원래 크기 (창 폭까지)' },
];

function ImageView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const filePath = useStore((s) => s.filePath);
  const [missing, setMissing] = useState(false);
  const src = String(node.attrs.src ?? '');
  const alt = String(node.attrs.alt ?? '');
  const url = assetUrlFor(filePath, src);
  useEffect(() => setMissing(false), [url]);
  const width = (node.attrs.width as string | null) ?? null;
  return (
    <NodeViewWrapper className={`note-image${selected ? ' is-selected' : ''}`} data-testid="note-image" data-src={src}>
      <div className="note-image-frame" style={{ width: width ?? undefined }} data-drag-handle>
        {url && !missing ? (
          <img
            src={url}
            alt={alt}
            draggable={false}
            decoding="async"
            onError={() => setMissing(true)}
            onDoubleClick={() => hostOf(editor).openImage(src, alt)}
          />
        ) : (
          <div className="note-image-missing">그림 파일을 찾을 수 없습니다 ({src.replace(/^assets\//, '')})</div>
        )}
        <div className="note-image-tools" contentEditable={false}>
          {SIZES.map((s) => (
            <button
              key={s.label}
              className={width === s.width ? 'is-on' : undefined}
              title={s.title}
              data-testid={`note-image-size-${s.label}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => updateAttributes({ width: s.width })}
            >
              {s.label}
            </button>
          ))}
          <button title="크게 보기 (두 번 눌러도 됩니다)" onMouseDown={(e) => e.preventDefault()} onClick={() => hostOf(editor).openImage(src, alt)}>
            ⤢
          </button>
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const NoteImage = Node.create({
  name: 'noteImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '', parseHTML: (el) => el.getAttribute('data-src') ?? '', renderHTML: (a) => ({ 'data-src': a.src }) },
      alt: { default: '', parseHTML: (el) => el.getAttribute('data-alt') ?? '', renderHTML: (a) => ({ 'data-alt': a.alt }) },
      width: { default: null, parseHTML: (el) => el.getAttribute('data-width'), renderHTML: (a) => (a.width ? { 'data-width': a.width } : {}) },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-note-image]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-note-image': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView, { stopEvent: stopInside });
  },
});

// ───────────── 그래프 ─────────────

const CHART_HELP = '첫 줄들(선택): type: bar · line · pie, title: 제목, unit: 단위 — 그 아래는 쉼표로 나눈 표 (첫 줄은 이름)';

function ChartView({ node, updateAttributes, selected, editor }: ReactNodeViewProps) {
  const source = String(node.attrs.source ?? '');
  const [editing, setEditing] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const spec = useMemo(() => parseChart(source), [source]);
  /** 자료 칸을 닫는다 — 칸이 사라지면 blur가 오지 않을 수 있어 입력 묶음(Undo 한 칸)을 직접 닫는다 */
  const finish = () => {
    if (document.activeElement === area.current) hostOf(editor).onBlur();
    setEditing(false);
  };

  // "/그래프"로 막 넣은 그래프는 바로 자료 편집
  useEffect(() => {
    if (node.attrs.fresh) {
      setEditing(true);
      updateAttributes({ fresh: false });
    }
  }, [node.attrs.fresh, updateAttributes]);
  useEffect(() => {
    if (editing) area.current?.focus();
  }, [editing]);

  return (
    <NodeViewWrapper className={`note-chart${selected ? ' is-selected' : ''}`} data-testid="note-chart">
      <div className="note-chart-tools" contentEditable={false}>
        <button data-testid="note-chart-edit" onMouseDown={(e) => e.preventDefault()} onClick={() => (editing ? finish() : setEditing(true))}>
          {editing ? '완료' : '편집'}
        </button>
      </div>
      {editing && (
        <div className="note-chart-editor" contentEditable={false}>
          <textarea
            ref={area}
            value={source}
            spellCheck={false}
            rows={Math.min(14, Math.max(5, source.split('\n').length + 1))}
            data-testid="note-chart-source"
            onFocus={() => hostOf(editor).onFocus()}
            onBlur={() => hostOf(editor).onBlur()}
            onChange={(e) => updateAttributes({ source: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                finish();
              }
            }}
          />
          <div className="note-chart-help">{CHART_HELP}</div>
        </div>
      )}
      <ChartFigure spec={spec} />
    </NodeViewWrapper>
  );
}

export const NoteChart = Node.create({
  name: 'noteChart',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: { default: '', parseHTML: (el) => el.getAttribute('data-source') ?? '', renderHTML: (a) => ({ 'data-source': a.source }) },
      fresh: { default: false, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-note-chart]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-note-chart': '' })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ChartView, { stopEvent: stopInside });
  },
});
