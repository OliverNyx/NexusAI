import { listIndexedRepos } from '../storage/repo-manager.js';

export const listCommand = async () => {
  const repos = await listIndexedRepos();
  if (repos.length === 0) {
    console.log('No indexed repositories found.');
    return;
  }

  repos.forEach((repo, index) => {
    const stats = repo.meta.stats || {};
    const repoName = repo.meta.repoPath.split(/[/\\]/).pop() || repo.meta.repoPath;
    const indexedDate = new Date(repo.meta.indexedAt).toLocaleString();
    
    console.log(`\n📁 ${repoName}`);
    console.log(`   Path: ${repo.meta.repoPath}`);
    console.log(`   Indexed: ${indexedDate}`);
    console.log(`   Stats: ${stats.files ?? 0} files, ${stats.nodes ?? 0} nodes, ${stats.edges ?? 0} edges`);
    console.log(`   Commit: ${repo.meta.lastCommit?.slice(0, 7) || 'unknown'}  (id: ${repo.id})`);
  });
};



