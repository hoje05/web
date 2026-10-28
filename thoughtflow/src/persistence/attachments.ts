/**
 * Box 첨부(이미지·파일): 고르기 / 끌어다 놓기 / 붙여 넣기 → 프로젝트의 자료 폴더로 복사 → Box에 기록 (Undo 한 칸).
 * 파일 내용은 프로젝트 파일(JSON)에 넣지 않는다. 모두 이 PC 안에서만.
 */
import { commitChange } from '../interaction/editSession';
import { addAttachments, removeAttachment } from '../model/docOps';
import type { Attachment } from '../model/types';
import { useStore } from '../store/store';
import { alertUser, desktopApi, saveNow, type AttachResult } from './fileService';

/** 창 안에서 바로 보여 주는 이미지 형식 */
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'];
/** 창 안에서 글자로 미리 볼 수 있는 파일 */
const TEXT_EXT = /\.(csv|tsv|json|txt|md|markdown|log|xml|ya?ml)$/i;

export const isTextAttachment = (a: Attachment) => a.mimeType.startsWith('text/') || TEXT_EXT.test(a.name) || a.mimeType === 'application/json';

/**
 * 첨부를 넣으려면 프로젝트 파일이 있어야 한다 (자료 폴더가 그 옆에 생긴다).
 * 아직 한 번도 저장하지 않은 새 보드면 지금 저장해서 만든다.
 */
async function projectPath(): Promise<string | null> {
  if (!desktopApi) {
    await alertUser('첨부는 데스크톱 앱에서만 사용할 수 있습니다.');
    return null;
  }
  let p = useStore.getState().filePath;
  if (!p) {
    await saveNow(true);
    p = useStore.getState().filePath;
  }
  if (!p) await alertUser('첨부하려면 먼저 프로젝트가 저장되어야 합니다. 위쪽의 저장 상태를 확인해 주세요.');
  return p;
}

/** 가져온 첨부를 Box에 기록 (Undo 한 칸). 가져오는 사이 다른 프로젝트로 바뀌었으면 기록하지 않는다. */
async function record(nodeId: string, project: string, res: AttachResult): Promise<number> {
  const s = useStore.getState();
  let added = 0;
  if (s.filePath === project && s.doc.nodes[nodeId] && res.attachments.length) {
    commitChange((doc) => addAttachments(doc, nodeId, res.attachments));
    added = res.attachments.length;
  }
  if (res.errors.length) await alertUser(`일부 파일을 첨부하지 못했습니다.\n${res.errors.join('\n')}`);
  return added;
}

const failed = (err: unknown): AttachResult => ({ attachments: [], errors: [err instanceof Error ? err.message : String(err)] });

/** 파일 고르기 창으로 첨부 (kind=image면 이미지만 보이게) */
export async function pickAttachments(nodeId: string, kind: 'image' | 'any' = 'any'): Promise<number> {
  const project = await projectPath();
  if (!project || !desktopApi) return 0;
  const res = await desktopApi.attachPick(project, kind).catch(failed);
  return record(nodeId, project, res);
}

/** 끌어다 놓은 파일 · 붙여 넣은 이미지 → Box의 첨부로 */
export async function attachFiles(nodeId: string, files: File[]): Promise<number> {
  if (!files.length) return 0;
  const project = await projectPath();
  if (!project || !desktopApi) return 0;
  return record(nodeId, project, await importFiles(project, files));
}

/** 파일들을 자료 폴더로 복사만 한다 (Box의 첨부로 기록하지 않음 — 메모 안의 그림 등) */
async function importFiles(project: string, files: File[]): Promise<AttachResult> {
  const api = desktopApi!;
  const withPath: string[] = [];
  const data: { name: string; mimeType: string; data: Uint8Array }[] = [];
  for (const f of files) {
    const p = api.pathForFile(f);
    if (p) withPath.push(p);
    else data.push({ name: f.name || pastedName(f.type), mimeType: f.type, data: new Uint8Array(await f.arrayBuffer()) });
  }
  const results = await Promise.all([
    withPath.length ? api.attachPaths(project, withPath).catch(failed) : null,
    data.length ? api.attachData(project, data).catch(failed) : null,
  ]);
  const res: AttachResult = { attachments: [], errors: [] };
  for (const r of results) {
    if (!r) continue;
    res.attachments.push(...r.attachments);
    res.errors.push(...r.errors);
  }
  return res;
}

/**
 * 메모에 넣을 그림: 파일 고르기(files 없음) 또는 붙여 넣기·끌어다 놓기(files) → 자료 폴더로 복사.
 * 그림이 아닌 파일은 돌려주지 않는다. 가져오는 사이 다른 프로젝트로 바뀌었으면 넣지 않는다.
 */
export async function importNoteImages(files?: File[]): Promise<{ src: string; alt: string }[]> {
  const project = await projectPath();
  if (!project || !desktopApi) return [];
  const res = files ? await importFiles(project, files) : await desktopApi.attachPick(project, 'image').catch(failed);
  if (res.errors.length) await alertUser(`일부 그림을 넣지 못했습니다.\n${res.errors.join('\n')}`);
  if (useStore.getState().filePath !== project) return [];
  return res.attachments.filter((a) => a.type === 'image').map((a) => ({ src: a.relativePath, alt: a.name.replace(/\.[^.]+$/, '') }));
}

/** 붙여 넣은 이미지의 이름: "붙여넣은 이미지 2026-10-15 14.05.png" */
function pastedName(mime: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  return `붙여넣은 이미지 ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${ext}`;
}

/** 드래그·붙여 넣기 데이터에서 파일만 (붙여 넣기는 이미지만) */
export function filesOf(dt: DataTransfer | null, imagesOnly = false): File[] {
  if (!dt) return [];
  const files = [...dt.files];
  return imagesOnly ? files.filter((f) => f.type.startsWith('image/')) : files;
}

export const hasFiles = (dt: DataTransfer | null) => !!dt && [...dt.types].includes('Files');

/** Box에서 첨부 빼기 (Undo 한 칸). 파일은 Undo로 되살릴 수 있게 남겨 두고, 다음에 프로젝트를 열 때 정리된다. */
export function removeAttachmentFrom(nodeId: string, attachmentId: string) {
  commitChange((doc) => removeAttachment(doc, nodeId, attachmentId));
}

const base64url = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** 이미지를 보여 줄 주소 (자료 폴더 안 파일만 열린다) */
export function assetUrl(filePath: string | null, a: Attachment): string | null {
  return assetUrlFor(filePath, a.relativePath);
}

export function assetUrlFor(filePath: string | null, relativePath: string): string | null {
  if (!filePath || !desktopApi || !relativePath.startsWith('assets/')) return null;
  return `tfasset://p/${base64url(filePath)}/${encodeURIComponent(relativePath.slice('assets/'.length))}`;
}

/** 이 PC의 기본 프로그램으로 열기 */
export async function openAttachment(a: Attachment) {
  const p = useStore.getState().filePath;
  if (!p || !desktopApi) return;
  const r = await desktopApi.attachOpen(p, a.relativePath);
  if ('error' in r) await alertUser(r.error);
}

/** 탐색기에서 위치 보기 */
export async function revealAttachment(a: Attachment) {
  const p = useStore.getState().filePath;
  if (!p || !desktopApi) return;
  const r = await desktopApi.attachReveal(p, a.relativePath);
  if ('error' in r) await alertUser(r.error);
}

export async function readAttachmentText(a: Attachment): Promise<{ text: string; truncated: boolean } | { error: string }> {
  const p = useStore.getState().filePath;
  if (!p || !desktopApi) return { error: '데스크톱 앱에서만 볼 수 있습니다.' };
  return desktopApi.attachReadText(p, a.relativePath);
}

/** 1.2 MB 처럼 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
