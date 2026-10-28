import { useEffect, useState } from 'react';
import { flushEditing } from '../interaction/editing';
import { useStore } from '../store/store';

const SHOW_MS = 8000;

/**
 * AI가 보드를 바꾸면 아래쪽에 잠깐 알려 준다: "Claude: Box 3개와 Route 2개를 추가했습니다."
 * 그 뒤로 다른 편집이 없었으면(= Undo 기록의 맨 위가 AI의 변경) "되돌리기"로 바로 취소할 수 있다 (Ctrl+Z와 같음).
 * (새 Box의 실제 크기 측정은 Doc을 바꾸지만 Undo 기록은 바꾸지 않으므로 영향이 없다)
 */
export function AiToast() {
  const activity = useStore((s) => s.aiActivity);
  const canUndo = useStore((s) => !!s.aiActivity && s.past[s.past.length - 1] === s.aiActivity.before);
  const [visible, setVisible] = useState(false);
  const [hover, setHover] = useState(false);
  const seq = activity?.seq;

  useEffect(() => {
    setVisible(seq !== undefined);
  }, [seq]);

  useEffect(() => {
    if (!visible || hover) return;
    const t = setTimeout(() => setVisible(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [visible, hover, seq]);

  if (!activity || !visible) return null;
  return (
    <div
      className="ai-toast"
      role="status"
      data-testid="ai-toast"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <SparkIcon />
      <span className="ai-toast-text">{activity.message}</span>
      {canUndo && (
        <button
          className="ai-toast-undo"
          data-testid="ai-toast-undo"
          onClick={() => {
            flushEditing();
            useStore.getState().undo();
            setVisible(false);
          }}
        >
          되돌리기
        </button>
      )}
      <button className="ai-toast-close" aria-label="닫기" onClick={() => setVisible(false)}>
        ×
      </button>
    </div>
  );
}

export function SparkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="spark-icon" width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1.2l1.5 4.1 4.3 1.5-4.3 1.6L8 12.6 6.5 8.4 2.2 6.8l4.3-1.5z" />
      <path d="M13 10.6l.6 1.6 1.6.6-1.6.6-.6 1.7-.6-1.7-1.6-.6 1.6-.6z" opacity="0.75" />
    </svg>
  );
}
