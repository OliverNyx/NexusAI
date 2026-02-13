import fs from 'fs/promises';
import path from 'path';
import { KnowledgeGraph } from '../graph/types.js';
import { ASTCache } from './ast-cache.js';
import Parser from 'tree-sitter';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader.js';
import { LANGUAGE_QUERIES } from './tree-sitter-queries.js';
import { generateId } from '../../lib/utils.js';
import { getLanguageFromFilename, yieldToEventLoop } from './utils.js';
import { SupportedLanguages } from '../../config/supported-languages.js';

const isDev = process.env.NODE_ENV === 'development';

// Type: Map<FilePath, Set<ResolvedFilePath>>
// Stores all files that a given file imports from
export type ImportMap = Map<string, Set<string>>;

export const createImportMap = (): ImportMap => new Map();

// ============================================================================
// LANGUAGE-SPECIFIC CONFIG
// ============================================================================

/** TypeScript path alias config parsed from tsconfig.json */
interface TsconfigPaths {
  /** Map of alias prefix -> target prefix (e.g., "@/" -> "src/") */
  aliases: Map<string, string>;
  /** Base URL for path resolution (relative to repo root) */
  baseUrl: string;
}

/** Go module config parsed from go.mod */
interface GoModuleConfig {
  /** Module path (e.g., "github.com/user/repo") */
  modulePath: string;
}

/**
 * Parse tsconfig.json to extract path aliases.
 * Tries tsconfig.json, tsconfig.app.json, tsconfig.base.json in order.
 */
async function loadTsconfigPaths(repoRoot: string): Promise<TsconfigPaths | null> {
  const candidates = ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json'];

  for (const filename of candidates) {
    try {
      const tsconfigPath = path.join(repoRoot, filename);
      const raw = await fs.readFile(tsconfigPath, 'utf-8');
      // Strip JSON comments (// and /* */ style) for robustness
      const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const tsconfig = JSON.parse(stripped);
      const compilerOptions = tsconfig.compilerOptions;
      if (!compilerOptions?.paths) continue;

      const baseUrl = compilerOptions.baseUrl || '.';
      const aliases = new Map<string, string>();

      for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        const target = targets[0] as string;

        // Convert glob patterns: "@/*" -> "@/", "src/*" -> "src/"
        const aliasPrefix = pattern.endsWith('/*') ? pattern.slice(0, -1) : pattern;
        const targetPrefix = target.endsWith('/*') ? target.slice(0, -1) : target;

        aliases.set(aliasPrefix, targetPrefix);
      }

      if (aliases.size > 0) {
        if (isDev) {
          console.log(`📦 Loaded ${aliases.size} path aliases from ${filename}`);
        }
        return { aliases, baseUrl };
      }
    } catch {
      // File doesn't exist or isn't valid JSON - try next
    }
  }

  return null;
}

/**
 * Parse go.mod to extract module path.
 */
async function loadGoModulePath(repoRoot: string): Promise<GoModuleConfig | null> {
  try {
    const goModPath = path.join(repoRoot, 'go.mod');
    const content = await fs.readFile(goModPath, 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    if (match) {
      if (isDev) {
        console.log(`📦 Loaded Go module path: ${match[1]}`);
      }
      return { modulePath: match[1] };
    }
  } catch {
    // No go.mod
  }
  return null;
}

// ============================================================================
// IMPORT PATH RESOLUTION
// ============================================================================

/** All file extensions to try during resolution */
const EXTENSIONS = [
  '',
  // TypeScript/JavaScript
  '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js',
  // Python
  '.py', '/__init__.py',
  // Java
  '.java',
  // C/C++
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hxx', '.hh',
  // C#
  '.cs',
  // Go
  '.go',
  // Rust
  '.rs', '/mod.rs',
];

/**
 * Try to match a path (with extensions) against the known file set.
 * Returns the matched file path or null.
 */
function tryResolveWithExtensions(
  basePath: string,
  allFiles: Set<string>,
): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (allFiles.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Suffix-based resolution: try progressively shorter suffixes against all files.
 * Used for package-style imports (Java, Python, etc.).
 */
function suffixResolve(
  pathParts: string[],
  normalizedFileList: string[],
  allFileList: string[],
): string | null {
  for (let i = 0; i < pathParts.length; i++) {
    const suffix = pathParts.slice(i).join('/');
    for (const ext of EXTENSIONS) {
      const suffixWithExt = suffix + ext;
      const suffixPattern = '/' + suffixWithExt;
      const matchIdx = normalizedFileList.findIndex(filePath =>
        filePath.endsWith(suffixPattern) || filePath.toLowerCase().endsWith(suffixPattern.toLowerCase())
      );
      if (matchIdx !== -1) {
        return allFileList[matchIdx];
      }
    }
  }
  return null;
}

/**
 * Resolve an import path to a file path in the repository.
 *
 * Language-specific preprocessing is applied before the generic resolution:
 * - TypeScript/JavaScript: rewrites tsconfig path aliases
 * - Rust: converts crate::/super::/self:: to relative paths
 *
 * Java wildcards and Go package imports are handled separately in processImports
 * because they resolve to multiple files.
 */
const resolveImportPath = (
  currentFile: string,
  importPath: string,
  allFiles: Set<string>,
  allFileList: string[],
  normalizedFileList: string[],
  resolveCache: Map<string, string | null>,
  language: SupportedLanguages,
  tsconfigPaths: TsconfigPaths | null,
): string | null => {
  const cacheKey = `${currentFile}::${importPath}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey) ?? null;

  const cache = (result: string | null): string | null => {
    resolveCache.set(cacheKey, result);
    return result;
  };

  // ---- TypeScript/JavaScript: rewrite path aliases ----
  if (
    (language === SupportedLanguages.TypeScript || language === SupportedLanguages.JavaScript) &&
    tsconfigPaths &&
    !importPath.startsWith('.')
  ) {
    for (const [aliasPrefix, targetPrefix] of tsconfigPaths.aliases) {
      if (importPath.startsWith(aliasPrefix)) {
        const remainder = importPath.slice(aliasPrefix.length);
        // Build the rewritten path relative to baseUrl
        const rewritten = tsconfigPaths.baseUrl === '.'
          ? targetPrefix + remainder
          : tsconfigPaths.baseUrl + '/' + targetPrefix + remainder;

        // Try direct resolution from repo root
        const resolved = tryResolveWithExtensions(rewritten, allFiles);
        if (resolved) return cache(resolved);

        // Try suffix matching as fallback
        const parts = rewritten.split('/').filter(Boolean);
        const suffixResult = suffixResolve(parts, normalizedFileList, allFileList);
        if (suffixResult) return cache(suffixResult);
      }
    }
  }

  // ---- Rust: convert module path syntax to file paths ----
  if (language === SupportedLanguages.Rust) {
    const rustResult = resolveRustImport(currentFile, importPath, allFiles);
    if (rustResult) return cache(rustResult);
    // Fall through to generic resolution if Rust-specific didn't match
  }

  // ---- Generic relative import resolution (./ and ../) ----
  const currentDir = currentFile.split('/').slice(0, -1);
  const parts = importPath.split('/');

  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      currentDir.pop();
    } else {
      currentDir.push(part);
    }
  }

  const basePath = currentDir.join('/');

  if (importPath.startsWith('.')) {
    const resolved = tryResolveWithExtensions(basePath, allFiles);
    return cache(resolved);
  }

  // ---- Generic package/absolute import resolution (suffix matching) ----
  // Java wildcards are handled in processImports, not here
  if (importPath.endsWith('.*')) {
    return cache(null);
  }

  const pathLike = importPath.includes('/')
    ? importPath
    : importPath.replace(/\./g, '/');
  const pathParts = pathLike.split('/').filter(Boolean);

  const resolved = suffixResolve(pathParts, normalizedFileList, allFileList);
  return cache(resolved);
};

// ============================================================================
// RUST MODULE RESOLUTION
// ============================================================================

/**
 * Resolve Rust use-path to a file.
 * Handles crate::, super::, self:: prefixes and :: path separators.
 */
function resolveRustImport(
  currentFile: string,
  importPath: string,
  allFiles: Set<string>,
): string | null {
  let rustPath: string;

  if (importPath.startsWith('crate::')) {
    // crate:: resolves from src/ directory (standard Rust layout)
    rustPath = importPath.slice(7).replace(/::/g, '/');

    // Try from src/ (standard layout)
    const fromSrc = tryRustModulePath('src/' + rustPath, allFiles);
    if (fromSrc) return fromSrc;

    // Try from repo root (non-standard)
    const fromRoot = tryRustModulePath(rustPath, allFiles);
    if (fromRoot) return fromRoot;

    return null;
  }

  if (importPath.startsWith('super::')) {
    // super:: = parent directory of current file's module
    const currentDir = currentFile.split('/').slice(0, -1);
    currentDir.pop(); // Go up one level for super::
    rustPath = importPath.slice(7).replace(/::/g, '/');
    const fullPath = [...currentDir, rustPath].join('/');
    return tryRustModulePath(fullPath, allFiles);
  }

  if (importPath.startsWith('self::')) {
    // self:: = current module's directory
    const currentDir = currentFile.split('/').slice(0, -1);
    rustPath = importPath.slice(6).replace(/::/g, '/');
    const fullPath = [...currentDir, rustPath].join('/');
    return tryRustModulePath(fullPath, allFiles);
  }

  // Bare path without prefix (e.g., from a use in a nested module)
  // Convert :: to / and try suffix matching
  if (importPath.includes('::')) {
    rustPath = importPath.replace(/::/g, '/');
    return tryRustModulePath(rustPath, allFiles);
  }

  return null;
}

/**
 * Try to resolve a Rust module path to a file.
 * Tries: path.rs, path/mod.rs, and with the last segment stripped
 * (last segment might be a symbol name, not a module).
 */
function tryRustModulePath(modulePath: string, allFiles: Set<string>): string | null {
  // Try direct: path.rs
  if (allFiles.has(modulePath + '.rs')) return modulePath + '.rs';
  // Try directory: path/mod.rs
  if (allFiles.has(modulePath + '/mod.rs')) return modulePath + '/mod.rs';
  // Try path/lib.rs (for crate root)
  if (allFiles.has(modulePath + '/lib.rs')) return modulePath + '/lib.rs';

  // The last segment might be a symbol (function, struct, etc.), not a module.
  // Strip it and try again.
  const lastSlash = modulePath.lastIndexOf('/');
  if (lastSlash > 0) {
    const parentPath = modulePath.substring(0, lastSlash);
    if (allFiles.has(parentPath + '.rs')) return parentPath + '.rs';
    if (allFiles.has(parentPath + '/mod.rs')) return parentPath + '/mod.rs';
  }

  return null;
}

// ============================================================================
// JAVA MULTI-FILE RESOLUTION
// ============================================================================

/**
 * Resolve a Java wildcard import (com.example.*) to all matching .java files.
 * Returns an array of file paths.
 */
function resolveJavaWildcard(
  importPath: string,
  normalizedFileList: string[],
  allFileList: string[],
): string[] {
  // "com.example.util.*" -> "com/example/util"
  const packagePath = importPath.slice(0, -2).replace(/\./g, '/');
  const packageSuffix = '/' + packagePath + '/';

  const matches: string[] = [];
  for (let i = 0; i < normalizedFileList.length; i++) {
    const normalized = normalizedFileList[i];
    if (normalized.includes(packageSuffix) && normalized.endsWith('.java')) {
      // Ensure the file is directly in the package (not a subdirectory)
      const afterPackage = normalized.substring(normalized.indexOf(packageSuffix) + packageSuffix.length);
      if (!afterPackage.includes('/')) {
        matches.push(allFileList[i]);
      }
    }
  }
  return matches;
}

/**
 * Try to resolve a Java static import by stripping the member name.
 * "com.example.Constants.VALUE" -> resolve "com.example.Constants"
 */
function resolveJavaStaticImport(
  importPath: string,
  normalizedFileList: string[],
  allFileList: string[],
): string | null {
  // Static imports look like: com.example.Constants.VALUE or com.example.Constants.*
  // The last segment is a member name (field/method) if it starts with lowercase or is ALL_CAPS
  const segments = importPath.split('.');
  if (segments.length < 3) return null;

  const lastSeg = segments[segments.length - 1];
  // If last segment is a wildcard or ALL_CAPS constant or starts with lowercase, strip it
  if (lastSeg === '*' || /^[a-z]/.test(lastSeg) || /^[A-Z_]+$/.test(lastSeg)) {
    const classPath = segments.slice(0, -1).join('/');
    const classSuffix = '/' + classPath + '.java';
    for (let i = 0; i < normalizedFileList.length; i++) {
      if (normalizedFileList[i].endsWith(classSuffix) ||
          normalizedFileList[i].toLowerCase().endsWith(classSuffix.toLowerCase())) {
        return allFileList[i];
      }
    }
  }

  return null;
}

// ============================================================================
// GO PACKAGE RESOLUTION
// ============================================================================

/**
 * Resolve a Go internal package import to all .go files in the package directory.
 * Returns an array of file paths.
 */
function resolveGoPackage(
  importPath: string,
  goModule: GoModuleConfig,
  normalizedFileList: string[],
  allFileList: string[],
): string[] {
  if (!importPath.startsWith(goModule.modulePath)) return [];

  // Strip module path to get relative package path
  const relativePkg = importPath.slice(goModule.modulePath.length + 1); // e.g., "internal/auth"
  if (!relativePkg) return [];

  const pkgSuffix = '/' + relativePkg + '/';
  const matches: string[] = [];

  for (let i = 0; i < normalizedFileList.length; i++) {
    const normalized = normalizedFileList[i];
    // File must be directly in the package directory (not a subdirectory)
    if (normalized.includes(pkgSuffix) && normalized.endsWith('.go') && !normalized.endsWith('_test.go')) {
      const afterPkg = normalized.substring(normalized.indexOf(pkgSuffix) + pkgSuffix.length);
      if (!afterPkg.includes('/')) {
        matches.push(allFileList[i]);
      }
    }
  }

  return matches;
}

// ============================================================================
// MAIN IMPORT PROCESSOR
// ============================================================================

export const processImports = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void,
  repoRoot?: string,
) => {
  // Create a Set of all file paths for fast lookup during resolution
  const allFilePaths = new Set(files.map(f => f.path));
  const parser = await loadParser();
  const resolveCache = new Map<string, string | null>();
  const allFileList = files.map(f => f.path);
  // Pre-compute normalized file list once (forward slashes)
  const normalizedFileList = allFileList.map(p => p.replace(/\\/g, '/'));

  // Track import statistics
  let totalImportsFound = 0;
  let totalImportsResolved = 0;

  // Load language-specific configs once before the file loop
  const effectiveRoot = repoRoot || '';
  const tsconfigPaths = await loadTsconfigPaths(effectiveRoot);
  const goModule = await loadGoModulePath(effectiveRoot);

  // Helper: add an IMPORTS edge + update import map
  const addImportEdge = (filePath: string, resolvedPath: string) => {
    const sourceId = generateId('File', filePath);
    const targetId = generateId('File', resolvedPath);
    const relId = generateId('IMPORTS', `${filePath}->${resolvedPath}`);

    totalImportsResolved++;

    graph.addRelationship({
      id: relId,
      sourceId,
      targetId,
      type: 'IMPORTS',
      confidence: 1.0,
      reason: '',
    });

    if (!importMap.has(filePath)) {
      importMap.set(filePath, new Set());
    }
    importMap.get(filePath)!.add(resolvedPath);
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length);
    if (i % 20 === 0) await yieldToEventLoop();

    // 1. Check language support first
    const language = getLanguageFromFilename(file.path);
    if (!language) continue;

    const queryStr = LANGUAGE_QUERIES[language];
    if (!queryStr) continue;

    // 2. ALWAYS load the language before querying (parser is stateful)
    await loadLanguage(language, file.path);

    // 3. Get AST (Try Cache First)
    let tree = astCache.get(file.path);
    let wasReparsed = false;

    if (!tree) {
      try {
        tree = parser.parse(file.content, undefined, { bufferSize: 1024 * 256 });
      } catch (parseError) {
        continue;
      }
      wasReparsed = true;
    }

    let query;
    let matches;
    try {
      const lang = parser.getLanguage();
      query = new Parser.Query(lang, queryStr);
      matches = query.matches(tree.rootNode);
    } catch (queryError: any) {
      if (isDev) {
        console.group(`🔴 Query Error: ${file.path}`);
        console.log('Language:', language);
        console.log('Query (first 200 chars):', queryStr.substring(0, 200) + '...');
        console.log('Error:', queryError?.message || queryError);
        console.log('File content (first 300 chars):', file.content.substring(0, 300));
        console.log('AST root type:', tree.rootNode?.type);
        console.log('AST has errors:', tree.rootNode?.hasError);
        console.groupEnd();
      }

      if (wasReparsed) (tree as any).delete?.();
      continue;
    }

    matches.forEach(match => {
      const captureMap: Record<string, any> = {};
      match.captures.forEach(c => captureMap[c.name] = c.node);

      if (captureMap['import']) {
        const sourceNode = captureMap['import.source'];
        if (!sourceNode) {
          if (isDev) {
            console.log(`⚠️ Import captured but no source node in ${file.path}`);
          }
          return;
        }

        // Clean path (remove quotes and angle brackets for C/C++ includes)
        const rawImportPath = sourceNode.text.replace(/['"<>]/g, '');
        totalImportsFound++;

        // ---- Java: handle wildcards and static imports specially ----
        if (language === SupportedLanguages.Java) {
          if (rawImportPath.endsWith('.*')) {
            const matchedFiles = resolveJavaWildcard(rawImportPath, normalizedFileList, allFileList);
            for (const matchedFile of matchedFiles) {
              addImportEdge(file.path, matchedFile);
            }
            return; // skip single-file resolution
          }

          // Try static import resolution (strip member name)
          const staticResolved = resolveJavaStaticImport(rawImportPath, normalizedFileList, allFileList);
          if (staticResolved) {
            addImportEdge(file.path, staticResolved);
            return;
          }
          // Fall through to normal resolution for regular Java imports
        }

        // ---- Go: handle package-level imports ----
        if (language === SupportedLanguages.Go && goModule && rawImportPath.startsWith(goModule.modulePath)) {
          const pkgFiles = resolveGoPackage(rawImportPath, goModule, normalizedFileList, allFileList);
          if (pkgFiles.length > 0) {
            for (const pkgFile of pkgFiles) {
              addImportEdge(file.path, pkgFile);
            }
            return; // skip single-file resolution
          }
          // Fall through if no files found (package might be external)
        }

        // ---- Standard single-file resolution ----
        const resolvedPath = resolveImportPath(
          file.path,
          rawImportPath,
          allFilePaths,
          allFileList,
          normalizedFileList,
          resolveCache,
          language,
          tsconfigPaths,
        );

        if (resolvedPath) {
          addImportEdge(file.path, resolvedPath);
        }
      }
    });

    // If re-parsed just for this, delete the tree to save memory
    if (wasReparsed) {
      (tree as any).delete?.();
    }
  }

  if (isDev) {
    console.log(`📊 Import processing complete: ${totalImportsResolved}/${totalImportsFound} imports resolved to graph edges`);
  }
};
