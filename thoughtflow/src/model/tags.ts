/**
 * 태그: Box를 분류하는 이름표. 프로젝트에 저장해 두고 여러 Box에서 다시 쓴다.
 * 모두 순수 함수 (새 Doc을 돌려준다) → 하나하나가 Undo 한 번.
 *
 *  - 같은 태그인지는 normalizedName으로 가린다 ("AI", "ai ", "Ai"는 같은 태그). 보여 주는 이름은 처음 쓴 모양.
 *  - 저장된 태그를 지우면 active=false (보관). 이미 붙어 있는 Box에서는 그대로 보이고, 추천 목록에서만 빠진다.
 *  - 보관된 태그와 같은 이름을 다시 쓰면 새로 만들지 않고 그 태그를 다시 살린다 (id 그대로).
 */
import { newId } from './ids';
import type { Doc, Tag } from './types';

/** 비교용 이름: 앞뒤 공백 제거, 여러 칸 공백은 한 칸, 소문자 */
export const normalizeTagName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** 보여 주는 이름: 앞뒤 공백 제거, 여러 칸 공백은 한 칸 */
export const cleanTagName = (name: string) => name.normalize('NFC').trim().replace(/\s+/g, ' ').slice(0, 60);

const tagsOf = (doc: Doc) => doc.tags ?? {};

export function findTag(doc: Doc, name: string): Tag | undefined {
  const key = normalizeTagName(name);
  if (!key) return undefined;
  return Object.values(tagsOf(doc)).find((t) => t.normalizedName === key);
}

/**
 * 이름으로 태그를 준비한다: 있으면 그 태그(보관 중이면 다시 살림), 없으면 새로 만든다.
 * 이름이 비었으면 null.
 */
export function ensureTag(doc: Doc, name: string, id = newId('t')): { doc: Doc; tag: Tag } | null {
  const display = cleanTagName(name);
  const key = normalizeTagName(display);
  if (!key) return null;
  const existing = findTag(doc, display);
  if (existing) {
    if (existing.active) return { doc, tag: existing };
    const tag = { ...existing, active: true };
    return { doc: { ...doc, tags: { ...tagsOf(doc), [tag.id]: tag } }, tag };
  }
  const tag: Tag = { id, name: display, normalizedName: key, active: true };
  return { doc: { ...doc, tags: { ...tagsOf(doc), [id]: tag } }, tag };
}

/** Box에 태그를 붙인다 (이미 있으면 그대로) */
export function applyTag(doc: Doc, nodeId: string, tagId: string): Doc {
  const node = doc.nodes[nodeId];
  if (!node || !tagsOf(doc)[tagId] || node.tagIds?.includes(tagId)) return doc;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...node, tagIds: [...(node.tagIds ?? []), tagId] } } };
}

/** 이름으로 Box에 태그 붙이기: 없으면 만들어 저장하고, 보관된 태그면 다시 살려서 붙인다 */
export function addTagByName(doc: Doc, nodeId: string, name: string): { doc: Doc; tag: Tag } | null {
  if (!doc.nodes[nodeId]) return null;
  const r = ensureTag(doc, name);
  if (!r) return null;
  return { doc: applyTag(r.doc, nodeId, r.tag.id), tag: r.tag };
}

/** Box에서만 태그를 뗀다 (저장된 태그는 그대로) */
export function removeTagFromNode(doc: Doc, nodeId: string, tagId: string): Doc {
  const node = doc.nodes[nodeId];
  if (!node?.tagIds?.includes(tagId)) return doc;
  const { tagIds: _, ...rest } = node;
  const tagIds = node.tagIds.filter((id) => id !== tagId);
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: tagIds.length ? { ...rest, tagIds } : rest } };
}

/** 저장된 태그 지우기(보관, active=false) / 되살리기. Box에 붙은 태그는 건드리지 않는다. */
export function setTagActive(doc: Doc, tagId: string, active: boolean): Doc {
  const tag = tagsOf(doc)[tagId];
  if (!tag || tag.active === active) return doc;
  return { ...doc, tags: { ...tagsOf(doc), [tagId]: { ...tag, active } } };
}

/**
 * 자동 완성: 쓰고 있는 글자로 시작하는 태그 먼저, 그다음 글자가 들어 있는 태그 (대소문자 무시).
 * 보관된 태그와 이미 붙은 태그는 빼고, 빈 입력이면 저장된 태그 전부 (최근에 만든 것부터).
 * 저장된 태그 목록만 훑는다 (Box 전체를 훑지 않는다).
 */
export function suggestTags(doc: Doc, query: string, exclude: readonly string[] = [], limit = 8): Tag[] {
  const q = normalizeTagName(query);
  const skip = new Set(exclude);
  const active = Object.values(tagsOf(doc)).filter((t) => t.active && !skip.has(t.id));
  if (!q) return active.reverse().slice(0, limit);
  const prefix: Tag[] = [];
  const includes: Tag[] = [];
  for (const t of active) {
    if (t.normalizedName.startsWith(q)) prefix.push(t);
    else if (t.normalizedName.includes(q)) includes.push(t);
  }
  const byName = (a: Tag, b: Tag) => a.normalizedName.localeCompare(b.normalizedName);
  return [...prefix.sort(byName), ...includes.sort(byName)].slice(0, limit);
}

/** 태그별로 붙어 있는 Box 수 (태그 관리 창에서 한 번 계산) */
export function tagUsage(doc: Doc): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of Object.values(doc.nodes)) for (const id of n.tagIds ?? []) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}
