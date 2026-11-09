/**
 * 도구 목록 찾기 — 이 PC의 파일을 읽기만 하고, 아무 곳에도 보내지 않는다.
 *
 *  스킬        ~/.claude/skills/<이름>/SKILL.md, <작업 폴더>/.claude/skills/<이름>/SKILL.md, 설치한 플러그인의 skills
 *  명령어      ~/.claude/commands/**.md, <작업 폴더>/.claude/commands/**.md, 플러그인의 commands
 *  서브 에이전트 ~/.claude/agents/*.md, <작업 폴더>/.claude/agents/*.md, 플러그인의 agents, 기본 제공(general-purpose·Explore·Plan)
 *  커넥터      Claude Code 설정(~/.claude.json의 mcpServers, 그 작업 폴더의 mcpServers), <작업 폴더>/.mcp.json,
 *              Claude 데스크톱 설정(claude_desktop_config.json)의 mcpServers
 *
 * claude.ai 계정에 연결한 커넥터(Gmail 등)는 PC 파일에 없어서 여기서는 찾을 수 없다 → 계획에는 이름을 직접 적는다.
 * 테스트용: THOUGHTFLOW_CLAUDE_HOME(=~/.claude), THOUGHTFLOW_CLAUDE_JSON(=~/.claude.json), THOUGHTFLOW_CLAUDE_DIR(데스크톱 설정 폴더)
 */
import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BUILTIN_AGENTS, dedupeCatalog, firstLine, parseFrontmatter, type Catalog, type CatalogItem } from '../src/workflow/catalog';
import { claudeDirs, SERVER_KEY } from './claudeDesktop';

const claudeHome = () => process.env.THOUGHTFLOW_CLAUDE_HOME ?? path.join(os.homedir(), '.claude');
const claudeJson = () => process.env.THOUGHTFLOW_CLAUDE_JSON ?? path.join(os.homedir(), '.claude.json');

/** 한 번에 너무 많이 읽지 않게 */
const MAX_FILES = 2000;
const HEAD_BYTES = 8192;

async function readHead(file: string): Promise<string> {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, bytesRead).toString('utf-8');
  } finally {
    await fh.close();
  }
}

async function dirs(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

/** dir 아래의 .md 파일 (depth 단계까지) */
async function mdFiles(dir: string, depth: number, budget: { n: number }): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (budget.n <= 0) break;
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
      out.push(p);
      budget.n--;
    } else if (e.isDirectory() && depth > 1 && !e.name.startsWith('.')) out.push(...(await mdFiles(p, depth - 1, budget)));
  }
  return out;
}

const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/** .claude 폴더(사용자·작업 폴더) 또는 플러그인 폴더 하나에서 스킬·명령어·에이전트 */
async function scanClaudeDir(base: string, source: CatalogItem['source'], budget: { n: number }, plugin?: string): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  const prefix = plugin ? `${plugin}:` : '';
  const where = plugin ? { where: plugin } : {};
  for (const name of await dirs(path.join(base, 'skills'))) {
    if (budget.n-- <= 0) break;
    try {
      const fm = parseFrontmatter(await readHead(path.join(base, 'skills', name, 'SKILL.md')));
      out.push({ kind: 'skill', name: prefix + (fm.name || name), description: clip(fm.description ?? ''), source, ...where });
    } catch {
      // SKILL.md 없는 폴더
    }
  }
  for (const file of await mdFiles(path.join(base, 'commands'), 3, budget)) {
    try {
      const text = await readHead(file);
      const fm = parseFrontmatter(text);
      out.push({ kind: 'command', name: `/${prefix}${path.basename(file, path.extname(file))}`, description: clip(fm.description || firstLine(text)), source, ...where });
    } catch {
      // 읽을 수 없는 파일
    }
  }
  for (const file of await mdFiles(path.join(base, 'agents'), 2, budget)) {
    try {
      const fm = parseFrontmatter(await readHead(file));
      out.push({ kind: 'subagent', name: prefix + (fm.name || path.basename(file, path.extname(file))), description: clip(fm.description ?? ''), source, ...where });
    } catch {
      // 읽을 수 없는 파일
    }
  }
  return out;
}

/** 설치한 플러그인: ~/.claude/plugins 아래에서 .claude-plugin/plugin.json이 있는 폴더 */
async function pluginRoots(dir: string, depth: number, budget: { n: number }): Promise<{ root: string; name: string }[]> {
  if (depth < 0 || budget.n <= 0) return [];
  try {
    const meta = JSON.parse(await fs.readFile(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf-8'));
    const name = typeof meta?.name === 'string' && meta.name ? meta.name : path.basename(dir);
    return [{ root: dir, name }];
  } catch {
    // 플러그인 폴더가 아님 → 더 안쪽
  }
  const out: { root: string; name: string }[] = [];
  for (const d of await dirs(dir)) {
    budget.n--;
    out.push(...(await pluginRoots(path.join(dir, d), depth - 1, budget)));
  }
  return out;
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const v = JSON.parse(await fs.readFile(file, 'utf-8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

const serverNames = (v: unknown): string[] =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as object).filter((k) => k && k !== SERVER_KEY) : [];

async function connectors(workingDir: string | null): Promise<CatalogItem[]> {
  const out: CatalogItem[] = [];
  const add = (names: string[], source: CatalogItem['source'], description: string) => {
    for (const name of names) out.push({ kind: 'connector', name, description, source });
  };
  const cc = await readJson(claudeJson());
  if (cc) {
    add(serverNames(cc.mcpServers), 'user', 'Claude Code MCP 서버');
    const projects = cc.projects as Record<string, { mcpServers?: unknown }> | undefined;
    if (workingDir && projects && typeof projects === 'object') {
      const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '').toLowerCase();
      const hit = Object.entries(projects).find(([p]) => norm(p) === norm(workingDir));
      if (hit) add(serverNames(hit[1]?.mcpServers), 'project', 'Claude Code MCP 서버 (이 작업 폴더)');
    }
  }
  if (workingDir) {
    const mcp = await readJson(path.join(workingDir, '.mcp.json'));
    if (mcp) add(serverNames(mcp.mcpServers), 'project', '작업 폴더의 .mcp.json');
  }
  for (const dir of claudeDirs()) {
    const cfg = await readJson(path.join(dir, 'claude_desktop_config.json'));
    if (cfg) add(serverNames(cfg.mcpServers), 'desktop', 'Claude 데스크톱 MCP 서버');
  }
  return out;
}

export async function scanCatalog(workingDir: string | null): Promise<Catalog> {
  const budget = { n: MAX_FILES };
  const home = claudeHome();
  const items: CatalogItem[] = [...BUILTIN_AGENTS];
  items.push(...(await scanClaudeDir(home, 'user', budget)));
  if (workingDir) items.push(...(await scanClaudeDir(path.join(workingDir, '.claude'), 'project', budget)));
  for (const p of await pluginRoots(path.join(home, 'plugins'), 6, { n: 400 })) items.push(...(await scanClaudeDir(p.root, 'plugin', budget, p.name)));
  items.push(...(await connectors(workingDir)));
  return { items: dedupeCatalog(items), workingDir, scannedAt: Date.now() };
}

/** 작업 폴더별로 잠깐 기억해 둔다 (자동 완성을 열 때마다 디스크를 읽지 않게). 새로 읽기를 누르면 다시. */
const cache = new Map<string, Promise<Catalog>>();
const CACHE_MS = 30_000;

export function setupCatalog() {
  ipcMain.handle('catalog:list', (_e, rawDir: unknown, refresh: unknown) => {
    const workingDir = typeof rawDir === 'string' && rawDir.trim() ? path.resolve(rawDir.trim()) : null;
    const key = workingDir ?? '';
    const hit = cache.get(key);
    if (hit && refresh !== true) return hit;
    const job = scanCatalog(workingDir).catch((err) => {
      console.error('catalog scan failed', err);
      return { items: [...BUILTIN_AGENTS], workingDir, scannedAt: Date.now() } satisfies Catalog;
    });
    cache.set(key, job);
    setTimeout(() => cache.get(key) === job && cache.delete(key), CACHE_MS);
    return job;
  });
}
