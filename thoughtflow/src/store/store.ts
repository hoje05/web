import { create } from 'zustand';
import type { Vec } from '../geometry/vec';
import { EMPTY_DOC, type Doc, type Selection, type Tool, type Viewport } from '../model/types';
import { zoomAt } from '../viewport/viewport';

export interface AppState {
  doc: Doc;
  viewport: Viewport;
  boardSize: { width: number; height: number };
  selection: Selection;
  tool: Tool;
  /** Space 키를 누르고 있는 동안 true → 왼쪽 드래그가 Pan */
  spaceHeld: boolean;

  setViewport: (v: Viewport) => void;
  zoomBy: (factor: number, anchor?: Vec) => void;
  setBoardSize: (size: { width: number; height: number }) => void;
  setTool: (tool: Tool) => void;
  setSpaceHeld: (held: boolean) => void;
}

export const useStore = create<AppState>()((set, get) => ({
  doc: EMPTY_DOC,
  viewport: { zoom: 1, panX: 0, panY: 0 },
  boardSize: { width: 1, height: 1 },
  selection: null,
  tool: 'select',
  spaceHeld: false,

  setViewport: (viewport) => set({ viewport }),
  zoomBy: (factor, anchor) => {
    const { viewport, boardSize } = get();
    const a = anchor ?? { x: boardSize.width / 2, y: boardSize.height / 2 };
    set({ viewport: zoomAt(viewport, a, factor) });
  },
  setBoardSize: (boardSize) => set({ boardSize }),
  setTool: (tool) => set({ tool }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
}));
