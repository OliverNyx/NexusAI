import { detectRepoByCwd } from '../storage/repo-manager.js';
import { getCurrentCommit, isGitRepo } from '../storage/git.js';

export const statusCommand = async () => {
  const cwd = process.cwd();
  if (!isGitRepo(cwd)) {
    console.log('Not a git repository.');
    return;
  }

  const repo = await detectRepoByCwd(cwd);
  if (!repo) {
    console.log('Repository not indexed. Run: gitnexus analyze');
    return;
  }

  const current = getCurrentCommit(repo.meta.repoPath);
  const upToDate = current && current === repo.meta.lastCommit;

  console.log(`Repo: ${repo.meta.repoPath}`);
  console.log(`Indexed at: ${repo.meta.indexedAt}`);
  console.log(`Last commit indexed: ${repo.meta.lastCommit}`);
  console.log(`Current commit: ${current}`);
  console.log(`Status: ${upToDate ? 'up-to-date' : 'stale'}`);
};



