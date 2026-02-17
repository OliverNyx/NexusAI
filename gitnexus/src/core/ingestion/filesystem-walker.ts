import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { shouldIgnorePath } from '../../config/ignore-service.js';

export interface FileEntry {
  path: string;
  content: string;
}

const READ_CONCURRENCY = 32;

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
  let processed = 0;

  for (let start = 0; start < filtered.length; start += READ_CONCURRENCY) {
    const batch = filtered.slice(start, start + READ_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(relativePath =>
        fs.readFile(path.join(repoPath, relativePath), 'utf-8')
          .then(content => ({ path: relativePath.replace(/\\/g, '/'), content }))
      )
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled') {
        entries.push(result.value);
        onProgress?.(processed, filtered.length, result.value.path);
      } else {
        onProgress?.(processed, filtered.length, batch[results.indexOf(result)]);
      }
    }
  }

  return entries;
};
