/**
 * Test helper: In-memory knowledge graph builder
 *
 * Provides a convenient API for constructing test graphs
 * without touching the filesystem or KuzuDB.
 */
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import type { KnowledgeGraph, GraphNode, NodeLabel, RelationshipType } from '../../src/core/graph/types.js';

export interface TestNodeInput {
  id: string;
  label: NodeLabel;
  name: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  isExported?: boolean;
  extra?: Record<string, any>;
}

export interface TestRelInput {
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  confidence?: number;
  reason?: string;
  step?: number;
}

/**
 * Build a test graph from simple input arrays.
 */
export function buildTestGraph(
  nodes: TestNodeInput[],
  relationships: TestRelInput[] = [],
): KnowledgeGraph {
  const graph = createKnowledgeGraph();

  for (const n of nodes) {
    graph.addNode({
      id: n.id,
      label: n.label,
      properties: {
        name: n.name,
        filePath: n.filePath,
        startLine: n.startLine,
        endLine: n.endLine,
        isExported: n.isExported,
        ...n.extra,
      },
    });
  }

  for (const r of relationships) {
    graph.addRelationship({
      id: `${r.sourceId}-${r.type}-${r.targetId}`,
      sourceId: r.sourceId,
      targetId: r.targetId,
      type: r.type,
      confidence: r.confidence ?? 1.0,
      reason: r.reason ?? '',
      step: r.step,
    });
  }

  return graph;
}

/**
 * Create a minimal graph with a few files, functions, and relationships.
 * Useful as a baseline for integration tests.
 */
export function createMinimalTestGraph(): KnowledgeGraph {
  return buildTestGraph(
    [
      { id: 'file:src/index.ts', label: 'File', name: 'index.ts', filePath: 'src/index.ts' },
      { id: 'file:src/utils.ts', label: 'File', name: 'utils.ts', filePath: 'src/utils.ts' },
      { id: 'func:main', label: 'Function', name: 'main', filePath: 'src/index.ts', startLine: 1, endLine: 10, isExported: true },
      { id: 'func:helper', label: 'Function', name: 'helper', filePath: 'src/utils.ts', startLine: 1, endLine: 5, isExported: true },
      { id: 'class:App', label: 'Class', name: 'App', filePath: 'src/index.ts', startLine: 12, endLine: 30, isExported: true },
      { id: 'folder:src', label: 'Folder', name: 'src', filePath: 'src' },
    ],
    [
      { sourceId: 'func:main', targetId: 'func:helper', type: 'CALLS' },
      { sourceId: 'func:main', targetId: 'class:App', type: 'CALLS' },
      { sourceId: 'file:src/index.ts', targetId: 'func:main', type: 'CONTAINS' },
      { sourceId: 'file:src/utils.ts', targetId: 'func:helper', type: 'CONTAINS' },
    ],
  );
}
