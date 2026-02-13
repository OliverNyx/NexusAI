// GitNexus SessionStart hook for Claude Code
// Fires on session startup. Stdout is injected into Claude's context.
// Checks if the current directory has a GitNexus index.

const fs = require('fs');
const path = require('path');

let dir = process.cwd();
let found = false;
for (let i = 0; i < 5; i++) {
  if (fs.existsSync(path.join(dir, '.gitnexus'))) {
    found = true;
    break;
  }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}

if (!found) {
  process.exit(0);
}

process.stdout.write(`## GitNexus Code Intelligence

This codebase is indexed by GitNexus, providing a knowledge graph with execution flows, relationships, and semantic search.

**Available MCP Tools:**
- \`query\` — Process-grouped code intelligence (execution flows related to a concept)
- \`context\` — 360-degree symbol view (categorized refs, process participation)
- \`impact\` — Blast radius analysis (what breaks if you change a symbol)
- \`detect_changes\` — Git-diff impact analysis (what do your changes affect)
- \`rename\` — Multi-file coordinated rename with confidence tags
- \`cypher\` — Raw graph queries
- \`list_repos\` — Discover indexed repos

**Quick Start:** READ \`gitnexus://repo/{name}/context\` for codebase overview, then use \`query\` to find execution flows.

**Resources:** \`gitnexus://repo/{name}/context\` (overview), \`/processes\` (execution flows), \`/schema\` (for Cypher)
`);
process.exit(0);
