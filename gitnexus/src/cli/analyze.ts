/**
 * Analyze Command
 * 
 * Indexes a repository and stores the knowledge graph in .gitnexus/
 */

import path from 'path';
import ora from 'ora';
import { runPipelineFromRepo } from '../core/ingestion/pipeline.js';
import { initKuzu, loadGraphToKuzu, getKuzuStats, executeQuery, executeWithReusedStatement, closeKuzu, createFTSIndex } from '../core/kuzu/kuzu-adapter.js';
import { runEmbeddingPipeline } from '../core/embeddings/embedding-pipeline.js';
import { getStoragePaths, saveMeta, loadMeta, addToGitignore } from '../storage/repo-manager.js';
import { getCurrentCommit, isGitRepo, getGitRoot } from '../storage/git.js';
import { generateAIContextFiles } from './ai-context.js';

export interface AnalyzeOptions {
  force?: boolean;
  skipEmbeddings?: boolean;
}

export const analyzeCommand = async (
  inputPath?: string,
  options?: AnalyzeOptions
) => {
  const spinner = ora('Checking repository...').start();

  // If path provided, use it directly. Otherwise, find git root from cwd.
  let repoPath: string;
  if (inputPath) {
    repoPath = path.resolve(inputPath);
  } else {
    const gitRoot = getGitRoot(process.cwd());
    if (!gitRoot) {
      spinner.fail('Not inside a git repository');
      process.exitCode = 1;
      return;
    }
    repoPath = gitRoot;
  }

  if (!isGitRepo(repoPath)) {
    spinner.fail('Not a git repository');
    process.exitCode = 1;
    return;
  }

  const { storagePath, kuzuPath } = getStoragePaths(repoPath);
  const currentCommit = getCurrentCommit(repoPath);
  const existingMeta = await loadMeta(storagePath);

  // Skip if already indexed at same commit
  if (existingMeta && !options?.force && existingMeta.lastCommit === currentCommit) {
    spinner.succeed('Repository already up to date');
    return;
  }

  // Run ingestion pipeline
  spinner.text = 'Running ingestion pipeline...';
  const pipelineResult = await runPipelineFromRepo(repoPath, (progress) => {
    spinner.text = `${progress.phase}: ${progress.percent}%`;
  });

  // Load graph into KuzuDB
  // Always start fresh - remove existing kuzu DB to avoid stale/corrupt data
  spinner.text = 'Loading graph into KuzuDB...';
  await closeKuzu();
  
  // Kuzu 0.11 stores databases as: <name> (main file) + <name>.wal (WAL file)
  // BOTH must be deleted or kuzu will find the orphaned WAL and corrupt the database
  const fsClean = await import('fs/promises');
  const kuzuFiles = [kuzuPath, `${kuzuPath}.wal`, `${kuzuPath}.lock`];
  for (const f of kuzuFiles) {
    try { await fsClean.rm(f, { recursive: true, force: true }); } catch { /* may not exist */ }
  }
  
  await initKuzu(kuzuPath);
  await loadGraphToKuzu(pipelineResult.graph, pipelineResult.fileContents, storagePath);

  // Create FTS indexes for keyword search
  // Indexes searchable content on: File, Function, Class, Method
  spinner.text = 'Creating FTS indexes...';
  try {
    await createFTSIndex('File', 'file_fts', ['name', 'content']);
    await createFTSIndex('Function', 'function_fts', ['name', 'content']);
    await createFTSIndex('Class', 'class_fts', ['name', 'content']);
    await createFTSIndex('Method', 'method_fts', ['name', 'content']);
  } catch (e: any) {
    // FTS index creation may fail if tables are empty (no data for that type)
    console.error('Note: Some FTS indexes may not have been created:', e.message);
  }

  // Generate embeddings
  if (!options?.skipEmbeddings) {
    spinner.text = 'Generating embeddings...';
    await runEmbeddingPipeline(
      executeQuery,
      executeWithReusedStatement,
      (progress) => {
        spinner.text = `Embeddings: ${progress.percent}%`;
      }
    );
  }

  // Save metadata
  const stats = await getKuzuStats();
  await saveMeta(storagePath, {
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
  });

  // Add .gitnexus to .gitignore
  await addToGitignore(repoPath);
  
  // Generate AI context files
  const projectName = path.basename(repoPath);
  const aiContext = await generateAIContextFiles(repoPath, storagePath, projectName, {
    files: pipelineResult.fileContents.size,
    nodes: stats.nodes,
    edges: stats.edges,
    communities: pipelineResult.communityResult?.stats.totalCommunities,
    processes: pipelineResult.processResult?.stats.totalProcesses,
  });
  
  // Close database
  await closeKuzu();

  spinner.succeed('Repository indexed successfully');
  console.log(`  Path: ${repoPath}`);
  console.log(`  Storage: ${storagePath}`);
  console.log(`  Stats: ${stats.nodes} nodes, ${stats.edges} edges`);
  
  if (aiContext.files.length > 0) {
    console.log(`  AI Context: ${aiContext.files.join(', ')}`);
  }
};
