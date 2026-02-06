/**
 * Repository Manager
 * 
 * Manages GitNexus index storage in .gitnexus/ at repo root.
 */

import fs from 'fs/promises';
import path from 'path';

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
    embeddings?: number;
  };
}

export interface IndexedRepo {
  repoPath: string;
  storagePath: string;
  kuzuPath: string;
  metaPath: string;
  meta: RepoMeta;
}

const GITNEXUS_DIR = '.gitnexus';

/**
 * Get the .gitnexus storage path for a repository
 */
export const getStoragePath = (repoPath: string): string => {
  return path.join(path.resolve(repoPath), GITNEXUS_DIR);
};

/**
 * Get paths to key storage files
 */
export const getStoragePaths = (repoPath: string) => {
  const storagePath = getStoragePath(repoPath);
  return {
    storagePath,
    kuzuPath: path.join(storagePath, 'kuzu'),
    metaPath: path.join(storagePath, 'meta.json'),
  };
};

/**
 * Load metadata from an indexed repo
 */
export const loadMeta = async (storagePath: string): Promise<RepoMeta | null> => {
  try {
    const metaPath = path.join(storagePath, 'meta.json');
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw) as RepoMeta;
  } catch {
    return null;
  }
};

/**
 * Save metadata to storage
 */
export const saveMeta = async (storagePath: string, meta: RepoMeta): Promise<void> => {
  await fs.mkdir(storagePath, { recursive: true });
  const metaPath = path.join(storagePath, 'meta.json');
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
};

/**
 * Check if a path has a GitNexus index
 */
export const hasIndex = async (repoPath: string): Promise<boolean> => {
  const { metaPath } = getStoragePaths(repoPath);
  try {
    await fs.access(metaPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Load an indexed repo from a path
 */
export const loadRepo = async (repoPath: string): Promise<IndexedRepo | null> => {
  const paths = getStoragePaths(repoPath);
  const meta = await loadMeta(paths.storagePath);
  if (!meta) return null;
  
  return {
    repoPath: path.resolve(repoPath),
    ...paths,
    meta,
  };
};

/**
 * Find .gitnexus by walking up from a starting path
 */
export const findRepo = async (startPath: string): Promise<IndexedRepo | null> => {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;
  
  while (current !== root) {
    const repo = await loadRepo(current);
    if (repo) return repo;
    current = path.dirname(current);
  }
  
  return null;
};

/**
 * Add .gitnexus to .gitignore if not already present
 */
export const addToGitignore = async (repoPath: string): Promise<void> => {
  const gitignorePath = path.join(repoPath, '.gitignore');
  
  try {
    const content = await fs.readFile(gitignorePath, 'utf-8');
    if (content.includes(GITNEXUS_DIR)) return;
    
    const newContent = content.endsWith('\n') 
      ? `${content}${GITNEXUS_DIR}\n`
      : `${content}\n${GITNEXUS_DIR}\n`;
    await fs.writeFile(gitignorePath, newContent, 'utf-8');
  } catch {
    // .gitignore doesn't exist, create it
    await fs.writeFile(gitignorePath, `${GITNEXUS_DIR}\n`, 'utf-8');
  }
};
