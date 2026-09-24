import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { neighborNode } from '../model/graph';
import type { BoxNode } from '../model/types';
import { useStore } from '../store/store';

interface Props {
  node: BoxNode;
  selected: boolean;
  editing: boolean;
  /** 마우스가 테두리 band 위에 있음 → Route를 끌어낼 수 있다는 표시 */
  borderHover: boolean;
  /** Route를 그리는 중 이 Box 위에 놓으면 연결됨 */
  dropTarget: boolean;
}

export const BoxView = memo(function BoxView({ node, selected, editing, borderHover, dropTarget }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // 실제 렌더링 크기를 측정해 Doc에 반영 (Anchor 계산용). Undo 기록에는 남기지 않는다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => useStore.getState().setNodeSize(node.id, el.offsetWidth, el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.id]);

  const className = [
    'box',
    selected && 'is-selected',
    editing && 'is-editing',
    borderHover && 'is-border-hover',
    dropTarget && 'is-drop-target',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={ref}
      className={className}
      data-node-id={node.id}
      data-testid="box"
      style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
    >
      {editing ? (
        <BoxEditor key="edit" nodeId={node.id} initialText={node.text} />
      ) : (
        <div key="view" className="box-text">
          {node.text || <span className="box-placeholder">내용 입력</span>}
        </div>
      )}
      <span className="box-port port-top" />
      <span className="box-port port-right" />
      <span className="box-port port-bottom" />
      <span className="box-port port-left" />
    </div>
  );
});

/**
 * 편집 중에는 React가 텍스트를 관리하지 않는다 (contentEditable과 React 재조정 충돌 방지).
 * 마운트 시 textContent를 넣고, blur 시 innerText를 읽어 한 번만 commit 한다.
 */
function neighborNodeLatest(id: string, dir: 'incoming' | 'outgoing') {
  return neighborNode(useStore.getState().doc, id, dir);
}

function BoxEditor({ nodeId, initialText }: { nodeId: string; initialText: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initialText;
    el.focus({ preventScroll: true });
    // 커서를 텍스트 끝으로
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const el = ref.current;
    if (!el || committed.current) return;
    committed.current = true;
    const text = el.innerText.replace(/\n$/, '');
    const s = useStore.getState();
    if (s.doc.nodes[nodeId]) s.setText(nodeId, text);
    if (s.editingNodeId === nodeId) s.stopEditing();
  };

  return (
    <div
      ref={ref}
      className="box-text box-editor"
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-testid="box-editor"
      onBlur={commit}
      onKeyDown={(e) => {
        // 한글 IME 조합 중인 키 입력은 무시
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          ref.current?.blur();
        } else if (e.key === 'Tab') {
          // Tab: 다음 생각(outgoing Box)으로, Shift+Tab: 이전 생각(incoming Box)으로 바로 이동
          e.preventDefault();
          const next = neighborNodeLatest(nodeId, e.shiftKey ? 'incoming' : 'outgoing');
          ref.current?.blur();
          if (next) useStore.getState().startEditing(next);
        }
      }}
    />
  );
}
