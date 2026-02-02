import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { shouldIgnorePath } from '../../config/ignore-service.js';

export interface FileEntry {
  path: string;
  content: string;
}

export const walkRepository = async (
  repoPath: string,
  onProgress?: (current: number, total: number, filePath: string) => void
): Promise<FileEntry[]> => {
  const files = await glob('**/*', {
    cwd: repoPath,
    nodir: true,
    dot: false,
  });

  const filtered = files.filter(file => !shouldIgnorePath(file));
  const entries: FileEntry[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const relativePath = filtered[i];
    const fullPath = path.join(repoPath, relativePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      entries.push({ path: relativePath.replace(/\\/g, '/'), content });
      onProgress?.(i + 1, filtered.length, relativePath);
    } catch {
      onProgress?.(i + 1, filtered.length, relativePath);
    }
  }

  return entries;
};



