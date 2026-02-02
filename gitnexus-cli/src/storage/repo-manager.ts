import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface RepoMeta {
  repoPath: string;
  lastCommit: string;
  indexedAt: string;
  stats?: {
    files?: number;
    nodes?: number;
    edges?: number;
    communities?: number;
    processes?: number;
  };
}

export interface IndexedRepo {
  id: string;
  storagePath: string;
  kuzuPath: string;
  bm25Path: string;
  metaPath: string;
  meta: RepoMeta;
}

const getHomeDir = (): string => path.join(os.homedir(), '.gitnexus');
const getReposDir = (): string => path.join(getHomeDir(), 'repos');

export const ensureRepoBase = async (): Promise<void> => {
  await fs.mkdir(getReposDir(), { recursive: true });
};

export const hashRepoPath = (repoPath: string): string => {
  const resolved = path.resolve(repoPath);
  return crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12);
};

export const getRepoStoragePath = (repoPathOrHash: string): string => {
  const hash = repoPathOrHash.length === 12 ? repoPathOrHash : hashRepoPath(repoPathOrHash);
  return path.join(getReposDir(), hash);
};

export const loadMeta = async (storagePath: string): Promise<RepoMeta | null> => {
  try {
    const metaPath = path.join(storagePath, 'meta.json');
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw) as RepoMeta;
  } catch {
    return null;
  }
};

export const saveMeta = async (storagePath: string, meta: RepoMeta): Promise<void> => {
  await fs.mkdir(storagePath, { recursive: true });
  const metaPath = path.join(storagePath, 'meta.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
};

export const listIndexedRepos = async (): Promise<IndexedRepo[]> => {
  await ensureRepoBase();
  const dirs = await fs.readdir(getReposDir(), { withFileTypes: true });
  const repos: IndexedRepo[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const id = dir.name;
    const storagePath = path.join(getReposDir(), id);
    const meta = await loadMeta(storagePath);
    if (!meta) continue;
    repos.push({
      id,
      storagePath,
      kuzuPath: path.join(storagePath, 'kuzu'),
      bm25Path: path.join(storagePath, 'bm25.json'),
      metaPath: path.join(storagePath, 'meta.json'),
      meta,
    });
  }

  return repos;
};

export const detectRepoByCwd = async (cwd: string): Promise<IndexedRepo | null> => {
  const repos = await listIndexedRepos();
  const cwdResolved = path.resolve(cwd);
  const cwdLower = cwdResolved.toLowerCase();

  for (const repo of repos) {
    const repoPath = path.resolve(repo.meta.repoPath);
    const repoLower = repoPath.toLowerCase();
    if (cwdLower.startsWith(repoLower) || repoLower.startsWith(cwdLower)) {
      return repo;
    }
  }
  return null;
};



