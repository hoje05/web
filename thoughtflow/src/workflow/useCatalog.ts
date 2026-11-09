/** 화면에서 쓰는 도구 목록: 계획의 작업 폴더가 바뀌면 다시 읽고, 여러 칸이 같은 목록을 나눠 쓴다. */
import { useEffect, useSyncExternalStore } from 'react';
import { desktopApi } from '../persistence/fileService';
import { useStore } from '../store/store';
import { BUILTIN_AGENTS, type Catalog } from './catalog';
import { workflowOf } from './defaults';

let current: Catalog = { items: BUILTIN_AGENTS, workingDir: null, scannedAt: 0 };
let loading = false;
let loadedFor: string | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

async function load(workingDir: string | null, refresh = false) {
  if (!desktopApi) return;
  loadedFor = workingDir;
  loading = true;
  emit();
  try {
    const next = await desktopApi.catalogList(workingDir, refresh);
    if (loadedFor === workingDir) current = next;
  } finally {
    loading = false;
    emit();
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => current;
const loadingSnapshot = () => loading;

export function useCatalog() {
  const workingDir = useStore((s) => workflowOf(s.doc).workingDir ?? null);
  const catalog = useSyncExternalStore(subscribe, snapshot);
  const isLoading = useSyncExternalStore(subscribe, loadingSnapshot);
  useEffect(() => {
    if (loadedFor !== workingDir) void load(workingDir);
  }, [workingDir]);
  return { catalog, loading: isLoading, refresh: () => void load(workingDir, true) };
}
