import { useEffect, useMemo, useRef, useState } from 'react';
import { nodeMatches, useStore } from '../store/store';

/**
 * Ctrl+F 검색: 제목이나 메모에 키워드가 들어 있는 Box(창)를 보여준다.
 *  - 목록에서 고르면(또는 Enter) 그 Box의 창을 열고 Board에서 가운데로 이동
 *  - Board에서는 일치하는 Box가 강조되고 나머지는 흐려진다
 */
export function SearchBar() {
  const open = useStore((s) => s.searchOpen);
  const seq = useStore((s) => s.searchSeq);
  const query = useStore((s) => s.searchQuery);
  const nodes = useStore((s) => s.doc.nodes);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);

  const results = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => nodeMatches(n, query))
        // 위 → 아래, 왼쪽 → 오른쪽 순서
        .sort((a, b) => a.y - b.y || a.x - b.x),
    [nodes, query],
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, seq]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;
  const s = useStore.getState();

  const go = (i: number) => {
    const n = results[i];
    if (!n) return;
    setActive(i);
    s.select({ kind: 'node', id: n.id });
    s.openPage(n.id, { force: true });
    s.centerOn(n.id);
  };

  return (
    <div className="search-bar" data-testid="search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <div className="search-input-row">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="7" cy="7" r="4.8" />
          <path d="M10.6 10.6 14 14" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          placeholder="생각 검색 (제목·메모)"
          spellCheck={false}
          data-testid="search-input"
          onChange={(e) => s.setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'Escape') {
              e.preventDefault();
              s.closeSearch();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // Enter: 현재 결과 열기 → 다시 누르면 다음 결과
              const opened = s.activeTab === results[active]?.id;
              go(opened ? (active + (e.shiftKey ? -1 + results.length : 1)) % Math.max(1, results.length) : active);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
          }}
        />
        <span className="search-count" data-testid="search-count">
          {query.trim() ? `${results.length}개` : ''}
        </span>
        <button className="search-close" aria-label="검색 닫기" onClick={() => s.closeSearch()}>
          ×
        </button>
      </div>
      {query.trim() && (
        <ul className="search-results" data-testid="search-results">
          {results.length === 0 && <li className="search-empty">"{query.trim()}"이(가) 들어 있는 창이 없습니다</li>}
          {results.map((n, i) => (
            <li
              key={n.id}
              className={i === active ? 'is-active' : undefined}
              data-testid="search-result"
              onMouseEnter={() => setActive(i)}
              onClick={() => go(i)}
            >
              <div className="search-result-title">
                <Mark text={n.text.split('\n')[0] || '제목 없음'} query={query} />
              </div>
              <div className="search-result-snippet">
                <Mark text={snippet(n.text.includes(query.trim()) && !n.note ? '' : n.note, query)} query={query} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 키워드 주변 문장 일부 */
function snippet(text: string, query: string): string {
  const q = query.trim().toLowerCase();
  const flat = text.replace(/\s+/g, ' ');
  const i = flat.toLowerCase().indexOf(q);
  if (i < 0) return flat.slice(0, 60);
  const start = Math.max(0, i - 24);
  return (start > 0 ? '…' : '') + flat.slice(start, i + q.length + 36) + (i + q.length + 36 < flat.length ? '…' : '');
}

function Mark({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  if (!q) return <>{text}</>;
  const out: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let i = 0;
  for (let j = lower.indexOf(q), k = 0; j >= 0; j = lower.indexOf(q, j + q.length), k++) {
    out.push(text.slice(i, j), <mark key={k}>{text.slice(j, j + q.length)}</mark>);
    i = j + q.length;
  }
  out.push(text.slice(i));
  return <>{out}</>;
}
