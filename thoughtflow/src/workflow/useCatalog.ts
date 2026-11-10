/**
 * 화면에서 쓰는 도구 목록: 계획의 작업 폴더가 바뀌면 다시 읽고, 여러 칸이 같은 목록을 나눠 쓴다.
 * Claude가 report_capabilities로 알려 준 도구는 앱을 끌 때까지만 기억해 함께 보여 준다 (파일에 저장하지 않음).
 */
import { useEffect, useSyncExternalStore } from 'react';
import { desktopApi } from '../persistence/fileService';
import { useStore } from '../store/store';
import { BUILTIN_AGENTS, dedupeCatalog, type Catalog, type CatalogItem } from './catalog';
import { workflowOf } from './defaults';

let scanned: Catalog = { items: BUILTIN_AGENTS, workingDir: null, scannedAt: 0 };
let reported: CatalogItem[] = [];
let current: Catalog = scanned;
let loading = false;
let loadedFor: string | null | undefined;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const rebuild = () => {
  current = reported.length ? { ...scanned, items: dedupeCatalog([...scanned.items, ...reported]) } : scanned;
};

async function load(workingDir: string | null, refresh = false) {
  if (!desktopApi) return;
  loadedFor = workingDir;
  loading = true;
  emit();
  try {
    const next = await desktopApi.catalogList(workingDir, refresh);
    if (loadedFor === workingDir) {
      scanned = next;
      rebuild();
    }
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

/** 지금 계획의 작업 폴더 기준 도구 목록 (AI 도구가 쓴다 — 아직 읽지 않았으면 읽고 나서) */
export async function catalogFor(workingDir: string | null): Promise<Catalog> {
  if (loadedFor !== workingDir || !scanned.scannedAt) {
    if (!pending || loadedFor !== workingDir) pending = load(workingDir).finally(() => (pending = null));
    await pending;
  }
  return current;
}

/** Claude가 알려 준 도구를 더한다. 새로 더한 개수를 돌려준다. */
export function addReported(items: CatalogItem[]): number {
  const before = reported.length;
  reported = dedupeCatalog([...reported, ...items.map((it) => ({ ...it, source: 'claude' as const }))]);
  rebuild();
  emit();
  return reported.length - before;
}

export function useCatalog() {
  const workingDir = useStore((s) => workflowOf(s.doc).workingDir ?? null);
  const catalog = useSyncExternalStore(subscribe, snapshot);
  const isLoading = useSyncExternalStore(subscribe, loadingSnapshot);
  useEffect(() => {
    if (loadedFor !== workingDir) void load(workingDir);
  }, [workingDir]);
  return { catalog, loading: isLoading, refresh: () => void load(workingDir, true) };
}
