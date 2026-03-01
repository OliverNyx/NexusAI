import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processHeritageFromExtracted } from '../../src/core/ingestion/heritage-processor.js';
import { createSymbolTable } from '../../src/core/ingestion/symbol-table.js';
import { createKnowledgeGraph } from '../../src/core/graph/graph.js';
import type { ExtractedHeritage } from '../../src/core/ingestion/workers/parse-worker.js';

describe('processHeritageFromExtracted', () => {
  let graph: ReturnType<typeof createKnowledgeGraph>;
  let symbolTable: ReturnType<typeof createSymbolTable>;

  beforeEach(() => {
    graph = createKnowledgeGraph();
    symbolTable = createSymbolTable();
  });

  describe('extends', () => {
    it('creates EXTENDS relationship between classes', async () => {
      symbolTable.add('src/admin.ts', 'AdminUser', 'Class:src/admin.ts:AdminUser', 'Class');
      symbolTable.add('src/user.ts', 'User', 'Class:src/user.ts:User', 'Class');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/admin.ts',
        className: 'AdminUser',
        parentName: 'User',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable);

      const rels = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toBe('Class:src/admin.ts:AdminUser');
      expect(rels[0].targetId).toBe('Class:src/user.ts:User');
      expect(rels[0].confidence).toBe(1.0);
    });

    it('uses generated ID when class not in symbol table', async () => {
      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/admin.ts',
        className: 'AdminUser',
        parentName: 'BaseUser',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable);

      const rels = graph.relationships.filter(r => r.type === 'EXTENDS');
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toContain('AdminUser');
      expect(rels[0].targetId).toContain('BaseUser');
    });

    it('skips self-inheritance', async () => {
      symbolTable.add('src/a.ts', 'Foo', 'Class:src/a.ts:Foo', 'Class');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/a.ts',
        className: 'Foo',
        parentName: 'Foo',
        kind: 'extends',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable);
      expect(graph.relationshipCount).toBe(0);
    });
  });

  describe('implements', () => {
    it('creates IMPLEMENTS relationship', async () => {
      symbolTable.add('src/service.ts', 'UserService', 'Class:src/service.ts:UserService', 'Class');
      symbolTable.add('src/interfaces.ts', 'IService', 'Interface:src/interfaces.ts:IService', 'Interface');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/service.ts',
        className: 'UserService',
        parentName: 'IService',
        kind: 'implements',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable);

      const rels = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(rels).toHaveLength(1);
      expect(rels[0].sourceId).toBe('Class:src/service.ts:UserService');
    });
  });

  describe('trait-impl (Rust)', () => {
    it('creates IMPLEMENTS relationship for trait impl', async () => {
      symbolTable.add('src/point.rs', 'Point', 'Struct:src/point.rs:Point', 'Struct');
      symbolTable.add('src/display.rs', 'Display', 'Trait:src/display.rs:Display', 'Trait');

      const heritage: ExtractedHeritage[] = [{
        filePath: 'src/point.rs',
        className: 'Point',
        parentName: 'Display',
        kind: 'trait-impl',
      }];

      await processHeritageFromExtracted(graph, heritage, symbolTable);

      const rels = graph.relationships.filter(r => r.type === 'IMPLEMENTS');
      expect(rels).toHaveLength(1);
      expect(rels[0].reason).toBe('trait-impl');
    });
  });

  it('handles multiple heritage entries', async () => {
    const heritage: ExtractedHeritage[] = [
      { filePath: 'src/a.ts', className: 'A', parentName: 'B', kind: 'extends' },
      { filePath: 'src/c.ts', className: 'C', parentName: 'D', kind: 'implements' },
      { filePath: 'src/e.rs', className: 'E', parentName: 'F', kind: 'trait-impl' },
    ];

    await processHeritageFromExtracted(graph, heritage, symbolTable);
    expect(graph.relationships.filter(r => r.type === 'EXTENDS')).toHaveLength(1);
    expect(graph.relationships.filter(r => r.type === 'IMPLEMENTS')).toHaveLength(2);
  });

  it('calls progress callback', async () => {
    const heritage: ExtractedHeritage[] = [
      { filePath: 'src/a.ts', className: 'A', parentName: 'B', kind: 'extends' },
    ];

    const onProgress = vi.fn();
    await processHeritageFromExtracted(graph, heritage, symbolTable, onProgress);
    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });

  it('handles empty heritage array', async () => {
    await processHeritageFromExtracted(graph, [], symbolTable);
    expect(graph.relationshipCount).toBe(0);
  });
});
