/**
 * Analyze Command
 * 
 * Indexes a repository and stores the knowledge graph in .gitnexus/
 */

import path from 'path';
import cliProgress from 'cli-progress';
import { runPipelineFromRepo } from '../core/ingestion/pipeline.js';
import { initKuzu, loadGraphToKuzu, getKuzuStats, executeQuery, executeWithReusedStatement, closeKuzu, createFTSIndex } from '../core/kuzu/kuzu-adapter.js';
import { runEmbeddingPipeline } from '../core/embeddings/embedding-pipeline.js';
import { disposeEmbedder } from '../core/embeddings/embedder.js';
import { getStoragePaths, saveMeta, loadMeta, addToGitignore, registerRepo, getGlobalRegistryPath, getGlobalDir } from '../storage/repo-manager.js';
import { getCurrentCommit, isGitRepo, getGitRoot } from '../storage/git.js';
import { generateAIContextFiles } from './ai-context.js';
import fs from 'fs/promises';

export interface AnalyzeOptions {
  force?: boolean;
  skipEmbeddings?: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  extracting: 'Scanning files',
  structure: 'Building structure',
  parsing: 'Parsing code',
  imports: 'Resolving imports',
  calls: 'Tracing calls',
  heritage: 'Extracting inheritance',
  communities: 'Detecting communities',
  processes: 'Detecting processes',
  complete: 'Complete',
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
      console.log('  ✗ Not inside a git repository\n');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  }

  if (!isGitRepo(repoPath)) {
    console.log('  ✗ Not a git repository\n');
    process.exitCode = 1;
    return;
  }

  const { storagePath, kuzuPath } = getStoragePaths(repoPath);
  const currentCommit = getCurrentCommit(repoPath);
  const existingMeta = await loadMeta(storagePath);

  if (existingMeta && !options?.force && existingMeta.lastCommit === currentCommit) {
    console.log('  ✓ Repository already up to date\n');
    return;
  }

  const multibar = new cliProgress.MultiBar({
    format: '  {bar} {percentage}% | {phase}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true,
    barGlue: '',
    autopadding: true,
  }, cliProgress.Presets.shades_grey);

  const progressBar = multibar.create(100, 0, { phase: 'Initializing...' });

  const pipelineResult = await runPipelineFromRepo(repoPath, (progress) => {
    const phaseLabel = PHASE_LABELS[progress.phase] || progress.phase;
    progressBar.update(progress.percent, { phase: phaseLabel });
  });

  progressBar.update(100, { phase: 'Loading graph into KuzuDB...' });
  
  await closeKuzu();
  
  const fsClean = await import('fs/promises');
  const kuzuFiles = [kuzuPath, `${kuzuPath}.wal`, `${kuzuPath}.lock`];
  for (const f of kuzuFiles) {
    try { await fsClean.rm(f, { recursive: true, force: true }); } catch { /* may not exist */ }
  }
  
  await initKuzu(kuzuPath);
  await loadGraphToKuzu(pipelineResult.graph, pipelineResult.fileContents, storagePath);

  progressBar.update(100, { phase: 'Creating search indexes...' });

  try {
    await createFTSIndex('File', 'file_fts', ['name', 'content']);
    await createFTSIndex('Function', 'function_fts', ['name', 'content']);
    await createFTSIndex('Class', 'class_fts', ['name', 'content']);
    await createFTSIndex('Method', 'method_fts', ['name', 'content']);
    await createFTSIndex('Interface', 'interface_fts', ['name', 'content']);
  } catch (e: any) {
    console.error('  Note: Some FTS indexes may not have been created:', e.message);
  }

  if (!options?.skipEmbeddings) {
    progressBar.update(100, { phase: 'Generating embeddings...' });
    await runEmbeddingPipeline(
      executeQuery,
      executeWithReusedStatement,
      (progress) => {
        progressBar.update(progress.percent, { phase: `Embeddings ${progress.percent}%` });
      }
    );
  }

  const stats = await getKuzuStats();
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

  multibar.stop();

  console.log('\n  ✓ Repository indexed successfully\n');
  console.log(`  Path:     ${repoPath}`);
  console.log(`  Storage:  ${storagePath}`);
  console.log(`  Registry: ${getGlobalDir()}`);
  console.log(`  Stats:    ${stats.nodes} nodes, ${stats.edges} edges, ${pipelineResult.communityResult?.stats.totalCommunities || 0} clusters, ${pipelineResult.processResult?.stats.totalProcesses || 0} processes`);
  
  if (aiContext.files.length > 0) {
    console.log(`  Context:  ${aiContext.files.join(', ')}`);
  }

  try {
    await fs.access(getGlobalRegistryPath());
  } catch {
    console.log('\n  Tip: Run `gitnexus setup` to configure MCP for your editor.');
  }

  console.log('');
};
