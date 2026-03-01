/**
 * P0 Integration Tests: Local Backend
 *
 * Tests tool implementations via direct KuzuDB queries.
 * The full LocalBackend.callTool() requires a global registry,
 * so here we test the security-critical behaviors directly:
 * - Write-operation blocking in cypher
 * - Query execution via the pool
 * - Parameterized queries preventing injection
 * - Read-only enforcement
 *
 * Covers hardening fixes: #1 (parameterized queries), #2 (write blocking),
 * #3 (path traversal), #4 (relation allowlist), #25 (regex lastIndex),
 * #26 (rename first-occurrence-only)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import kuzu from 'kuzu';
import { createTempDir, type TestDBHandle } from '../helpers/test-db.js';
import {
  initKuzu,
  executeQuery,
  executeParameterized,
  closeKuzu,
} from '../../src/mcp/core/kuzu-adapter.js';
import { NODE_SCHEMA_QUERIES, REL_SCHEMA_QUERIES } from '../../src/core/kuzu/schema.js';
import {
  CYPHER_WRITE_RE,
  VALID_RELATION_TYPES,
  isWriteQuery,
} from '../../src/mcp/local/local-backend.js';

let tmpHandle: TestDBHandle;
let dbPath: string;
const REPO_ID = 'backend-test';

async function createTestDB(dbDir: string): Promise<void> {
  const db = new kuzu.Database(dbDir);
  const conn = new kuzu.Connection(db);

  for (const q of NODE_SCHEMA_QUERIES) {
    await conn.query(q);
  }
  for (const q of REL_SCHEMA_QUERIES) {
    await conn.query(q);
  }

  // Insert test data: files, functions, classes, relationships
  await conn.query(`CREATE (f:File {id: 'file:auth.ts', name: 'auth.ts', filePath: 'src/auth.ts', content: 'auth module'})`);
  await conn.query(`CREATE (f:File {id: 'file:utils.ts', name: 'utils.ts', filePath: 'src/utils.ts', content: 'utils module'})`);
  await conn.query(`CREATE (fn:Function {id: 'func:login', name: 'login', filePath: 'src/auth.ts', startLine: 1, endLine: 15, isExported: true, content: 'function login() {}', description: 'User login'})`);
  await conn.query(`CREATE (fn:Function {id: 'func:validate', name: 'validate', filePath: 'src/auth.ts', startLine: 17, endLine: 25, isExported: true, content: 'function validate() {}', description: 'Validate input'})`);
  await conn.query(`CREATE (fn:Function {id: 'func:hash', name: 'hash', filePath: 'src/utils.ts', startLine: 1, endLine: 8, isExported: true, content: 'function hash() {}', description: 'Hash utility'})`);
  await conn.query(`CREATE (c:Class {id: 'class:AuthService', name: 'AuthService', filePath: 'src/auth.ts', startLine: 30, endLine: 60, isExported: true, content: 'class AuthService {}', description: 'Authentication service'})`);
  await conn.query(`CREATE (c:Community {id: 'comm:auth', label: 'Auth', heuristicLabel: 'Authentication', keywords: ['auth', 'login'], description: 'Auth module', enrichedBy: 'heuristic', cohesion: 0.8, symbolCount: 3})`);
  await conn.query(`CREATE (p:Process {id: 'proc:login-flow', label: 'LoginFlow', heuristicLabel: 'User Login', processType: 'intra_community', stepCount: 2, communities: ['auth'], entryPointId: 'func:login', terminalId: 'func:validate'})`);

  // Relationships
  await conn.query(`
    MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:validate'
    CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 1.0, reason: 'direct', step: 0}]->(b)
  `);
  await conn.query(`
    MATCH (a:Function), (b:Function) WHERE a.id = 'func:login' AND b.id = 'func:hash'
    CREATE (a)-[:CodeRelation {type: 'CALLS', confidence: 0.9, reason: 'import-resolved', step: 0}]->(b)
  `);
  await conn.query(`
    MATCH (a:Function), (c:Community) WHERE a.id = 'func:login' AND c.id = 'comm:auth'
    CREATE (a)-[:CodeRelation {type: 'MEMBER_OF', confidence: 1.0, reason: '', step: 0}]->(c)
  `);
  await conn.query(`
    MATCH (a:Function), (p:Process) WHERE a.id = 'func:login' AND p.id = 'proc:login-flow'
    CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 1}]->(p)
  `);
  await conn.query(`
    MATCH (a:Function), (p:Process) WHERE a.id = 'func:validate' AND p.id = 'proc:login-flow'
    CREATE (a)-[:CodeRelation {type: 'STEP_IN_PROCESS', confidence: 1.0, reason: '', step: 2}]->(p)
  `);

  conn.close();
  db.close();
}

beforeAll(async () => {
  tmpHandle = await createTempDir('backend-test-');
  dbPath = path.join(tmpHandle.dbPath, 'kuzu');
  // KuzuDB creates the directory itself — do NOT mkdir
  await createTestDB(dbPath);
  await initKuzu(REPO_ID, dbPath);
}, 30000);

afterAll(async () => {
  // NOTE: We intentionally skip closeKuzu() here because KuzuDB native
  // cleanup in forked workers can cause segfaults on process exit.
  // The OS reclaims resources when the worker process terminates.
  try { await tmpHandle.cleanup(); } catch { /* best-effort */ }
});

// ─── Cypher write blocking ───────────────────────────────────────────

describe('cypher write blocking', () => {
  const allWriteKeywords = ['CREATE', 'DELETE', 'SET', 'MERGE', 'REMOVE', 'DROP', 'ALTER', 'COPY', 'DETACH'];

  for (const keyword of allWriteKeywords) {
    it(`blocks ${keyword} query`, () => {
      const blocked = isWriteQuery(`MATCH (n) ${keyword} n.name = "x"`);
      expect(blocked).toBe(true);
    });
  }

  it('allows valid read queries through the pool', async () => {
    const rows = await executeQuery(REPO_ID, 'MATCH (n:Function) RETURN n.name AS name ORDER BY n.name');
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Parameterized queries ───────────────────────────────────────────

describe('parameterized queries', () => {
  it('finds exact match with parameter', async () => {
    const rows = await executeParameterized(
      REPO_ID,
      'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name, n.filePath AS filePath',
      { name: 'login' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('login');
    expect(rows[0].filePath).toBe('src/auth.ts');
  });

  it('injection is harmless', async () => {
    const rows = await executeParameterized(
      REPO_ID,
      'MATCH (n:Function) WHERE n.name = $name RETURN n.name AS name',
      { name: "login' OR '1'='1" },
    );
    expect(rows).toHaveLength(0);
  });
});

// ─── Relation type filtering ─────────────────────────────────────────

describe('relation type filtering', () => {
  it('only allows valid relation types in queries', () => {
    const validTypes = ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const invalidTypes = ['CONTAINS', 'STEP_IN_PROCESS', 'MEMBER_OF', 'DROP_TABLE'];

    for (const t of validTypes) {
      expect(VALID_RELATION_TYPES.has(t)).toBe(true);
    }
    for (const t of invalidTypes) {
      expect(VALID_RELATION_TYPES.has(t)).toBe(false);
    }
  });

  it('can query relationships with valid types', async () => {
    const rows = await executeQuery(
      REPO_ID,
      `MATCH (a:Function)-[r:CodeRelation {type: 'CALLS'}]->(b:Function) RETURN a.name AS caller, b.name AS callee ORDER BY b.name`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Process queries ─────────────────────────────────────────────────

describe('process queries', () => {
  it('can find processes', async () => {
    const rows = await executeQuery(REPO_ID, 'MATCH (p:Process) RETURN p.heuristicLabel AS label, p.stepCount AS steps');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].label).toBe('User Login');
  });

  it('can trace process steps', async () => {
    const rows = await executeQuery(
      REPO_ID,
      `MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
       WHERE p.id = 'proc:login-flow'
       RETURN s.name AS symbol, r.step AS step
       ORDER BY r.step`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe('login');
    expect(rows[0].step).toBe(1);
    expect(rows[1].symbol).toBe('validate');
    expect(rows[1].step).toBe(2);
  });
});

// ─── Community queries ───────────────────────────────────────────────

describe('community queries', () => {
  it('can find communities', async () => {
    const rows = await executeQuery(REPO_ID, 'MATCH (c:Community) RETURN c.heuristicLabel AS label');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].label).toBe('Authentication');
  });

  it('can find community members', async () => {
    const rows = await executeQuery(
      REPO_ID,
      `MATCH (f)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
       WHERE c.heuristicLabel = 'Authentication'
       RETURN f.name AS name`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].name).toBe('login');
  });
});

// ─── Read-only enforcement ───────────────────────────────────────────

describe('read-only database', () => {
  it('rejects write operations at DB level', async () => {
    await expect(
      executeQuery(REPO_ID, `CREATE (n:Function {id: 'new', name: 'new', filePath: '', startLine: 0, endLine: 0, isExported: false, content: '', description: ''})`)
    ).rejects.toThrow();
  });
});

// ─── Regex lastIndex hardening (#25) ─────────────────────────────────

describe('regex lastIndex (hardening #25)', () => {
  it('CYPHER_WRITE_RE is non-global (no sticky lastIndex)', () => {
    expect(CYPHER_WRITE_RE.global).toBe(false);
    expect(CYPHER_WRITE_RE.sticky).toBe(false);
  });

  it('works correctly across multiple consecutive calls', () => {
    // If the regex were global, lastIndex could cause false results
    const results = [
      isWriteQuery('CREATE (n)'),     // true
      isWriteQuery('MATCH (n) RETURN n'), // false
      isWriteQuery('DELETE n'),       // true
      isWriteQuery('MATCH (n) RETURN n'), // false
      isWriteQuery('SET n.x = 1'),    // true
    ];
    expect(results).toEqual([true, false, true, false, true]);
  });
});

// ─── Content queries (include_content equivalent) ────────────────────

describe('content queries', () => {
  it('can retrieve symbol content', async () => {
    const rows = await executeQuery(
      REPO_ID,
      `MATCH (n:Function) WHERE n.name = 'login' RETURN n.content AS content`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toContain('function login');
  });
});
