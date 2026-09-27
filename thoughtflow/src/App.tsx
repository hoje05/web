import { useEffect } from 'react';
import { handleAiRequest } from './ai/aiBridge';
import { AiSettings } from './components/AiSettings';
import { AiToast } from './components/AiToast';
import { Board } from './components/Board';
import { ContextMenu } from './components/ContextMenu';
import { ProjectDrawer } from './components/ProjectDrawer';
import { SearchBar } from './components/SearchBar';
import { SidePanel } from './components/SidePanel';
import { TitleBar } from './components/TitleBar';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { runCommand } from './interaction/commands';
import { useKeyboard } from './interaction/useKeyboard';
import { desktopApi, openPath, openStartupBoard, projectName, startAutosave } from './persistence/fileService';
import { useStore } from './store/store';

export function App() {
  useKeyboard();
  const filePath = useStore((s) => s.filePath);
  const panelOpen = useStore((s) => s.panelOpen);
  const panelWidth = useStore((s) => s.panelWidth);

  useEffect(() => {
    // 작업 표시줄에 보이는 이름
    document.title = `${projectName(filePath)} — ThoughtFlow`;
  }, [filePath]);

  // 자동 저장, 메뉴 명령, 파일 연결(더블클릭)로 전달된 파일, 마지막 보드 다시 열기
  useEffect(() => {
    const stopAutosave = startAutosave();
    if (!desktopApi) return stopAutosave;
    const offMenu = desktopApi.onMenuCommand(runCommand);
    const offOpen = desktopApi.onOpenPath((p) => void openPath(p));
    // Claude·ChatGPT의 요청 → 보드. 마지막 보드를 불러온 뒤부터 받는다.
    const api = desktopApi;
    const offAi = api.onAiRequest((req) => void handleAiRequest(req).then((res) => api.aiRespond(req.id, res)));
    void openStartupBoard().finally(() => api.aiReady());
    return () => {
      stopAutosave();
      offMenu();
      offOpen();
      offAi();
    };
  }, []);

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <SidePanel />
        <div className="board-area" style={{ right: panelOpen ? panelWidth : 0 }}>
          <Board />
          <Toolbar />
          <ZoomControls />
          <SearchBar />
          <ContextMenu />
          <AiToast />
        </div>
        <ProjectDrawer />
        <AiSettings />
      </div>
    </div>
  );
}
