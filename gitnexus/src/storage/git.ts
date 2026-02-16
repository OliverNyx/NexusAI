import { execSync } from 'child_process';

// Git utilities for repository detection, commit tracking, and diff analysis

export const isGitRepo = (repoPath: string): boolean => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

export const getCurrentCommit = (repoPath: string): string => {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoPath }).toString().trim();
  } catch {
    return '';
  }
};

export const getStatusPorcelain = (repoPath: string): string => {
  try {
    return execSync('git status --porcelain', { cwd: repoPath }).toString();
  } catch {
    return '';
  }
};

/**
 * Find the git repository root from any path inside the repo
 */
export const getGitRoot = (fromPath: string): string | null => {
  try {
    return execSync('git rev-parse --show-toplevel', { cwd: fromPath })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

/**
 * Get files that were added, modified, copied, or renamed between two commits.
 * Returns relative paths (forward-slash normalized).
 */
export const getChangedFiles = (fromCommit: string, toCommit: string, repoPath: string): string[] => {
  try {
    const output = execSync(
      `git diff ${fromCommit}..${toCommit} --name-only --diff-filter=ACMR`,
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    ).trim();
    return output ? output.split('\n').filter(Boolean).map(f => f.replace(/\\/g, '/')) : [];
  } catch {
    return [];
  }
};

/**
 * Get files that were deleted between two commits.
 * Returns relative paths (forward-slash normalized).
 */
export const getDeletedFiles = (fromCommit: string, toCommit: string, repoPath: string): string[] => {
  try {
    const output = execSync(
      `git diff ${fromCommit}..${toCommit} --name-only --diff-filter=D`,
      { cwd: repoPath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    ).trim();
    return output ? output.split('\n').filter(Boolean).map(f => f.replace(/\\/g, '/')) : [];
  } catch {
    return [];
  }
};

