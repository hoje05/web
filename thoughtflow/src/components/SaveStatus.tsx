import { fileName, saveBoard } from '../persistence/fileService';
import { useStore } from '../store/store';

/** 왼쪽 아래: 자동 저장 상태와 파일 이름 */
export function SaveStatus() {
  const state = useStore((s) => s.saveState);
  const filePath = useStore((s) => s.filePath);
  const dirty = useStore((s) => s.doc !== s.savedDoc);
  const empty = useStore((s) => Object.keys(s.doc.nodes).length === 0);
  if (!filePath && empty) return null;

  const label =
    state === 'error' ? '저장 실패 — 클릭해서 다시 저장' : state === 'saving' || dirty ? '저장 중…' : '자동 저장됨';
  return (
    <button
      className={`save-status state-${state === 'error' ? 'error' : dirty || state === 'saving' ? 'saving' : 'saved'}`}
      title={filePath ?? '문서/ThoughtFlow 폴더에 자동으로 저장됩니다'}
      data-testid="save-status"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void saveBoard()}
    >
      <span className="save-dot" />
      {label}
      {filePath && <span className="save-file"> · {fileName(filePath)}</span>}
    </button>
  );
}
