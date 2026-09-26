import { useEffect, useRef, useState } from 'react';
import {
  createProject,
  deleteProject,
  listProjects,
  openBoard,
  renameProject,
  revealProjects,
  samePath,
  saveNow,
  switchProject,
  type ProjectInfo,
} from '../persistence/fileService';
import { useStore } from '../store/store';

/**
 * 프로젝트 창: 프로그램 바 왼쪽 위 버튼을 누르면 왼쪽에서 스르륵 나온다.
 * 프로젝트 = 보드 파일 하나 (서로 다른 생각 흐름을 따로 관리).
 * 새 프로젝트를 만들거나, 이전 프로젝트를 눌러 그 보드로 전환한다.
 */
export function ProjectDrawer() {
  const open = useStore((s) => s.drawerOpen);
  const createRequested = useStore((s) => s.drawerCreate);
  const filePath = useStore((s) => s.filePath);
  const setDrawer = useStore((s) => s.setDrawer);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => setProjects(await listProjects());

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setRenaming(null);
      setError(null);
      return;
    }
    // 지금 보드의 마지막 변경을 저장한 뒤 목록을 읽는다 (수정 시각·Box 수가 최신이 되도록)
    void saveNow().then(refresh);
    if (createRequested) setCreating(true);
  }, [open, createRequested]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing && !(e.target instanceof HTMLInputElement)) setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setDrawer]);

  const names = new Set((projects ?? []).map((p) => p.name));
  const defaultName = () => {
    let n = '새 프로젝트';
    for (let i = 2; names.has(n); i++) n = `새 프로젝트 ${i}`;
    return n;
  };

  const run = async (fn: () => Promise<string | null | void>) => {
    setBusy(true);
    setError(null);
    try {
      const problem = await fn();
      if (problem) setError(problem);
      return !problem;
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className={`drawer-backdrop${open ? ' is-open' : ''}`} onMouseDown={() => setDrawer(false)} />
      <aside className={`project-drawer${open ? ' is-open' : ''}`} aria-hidden={!open} data-testid="project-drawer">
        <div className="drawer-head">
          <span>프로젝트</span>
          <button className="drawer-icon-btn" title="닫기 (Esc)" onClick={() => setDrawer(false)} tabIndex={open ? 0 : -1}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {creating ? (
          <NameForm
            key={`create-${open}`}
            initial={defaultName()}
            placeholder="프로젝트 이름"
            submitLabel="만들기"
            busy={busy}
            onCancel={() => {
              setCreating(false);
              setError(null);
            }}
            onSubmit={async (name) => {
              if (await run(() => createProject(name))) setDrawer(false);
            }}
          />
        ) : (
          <button
            className="drawer-new"
            data-testid="new-project"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setCreating(true);
              setRenaming(null);
            }}
          >
            <span className="drawer-new-plus">+</span> 새 프로젝트
          </button>
        )}
        {error && <div className="drawer-error" data-testid="drawer-error">{error}</div>}

        <div className="drawer-section">최근 프로젝트</div>
        <ul className="project-list" data-testid="project-list">
          {projects?.length === 0 && <li className="project-empty">아직 프로젝트가 없습니다.</li>}
          {projects?.map((p) =>
            renaming === p.filePath ? (
              <li key={p.filePath}>
                <NameForm
                  initial={p.name}
                  placeholder="새 이름"
                  submitLabel="바꾸기"
                  busy={busy}
                  onCancel={() => setRenaming(null)}
                  onSubmit={async (name) => {
                    if (await run(() => renameProject(p.filePath, name))) {
                      setRenaming(null);
                      await refresh();
                    }
                  }}
                />
              </li>
            ) : (
              <li key={p.filePath} className={samePath(p.filePath, filePath) ? 'is-current' : undefined}>
                <button
                  className="project-item"
                  data-testid="project-item"
                  title={p.filePath}
                  tabIndex={open ? 0 : -1}
                  onClick={async () => {
                    setDrawer(false);
                    await switchProject(p.filePath);
                  }}
                >
                  <span className="project-name">{p.name}</span>
                  <span className="project-meta">
                    {relativeTime(p.modifiedAt)}
                    {p.boxCount !== null && ` · Box ${p.boxCount}개`}
                  </span>
                </button>
                <div className="project-actions">
                  <button
                    className="drawer-icon-btn"
                    title="이름 바꾸기"
                    data-testid="project-rename"
                    tabIndex={open ? 0 : -1}
                    onClick={() => {
                      setRenaming(p.filePath);
                      setCreating(false);
                      setError(null);
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <path d="M9.5 2.2l2.3 2.3L5 11.3 2.3 11.8l.5-2.7z" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    className="drawer-icon-btn"
                    title="휴지통으로 옮기기"
                    data-testid="project-delete"
                    tabIndex={open ? 0 : -1}
                    onClick={async () => {
                      if (await deleteProject(p.filePath)) await refresh();
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <path d="M2.5 4h9M5.5 4V2.6h3V4M3.8 4l.6 7.6h5.2l.6-7.6" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>

        <div className="drawer-foot">
          <button
            tabIndex={open ? 0 : -1}
            onClick={() => {
              setDrawer(false);
              void openBoard();
            }}
          >
            다른 위치에서 열기…
          </button>
          <button tabIndex={open ? 0 : -1} onClick={revealProjects}>
            저장 폴더 열기
          </button>
        </div>
      </aside>
    </>
  );
}

function NameForm(props: {
  initial: string;
  placeholder: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 슬라이드 애니메이션이 시작된 뒤 포커스
    const t = setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 30);
    return () => clearTimeout(t);
  }, []);
  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!props.busy) props.onSubmit(value);
      }}
    >
      <input
        ref={ref}
        value={value}
        placeholder={props.placeholder}
        spellCheck={false}
        data-testid="project-name-input"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            props.onCancel();
          }
        }}
      />
      <button type="submit" disabled={props.busy || !value.trim()}>
        {props.submitLabel}
      </button>
    </form>
  );
}

function relativeTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 2) return '어제';
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  const d = new Date(ms);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}
