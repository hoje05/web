import { describe, expect, it } from 'vitest';
import { addNode, makeNode, removeNode } from '../src/model/docOps';
import { addTagByName, applyTag, normalizeTagName, removeTagFromNode, setTagActive, suggestTags, tagUsage } from '../src/model/tags';
import { EMPTY_DOC, type Doc } from '../src/model/types';

const base = (): Doc => addNode(addNode(addNode(EMPTY_DOC, makeNode('a', { x: 0, y: 0 })), makeNode('b', { x: 300, y: 0 })), makeNode('c', { x: 600, y: 0 }));
const must = <T,>(v: T | null): T => {
  if (!v) throw new Error('null');
  return v;
};

describe('tags', () => {
  it('normalizes names (trim, spaces, case)', () => {
    expect(normalizeTagName('  AI  ')).toBe('ai');
    expect(normalizeTagName('Deep   Learning')).toBe('deep learning');
    expect(normalizeTagName('   ')).toBe('');
  });

  it('creates a tag, applies it and saves it in the registry', () => {
    const r = must(addTagByName(base(), 'a', ' AI '));
    expect(r.tag).toMatchObject({ name: 'AI', normalizedName: 'ai', active: true });
    expect(r.doc.nodes.a.tagIds).toEqual([r.tag.id]);
    expect(Object.keys(r.doc.tags)).toEqual([r.tag.id]);
  });

  it('reuses the same tag for ai / AI / Ai (no duplicates)', () => {
    let doc = must(addTagByName(base(), 'a', 'AI')).doc;
    const id = Object.keys(doc.tags)[0];
    doc = must(addTagByName(doc, 'b', 'ai')).doc;
    doc = must(addTagByName(doc, 'c', 'Ai ')).doc;
    expect(Object.keys(doc.tags)).toEqual([id]);
    expect(doc.tags[id].name).toBe('AI');
    expect([doc.nodes.a.tagIds, doc.nodes.b.tagIds, doc.nodes.c.tagIds]).toEqual([[id], [id], [id]]);
    // 같은 Box에 두 번 붙이면 그대로
    expect(applyTag(doc, 'a', id)).toBe(doc);
  });

  it('removing from a box keeps the saved tag', () => {
    let doc = must(addTagByName(base(), 'a', 'AI')).doc;
    const id = Object.keys(doc.tags)[0];
    doc = must(addTagByName(doc, 'b', 'AI')).doc;
    doc = removeTagFromNode(doc, 'b', id);
    expect(doc.nodes.b.tagIds).toBeUndefined();
    expect(doc.nodes.a.tagIds).toEqual([id]);
    expect(doc.tags[id].active).toBe(true);
    expect(suggestTags(doc.tags, 'a', doc.nodes.c.tagIds).map((t) => t.name)).toEqual(['AI']);
  });

  it('archiving a saved tag keeps it on boxes but hides it from suggestions; re-creating revives the same id', () => {
    let doc = must(addTagByName(base(), 'a', 'AI')).doc;
    const id = Object.keys(doc.tags)[0];
    doc = setTagActive(doc, id, false);
    expect(doc.nodes.a.tagIds).toEqual([id]);
    expect(suggestTags(doc.tags, 'a')).toEqual([]);
    expect(suggestTags(doc.tags, '')).toEqual([]);
    const r = must(addTagByName(doc, 'b', 'ai'));
    expect(r.tag.id).toBe(id);
    expect(Object.keys(r.doc.tags)).toEqual([id]);
    expect(r.doc.tags[id].active).toBe(true);
    expect(r.doc.nodes.b.tagIds).toEqual([id]);
  });

  it('suggests prefix matches first, then includes, case-insensitive', () => {
    let doc = base();
    for (const n of ['Project', 'Programming', 'Prototype', 'Improve', 'Game', 'AI']) doc = must(addTagByName(doc, 'a', n)).doc;
    expect(suggestTags(doc.tags, 'pro').map((t) => t.name)).toEqual(['Programming', 'Project', 'Prototype', 'Improve']);
    expect(suggestTags(doc.tags, 'PRO').length).toBe(4);
    // 이미 붙은 태그는 빼고
    const project = Object.values(doc.tags).find((t) => t.name === 'Project')!;
    expect(suggestTags(doc.tags, 'pro', [project.id]).map((t) => t.name)).not.toContain('Project');
    // 빈 입력: 저장된 태그 전부 (최근 것부터)
    expect(suggestTags(doc.tags, '', [], 3).map((t) => t.name)).toEqual(['AI', 'Game', 'Improve']);
  });

  it('counts usage and survives box deletion', () => {
    let doc = must(addTagByName(base(), 'a', 'AI')).doc;
    const id = Object.keys(doc.tags)[0];
    doc = must(addTagByName(doc, 'b', 'AI')).doc;
    expect(tagUsage(doc).get(id)).toBe(2);
    doc = removeNode(doc, 'a');
    expect(doc.tags[id]).toBeDefined();
    expect(tagUsage(doc).get(id)).toBe(1);
  });

  it('ignores empty names', () => {
    expect(addTagByName(base(), 'a', '   ')).toBeNull();
    expect(addTagByName(base(), 'missing', 'AI')).toBeNull();
  });
});
