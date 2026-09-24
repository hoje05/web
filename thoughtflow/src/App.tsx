import { Board } from './components/Board';
import { Toolbar } from './components/Toolbar';
import { ZoomControls } from './components/ZoomControls';
import { useKeyboard } from './interaction/useKeyboard';

export function App() {
  useKeyboard();
  return (
    <div className="app">
      <Board />
      <Toolbar />
      <ZoomControls />
    </div>
  );
}
