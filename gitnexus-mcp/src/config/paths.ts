/**
 * Path Utilities
 * 
 * Resolves paths for the MCP bridge executable.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

/**
 * Get the path to this CLI executable.
 * When installed via npm, this will be in node_modules/.bin/
 * The MCP config needs to point to the actual executable.
 */
export function getBridgePath(): string {
  // When running as ES module, we need to resolve from import.meta.url
  // But for the installed package, we want the bin path
  
  // Get the path to this module
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // Go up from dist/config/ to the package root, then to the bin
  const packageRoot = resolve(__dirname, '..', '..');
  const binPath = resolve(packageRoot, 'dist', 'cli.js');
  
  // Return as node command since it's a JS file
  return `node ${binPath}`;
}

/**
 * Get user's GitNexus config directory
 */
export function getGitNexusConfigDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return resolve(home, '.gitnexus');
}
