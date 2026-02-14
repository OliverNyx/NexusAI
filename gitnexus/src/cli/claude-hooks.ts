/**
 * Claude Code Hook Registration
 * 
 * Registers the GitNexus PreToolUse hook in ~/.claude/hooks.json
 * so that grep/glob/bash calls are automatically augmented with
 * knowledge graph context.
 * 
 * Idempotent — safe to call multiple times.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the absolute path to the gitnexus-hook.js file.
 * Works for both local dev and npm-installed packages.
 */
function getHookScriptPath(): string {
  // From dist/cli/claude-hooks.js → hooks/claude/gitnexus-hook.js
  const packageRoot = path.resolve(__dirname, '..', '..');
  return path.join(packageRoot, 'hooks', 'claude', 'gitnexus-hook.cjs');
}

/**
 * Register (or verify) the GitNexus hook in Claude Code's global hooks.json.
 * 
 * - Creates ~/.claude/ and hooks.json if they don't exist
 * - Preserves existing hooks from other tools
 * - Skips if GitNexus hook is already registered
 * 
 * Returns a status message for the CLI output.
 */
export async function registerClaudeHook(): Promise<{ registered: boolean; message: string }> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const hooksFile = path.join(claudeDir, 'hooks.json');
  const hookScript = getHookScriptPath();
  
  // Check if the hook script exists
  try {
    await fs.access(hookScript);
  } catch {
    return { registered: false, message: 'Hook script not found (package may be incomplete)' };
  }

  // Build the hook command — use node + absolute path for reliability
  const hookCommand = `node "${hookScript}"`;
  
  // Check if ~/.claude/ exists (user has Claude Code installed)
  try {
    await fs.access(claudeDir);
  } catch {
    // No Claude Code installation — skip silently
    return { registered: false, message: 'Claude Code not detected (~/.claude/ not found)' };
  }
  
  // Read existing hooks.json or start fresh
  let hooksConfig: any = {};
  try {
    const existing = await fs.readFile(hooksFile, 'utf-8');
    hooksConfig = JSON.parse(existing);
  } catch {
    // File doesn't exist or is invalid — we'll create it
  }
  
  // Ensure the hooks structure exists
  if (!hooksConfig.hooks) {
    hooksConfig.hooks = {};
  }
  if (!Array.isArray(hooksConfig.hooks.PreToolUse)) {
    hooksConfig.hooks.PreToolUse = [];
  }
  
  // Check if GitNexus hook is already registered
  const existingEntry = hooksConfig.hooks.PreToolUse.find((entry: any) => {
    if (!entry.hooks || !Array.isArray(entry.hooks)) return false;
    return entry.hooks.some((h: any) => 
      h.command && (
        h.command.includes('gitnexus-hook') || 
        h.command.includes('gitnexus augment')
      )
    );
  });
  
  if (existingEntry) {
    return { registered: true, message: 'Claude Code hook already registered' };
  }
  
  // Add the GitNexus hook entry
  hooksConfig.hooks.PreToolUse.push({
    matcher: {
      tool_name: "Grep|Glob|Bash"
    },
    hooks: [
      {
        type: "command",
        command: hookCommand,
        timeout: 8000
      }
    ]
  });
  
  // Write back
  await fs.writeFile(hooksFile, JSON.stringify(hooksConfig, null, 2) + '\n', 'utf-8');
  
  return { registered: true, message: 'Claude Code hook registered' };
}
