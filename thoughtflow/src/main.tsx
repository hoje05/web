import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import './styles.css';

// e2e 테스트에서 상태를 확인하기 위한 읽기용 hook
(window as unknown as { __tf: unknown }).__tf = { getState: useStore.getState };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
