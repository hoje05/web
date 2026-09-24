import { describe, expect, it } from 'vitest';
import { parseBoard, serializeBoard, FileFormatError } from '../src/persistence/fileFormat';
import type { Doc } from '../src/model/types';

const doc: Doc = {
  nodes: {
    a: { id: 'a', x: 0, y: 0, width: 180, height: 64, text: '처음 생각\n줄바꿈' },
    b: { id: 'b', x: 400, y: 20, width: 220, height: 85, text: '행동 "따옴표"' },
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
    expect(Object.keys(json.nodes[0])).toEqual(['id', 'x', 'y', 'width', 'height', 'text']);
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

  it('drops routes that point to missing boxes', () => {
    const json = JSON.parse(serializeBoard(doc, { zoom: 1, panX: 0, panY: 0 }));
    json.nodes = json.nodes.filter((n: { id: string }) => n.id !== 'b');
    const { doc: back, warnings } = parseBoard(JSON.stringify(json));
    expect(Object.keys(back.edges)).toHaveLength(0);
    expect(warnings.length).toBe(1);
  });

  it('rejects non-board files', () => {
    expect(() => parseBoard('not json')).toThrow(FileFormatError);
    expect(() => parseBoard('{"hello":1}')).toThrow(FileFormatError);
    expect(() => parseBoard('{"format":"thoughtflow","version":99,"nodes":[],"edges":[]}')).toThrow(/새로운 버전/);
  });
});
