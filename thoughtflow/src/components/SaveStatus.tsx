import { saveBoard } from '../persistence/fileService';
import { useStore } from '../store/store';

/** 프로그램 바의 저장 상태 (자동 저장됨 / 저장 중… / 저장 실패) */
export function SaveStatus() {
  const state = useStore((s) => s.saveState);
  const filePath = useStore((s) => s.filePath);
  const dirty = useStore((s) => s.doc !== s.savedDoc);
  const empty = useStore((s) => Object.keys(s.doc.nodes).length === 0);
  if (!filePath && empty) return null;

  const kind = state === 'error' ? 'error' : dirty || state === 'saving' ? 'saving' : 'saved';
  const label = kind === 'error' ? '저장 실패 — 클릭해서 다시 저장' : kind === 'saving' ? '저장 중…' : '자동 저장됨';
  return (
    <button
      className={`save-status state-${kind}`}
      title={filePath ?? '이 PC의 사용자 폴더/ThoughtFlow에 자동으로 저장됩니다'}
      data-testid="save-status"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void saveBoard()}
    >
      <span className="save-dot" />
      {label}
    </button>
  );
}
