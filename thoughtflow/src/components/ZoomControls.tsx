import { useEffect, useState } from 'react';
import { useStore } from '../store/store';

export function ZoomControls() {
  const zoom = useStore((s) => s.viewport.zoom);
  const zoomBy = useStore((s) => s.zoomBy);
  const fitView = useStore((s) => s.fitView);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (!help) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setHelp(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [help]);

  return (
    <>
      {help && <HelpPanel onClose={() => setHelp(false)} />}
      <div className="zoom-controls" onMouseDown={(e) => e.preventDefault()}>
        <button title="축소 (Ctrl -)" onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button className="zoom-value" data-testid="zoom-value" title="100% (Ctrl 0)" onClick={() => zoomBy(1 / zoom)}>
          {Math.round(zoom * 100)}%
        </button>
        <button title="확대 (Ctrl +)" onClick={() => zoomBy(1.2)}>
          +
        </button>
        <span className="zoom-sep" />
        <button title="전체 보기 (Shift 1)" data-testid="zoom-fit" onClick={fitView}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M1.5 5V1.5H5M9 1.5h3.5V5M12.5 9v3.5H9M5 12.5H1.5V9" />
          </svg>
        </button>
        <button title="사용법" aria-pressed={help} onClick={() => setHelp((h) => !h)}>
          ?
        </button>
      </div>
    </>
  );
}

const HELP: [string, string][] = [
  ['프로젝트', '왼쪽 위 버튼 → 새 프로젝트(빈 보드가 바로 열림) · 이전 프로젝트 열기'],
  ['프로젝트 이름', '위쪽 프로그램 바의 이름을 눌러 바로 바꾸기'],
  ['Box 만들기', 'Box를 Board로 끌어다 놓기 · 빈 곳 더블클릭'],
  ['생각 쓰기', 'Box 클릭 → 오른쪽 창에 자유롭게 쓰기'],
  ['메모 꾸미기', "'/' 메뉴 · # 제목 · - 목록 · [] 체크박스 · 1. 번호 · **굵게**"],
  ['창 닫기/열기', '창의 × 로 닫기 · Box 더블클릭으로 다시 열기'],
  ['창 전환', '창 위쪽 탭 클릭 · 들어온/나간 흐름 클릭'],
  ['Box 글 바로 고치기', 'Box 선택 후 Enter  /  완료 Esc  /  다음 Box Tab'],
  ['다음 생각 잇기', 'Box 테두리에서 끌어내 빈 곳에 놓기'],
  ['Box끼리 연결', 'Box 테두리에서 끌어 다른 Box 위에 놓기'],
  ['자유 Route', 'Route 도구(R) → 빈 곳에서 그리기'],
  ['방향 바꾸기', 'Route의 화살표 클릭'],
  ['선 정리', 'Route는 그리면 자동으로 매끈해지고, Box를 옮기면 따라 움직임'],
  ['정렬', '왼쪽 도구 막대의 정렬 → Box·Route를 흐름 순서대로 (Ctrl+Z로 되돌리기)'],
  ['검색', 'Ctrl+F (제목과 메모에서 찾기)'],
  ['저장', '자동 저장 · 바로 저장 Ctrl+S · 새 프로젝트 Ctrl+N'],
  ['화면 이동', '빈 곳 드래그 · 휠 버튼 · Space+드래그'],
  ['확대/축소', '마우스 휠 · 전체 보기 Shift+1'],
  ['되돌리기', 'Ctrl+Z  /  다시 실행 Ctrl+Y'],
  ['삭제', 'Box·Route 우클릭 → 삭제 · Delete'],
  ['AI 연결', '프로그램 바의 AI 버튼 → Claude·ChatGPT가 대화를 보드에 정리'],
];

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="help-panel" role="dialog" aria-label="사용법" onMouseDown={(e) => e.preventDefault()}>
      <div className="help-title">
        사용법
        <button onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <dl>
        {HELP.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="help-legend">
        Box를 선택하면 <span className="lg-in">들어온 흐름</span>은 보라, <span className="lg-out">나간 흐름</span>은 초록으로
        표시됩니다.
      </p>
    </div>
  );
}
