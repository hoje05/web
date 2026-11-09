/**
 * 도구 목록(카탈로그): 계획 블록에 고를 수 있는 스킬·명령어·커넥터·서브 에이전트.
 * 실제로 찾는 일은 주 프로세스(electron/catalog.ts)가 이 PC의 파일을 읽어서 한다 — 여기는 공용 모양과 순수 함수.
 */
import type { ResourceKind } from './resources';
import { sameName } from './resources';

export interface CatalogItem {
  kind: ResourceKind;
  /** 계획에 적을 이름 (명령어는 "/"로 시작, 플러그인 것은 "플러그인:이름") */
  name: string;
  description: string;
  /** 어디서 찾았나: 사용자 폴더 · 작업 폴더 · 플러그인 · Claude 데스크톱 설정 · 기본 제공 */
  source: 'user' | 'project' | 'plugin' | 'desktop' | 'builtin';
  /** 플러그인 이름 등 짧은 설명 */
  where?: string;
}

export interface Catalog {
  items: CatalogItem[];
  /** 목록을 읽은 작업 폴더 (없으면 사용자 폴더만) */
  workingDir: string | null;
  scannedAt: number;
}

export const SOURCE_LABEL: Record<CatalogItem['source'], string> = {
  user: '내 PC',
  project: '작업 폴더',
  plugin: '플러그인',
  desktop: 'Claude 데스크톱',
  builtin: '기본 제공',
};

/** Claude Code에 기본으로 있는 서브 에이전트 */
export const BUILTIN_AGENTS: CatalogItem[] = [
  { kind: 'subagent', name: 'general-purpose', description: '여러 단계의 일을 맡기는 범용 에이전트', source: 'builtin' },
  { kind: 'subagent', name: 'Explore', description: '코드를 빠르게 찾아보는 읽기 전용 에이전트', source: 'builtin' },
  { kind: 'subagent', name: 'Plan', description: '구현 계획을 세우는 에이전트', source: 'builtin' },
];

/**
 * 마크다운 맨 앞의 YAML 머리말(--- … ---)에서 단순한 "키: 값"만 읽는다.
 * 따옴표, "|"·">" 여러 줄 값까지. 그 밖의 YAML(목록·객체)은 무시.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const out: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '---') break;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    let value = raw.trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '') && lines[i + 1].trim() !== '---') {
        block.push(lines[++i].trim());
      }
      value = (value.startsWith('|') ? block.join('\n') : block.join(' ')).trim();
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 머리말 다음의 첫 문장 (설명이 없는 명령어 파일용) */
export function firstLine(text: string): string {
  const body = text.replace(/^﻿/, '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const line = body.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('<!--'));
  return (line ?? '').trim().slice(0, 200);
}

/**
 * 자동 완성: 그 종류에서 이름이 query로 시작하는 것 → 이름에 들어 있는 것 → 설명에 들어 있는 것. 이미 고른 것은 빼고.
 */
export function searchCatalog(items: CatalogItem[], kind: ResourceKind, query: string, exclude: string[] = [], limit = 8): CatalogItem[] {
  const q = query.trim().replace(/^\//, '').toLowerCase();
  const pool = items.filter((it) => it.kind === kind && !exclude.some((e) => sameName(e, it.name)));
  const bare = (n: string) => n.replace(/^\//, '').toLowerCase();
  const local = (n: string) => bare(n).replace(/^[^:]*:/, '');
  if (!q) return pool.slice(0, limit);
  const rank = (it: CatalogItem) =>
    bare(it.name).startsWith(q) || local(it.name).startsWith(q) ? 0 : bare(it.name).includes(q) ? 1 : it.description.toLowerCase().includes(q) ? 2 : 3;
  return pool
    .map((it) => ({ it, r: rank(it) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r || a.it.name.localeCompare(b.it.name))
    .slice(0, limit)
    .map((x) => x.it);
}

/** 목록에 있는 이름인가 */
export const findInCatalog = (items: CatalogItem[], kind: ResourceKind, name: string) => items.find((it) => it.kind === kind && sameName(it.name, name));

/** 같은 종류·이름은 하나만 (작업 폴더 > 사용자 > 플러그인 > 데스크톱 > 기본 순서로 남긴다) */
export function dedupeCatalog(items: CatalogItem[]): CatalogItem[] {
  const order: CatalogItem['source'][] = ['project', 'user', 'plugin', 'desktop', 'builtin'];
  const out: CatalogItem[] = [];
  for (const it of [...items].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))) {
    if (!out.some((o) => o.kind === it.kind && sameName(o.name, it.name))) out.push(it);
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
