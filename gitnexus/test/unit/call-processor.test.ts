import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processCallsFromExtracted } from '../../src/core/ingestion/call-processor.js';
import { createSymbolTable } from '../../src/core/ingestion/symbol-table.js';
import { createImportMap, type ImportMap } from '../../src/core/ingestion/import-processor.js';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import type { ExtractedCall } from '../../src/core/ingestion/workers/parse-worker.js';

describe('processCallsFromExtracted', () => {
  let graph: ReturnType<typeof createKnowledgeGraph>;
  let symbolTable: ReturnType<typeof createSymbolTable>;
  let importMap: ImportMap;

  beforeEach(() => {
    graph = createKnowledgeGraph();
    symbolTable = createSymbolTable();
    importMap = createImportMap();
  });

  it('creates CALLS relationship for same-file resolution', async () => {
    symbolTable.add('src/index.ts', 'helper', 'Function:src/index.ts:helper', 'Function');

    const calls: ExtractedCall[] = [{
      filePath: 'src/index.ts',
      calledName: 'helper',
      sourceId: 'Function:src/index.ts:main',
    }];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);

    const rels = graph.relationships.filter(r => r.type === 'CALLS');
    expect(rels).toHaveLength(1);
    expect(rels[0].sourceId).toBe('Function:src/index.ts:main');
    expect(rels[0].targetId).toBe('Function:src/index.ts:helper');
    expect(rels[0].confidence).toBe(0.85);
    expect(rels[0].reason).toBe('same-file');
  });

  it('creates CALLS relationship for import-resolved resolution', async () => {
    symbolTable.add('src/utils.ts', 'format', 'Function:src/utils.ts:format', 'Function');
    importMap.set('src/index.ts', new Set(['src/utils.ts']));

    const calls: ExtractedCall[] = [{
      filePath: 'src/index.ts',
      calledName: 'format',
      sourceId: 'Function:src/index.ts:main',
    }];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);

    const rels = graph.relationships.filter(r => r.type === 'CALLS');
    expect(rels).toHaveLength(1);
    expect(rels[0].confidence).toBe(0.9);
    expect(rels[0].reason).toBe('import-resolved');
  });

  it('uses fuzzy-global with higher confidence for unique symbols', async () => {
    symbolTable.add('src/other.ts', 'uniqueFunc', 'Function:src/other.ts:uniqueFunc', 'Function');

    const calls: ExtractedCall[] = [{
      filePath: 'src/index.ts',
      calledName: 'uniqueFunc',
      sourceId: 'Function:src/index.ts:main',
    }];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);

    const rels = graph.relationships.filter(r => r.type === 'CALLS');
    expect(rels).toHaveLength(1);
    expect(rels[0].confidence).toBe(0.5);
    expect(rels[0].reason).toBe('fuzzy-global');
  });

  it('uses lower confidence for ambiguous fuzzy-global symbols', async () => {
    symbolTable.add('src/a.ts', 'render', 'Function:src/a.ts:render', 'Function');
    symbolTable.add('src/b.ts', 'render', 'Function:src/b.ts:render', 'Function');

    const calls: ExtractedCall[] = [{
      filePath: 'src/index.ts',
      calledName: 'render',
      sourceId: 'Function:src/index.ts:main',
    }];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);

    const rels = graph.relationships.filter(r => r.type === 'CALLS');
    expect(rels).toHaveLength(1);
    expect(rels[0].confidence).toBe(0.3);
  });

  it('skips unresolvable calls', async () => {
    const calls: ExtractedCall[] = [{
      filePath: 'src/index.ts',
      calledName: 'nonExistent',
      sourceId: 'Function:src/index.ts:main',
    }];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);
    expect(graph.relationshipCount).toBe(0);
  });

  it('prefers same-file over import-resolved', async () => {
    // Symbol exists both locally and in imported file
    symbolTable.add('src/index.ts', 'render', 'Function:src/index.ts:render', 'Function');
    symbolTable.add('src/utils.ts', 'render', 'Function:src/utils.ts:render', 'Function');
    importMap.set('src/index.ts', new Set(['src/utils.ts']));

    const calls: ExtractedCall[] = [{
      filePath: 'src/index.ts',
      calledName: 'render',
      sourceId: 'Function:src/index.ts:main',
    }];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);

    const rels = graph.relationships.filter(r => r.type === 'CALLS');
    expect(rels).toHaveLength(1);
    // Same-file resolution takes priority
    expect(rels[0].targetId).toBe('Function:src/index.ts:render');
    expect(rels[0].reason).toBe('same-file');
  });

  it('handles multiple calls from the same file', async () => {
    symbolTable.add('src/index.ts', 'foo', 'Function:src/index.ts:foo', 'Function');
    symbolTable.add('src/index.ts', 'bar', 'Function:src/index.ts:bar', 'Function');

    const calls: ExtractedCall[] = [
      { filePath: 'src/index.ts', calledName: 'foo', sourceId: 'Function:src/index.ts:main' },
      { filePath: 'src/index.ts', calledName: 'bar', sourceId: 'Function:src/index.ts:main' },
    ];

    await processCallsFromExtracted(graph, calls, symbolTable, importMap);
    expect(graph.relationships.filter(r => r.type === 'CALLS')).toHaveLength(2);
  });

  it('calls progress callback', async () => {
    symbolTable.add('src/index.ts', 'foo', 'Function:src/index.ts:foo', 'Function');

    const calls: ExtractedCall[] = [
      { filePath: 'src/index.ts', calledName: 'foo', sourceId: 'Function:src/index.ts:main' },
    ];

    const onProgress = vi.fn();
    await processCallsFromExtracted(graph, calls, symbolTable, importMap, onProgress);

    // Final progress call
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it('handles empty calls array', async () => {
    await processCallsFromExtracted(graph, [], symbolTable, importMap);
    expect(graph.relationshipCount).toBe(0);
  });
});
