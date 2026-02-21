import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { shouldIgnorePath } from '../../config/ignore-service.js';

export interface FileEntry {
  path: string;
  content: string;
}

const READ_CONCURRENCY = 32;

/** Skip files larger than 512KB — they're usually generated/vendored and crash tree-sitter */
const MAX_FILE_SIZE = 512 * 1024;

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
  let skippedLarge = 0;

  for (let start = 0; start < filtered.length; start += READ_CONCURRENCY) {
    const batch = filtered.slice(start, start + READ_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async relativePath => {
        const fullPath = path.join(repoPath, relativePath);
        const stat = await fs.stat(fullPath);
        if (stat.size > MAX_FILE_SIZE) {
          skippedLarge++;
          return null;
        }
        const content = await fs.readFile(fullPath, 'utf-8');
        return { path: relativePath.replace(/\\/g, '/'), content };
      })
    );

    for (const result of results) {
      processed++;
      if (result.status === 'fulfilled' && result.value !== null) {
        entries.push(result.value);
        onProgress?.(processed, filtered.length, result.value.path);
      } else {
        onProgress?.(processed, filtered.length, batch[results.indexOf(result)]);
      }
    }
  }

  if (skippedLarge > 0) {
    console.warn(`  Skipped ${skippedLarge} files larger than ${MAX_FILE_SIZE / 1024}KB`);
  }

  return entries;
};
