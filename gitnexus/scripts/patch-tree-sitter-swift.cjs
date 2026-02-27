#!/usr/bin/env node
/**
 * Patches tree-sitter-swift's binding.gyp to remove the 'actions' array
 * that requires tree-sitter-cli during npm install.
 *
 * tree-sitter-swift@0.6.0 ships pre-generated parser files (parser.c, scanner.c)
 * but its binding.gyp includes actions that try to regenerate them,
 * which fails for consumers who don't have tree-sitter-cli installed.
 */
const fs = require('fs');
const path = require('path');

const bindingPath = path.join(__dirname, '..', 'node_modules', 'tree-sitter-swift', 'binding.gyp');

try {
  if (!fs.existsSync(bindingPath)) {
    // tree-sitter-swift not installed (optional dependency or not yet installed)
    process.exit(0);
  }

  const content = fs.readFileSync(bindingPath, 'utf8');

  // Check if actions array exists
  if (!content.includes('"actions"')) {
    // Already clean, nothing to do
    process.exit(0);
  }

  // Parse, remove actions, write back
  // binding.gyp uses Python-style comments (#) which aren't valid JSON,
  // so we use regex to strip them before parsing
  const cleaned = content.replace(/#[^\n]*/g, '');
  const gyp = JSON.parse(cleaned);

  if (gyp.targets && gyp.targets[0] && gyp.targets[0].actions) {
    delete gyp.targets[0].actions;
    fs.writeFileSync(bindingPath, JSON.stringify(gyp, null, 2) + '\n');
    console.log('Patched tree-sitter-swift binding.gyp (removed actions array)');
  }
} catch (err) {
  // Non-fatal — the native build may still work, or the user can patch manually
  console.warn('Could not patch tree-sitter-swift binding.gyp:', err.message);
}
