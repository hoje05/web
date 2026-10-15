/**
 * Box 첨부(이미지·파일)의 실제 파일 관리 — 모두 이 PC 안에서만.
 *
 *  - 프로젝트 파일 "여행.tflow" 옆의 "여행.assets" 폴더에 복사해 둔다. 프로젝트 파일(JSON)에는 위치와 정보만.
 *  - 폴더 안 이름은 "고유번호-원래이름" → 같은 이름의 파일을 여러 번 넣어도 겹치지 않는다.
 *  - 첨부 하나 = 파일 하나 (다른 Box와 나눠 쓰지 않음). 빼낸 첨부의 파일은 Undo로 되살릴 수 있도록 바로 지우지 않고,
 *    다음에 프로젝트를 열 때 어디에서도 쓰지 않는 파일만 정리한다.
 *  - 화면에서는 tfasset:// 주소로 이미지를 보여 준다 (허용된 프로젝트의 자료 폴더 안 파일만).
 */
import { BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import { randomUUID } from 'crypto';
import { constants as fsConstants, existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

export const ASSET_SCHEME = 'tfasset';

/** 창을 만들기 전에(app ready 전) 불러야 한다 */
export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};
const FILE_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.log': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.pdf': 'application/pdf',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.hwp': 'application/x-hwp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};
/** 이미지로 붙여 넣은 데이터의 확장자 */
const MIME_EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };

/** 파일 하나의 최대 크기 (복사) / 붙여 넣은 데이터의 최대 크기 */
const MAX_FILE = 2 * 1024 ** 3;
const MAX_DATA = 64 * 1024 ** 2;

export interface AttachmentMeta {
  id: string;
  type: 'image' | 'file';
  name: string;
  relativePath: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
}

type ImportResult = { attachments: AttachmentMeta[]; errors: string[] };

/** "여행.tflow" → "여행.assets" (같은 폴더) */
export const assetDirOf = (projectPath: string) =>
  path.join(path.dirname(projectPath), `${path.basename(projectPath, path.extname(projectPath))}.assets`);

const REL = /^assets\/([^/\\]+)$/;

/** 첨부 경로 → 자료 폴더 안의 실제 파일. 허용되지 않은 프로젝트이거나 폴더 밖을 가리키면 null. */
function resolveAsset(isAllowed: (p: string) => boolean, projectPath: unknown, rel: unknown): string | null {
  if (typeof projectPath !== 'string' || typeof rel !== 'string') return null;
  const proj = path.resolve(projectPath);
  if (!isAllowed(proj)) return null;
  const m = REL.exec(rel);
  if (!m || m[1] === '.' || m[1] === '..') return null;
  const dir = assetDirOf(proj);
  const abs = path.join(dir, m[1]);
  return path.dirname(abs) === dir ? abs : null;
}

/** 폴더 안에서 쓸 이름: 파일 이름에 못 쓰는 글자는 빼고, 너무 길면 줄인다 (확장자는 지킨다) */
function safeName(name: string, fallbackExt = ''): string {
  const clean = name
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const ext = (path.extname(clean) || fallbackExt).toLowerCase().slice(0, 12);
  let base = path.basename(clean, path.extname(clean)).slice(0, 60).trim();
  if (!base || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = 'file';
  return `${base}${ext}`;
}

/** PNG·JPEG·WebP 머리 부분에서 가로·세로 크기를 읽는다 (그림 전체를 풀지 않는다) */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  try {
    if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('ascii', 12, 16) === 'IHDR') {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = b[i + 1];
        if (marker === 0xff) {
          i++;
          continue;
        }
        const len = b.readUInt16BE(i + 2);
        const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (sof) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + len;
      }
      return null;
    }
    if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
    }
  } catch {
    // 손상된 머리 → 크기 없이
  }
  return null;
}

async function readHead(file: string, bytes = 256 * 1024): Promise<Buffer> {
  const h = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await h.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await h.close();
  }
}

/** 파일 하나를 자료 폴더로 (경로에서 복사하거나, 붙여 넣은 데이터를 쓴다) */
async function importOne(
  projectPath: string,
  src: { path: string; name?: string } | { data: Uint8Array; name: string; mimeType: string },
): Promise<AttachmentMeta> {
  const dir = assetDirOf(projectPath);
  await fs.mkdir(dir, { recursive: true });
  const original = 'path' in src ? (src.name || path.basename(src.path)) : src.name;
  const fallbackExt = 'data' in src ? (MIME_EXT[src.mimeType] ?? '') : '';
  const name = safeName(original || 'file', fallbackExt);
  let size = 0;
  if ('path' in src) {
    const st = await fs.stat(src.path);
    if (!st.isFile()) throw new Error(`${original}: 파일이 아닙니다 (폴더는 첨부할 수 없습니다).`);
    if (st.size > MAX_FILE) throw new Error(`${original}: 파일이 너무 큽니다 (2GB까지).`);
    size = st.size;
  } else {
    if (src.data.byteLength > MAX_DATA) throw new Error(`${original}: 붙여 넣은 데이터가 너무 큽니다 (64MB까지).`);
    size = src.data.byteLength;
  }
  for (let attempt = 0; ; attempt++) {
    const fileName = `${randomUUID().slice(0, 8)}-${name}`;
    const target = path.join(dir, fileName);
    try {
      if ('path' in src) await fs.copyFile(src.path, target, fsConstants.COPYFILE_EXCL);
      else await fs.writeFile(target, Buffer.from(src.data), { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST' && attempt < 5) continue;
      throw err;
    }
    const ext = path.extname(name).toLowerCase();
    const isImage = !!IMAGE_TYPES[ext];
    const mimeType = IMAGE_TYPES[ext] ?? FILE_TYPES[ext] ?? ('data' in src && src.mimeType ? src.mimeType : 'application/octet-stream');
    const dims = isImage ? imageSize(await readHead(target)) : null;
    return {
      id: `a_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      type: isImage ? 'image' : 'file',
      name: (original || name).normalize('NFC').slice(0, 255),
      relativePath: `assets/${fileName}`,
      mimeType,
      size,
      ...(dims && dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : {}),
    };
  }
}

async function importAll<T>(items: T[], one: (item: T) => Promise<AttachmentMeta>): Promise<ImportResult> {
  const attachments: AttachmentMeta[] = [];
  const errors: string[] = [];
  for (const item of items) {
    try {
      attachments.push(await one(item));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }
  return { attachments, errors };
}

/** 글자 파일 미리보기: UTF-8이 아니면 한국어 Windows 기본(CP949)으로 읽어 본다 */
function decodeText(buf: Buffer): string {
  const body = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    // 잘린 끝 글자 때문일 수 있으니 끝을 조금 빼고 다시
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, Math.max(0, body.length - 3)));
    } catch {
      try {
        return new TextDecoder('euc-kr').decode(body);
      } catch {
        return new TextDecoder('utf-8').decode(body);
      }
    }
  }
}

/** 프로젝트 이름을 바꿀 때 자료 폴더도 함께 (먼저 옮기고, 프로젝트 파일 이름 바꾸기가 실패하면 되돌린다) */
export async function renameAssetDir(from: string, to: string, renameProjectFile: () => Promise<void>) {
  const a = assetDirOf(from);
  const b = assetDirOf(to);
  const move = existsSync(a) && path.resolve(a) !== path.resolve(b) && !existsSync(b);
  if (move) await fs.rename(a, b);
  try {
    await renameProjectFile();
  } catch (err) {
    if (move) await fs.rename(b, a).catch(() => undefined);
    throw err;
  }
}

/** 프로젝트를 휴지통으로 옮길 때 자료 폴더도 */
export async function trashAssetDir(projectPath: string) {
  const dir = assetDirOf(projectPath);
  if (existsSync(dir)) await shell.trashItem(dir).catch((err) => console.error('asset folder trash failed', err));
}

/** 다른 이름으로 저장할 때 자료 폴더를 새 위치로 복사 (원래 프로젝트의 첨부는 그대로) */
export async function copyAssetDir(from: string, to: string) {
  const a = assetDirOf(from);
  const b = assetDirOf(to);
  if (!existsSync(a) || path.resolve(a) === path.resolve(b)) return;
  await fs.cp(a, b, { recursive: true, force: false, errorOnExist: false });
}

export function setupAssets(opts: { isAllowed: (p: string) => boolean; getWindow: () => BrowserWindow | null }) {
  const { isAllowed, getWindow } = opts;
  const project = (p: unknown): string => {
    if (typeof p !== 'string' || !isAllowed(path.resolve(p))) throw new Error('먼저 프로젝트를 저장해 주세요.');
    return path.resolve(p);
  };

  // 이미지 보기: tfasset://p/<프로젝트 경로(base64url)>/<자료 폴더 안 파일 이름>
  protocol.handle(ASSET_SCHEME, async (req) => {
    try {
      const url = new URL(req.url);
      const [, enc, name] = url.pathname.split('/');
      const projectPath = Buffer.from(enc ?? '', 'base64url').toString('utf-8');
      const abs = resolveAsset(isAllowed, projectPath, `assets/${decodeURIComponent(name ?? '')}`);
      if (!abs || !existsSync(abs)) return new Response('not found', { status: 404 });
      return await net.fetch(pathToFileURL(abs).toString());
    } catch {
      return new Response('bad request', { status: 400 });
    }
  });

  /** 파일 고르기 창 → 고른 파일들을 자료 폴더로 */
  ipcMain.handle('attach:pick', async (_e, projectPath: unknown, kind: unknown) => {
    const proj = project(projectPath);
    const win = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: kind === 'image' ? '첨부할 이미지 고르기' : '첨부할 파일 고르기',
      properties: ['openFile', 'multiSelections'],
      filters:
        kind === 'image'
          ? [{ name: '이미지 (PNG, JPG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
          : [
              { name: '모든 파일', extensions: ['*'] },
              { name: '이미지 (PNG, JPG, WebP)', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
              { name: '자료 (CSV, JSON, TXT, PDF, Markdown)', extensions: ['csv', 'json', 'txt', 'pdf', 'md'] },
            ],
    };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (r.canceled) return { attachments: [], errors: [] } satisfies ImportResult;
    return importAll(r.filePaths, (p) => importOne(proj, { path: p }));
  });

  /** 끌어다 놓은 파일들 (사용자가 직접 놓은 파일의 경로) */
  ipcMain.handle('attach:paths', async (_e, projectPath: unknown, paths: unknown) => {
    const proj = project(projectPath);
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && path.isAbsolute(p)).slice(0, 100) : [];
    return importAll(list, (p) => importOne(proj, { path: p }));
  });

  /** 붙여 넣은 이미지 등 경로가 없는 데이터 */
  ipcMain.handle('attach:data', async (_e, projectPath: unknown, items: unknown) => {
    const proj = project(projectPath);
    const list = (Array.isArray(items) ? items : [])
      .filter(
        (i): i is { name: string; mimeType: string; data: Uint8Array } =>
          !!i && typeof i.name === 'string' && typeof i.mimeType === 'string' && i.data instanceof Uint8Array,
      )
      .slice(0, 50);
    return importAll(list, (i) => importOne(proj, i));
  });

  const existing = (projectPath: unknown, rel: unknown) => {
    const abs = resolveAsset(isAllowed, projectPath, rel);
    if (!abs) throw new Error('허용되지 않은 첨부입니다.');
    if (!existsSync(abs)) throw new Error('첨부 파일을 찾을 수 없습니다. 자료 폴더에서 지워졌거나 옮겨졌을 수 있습니다.');
    return abs;
  };

  /** 이 PC의 기본 프로그램으로 열기 */
  ipcMain.handle('attach:open', async (_e, projectPath: unknown, rel: unknown) => {
    try {
      const problem = await shell.openPath(existing(projectPath, rel));
      return problem ? { error: `파일을 열 수 없습니다. ${problem}` } : { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 탐색기에서 파일 위치 보기 */
  ipcMain.handle('attach:reveal', async (_e, projectPath: unknown, rel: unknown) => {
    try {
      shell.showItemInFolder(existing(projectPath, rel));
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** 글자 파일(CSV, JSON, TXT, Markdown) 앞부분 미리보기 */
  ipcMain.handle('attach:read-text', async (_e, projectPath: unknown, rel: unknown) => {
    try {
      const abs = existing(projectPath, rel);
      const max = 256 * 1024;
      const st = await fs.stat(abs);
      const head = await readHead(abs, max);
      return { text: decodeText(head), truncated: st.size > max };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * 자료 폴더 정리: 프로젝트를 열 때, 어느 Box에서도 쓰지 않는 파일(빼낸 첨부)을 지운다.
   * 방금 넣은 파일은 건드리지 않도록 1분 지난 것만.
   */
  ipcMain.handle('attach:gc', async (_e, projectPath: unknown, keep: unknown) => {
    try {
      const dir = assetDirOf(project(projectPath));
      if (!existsSync(dir)) return { removed: 0 };
      const used = new Set(
        (Array.isArray(keep) ? keep : []).map((r) => (typeof r === 'string' ? REL.exec(r)?.[1] : undefined)).filter(Boolean),
      );
      let removed = 0;
      for (const name of await fs.readdir(dir)) {
        if (used.has(name)) continue;
        const abs = path.join(dir, name);
        const st = await fs.stat(abs).catch(() => null);
        if (!st?.isFile() || Date.now() - st.mtimeMs < 60_000) continue;
        await fs.rm(abs, { force: true }).then(() => removed++, () => undefined);
      }
      return { removed };
    } catch {
      return { removed: 0 };
    }
  });
}
