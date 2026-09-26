import { useEffect } from 'react';
import { Board } from './components/Board';
import { SaveStatus } from './components/SaveStatus';
import { SearchBar } from './components/SearchBar';
import { SidePanel } from './components/SidePanel';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { runCommand } from './interaction/commands';
import { useKeyboard } from './interaction/useKeyboard';
import { desktopApi, fileName, openPath, openStartupBoard, startAutosave } from './persistence/fileService';
import { useStore } from './store/store';

export function App() {
  useKeyboard();
  const filePath = useStore((s) => s.filePath);
  const panelOpen = useStore((s) => s.panelOpen);
  const panelWidth = useStore((s) => s.panelWidth);

  useEffect(() => {
    document.title = `${fileName(filePath)} — ThoughtFlow`;
  }, [filePath]);

  // 자동 저장, 메뉴 명령, 파일 연결(더블클릭)로 전달된 파일, 마지막 보드 다시 열기
  useEffect(() => {
    const stopAutosave = startAutosave();
    if (!desktopApi) return stopAutosave;
    const offMenu = desktopApi.onMenuCommand(runCommand);
    const offOpen = desktopApi.onOpenPath((p) => void openPath(p));
    void openStartupBoard();
    return () => {
      stopAutosave();
      offMenu();
      offOpen();
    };
  }, []);

  return (
    <div className="app">
      <SidePanel />
      <div className="board-area" style={{ left: panelOpen ? panelWidth : 0 }}>
        <Board />
        <Toolbar />
        <ZoomControls />
        <SearchBar />
        <SaveStatus />
      </div>
    </div>
  );
}
