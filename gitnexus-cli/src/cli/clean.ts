import fs from 'fs/promises';
import { listIndexedRepos, getRepoStoragePath, hashRepoPath } from '../storage/repo-manager.js';

export const cleanCommand = async (target?: string, options?: { all?: boolean; force?: boolean }) => {
  const repos = await listIndexedRepos();
  
  if (repos.length === 0) {
    console.log('No indexed repositories found.');
    return;
  }

  // Clean all repos
  if (options?.all) {
    if (!options.force) {
      console.log(`⚠️  This will delete ${repos.length} indexed repository(ies):`);
      repos.forEach(repo => {
        const repoName = repo.meta.repoPath.split(/[/\\]/).pop() || repo.meta.repoPath;
        console.log(`   - ${repoName} (${repo.id})`);
      });
      console.log('\nRun with --force to confirm deletion.');
      return;
    }

    for (const repo of repos) {
      try {
        await fs.rm(repo.storagePath, { recursive: true, force: true });
        const repoName = repo.meta.repoPath.split(/[/\\]/).pop() || repo.meta.repoPath;
        console.log(`🗑️  Deleted: ${repoName} (${repo.id})`);
      } catch (err) {
        console.error(`Failed to delete ${repo.id}:`, err);
      }
    }
    console.log(`\n✅ Cleaned ${repos.length} indexed repository(ies).`);
    return;
  }

  // Clean specific repo by ID or path
  if (target) {
    // Try to match by ID first
    let repoToDelete = repos.find(r => r.id === target || r.id.startsWith(target));
    
    // If not found by ID, try to match by path
    if (!repoToDelete) {
      const targetLower = target.toLowerCase();
      repoToDelete = repos.find(r => {
        const repoPath = r.meta.repoPath.toLowerCase();
        const repoName = repoPath.split(/[/\\]/).pop() || '';
        return repoPath.includes(targetLower) || repoName === targetLower;
      });
    }

    if (!repoToDelete) {
      console.log(`❌ No indexed repository found matching: ${target}`);
      console.log('\nAvailable repositories:');
      repos.forEach(repo => {
        const repoName = repo.meta.repoPath.split(/[/\\]/).pop() || repo.meta.repoPath;
        console.log(`   📁 ${repoName} (${repo.id})`);
      });
      return;
    }

    const repoName = repoToDelete.meta.repoPath.split(/[/\\]/).pop() || repoToDelete.meta.repoPath;
    
    if (!options?.force) {
      console.log(`⚠️  This will delete the index for: ${repoName}`);
      console.log(`   Path: ${repoToDelete.meta.repoPath}`);
      console.log(`   ID: ${repoToDelete.id}`);
      console.log('\nRun with --force to confirm deletion.');
      return;
    }

    try {
      await fs.rm(repoToDelete.storagePath, { recursive: true, force: true });
      console.log(`🗑️  Deleted: ${repoName} (${repoToDelete.id})`);
    } catch (err) {
      console.error(`Failed to delete ${repoToDelete.id}:`, err);
    }
    return;
  }

  // No target specified - show usage
  console.log('Usage:');
  console.log('  gitnexus clean <id-or-name> [--force]  Delete a specific repo');
  console.log('  gitnexus clean --all [--force]         Delete all indexed repos');
  console.log('\nIndexed repositories:');
  repos.forEach(repo => {
    const repoName = repo.meta.repoPath.split(/[/\\]/).pop() || repo.meta.repoPath;
    console.log(`   📁 ${repoName} (${repo.id})`);
  });
};
