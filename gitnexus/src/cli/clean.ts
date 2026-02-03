/**
 * Clean Command
 * 
 * Removes the .gitnexus index from the current repository.
 */

import fs from 'fs/promises';
import { findRepo, getStoragePath } from '../storage/repo-manager.js';

export const cleanCommand = async (options?: { force?: boolean }) => {
  const cwd = process.cwd();
  const repo = await findRepo(cwd);

  if (!repo) {
    console.log('No indexed repository found in this directory.');
    return;
  }

  const repoName = repo.repoPath.split(/[/\\]/).pop() || repo.repoPath;

  if (!options?.force) {
    console.log(`⚠️  This will delete the GitNexus index for: ${repoName}`);
    console.log(`   Path: ${repo.storagePath}`);
    console.log('\nRun with --force to confirm deletion.');
    return;
  }

  try {
    await fs.rm(repo.storagePath, { recursive: true, force: true });
    console.log(`🗑️  Deleted: ${repo.storagePath}`);
  } catch (err) {
    console.error('Failed to delete:', err);
  }
};
