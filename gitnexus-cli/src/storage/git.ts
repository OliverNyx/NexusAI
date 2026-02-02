import { execSync } from 'child_process';

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



