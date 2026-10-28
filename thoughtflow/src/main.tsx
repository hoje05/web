import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { requestStartupBoard } from './persistence/fileService';
import { useStore } from './store/store';
import './styles.css';

// 시작 속도를 잴 때 보는 표시 (e2e/perf-startup.mjs)
performance.mark('tf:js');
// 마지막 보드는 화면을 그리는 동안 받아 온다
requestStartupBoard();

// e2e 테스트에서 상태를 확인하기 위한 읽기용 hook
(window as unknown as { __tf: unknown }).__tf = { getState: useStore.getState };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
