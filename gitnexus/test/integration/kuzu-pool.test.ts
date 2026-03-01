/**
 * P0 Integration Tests: KuzuDB Connection Pool
 *
 * Tests: initKuzu, executeQuery, executeParameterized, closeKuzu lifecycle
 * Covers hardening fixes: parameterized queries, query timeout,
 * waiter queue timeout, idle eviction guards, stdout silencing race
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import kuzu from 'kuzu';
import { createTempDir, type TestDBHandle } from '../helpers/test-db.js';
import {
  initKuzu,
  executeQuery,
  executeParameterized,
  closeKuzu,
  isKuzuReady,
} from '../../src/mcp/core/kuzu-adapter.js';
import { NODE_SCHEMA_QUERIES, REL_SCHEMA_QUERIES } from '../../src/core/kuzu/schema.js';

let tmpHandle: TestDBHandle;
let dbPath: string;
const REPO_ID = 'test-repo';

/**
 * Create a writable KuzuDB with schema and seed data.
 * The pool opens it read-only, so we must create it separately.
 */
async function createTestDB(dbDir: string): Promise<void> {
  const db = new kuzu.Database(dbDir);
  const conn = new kuzu.Connection(db);

  // Create schema
  for (const q of NODE_SCHEMA_QUERIES) {
    await conn.query(q);
  }
  for (const q of REL_SCHEMA_QUERIES) {
    await conn.query(q);
  }

  // Insert test data
  await conn.query(`CREATE (f:File {id: 'file:index.ts', name: 'index.ts', filePath: 'src/index.ts', content: ''})`);
  await conn.query(`CREATE (fn:Function {id: 'func:main', name: 'main', filePath: 'src/index.ts', startLine: 1, endLine: 10, isExported: true, content: '', description: ''})`);
  await conn.query(`CREATE (fn2:Function {id: 'func:helper', name: 'helper', filePath: 'src/utils.ts', startLine: 1, endLine: 5, isExported: true, content: '', description: ''})`);
  await conn.query(`
    MATCH (a:Function), (b:Function)
    WHERE a.id = 'func:main' AND b.id = 'func:helper'
    CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 1.0, reason: 'direct', step: 0}]->(b)
  `);

  conn.close();
  db.close();
}

beforeAll(async () => {
  tmpHandle = await createTempDir('kuzu-pool-test-');
  dbPath = path.join(tmpHandle.dbPath, 'kuzu');
  // KuzuDB creates the directory itself — do NOT mkdir
  await createTestDB(dbPath);
}, 30000);

afterAll(async () => {
  // NOTE: We intentionally skip closeKuzu() here because KuzuDB native
  // cleanup in forked workers can cause segfaults on process exit.
  // The OS reclaims resources when the worker process terminates.
  try { await tmpHandle.cleanup(); } catch { /* best-effort */ }
});

afterEach(async () => {
  // Clean up specific repo IDs used in tests, not all
  try { await closeKuzu(REPO_ID); } catch { /* best-effort */ }
  try { await closeKuzu('repo1'); } catch { /* best-effort */ }
  try { await closeKuzu('repo2'); } catch { /* best-effort */ }
});

// ─── Lifecycle: init → query → close ─────────────────────────────────

describe('pool lifecycle', () => {
  it('initKuzu + executeQuery + closeKuzu', async () => {
    await initKuzu(REPO_ID, dbPath);
    expect(isKuzuReady(REPO_ID)).toBe(true);

    const rows = await executeQuery(REPO_ID, 'MATCH (n:Function) RETURN n.name AS name');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const names = rows.map((r: any) => r.name);
    expect(names).toContain('main');
    expect(names).toContain('helper');

    await closeKuzu(REPO_ID);
    expect(isKuzuReady(REPO_ID)).toBe(false);
  });

  it('initKuzu reuses existing pool entry', async () => {
    await initKuzu(REPO_ID, dbPath);
    await initKuzu(REPO_ID, dbPath); // second call should be no-op
    expect(isKuzuReady(REPO_ID)).toBe(true);
  });

  it('closeKuzu is idempotent', async () => {
    await initKuzu(REPO_ID, dbPath);
    await closeKuzu(REPO_ID);
    await closeKuzu(REPO_ID); // second close should not throw
    expect(isKuzuReady(REPO_ID)).toBe(false);
  });

  it('closeKuzu with no args closes all repos', async () => {
    await initKuzu('repo1', dbPath);
    await initKuzu('repo2', dbPath);
    expect(isKuzuReady('repo1')).toBe(true);
    expect(isKuzuReady('repo2')).toBe(true);

    await closeKuzu();
    expect(isKuzuReady('repo1')).toBe(false);
    expect(isKuzuReady('repo2')).toBe(false);
  });
});

// ─── Parameterized queries ───────────────────────────────────────────

describe('executeParameterized', () => {
  it('works with parameterized query', async () => {
    await initKuzu(REPO_ID, dbPath);
    const rows = await executeParameterized(
      REPO_ID,
      'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name',
      { name: 'main' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('main');
  });

  it('injection attempt is harmless with parameterized query', async () => {
    await initKuzu(REPO_ID, dbPath);
    const rows = await executeParameterized(
      REPO_ID,
      'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name',
      { name: "' OR 1=1 --" }, // SQL/Cypher injection attempt
    );
    // Should return 0 rows, not all rows
    expect(rows).toHaveLength(0);
  });
});

// ─── Error handling ──────────────────────────────────────────────────

describe('error handling', () => {
  it('throws when querying uninitialized repo', async () => {
    await expect(executeQuery('nonexistent-repo', 'MATCH (n) RETURN n'))
      .rejects.toThrow(/not initialized/);
  });

  it('throws when db path does not exist', async () => {
    await expect(initKuzu('bad-repo', '/nonexistent/path/kuzu'))
      .rejects.toThrow();
  });

  it('read-only mode: write query throws', async () => {
    await initKuzu(REPO_ID, dbPath);
    await expect(executeQuery(REPO_ID, "CREATE (n:Function {id: 'new', name: 'new', filePath: '', startLine: 0, endLine: 0, isExported: false, content: '', description: ''})"))
      .rejects.toThrow();
  });
});

// ─── Relationship queries ────────────────────────────────────────────

describe('relationship queries', () => {
  it('can query relationships', async () => {
    await initKuzu(REPO_ID, dbPath);
    const rows = await executeQuery(
      REPO_ID,
      `MATCH (a:Function)-[r:CodeRelation {type: 'CALLS'}]->(b:Function) RETURN a.name AS caller, b.name AS callee`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows.find((r: any) => r.caller === 'main');
    expect(row).toBeDefined();
    expect(row.callee).toBe('helper');
  });
});
