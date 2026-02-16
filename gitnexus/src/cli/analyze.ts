/**
 * Analyze Command
 *
 * Indexes a repository and stores the knowledge graph in .gitnexus/
 */

import path from 'path';
import cliProgress from 'cli-progress';
import { runPipelineFromRepo, runIncrementalPipeline } from '../core/ingestion/pipeline.js';
import { initKuzu, loadGraphToKuzu, getKuzuStats, executeQuery, executeWithReusedStatement, closeKuzu, createFTSIndex, loadExistingGraph } from '../core/kuzu/kuzu-adapter.js';
import { runEmbeddingPipeline } from '../core/embeddings/embedding-pipeline.js';
import { disposeEmbedder } from '../core/embeddings/embedder.js';
import { getStoragePaths, saveMeta, loadMeta, addToGitignore, registerRepo, getGlobalRegistryPath, getGlobalDir } from '../storage/repo-manager.js';
import { getCurrentCommit, isGitRepo, getGitRoot, getChangedFiles, getDeletedFiles, getUncommittedChanges } from '../storage/git.js';
import { generateAIContextFiles } from './ai-context.js';
import fs from 'fs/promises';
import { registerClaudeHook } from './claude-hooks.js';

export interface AnalyzeOptions {
  force?: boolean;
  skipEmbeddings?: boolean;
}

/** Threshold: auto-skip embeddings for repos with more nodes than this */
const EMBEDDING_NODE_LIMIT = 50_000;

const PHASE_LABELS: Record<string, string> = {
  extracting: 'Scanning files',
  structure: 'Building structure',
  parsing: 'Parsing code',
  imports: 'Resolving imports',
  calls: 'Tracing calls',
  heritage: 'Extracting inheritance',
  communities: 'Detecting communities',
  processes: 'Detecting processes',
  complete: 'Pipeline complete',
  kuzu: 'Loading into KuzuDB',
  fts: 'Creating search indexes',
  embeddings: 'Generating embeddings',
  done: 'Done',
};

export const analyzeCommand = async (
  inputPath?: string,
  options?: AnalyzeOptions
) => {
  console.log('\n  GitNexus Analyzer\n');

  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot) {
      console.log('  Not inside a git repository\n');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  }

  if (!isGitRepo(repoPath)) {
    console.log('  Not a git repository\n');
    process.exitCode = 1;
    return;
  }

  const { storagePath, kuzuPath } = getStoragePaths(repoPath);
  const currentCommit = getCurrentCommit(repoPath);
  const existingMeta = await loadMeta(storagePath);

  if (existingMeta && !options?.force && existingMeta.lastCommit === currentCommit) {
    console.log('  Already up to date\n');
    return;
  }

  // ── Determine incremental vs full rebuild ──────────────────────────
  const INCREMENTAL_THRESHOLD = 0.6; // Fall back to full if >60% files changed
  let useIncremental = false;
  let changedFileList: string[] = [];
  let deletedFileList: string[] = [];
  let cachedEmbeddingNodeIds = new Set<string>();
  let cachedEmbeddings: Array<{ nodeId: string; embedding: number[] }> = [];

  if (existingMeta?.lastCommit && !options?.force) {
    changedFileList = getChangedFiles(existingMeta.lastCommit, currentCommit, repoPath);
    deletedFileList = getDeletedFiles(existingMeta.lastCommit, currentCommit, repoPath);

    // Also include uncommitted working tree changes — the pipeline reads from disk,
    // so any file modified in the working tree needs re-parsing even if not committed.
    const uncommitted = getUncommittedChanges(repoPath);
    if (uncommitted.length > 0) {
      const changedSet = new Set(changedFileList);
      for (const f of uncommitted) changedSet.add(f);
      changedFileList = Array.from(changedSet);
    }

    // We'll check the ratio after scanning total file count below
    if (changedFileList.length > 0 || deletedFileList.length > 0) {
      useIncremental = true;
    }
  }

  // Single progress bar for entire pipeline
  const bar = new cliProgress.SingleBar({
    format: '  {bar} {percentage}% | {phase}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
    barGlue: '',
    autopadding: true,
    clearOnComplete: false,
    stopOnComplete: false,
  }, cliProgress.Presets.shades_grey);

  bar.start(100, 0, { phase: 'Initializing...' });

  const t0Global = Date.now();
  let pipelineMode: 'full' | 'incremental' = 'full';

  // ── Load existing graph for incremental mode ───────────────────────
  let preloadedData: Awaited<ReturnType<typeof loadExistingGraph>> | null = null;

  if (useIncremental) {
    try {
      bar.update(0, { phase: 'Loading cached graph...' });
      await initKuzu(kuzuPath);
      preloadedData = await loadExistingGraph(
        new Set(changedFileList),
        new Set(deletedFileList),
      );
      await closeKuzu();

      // Check threshold: if too many files changed, fall back to full rebuild
      const totalCachedFiles = preloadedData.nodes.filter(n => n.label === 'File').length;
      const totalFiles = totalCachedFiles + changedFileList.length;
      const changeRatio = totalFiles > 0 ? changedFileList.length / totalFiles : 1;

      if (changeRatio > INCREMENTAL_THRESHOLD) {
        preloadedData = null;
        useIncremental = false;
      } else {
        pipelineMode = 'incremental';
        cachedEmbeddingNodeIds = preloadedData.embeddingNodeIds;
        cachedEmbeddings = preloadedData.cachedEmbeddings;
      }
    } catch {
      // KuzuDB load failed — fall back to full rebuild
      preloadedData = null;
      useIncremental = false;
      try { await closeKuzu(); } catch {}
    }
  }

  // ── Phase 1: Pipeline (0–60%) ──────────────────────────────────────
  let pipelineResult;

  if (pipelineMode === 'incremental' && preloadedData) {
    bar.update(0, { phase: `Incremental: ${changedFileList.length} files changed` });
    pipelineResult = await runIncrementalPipeline(
      repoPath,
      new Set(changedFileList),
      {
        nodes: preloadedData.nodes,
        relationships: preloadedData.relationships,
        symbolEntries: preloadedData.symbolEntries,
      },
      (progress) => {
        const phaseLabel = PHASE_LABELS[progress.phase] || progress.phase;
        const scaled = Math.round(progress.percent * 0.6);
        bar.update(scaled, { phase: phaseLabel });
      }
    );
  } else {
    pipelineResult = await runPipelineFromRepo(repoPath, (progress) => {
      const phaseLabel = PHASE_LABELS[progress.phase] || progress.phase;
      const scaled = Math.round(progress.percent * 0.6);
      bar.update(scaled, { phase: phaseLabel });
    });
  }

  // ── Phase 2: KuzuDB (60–85%) ──────────────────────────────────────
  bar.update(60, { phase: 'Loading into KuzuDB...' });

  await closeKuzu();
  const kuzuFiles = [kuzuPath, `${kuzuPath}.wal`, `${kuzuPath}.lock`];
  for (const f of kuzuFiles) {
    try { await fs.rm(f, { recursive: true, force: true }); } catch {}
  }

  const t0Kuzu = Date.now();
  await initKuzu(kuzuPath);
  let kuzuMsgCount = 0;
  const kuzuResult = await loadGraphToKuzu(pipelineResult.graph, pipelineResult.fileContents, storagePath, (msg) => {
    kuzuMsgCount++;
    const progress = Math.min(84, 60 + Math.round((kuzuMsgCount / (kuzuMsgCount + 10)) * 24));
    bar.update(progress, { phase: msg });
  });
  const kuzuTime = ((Date.now() - t0Kuzu) / 1000).toFixed(1);
  const kuzuWarnings = kuzuResult.warnings;

  // ── Phase 3: FTS (85–90%) ─────────────────────────────────────────
  bar.update(85, { phase: 'Creating search indexes...' });

  const t0Fts = Date.now();
  try {
    await createFTSIndex('File', 'file_fts', ['name', 'content']);
    await createFTSIndex('Function', 'function_fts', ['name', 'content']);
    await createFTSIndex('Class', 'class_fts', ['name', 'content']);
    await createFTSIndex('Method', 'method_fts', ['name', 'content']);
    await createFTSIndex('Interface', 'interface_fts', ['name', 'content']);
  } catch (e: any) {
    // Non-fatal — FTS is best-effort
  }
  const ftsTime = ((Date.now() - t0Fts) / 1000).toFixed(1);

  // ── Phase 3.5: Re-insert cached embeddings (incremental) ───────────
  if (cachedEmbeddings.length > 0) {
    bar.update(88, { phase: `Restoring ${cachedEmbeddings.length} cached embeddings...` });
    const EMBED_BATCH = 200;
    for (let i = 0; i < cachedEmbeddings.length; i += EMBED_BATCH) {
      const batch = cachedEmbeddings.slice(i, i + EMBED_BATCH);
      const paramsList = batch.map(e => ({ nodeId: e.nodeId, embedding: e.embedding }));
      try {
        await executeWithReusedStatement(
          `CREATE (e:CodeEmbedding {nodeId: $nodeId, embedding: $embedding})`,
          paramsList,
        );
      } catch { /* some may fail if node was removed, that's fine */ }
    }
  }

  // ── Phase 4: Embeddings (90–98%) ──────────────────────────────────
  const stats = await getKuzuStats();
  let embeddingTime = '0.0';
  let embeddingSkipped = false;
  let embeddingSkipReason = '';

  if (options?.skipEmbeddings) {
    embeddingSkipped = true;
    embeddingSkipReason = 'skipped (--skip-embeddings)';
  } else if (stats.nodes > EMBEDDING_NODE_LIMIT) {
    embeddingSkipped = true;
    embeddingSkipReason = `skipped (${stats.nodes.toLocaleString()} nodes > ${EMBEDDING_NODE_LIMIT.toLocaleString()} limit)`;
  }

  if (!embeddingSkipped) {
    bar.update(90, { phase: 'Loading embedding model...' });
    const t0Emb = Date.now();
    await runEmbeddingPipeline(
      executeQuery,
      executeWithReusedStatement,
      (progress) => {
        const scaled = 90 + Math.round((progress.percent / 100) * 8);
        const label = progress.phase === 'loading-model' ? 'Loading embedding model...' : `Embedding ${progress.nodesProcessed || 0}/${progress.totalNodes || '?'}`;
        bar.update(scaled, { phase: label });
      },
      {},
      cachedEmbeddingNodeIds.size > 0 ? cachedEmbeddingNodeIds : undefined,
    );
    embeddingTime = ((Date.now() - t0Emb) / 1000).toFixed(1);
  }

  // ── Phase 5: Finalize (98–100%) ───────────────────────────────────
  bar.update(98, { phase: 'Saving metadata...' });

  const meta = {
    repoPath,
    lastCommit: currentCommit,
    indexedAt: new Date().toISOString(),
    stats: {
      files: pipelineResult.fileContents.size,
      nodes: stats.nodes,
      edges: stats.edges,
      communities: pipelineResult.communityResult?.stats.totalCommunities,
      processes: pipelineResult.processResult?.stats.totalProcesses,
    },
  };
  await saveMeta(storagePath, meta);
  await registerRepo(repoPath, meta);
  await addToGitignore(repoPath);

  const hookResult = await registerClaudeHook();

  const projectName = path.basename(repoPath);
  let aggregatedClusterCount = 0;
  if (pipelineResult.communityResult?.communities) {
    const groups = new Map<string, number>();
    for (const c of pipelineResult.communityResult.communities) {
      const label = c.heuristicLabel || c.label || 'Unknown';
      groups.set(label, (groups.get(label) || 0) + c.symbolCount);
    }
    aggregatedClusterCount = Array.from(groups.values()).filter(count => count >= 5).length;
  }

  const aiContext = await generateAIContextFiles(repoPath, storagePath, projectName, {
    files: pipelineResult.fileContents.size,
    nodes: stats.nodes,
    edges: stats.edges,
    communities: pipelineResult.communityResult?.stats.totalCommunities,
    clusters: aggregatedClusterCount,
    processes: pipelineResult.processResult?.stats.totalProcesses,
  });

  await closeKuzu();
  await disposeEmbedder();

  const totalTime = ((Date.now() - t0Global) / 1000).toFixed(1);

  bar.update(100, { phase: 'Done' });
  bar.stop();

  // ── Summary ───────────────────────────────────────────────────────
  const modeLabel = pipelineMode === 'incremental'
    ? `incremental — ${changedFileList.length} files re-parsed`
    : 'full rebuild';
  console.log(`\n  Repository indexed successfully (${totalTime}s) [${modeLabel}]\n`);
  console.log(`  ${stats.nodes.toLocaleString()} nodes | ${stats.edges.toLocaleString()} edges | ${pipelineResult.communityResult?.stats.totalCommunities || 0} clusters | ${pipelineResult.processResult?.stats.totalProcesses || 0} flows`);
  console.log(`  KuzuDB ${kuzuTime}s | FTS ${ftsTime}s | Embeddings ${embeddingSkipped ? embeddingSkipReason : embeddingTime + 's'}`);
  console.log(`  ${repoPath}`);

  if (aiContext.files.length > 0) {
    console.log(`  Context: ${aiContext.files.join(', ')}`);
  }

  if (hookResult.registered) {
    console.log(`  Hooks: ${hookResult.message}`);
  }

  // Show warnings (missing schema pairs, etc.) after the clean output
  if (kuzuWarnings.length > 0) {
    console.log(`\n  Warnings (${kuzuWarnings.length}):`);
    for (const w of kuzuWarnings) {
      console.log(`    ${w}`);
    }
  }

  try {
    await fs.access(getGlobalRegistryPath());
  } catch {
    console.log('\n  Tip: Run `gitnexus setup` to configure MCP for your editor.');
  }

  console.log('');
};
