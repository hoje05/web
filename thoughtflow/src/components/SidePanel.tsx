import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { NoteEditor, type NoteEditorHandle } from '../editor/NoteEditor';
import { incomingEdges, outgoingEdges } from '../model/graph';
import type { BoxNode, Doc } from '../model/types';
import { nodeMatches, useStore } from '../store/store';

/**
 * 오른쪽 창: Box 하나에 대한 긴 생각을 쓰는 곳.
 *  - 윗부분: 연 Box들이 탭으로 한 줄 나열 → 클릭하면 그 Box의 창으로 전환
 *  - 제목(= Box에 보이는 글), 들어온/나간 흐름, 메모 (Notion식 블록 편집: "/" 메뉴, 제목·목록·체크박스)
 *  - × 로 닫으면, 다시 열 때는 Box 더블클릭
 */
export function SidePanel() {
  const open = useStore((s) => s.panelOpen);
  const width = useStore((s) => s.panelWidth);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const nodes = useStore((s) => s.doc.nodes);
  const query = useStore((s) => s.searchQuery);
  const tabsRef = useRef<HTMLDivElement>(null);

  // 활성 탭이 보이도록 가로 스크롤
  useEffect(() => {
    tabsRef.current?.querySelector('.panel-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTab, tabs.length]);

  if (!open) return null;
  const s = useStore.getState();
  const liveTabs = tabs.filter((id) => nodes[id]);
  const node = activeTab ? nodes[activeTab] : undefined;

  return (
    <aside className="side-panel" style={{ width }} data-testid="side-panel">
      <div className="panel-top">
        <div
          className="panel-tabs"
          role="tablist"
          ref={tabsRef}
          onWheel={(e) => {
            // 세로 휠로도 탭 줄을 가로로 스크롤
            if (tabsRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) tabsRef.current.scrollLeft += e.deltaY;
          }}
        >
          {liveTabs.map((id) => (
            <div
              key={id}
              role="tab"
              aria-selected={id === activeTab}
              className={['panel-tab', id === activeTab && 'is-active', nodeMatches(nodes[id], query) && 'is-match']
                .filter(Boolean)
                .join(' ')}
              title={nodes[id].text || '제목 없음'}
              data-testid="panel-tab"
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  s.closeTab(id);
                }
              }}
              onClick={() => s.activateTab(id)}
            >
              <span className="panel-tab-label">{firstLine(nodes[id].text)}</span>
              <button
                className="panel-tab-close"
                aria-label="탭 닫기"
                onClick={(e) => {
                  e.stopPropagation();
                  s.closeTab(id);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          className="panel-close"
          title="창 닫기 (다시 열려면 Box를 더블클릭)"
          data-testid="panel-close"
          onClick={() => {
            s.closePanel();
            s.setPanelDismissed(true);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
      {node ? (
        <PageEditor key={node.id} node={node} query={query} />
      ) : (
        <div className="panel-empty">Board에서 Box를 클릭하면 여기에서 생각을 적을 수 있습니다.</div>
      )}
      <ResizeHandle />
    </aside>
  );
}

const firstLine = (text: string) => text.split('\n')[0].trim() || '제목 없음';

/**
 * 입력칸에 머무는 동안의 변경을 Undo 한 번으로 묶는다.
 * (글자마다 Undo 기록이 쌓이지 않도록, 입력칸을 떠날 때 시작 시점 Doc을 기록)
 */
function useEditSession() {
  const before = useRef<Doc | null>(null);
  const changed = useRef(false);
  const begin = () => {
    before.current = useStore.getState().doc;
    changed.current = false;
  };
  const touch = () => {
    if (!before.current) begin();
    changed.current = true;
  };
  const end = () => {
    if (before.current && changed.current) useStore.getState().commitFrom(before.current);
    before.current = null;
    changed.current = false;
  };
  useEffect(() => end, []);
  return { begin, touch, end };
}

function PageEditor({ node, query }: { node: BoxNode; query: string }) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const noteRef = useRef<NoteEditorHandle>(null);
  const focusReq = useStore((s) => s.panelFocus);
  const edges = useStore((s) => s.doc.edges);
  const nodes = useStore((s) => s.doc.nodes);
  const session = useEditSession();

  // 제목 입력칸 높이를 내용에 맞춘다
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [node.text]);

  // 더블클릭 등으로 요청된 포커스
  useEffect(() => {
    if (!focusReq || focusReq.nodeId !== node.id) return;
    if (focusReq.field === 'note') {
      noteRef.current?.focus('end');
      return;
    }
    const el = titleRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, [focusReq, node.id]);

  const doc = { nodes, edges } as Doc;
  const incoming = incomingEdges(doc, node.id);
  const outgoing = outgoingEdges(doc, node.id);
  const s = useStore.getState();

  return (
    <div className="panel-page" data-testid="panel-page">
      <textarea
        ref={titleRef}
        className="panel-title"
        rows={1}
        value={node.text}
        placeholder="제목 없음"
        spellCheck={false}
        data-testid="panel-title"
        onFocus={session.begin}
        onBlur={session.end}
        onChange={(e) => {
          session.touch();
          s.setTextLive(node.id, e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            // 제목에서 Enter → 메모로
            e.preventDefault();
            noteRef.current?.focus('start');
          } else if (e.key === 'Escape') {
            e.currentTarget.blur();
          }
        }}
      />
      {(incoming.length > 0 || outgoing.length > 0) && (
        <div className="panel-flow">
          {incoming.length > 0 && (
            <FlowRow label="들어온 흐름" kind="in">
              {incoming.map((e) => (
                <FlowChip key={e.id} node={nodes[e.sourceNodeId]} kind="in" />
              ))}
            </FlowRow>
          )}
          {outgoing.length > 0 && (
            <FlowRow label="나간 흐름" kind="out">
              {outgoing.map((e) => (
                <FlowChip key={e.id} node={nodes[e.targetNodeId]} kind="out" />
              ))}
            </FlowRow>
          )}
        </div>
      )}
      <NoteEditor
        ref={noteRef}
        note={node.note}
        query={query}
        onFocus={session.begin}
        onBlur={session.end}
        onChange={(note) => {
          session.touch();
          useStore.getState().setNoteLive(node.id, note);
        }}
      />
    </div>
  );
}

function FlowRow({ label, kind, children }: { label: string; kind: 'in' | 'out'; children: ReactNode }) {
  return (
    <div className={`panel-flow-row flow-${kind}`}>
      <span className="panel-flow-label">{label}</span>
      <div className="panel-flow-chips">{children}</div>
    </div>
  );
}

function FlowChip({ node, kind }: { node: BoxNode | undefined; kind: 'in' | 'out' }) {
  if (!node) return null;
  return (
    <button
      className={`flow-chip flow-${kind}`}
      title={node.text || '제목 없음'}
      onClick={() => {
        const s = useStore.getState();
        s.select({ kind: 'node', id: node.id });
        s.openPage(node.id, { force: true });
      }}
    >
      {kind === 'in' ? '← ' : '→ '}
      {firstLine(node.text)}
    </button>
  );
}

function ResizeHandle() {
  return (
    <div
      className="panel-resize"
      title="끌어서 창 너비 조절"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        // 창은 화면 오른쪽 끝에 붙어 있으므로, 왼쪽 가장자리를 끌면 너비 = 화면 폭 - 마우스 x
        const move = (ev: PointerEvent) => useStore.getState().setPanelWidth(window.innerWidth - ev.clientX);
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
          el.removeEventListener('pointercancel', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
    />
  );
}
