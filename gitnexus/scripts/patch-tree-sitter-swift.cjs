#!/usr/bin/env node
/**
 * Patches tree-sitter-swift's binding.gyp to remove the 'actions' array
 * that requires tree-sitter-cli during npm install, then rebuilds the native binding.
 *
 * tree-sitter-swift@0.6.0 ships pre-generated parser files (parser.c, scanner.c)
 * but its binding.gyp includes actions that try to regenerate them,
 * which fails for consumers who don't have tree-sitter-cli installed.
 *
 * Flow: tree-sitter-swift's own postinstall fails (npm warns but continues)
 *       → this script patches binding.gyp → rebuilds native binding → success
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const swiftDir = path.join(__dirname, '..', 'node_modules', 'tree-sitter-swift');
const bindingPath = path.join(swiftDir, 'binding.gyp');

try {
  if (!fs.existsSync(bindingPath)) {
    process.exit(0);
  }

  const content = fs.readFileSync(bindingPath, 'utf8');
  let needsRebuild = false;

  if (content.includes('"actions"')) {
    // Strip Python-style comments (#) before JSON parsing
    const cleaned = content.replace(/#[^\n]*/g, '');
    const gyp = JSON.parse(cleaned);

    if (gyp.targets && gyp.targets[0] && gyp.targets[0].actions) {
      delete gyp.targets[0].actions;
      fs.writeFileSync(bindingPath, JSON.stringify(gyp, null, 2) + '\n');
      console.log('[tree-sitter-swift] Patched binding.gyp (removed actions array)');
      needsRebuild = true;
    }
  }

  // Check if native binding exists
  const bindingNode = path.join(swiftDir, 'build', 'Release', 'tree_sitter_swift_binding.node');
  if (!fs.existsSync(bindingNode)) {
    needsRebuild = true;
  }

  if (needsRebuild) {
    console.log('[tree-sitter-swift] Rebuilding native binding...');
    execSync('npx node-gyp rebuild', {
      cwd: swiftDir,
      stdio: 'pipe',
      timeout: 120000,
    });
    console.log('[tree-sitter-swift] Native binding built successfully');
  }
} catch (err) {
  console.warn('[tree-sitter-swift] Could not build native binding:', err.message);
  console.warn('[tree-sitter-swift] You may need to manually run: cd node_modules/tree-sitter-swift && npx node-gyp rebuild');
}
