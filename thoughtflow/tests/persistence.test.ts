import { describe, expect, it } from 'vitest';
import { parseBoard, serializeBoard, FileFormatError } from '../src/persistence/fileFormat';
import type { Doc } from '../src/model/types';

const doc: Doc = {
  tags: {},
  nodes: {
    a: { id: 'a', x: 0, y: 0, width: 180, height: 64, text: '처음 생각\n줄바꿈', note: '긴 메모\n두 번째 줄' },
    b: { id: 'b', x: 400, y: 20, width: 220, height: 85, text: '행동 "따옴표"', note: '' },
  },
  edges: {
    e: {
      id: 'e',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      sourceAnchor: { side: 'right' },
      targetAnchor: { side: 'left' },
      pathPoints: [
        [0.25, -0.1],
        [0.75, 0.12345678],
      ],
      pathMode: 'smoothed',
    },
  },
};

describe('file format', () => {
  it('round-trips a board', () => {
    const text = serializeBoard(doc, { zoom: 1.5, panX: 10, panY: -20 });
    const { doc: back, viewport, warnings } = parseBoard(text);
    expect(warnings).toEqual([]);
    expect(viewport).toEqual({ zoom: 1.5, panX: 10, panY: -20 });
    expect(back.nodes).toEqual(doc.nodes);
    expect(back.edges.e.pathPoints[1][1]).toBeCloseTo(0.12346, 5);
    expect({ ...back.edges.e, pathPoints: [] }).toEqual({ ...doc.edges.e, pathPoints: [] });
  });

  it('contains the required fields', () => {
    const json = JSON.parse(serializeBoard(doc, { zoom: 1, panX: 0, panY: 0 }));
    expect(Object.keys(json.nodes[0])).toEqual(['id', 'x', 'y', 'width', 'height', 'text', 'note', 'tagIds', 'attachments']);
    expect(json.version).toBe(3);
    expect(json.tags).toEqual([]);
    expect(Object.keys(json.edges[0])).toEqual([
      'id',
      'sourceNodeId',
      'targetNodeId',
      'sourceAnchor',
      'targetAnchor',
      'pathPoints',
      'pathMode',
    ]);
    expect(json.board).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('reads v1 files (no note field)', () => {
    const v1 = JSON.stringify({
      format: 'thoughtflow',
      version: 1,
      board: { zoom: 1, panX: 0, panY: 0 },
      nodes: [{ id: 'a', x: 0, y: 0, width: 180, height: 64, text: 'A' }],
      edges: [],
    });
    expect(parseBoard(v1).doc.nodes.a.note).toBe('');
  });

  it('remembers the right panel tabs per project (ui)', () => {
    const text = serializeBoard(doc, { zoom: 1, panX: 0, panY: 0 }, { tabs: ['b', 'gone', 'a'], activeTab: 'a', panelOpen: true });
    const { ui } = parseBoard(text);
    expect(ui).toEqual({ tabs: ['b', 'a'], activeTab: 'a', panelOpen: true });
    expect(parseBoard(serializeBoard(doc, { zoom: 1, panX: 0, panY: 0 })).ui).toBeNull();
  });

  it('drops routes that point to missing boxes', () => {
    const json = JSON.parse(serializeBoard(doc, { zoom: 1, panX: 0, panY: 0 }));
    json.nodes = json.nodes.filter((n: { id: string }) => n.id !== 'b');
    const { doc: back, warnings } = parseBoard(JSON.stringify(json));
    expect(Object.keys(back.edges)).toHaveLength(0);
    expect(warnings.length).toBe(1);
  });

  it('saves tags, tagIds and attachments (v3)', () => {
    const rich: Doc = {
      ...doc,
      tags: {
        t1: { id: 't1', name: 'AI', normalizedName: 'ai', active: true },
        t2: { id: 't2', name: 'Project', normalizedName: 'project', active: false },
      },
      nodes: {
        ...doc.nodes,
        a: {
          ...doc.nodes.a,
          tagIds: ['t1', 't2'],
          attachments: [
            { id: 'x1', type: 'image', name: '그래프.png', relativePath: 'assets/a1b2-그래프.png', mimeType: 'image/png', size: 1234, width: 640, height: 480 },
            { id: 'x2', type: 'file', name: 'results.csv', relativePath: 'assets/c3d4-results.csv', mimeType: 'text/csv', size: 99 },
          ],
        },
      },
    };
    const text = serializeBoard(rich, { zoom: 1, panX: 0, panY: 0 });
    expect(text).not.toMatch(/base64/);
    const { doc: back, warnings } = parseBoard(text);
    expect(warnings).toEqual([]);
    expect(back.tags).toEqual(rich.tags);
    expect(back.nodes).toEqual(rich.nodes);
  });

  it('opens older projects without tags/attachments (legacy v2)', () => {
    const v2 = JSON.stringify({
      format: 'thoughtflow',
      version: 2,
      board: { zoom: 1, panX: 0, panY: 0 },
      nodes: [{ id: 'a', x: 0, y: 0, width: 180, height: 64, text: 'A', note: 'n' }],
      edges: [],
    });
    const { doc: back, warnings } = parseBoard(v2);
    expect(warnings).toEqual([]);
    expect(back.tags).toEqual({});
    expect(back.nodes.a.tagIds ?? []).toEqual([]);
    expect(back.nodes.a.attachments ?? []).toEqual([]);
    // 다시 저장하면 v3
    expect(JSON.parse(serializeBoard(back, { zoom: 1, panX: 0, panY: 0 })).version).toBe(3);
  });

  it('merges duplicate tag names and drops unknown tag ids', () => {
    const file = JSON.stringify({
      format: 'thoughtflow',
      version: 3,
      tags: [
        { id: 't1', name: 'AI', normalizedName: 'ai', active: false },
        { id: 't2', name: ' ai ', active: true },
        { id: 't3', name: '   ' },
      ],
      nodes: [{ id: 'a', x: 0, y: 0, width: 180, height: 64, text: 'A', note: '', tagIds: ['t2', 't1', 'nope', 3] }],
      edges: [],
    });
    const { doc: back } = parseBoard(file);
    expect(Object.keys(back.tags)).toEqual(['t1']);
    expect(back.tags.t1).toEqual({ id: 't1', name: 'AI', normalizedName: 'ai', active: true });
    expect(back.nodes.a.tagIds).toEqual(['t1']);
  });

  it('never lets an attachment point outside the project asset folder', () => {
    const bad = ['../secret.txt', 'assets/../../x', 'C:\\Windows\\x', 'assets/a/b.png', 'assets/..', '/etc/passwd', 'assets\\x.png'];
    const file = JSON.stringify({
      format: 'thoughtflow',
      version: 3,
      nodes: [
        {
          id: 'a', x: 0, y: 0, width: 180, height: 64, text: 'A', note: '',
          attachments: [...bad.map((p, i) => ({ id: `b${i}`, type: 'file', name: 'x', relativePath: p, mimeType: 'text/plain', size: 1 })),
            { id: 'ok', type: 'image', name: 'ok.png', relativePath: 'assets/ok.png', mimeType: 'image/png', size: 1 }],
        },
      ],
      edges: [],
    });
    const { doc: back, warnings } = parseBoard(file);
    expect(back.nodes.a.attachments?.map((a) => a.id)).toEqual(['ok']);
    expect(warnings.length).toBe(1);
  });

  it('rejects non-board files', () => {
    expect(() => parseBoard('not json')).toThrow(FileFormatError);
    expect(() => parseBoard('{"hello":1}')).toThrow(FileFormatError);
    expect(() => parseBoard('{"format":"thoughtflow","version":99,"nodes":[],"edges":[]}')).toThrow(/새로운 버전/);
  });
});
