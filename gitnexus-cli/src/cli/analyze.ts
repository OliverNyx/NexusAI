import path from 'path';
import ora from 'ora';
import { runPipelineFromRepo } from '../core/ingestion/pipeline.js';
import { initKuzu, loadGraphToKuzu, getKuzuStats, executeQuery, executeWithReusedStatement } from '../core/kuzu/kuzu-adapter.js';
import { buildBM25Index, exportBM25Index } from '../core/search/bm25-index.js';
import { runEmbeddingPipeline } from '../core/embeddings/embedding-pipeline.js';
import { ensureRepoBase, getRepoStoragePath, saveMeta, loadMeta } from '../storage/repo-manager.js';
import { getCurrentCommit, isGitRepo } from '../storage/git.js';

export const analyzeCommand = async (
  inputPath?: string,
  options?: { force?: boolean; skipEmbeddings?: boolean }
) => {
  const repoPath = path.resolve(inputPath || '.');
  const spinner = ora('Checking repository...').start();

  if (!isGitRepo(repoPath)) {
    spinner.fail('Not a git repository');
    process.exitCode = 1;
    return;
  }

  await ensureRepoBase();
  const storagePath = getRepoStoragePath(repoPath);
  const kuzuPath = path.join(storagePath, 'kuzu');
  const bm25Path = path.join(storagePath, 'bm25.json');

  const currentCommit = getCurrentCommit(repoPath);
  const existingMeta = await loadMeta(storagePath);
  if (existingMeta && !options?.force && existingMeta.lastCommit === currentCommit) {
    spinner.succeed('Repository already up to date');
    return;
  }

  spinner.text = 'Running ingestion pipeline...';
  const pipelineResult = await runPipelineFromRepo(repoPath, (progress) => {
    spinner.text = `${progress.phase}: ${progress.percent}%`;
  });

  spinner.text = 'Loading graph into KuzuDB...';
  await initKuzu(kuzuPath);
  await loadGraphToKuzu(pipelineResult.graph, pipelineResult.fileContents, storagePath);

  spinner.text = 'Building BM25 index...';
  buildBM25Index(pipelineResult.fileContents);
  await exportBM25Index(bm25Path);

  if (!options?.skipEmbeddings) {
    spinner.text = 'Generating embeddings...';
    await runEmbeddingPipeline(
      executeQuery,
      executeWithReusedStatement,
      (progress) => {
        spinner.text = `embeddings: ${progress.percent}%`;
      }
    );
  }

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

  spinner.succeed('Repository indexed successfully');
  console.log(`Storage: ${storagePath}`);
};

