import { useEffect, useRef, useState } from 'react';
import { alertUser, desktopApi, projectName, renameProject } from '../persistence/fileService';
import { useStore } from '../store/store';
import { SparkIcon } from './AiToast';
import { SaveStatus } from './SaveStatus';

/**
 * 프로그램 바 (기본 제목 표시줄 대신).
 *  왼쪽: 프로젝트 버튼(누르면 왼쪽 프로젝트 창) · 프로젝트 이름 · 저장 상태
 *  오른쪽: 메뉴(⋯) · 최소화 · 최대화/이전 크기 · 닫기
 *  빈 곳을 끌면 창 이동, 더블클릭하면 최대화 (Windows 기본 동작)
 */
export function TitleBar() {
  const filePath = useStore((s) => s.filePath);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const setDrawer = useStore((s) => s.setDrawer);
  const aiOpen = useStore((s) => s.aiSettingsOpen);
  const setAiOpen = useStore((s) => s.setAiSettingsOpen);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi.isMaximized().then(setMaximized);
    return desktopApi.onWindowState((st) => setMaximized(st.maximized));
  }, []);

  return (
    <header className="titlebar" data-testid="titlebar" onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
      <button
        className="tb-project"
        aria-pressed={drawerOpen}
        title="프로젝트"
        data-testid="project-button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setDrawer(!drawerOpen)}
      >
        <AppLogo />
      </button>
      <div className="tb-title">
        <ProjectTitle filePath={filePath} />
        <SaveStatus />
      </div>
      <div className="tb-spacer" />
      {desktopApi && (
        <div className="tb-controls" onMouseDown={(e) => e.preventDefault()}>
          <button
            className="tb-btn tb-ai"
            title="AI 연결 (Claude · ChatGPT)"
            aria-pressed={aiOpen}
            data-testid="ai-button"
            onClick={() => setAiOpen(!aiOpen)}
          >
            <SparkIcon />
            <span>AI</span>
          </button>
          <button
            className="tb-btn"
            title="메뉴 (파일 · 편집 · 보기)"
            data-testid="app-menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              desktopApi!.showMenu(r.left, r.bottom);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="3.5" cy="8" r="1.3" />
              <circle cx="8" cy="8" r="1.3" />
              <circle cx="12.5" cy="8" r="1.3" />
            </svg>
          </button>
          <button className="tb-btn" title="최소화" data-testid="win-minimize" onClick={() => desktopApi!.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1">
              <path d="M0 5.5h10" />
            </svg>
          </button>
          <button
            className="tb-btn"
            title={maximized ? '이전 크기로' : '최대화'}
            data-testid="win-maximize"
            onClick={() => desktopApi!.toggleMaximize()}
          >
            {maximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="2.5" width="7" height="7" />
                <path d="M2.5 2.5V0.5h7v7h-2" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="0.5" y="0.5" width="9" height="9" />
              </svg>
            )}
          </button>
          <button className="tb-btn tb-close" title="닫기" data-testid="win-close" onClick={() => desktopApi!.closeWindow()}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.1">
              <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
            </svg>
          </button>
        </div>
      )}
    </header>
  );
}

/** 프로젝트 이름. 누르면 그 자리에서 이름을 바꾼다 (새 프로젝트는 "새 프로젝트"로 만들어지므로). */
function ProjectTitle({ filePath }: { filePath: string | null }) {
  const [editing, setEditing] = useState(false);
  const name = projectName(filePath);
  if (!filePath || !editing) {
    return filePath ? (
      <button className="tb-name" data-testid="project-name" title="눌러서 이름 바꾸기" onClick={() => setEditing(true)}>
        {name}
      </button>
    ) : (
      <span className="tb-name" data-testid="project-name">
        {name}
      </span>
    );
  }
  return (
    <TitleInput
      initial={name}
      onDone={async (next) => {
        setEditing(false);
        if (!next || next === name) return;
        const problem = await renameProject(filePath, next);
        if (problem) await alertUser(problem);
      }}
    />
  );
}

function TitleInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="tb-name-input"
      data-testid="project-name-input"
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value.trim())}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') finish(value.trim());
        else if (e.key === 'Escape') finish(null);
      }}
    />
  );
}

/** 앱 아이콘을 작게 (Box 두 개와 흐름) */
export function AppLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2.5" y="4" width="8.5" height="5.5" rx="1.4" fill="currentColor" />
      <rect x="13" y="14.5" width="8.5" height="5.5" rx="1.4" fill="currentColor" />
      <path d="M11 6.8c3.6 0 5.8 1.3 6.2 6.4" stroke="#22c55e" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M15.6 11.4l1.6 2.3 1.7-2.3" stroke="#22c55e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
