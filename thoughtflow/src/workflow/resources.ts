/**
 * 단계의 도구(스킬·명령어·커넥터·서브 에이전트) 이름 다루기:
 * 정리(공백·중복·명령어 앞 "/"), 보드 기본값과 합치기, 지정한 것과 실제로 쓴 것 비교.
 */
import type { StepResources } from '../model/types';

export type ResourceKind = 'skill' | 'command' | 'connector' | 'subagent';

const LIST_KEYS = { skill: 'skills', command: 'commands', connector: 'connectors' } as const;

/** 이름 하나 정리: 앞뒤 공백 제거, 가운데 공백은 하나로, 명령어는 "/"로 시작. 빈 이름이면 '' */
export function cleanName(kind: ResourceKind, raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!name) return '';
  if (kind === 'command') return name.startsWith('/') ? name : `/${name}`;
  return name;
}

/** 같은 이름인지 (대소문자 무시, 명령어의 "/" 무시) */
export const sameName = (a: string, b: string) => a.replace(/^\//, '').toLowerCase() === b.replace(/^\//, '').toLowerCase();

function cleanList(kind: ResourceKind, list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const n = cleanName(kind, raw);
    if (n && !out.some((o) => sameName(o, n))) out.push(n);
  }
  return out.slice(0, 50);
}

/** 어떤 값이 와도 올바른 StepResources로 (파일·AI가 준 값 검사용) */
export function normalizeResources(raw: unknown): StepResources {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: StepResources = {
    skills: cleanList('skill', r.skills),
    commands: cleanList('command', r.commands),
    connectors: cleanList('connector', r.connectors),
  };
  const sub = r.subagent as Record<string, unknown> | undefined;
  if (sub && typeof sub === 'object' && typeof sub.type === 'string' && cleanName('subagent', sub.type)) {
    out.subagent = { type: cleanName('subagent', sub.type) };
    if (typeof sub.model === 'string' && sub.model.trim()) out.subagent.model = sub.model.trim().slice(0, 80);
    if (typeof sub.instructions === 'string' && sub.instructions.trim()) out.subagent.instructions = sub.instructions.trim().slice(0, 4000);
  }
  const avoid = Array.isArray(r.avoid) ? r.avoid.filter((a): a is string => typeof a === 'string' && !!a.trim()).map((a) => a.trim().slice(0, 300)) : [];
  if (avoid.length) out.avoid = [...new Set(avoid)].slice(0, 30);
  return out;
}

/** 보드 기본 도구 + 단계 도구 (단계에 서브 에이전트가 있으면 그것이 우선) */
export function mergeResources(defaults: StepResources, step: StepResources): StepResources {
  const merged: StepResources = {
    skills: cleanList('skill', [...defaults.skills, ...step.skills]),
    commands: cleanList('command', [...defaults.commands, ...step.commands]),
    connectors: cleanList('connector', [...defaults.connectors, ...step.connectors]),
  };
  const subagent = step.subagent ?? defaults.subagent;
  if (subagent) merged.subagent = subagent;
  const avoid = [...(defaults.avoid ?? []), ...(step.avoid ?? [])];
  if (avoid.length) merged.avoid = [...new Set(avoid)];
  return merged;
}

export interface ResourceDiff {
  /** 지정했는데 쓰지 않은 것 */
  missing: { kind: ResourceKind; name: string }[];
  /** 지정하지 않았는데 쓴 것 */
  extra: { kind: ResourceKind; name: string }[];
}

/** 지정한 도구와 실제로 쓴 도구 비교 (계획 대비 결과의 ⚠ 표시) */
export function resourceDiff(specified: StepResources, used: StepResources): ResourceDiff {
  const diff: ResourceDiff = { missing: [], extra: [] };
  for (const kind of ['skill', 'command', 'connector'] as const) {
    const key = LIST_KEYS[kind];
    for (const name of specified[key]) if (!used[key].some((u) => sameName(u, name))) diff.missing.push({ kind, name });
    for (const name of used[key]) if (!specified[key].some((s) => sameName(s, name))) diff.extra.push({ kind, name });
  }
  const want = specified.subagent?.type;
  const got = used.subagent?.type;
  if (want && (!got || !sameName(want, got))) diff.missing.push({ kind: 'subagent', name: want });
  if (got && (!want || !sameName(want, got))) diff.extra.push({ kind: 'subagent', name: got });
  return diff;
}

export const isEmptyResources = (r: StepResources) =>
  !r.skills.length && !r.commands.length && !r.connectors.length && !r.subagent && !(r.avoid?.length);
