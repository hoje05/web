import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../src/store/store';
import { EMPTY_DOC } from '../src/model/types';

const s = () => useStore.getState();

describe('undo / redo', () => {
  beforeEach(() => {
    useStore.setState({ doc: EMPTY_DOC, savedDoc: EMPTY_DOC, past: [], future: [], selection: null, editingNodeId: null });
  });

  it('undoes and redoes box creation, text change and route reverse', () => {
    const a = s().addBoxAt({ x: 0, y: 0 });
    s().setText(a, 'A');
    s().finishRoute({ sourceNodeId: a, points: [{ x: 90, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 0 }] }, null);
    const edge = Object.values(s().doc.edges)[0];
    s().reverseEdge(edge.id);
    expect(s().doc.edges[edge.id].targetNodeId).toBe(a);

    s().undo(); // reverse
    expect(s().doc.edges[edge.id].sourceNodeId).toBe(a);
    s().undo(); // route + new box
    expect(Object.keys(s().doc.edges)).toHaveLength(0);
    expect(Object.keys(s().doc.nodes)).toHaveLength(1);
    s().undo(); // text
    expect(s().doc.nodes[a].text).toBe('');
    s().undo(); // box
    expect(Object.keys(s().doc.nodes)).toHaveLength(0);
    expect(s().selection).toBeNull();

    s().redo();
    s().redo();
    s().redo();
    s().redo();
    expect(s().doc.edges[edge.id].targetNodeId).toBe(a);
    expect(s().doc.nodes[a].text).toBe('A');
  });

  it('a new change clears the redo stack', () => {
    s().addBoxAt({ x: 0, y: 0 });
    s().undo();
    expect(s().future).toHaveLength(1);
    s().addBoxAt({ x: 50, y: 50 });
    expect(s().future).toHaveLength(0);
  });

  it('size measurement does not create history or dirty state', () => {
    const a = s().addBoxAt({ x: 0, y: 0 });
    useStore.setState({ savedDoc: s().doc });
    const past = s().past.length;
    s().setNodeSize(a, 240, 90);
    expect(s().past.length).toBe(past);
    expect(s().doc).toBe(s().savedDoc);
  });
});
