import { useEffect } from 'react';
import { Board } from './components/Board';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { runCommand } from './interaction/commands';
import { useKeyboard } from './interaction/useKeyboard';
import { desktopApi, fileName, openPath } from './persistence/fileService';
import { useStore } from './store/store';

export function App() {
  useKeyboard();
  const dirty = useStore((s) => s.doc !== s.savedDoc);
  const filePath = useStore((s) => s.filePath);

  // 창 제목 + 저장 안 됨 표시 (창 닫기 확인에 사용)
  useEffect(() => {
    document.title = `${fileName(filePath)}${dirty ? ' •' : ''} — ThoughtFlow`;
    desktopApi?.setDirty(dirty);
  }, [dirty, filePath]);

  // 메뉴 명령, 파일 연결(더블클릭)로 전달된 파일
  useEffect(() => {
    if (!desktopApi) return;
    const offMenu = desktopApi.onMenuCommand(runCommand);
    const offOpen = desktopApi.onOpenPath((p) => void openPath(p));
    void desktopApi.initialFile().then((p) => {
      if (p) void openPath(p, false);
    });
    return () => {
      offMenu();
      offOpen();
    };
  }, []);

  return (
    <div className="app">
      <Board />
      <Toolbar />
      <ZoomControls />
    </div>
  );
}
