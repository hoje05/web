import { useEffect, useMemo } from 'react';
import { commitChange } from '../interaction/editSession';
import { setTagActive, tagUsage } from '../model/tags';
import { useStore } from '../store/store';

/**
 * 저장된 태그 관리: 지우기(보관) / 되살리기.
 * 지워도 이미 붙어 있는 Box의 태그는 그대로 남고, 추천 목록에서만 빠진다. 같은 이름을 다시 쓰면 되살아난다.
 */
export function TagManager() {
  const open = useStore((s) => s.tagManagerOpen);
  const tags = useStore((s) => s.doc.tags);
  const nodes = useStore((s) => s.doc.nodes);
  const usage = useMemo(() => (open ? tagUsage({ nodes, edges: {}, tags }) : new Map<string, number>()), [open, nodes, tags]);
  const close = () => useStore.getState().setTagManagerOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopImmediatePropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;
  const list = Object.values(tags ?? {});
  const active = list.filter((t) => t.active).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
  const archived = list.filter((t) => !t.active).sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
  const used = (id: string) => usage.get(id) ?? 0;

  return (
    <>
      <div className="modal-backdrop" onMouseDown={close} />
      <div className="tag-manager" role="dialog" aria-label="저장된 태그" data-testid="tag-manager">
        <div className="ai-head">
          <span className="tag-manager-title">저장된 태그</span>
          <button className="preview-close" aria-label="닫기" onClick={close}>
            ×
          </button>
        </div>
        <div className="tag-manager-body">
          {list.length === 0 && <p className="tag-manager-empty">아직 저장된 태그가 없습니다. 오른쪽 창의 “+ 태그”로 만들 수 있습니다.</p>}
          {active.length > 0 && (
            <ul className="tag-manager-list">
              {active.map((t) => (
                <li key={t.id} data-testid="saved-tag" data-tag-id={t.id}>
                  <span className="tag-chip is-static">{t.name}</span>
                  <span className="tag-manager-count">{used(t.id) ? `Box ${used(t.id)}개` : '쓰는 Box 없음'}</span>
                  <button
                    className="tag-manager-action danger"
                    data-testid="saved-tag-delete"
                    title="저장된 태그에서 지우기 — 이미 붙어 있는 Box에는 남고, 추천 목록에서만 빠집니다 (Ctrl+Z로 되돌리기)"
                    onClick={() => commitChange((doc) => setTagActive(doc, t.id, false))}
                  >
                    지우기
                  </button>
                </li>
              ))}
            </ul>
          )}
          {archived.length > 0 && (
            <>
              <div className="tag-manager-section">지운 태그 — 붙어 있던 Box에는 남아 있고, 추천에는 나오지 않습니다</div>
              <ul className="tag-manager-list">
                {archived.map((t) => (
                  <li key={t.id} data-testid="archived-tag" data-tag-id={t.id}>
                    <span className="tag-chip is-static is-archived">{t.name}</span>
                    <span className="tag-manager-count">{used(t.id) ? `Box ${used(t.id)}개` : '쓰는 Box 없음'}</span>
                    <button
                      className="tag-manager-action"
                      data-testid="saved-tag-restore"
                      onClick={() => commitChange((doc) => setTagActive(doc, t.id, true))}
                    >
                      되살리기
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}
