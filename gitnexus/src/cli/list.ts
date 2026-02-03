/**
 * List Command
 * 
 * Shows info about the indexed repo in the current directory.
 */

import path from 'path';
import { findRepo } from '../storage/repo-manager.js';

export const listCommand = async () => {
  const cwd = process.cwd();
  const repo = await findRepo(cwd);

  if (!repo) {
    console.log('No indexed repository found in this directory.');
    console.log('Run `gitnexus analyze` to index your codebase.');
    return;
  }

  const stats = repo.meta.stats || {};
  const repoName = repo.repoPath.split(/[/\\]/).pop() || repo.repoPath;
  const indexedDate = new Date(repo.meta.indexedAt).toLocaleString();

  console.log(`\n📁 ${repoName}`);
  console.log(`   Path: ${repo.repoPath}`);
  console.log(`   Indexed: ${indexedDate}`);
  console.log(`   Stats: ${stats.files ?? 0} files, ${stats.nodes ?? 0} nodes, ${stats.edges ?? 0} edges`);
  console.log(`   Commit: ${repo.meta.lastCommit?.slice(0, 7) || 'unknown'}`);
  if (stats.communities) console.log(`   Communities: ${stats.communities}`);
  if (stats.processes) console.log(`   Processes: ${stats.processes}`);
};
