/**
 * Augment CLI Command
 * 
 * Fast-path command for platform hooks.
 * Shells out from Claude Code PreToolUse / Cursor beforeShellExecution hooks.
 * 
 * Usage: gitnexus augment <pattern>
 * Returns enriched text to stdout.
 * 
 * Performance: Must cold-start fast (<500ms).
 * Skips unnecessary initialization (no web server, no full DB warmup).
 */

import { augment } from '../core/augmentation/engine.js';

export async function augmentCommand(pattern: string): Promise<void> {
  if (!pattern || pattern.length < 3) {
    // Too short to be useful — exit silently
    process.exit(0);
  }
  
  try {
    const result = await augment(pattern, process.cwd());
    
    if (result) {
      process.stdout.write(result + '\n');
    }
  } catch {
    // Graceful failure — never break the calling hook
    process.exit(0);
  }
}
