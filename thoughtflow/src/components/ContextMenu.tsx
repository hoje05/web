import { useEffect } from 'react';
import { useStore } from '../store/store';

/** Box·Route 우클릭 메뉴 */
export function ContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const setMenu = useStore((s) => s.setContextMenu);
  const board = useStore((s) => s.boardSize);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu, setMenu]);

  if (!menu) return null;
  const label = menu.target === 'node' ? 'Box 삭제' : 'Route 삭제';
  return (
    <>
      <div
        className="context-backdrop"
        onMouseDown={() => setMenu(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(null);
        }}
      />
      <div className="context-menu" role="menu" style={{ left: Math.min(menu.x, board.width - 180), top: Math.min(menu.y, board.height - 52) }} data-testid="context-menu">
        <button
          role="menuitem"
          className="context-item danger"
          data-testid="context-delete"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setMenu(null);
            useStore.getState().deleteSelection();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M2.5 4h9M5.5 4V2.6h3V4M3.8 4l.6 7.6h5.2l.6-7.6" strokeLinejoin="round" />
          </svg>
          <span>{label}</span>
          <kbd>Delete</kbd>
        </button>
      </div>
    </>
  );
}
