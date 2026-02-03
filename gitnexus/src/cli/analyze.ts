/**
 * Analyze Command
 * 
 * Indexes a repository and stores the knowledge graph in .gitnexus/
 */

import path from 'path';
import ora from 'ora';
import { runPipelineFromRepo } from '../core/ingestion/pipeline.js';
import { initKuzu, loadGraphToKuzu, getKuzuStats, executeQuery, executeWithReusedStatement, closeKuzu } from '../core/kuzu/kuzu-adapter.js';
import { buildBM25Index, exportBM25Index } from '../core/search/bm25-index.js';
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

  const { storagePath, kuzuPath, bm25Path } = getStoragePaths(repoPath);
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
  spinner.text = 'Loading graph into KuzuDB...';
  await initKuzu(kuzuPath);
  await loadGraphToKuzu(pipelineResult.graph, pipelineResult.fileContents, storagePath);

  // Build BM25 search index
  spinner.text = 'Building BM25 index...';
  buildBM25Index(pipelineResult.fileContents);
  await exportBM25Index(bm25Path);

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
