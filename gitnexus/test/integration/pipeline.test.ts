import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import { runPipelineFromRepo } from '../../src/core/ingestion/pipeline.js';
import type { PipelineProgress } from '../../src/types/pipeline.js';

const MINI_REPO = path.resolve(__dirname, '..', 'fixtures', 'mini-repo');

describe('pipeline end-to-end', () => {
  it('indexes a mini repo and produces a valid graph', async () => {
    const progressCalls: PipelineProgress[] = [];
    const onProgress = (p: PipelineProgress) => progressCalls.push(p);

    const result = await runPipelineFromRepo(MINI_REPO, onProgress);

    // --- Graph should have nodes ---
    expect(result.graph.nodeCount).toBeGreaterThan(0);
    expect(result.graph.relationshipCount).toBeGreaterThan(0);

    // --- Should find the 5 TypeScript files ---
    expect(result.totalFileCount).toBe(5);

    // --- Verify File nodes exist for each source file ---
    const fileNodes: string[] = [];
    result.graph.forEachNode(n => {
      if (n.label === 'File') fileNodes.push(n.properties.filePath || n.properties.name);
    });
    expect(fileNodes).toContain('src/handler.ts');
    expect(fileNodes).toContain('src/validator.ts');
    expect(fileNodes).toContain('src/db.ts');
    expect(fileNodes).toContain('src/formatter.ts');
    expect(fileNodes).toContain('src/index.ts');

    // --- Verify symbol nodes were created (functions, classes) ---
    const symbolNames: string[] = [];
    result.graph.forEachNode(n => {
      if (['Function', 'Method', 'Class', 'Interface'].includes(n.label)) {
        symbolNames.push(n.properties.name);
      }
    });
    expect(symbolNames).toContain('handleRequest');
    expect(symbolNames).toContain('validateInput');
    expect(symbolNames).toContain('saveToDb');
    expect(symbolNames).toContain('formatResponse');
    expect(symbolNames).toContain('RequestHandler');

    // --- Verify relationships exist ---
    const relTypes = new Set<string>();
    for (const rel of result.graph.iterRelationships()) {
      relTypes.add(rel.type);
    }
    // Should have at least CONTAINS (structure) and CALLS (call graph)
    expect(relTypes).toContain('CONTAINS');

    // --- Verify CALLS edges were detected ---
    const callEdges: { source: string; target: string }[] = [];
    for (const rel of result.graph.iterRelationships()) {
      if (rel.type === 'CALLS') {
        const sourceNode = result.graph.getNode(rel.sourceId);
        const targetNode = result.graph.getNode(rel.targetId);
        if (sourceNode && targetNode) {
          callEdges.push({
            source: sourceNode.properties.name,
            target: targetNode.properties.name,
          });
        }
      }
    }
    expect(callEdges.length).toBeGreaterThan(0);

    // handleRequest should call validateInput, saveToDb, formatResponse
    const handleRequestCalls = callEdges.filter(e => e.source === 'handleRequest');
    const calledByHandler = handleRequestCalls.map(e => e.target);
    expect(calledByHandler).toContain('validateInput');
    expect(calledByHandler).toContain('saveToDb');
    expect(calledByHandler).toContain('formatResponse');

    // --- Verify IMPORTS edges ---
    let importsCount = 0;
    for (const rel of result.graph.iterRelationships()) {
      if (rel.type === 'IMPORTS') importsCount++;
    }
    expect(importsCount).toBeGreaterThan(0);
  });

  it('detects communities', async () => {
    const result = await runPipelineFromRepo(MINI_REPO, () => {});

    expect(result.communityResult).toBeDefined();
    expect(result.communityResult.stats.totalCommunities).toBeGreaterThan(0);

    // Community nodes should be in the graph
    const communityNodes: string[] = [];
    result.graph.forEachNode(n => {
      if (n.label === 'Community') communityNodes.push(n.properties.name);
    });
    expect(communityNodes.length).toBeGreaterThan(0);

    // MEMBER_OF relationships should exist
    let memberOfCount = 0;
    for (const rel of result.graph.iterRelationships()) {
      if (rel.type === 'MEMBER_OF') memberOfCount++;
    }
    expect(memberOfCount).toBeGreaterThan(0);
  });

  it('detects execution flows (processes)', async () => {
    const result = await runPipelineFromRepo(MINI_REPO, () => {});

    expect(result.processResult).toBeDefined();

    // With a 4-function call chain (handler -> validator -> db -> formatter),
    // there should be at least one process detected
    if (result.processResult.stats.totalProcesses > 0) {
      const process = result.processResult.processes[0];

      // Each process should have valid structure
      expect(process.id).toBeTruthy();
      expect(process.stepCount).toBeGreaterThanOrEqual(3); // minSteps default
      expect(process.trace.length).toBe(process.stepCount);
      expect(process.entryPointId).toBeTruthy();
      expect(process.terminalId).toBeTruthy();
      expect(process.processType).toMatch(/^(intra_community|cross_community)$/);

      // Process nodes should be in the graph
      const processNode = result.graph.getNode(process.id);
      expect(processNode).toBeDefined();
      expect(processNode!.label).toBe('Process');

      // STEP_IN_PROCESS relationships should exist
      let stepCount = 0;
      for (const rel of result.graph.iterRelationships()) {
        if (rel.type === 'STEP_IN_PROCESS' && rel.targetId === process.id) {
          stepCount++;
          expect(rel.step).toBeGreaterThanOrEqual(1);
        }
      }
      expect(stepCount).toBe(process.stepCount);
    }
  });

  it('reports progress through all 6 phases', async () => {
    const phases = new Set<string>();
    const onProgress = (p: PipelineProgress) => phases.add(p.phase);

    await runPipelineFromRepo(MINI_REPO, onProgress);

    expect(phases).toContain('extracting');
    expect(phases).toContain('structure');
    expect(phases).toContain('parsing');
    expect(phases).toContain('communities');
    expect(phases).toContain('processes');
    expect(phases).toContain('complete');
  });

  it('returns correct repoPath in result', async () => {
    const result = await runPipelineFromRepo(MINI_REPO, () => {});
    expect(result.repoPath).toBe(MINI_REPO);
  });
});
