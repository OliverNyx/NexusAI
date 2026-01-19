import { KnowledgeGraph } from '../graph/types';
import { ASTCache } from './ast-cache';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { getLanguageFromFilename } from './utils';

// Type: Map<FilePath, Set<ResolvedFilePath>>
// Stores all files that a given file imports from
export type ImportMap = Map<string, Set<string>>;

export const createImportMap = (): ImportMap => new Map();

// Helper: Resolve relative paths (e.g. "../utils" -> "src/lib/utils.ts")
const resolveImportPath = (
  currentFile: string, 
  importPath: string, 
  allFiles: Set<string>
): string | null => {
  // 1. Handle non-relative imports (libraries like 'react')
  if (!importPath.startsWith('.')) return null; // We skip node_modules for now

  // 2. Resolve '..' and '.'
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

  // 3. Try extensions (prioritize .tsx for React projects)
  const extensions = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
  
  for (const ext of extensions) {
    const candidate = basePath + ext;
    if (allFiles.has(candidate)) return candidate;
  }

  return null;
};

export const processImports = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void
) => {
  // Create a Set of all file paths for fast lookup during resolution
  const allFilePaths = new Set(files.map(f => f.path));
  const parser = await loadParser();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i + 1, files.length);

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
      // Cache Miss: Re-parse (slower, but necessary if evicted)
      tree = parser.parse(file.content);
      wasReparsed = true;
    }

    let query;
    let matches;
    try {
      query = parser.getLanguage().query(queryStr);
      matches = query.matches(tree.rootNode);
    } catch (queryError: any) {
      // Detailed debug logging for query failures
      console.group(`🔴 Query Error: ${file.path}`);
      console.log('Language:', language);
      console.log('Query (first 200 chars):', queryStr.substring(0, 200) + '...');
      console.log('Error:', queryError?.message || queryError);
      console.log('File content (first 300 chars):', file.content.substring(0, 300));
      console.log('AST root type:', tree.rootNode?.type);
      console.log('AST has errors:', tree.rootNode?.hasError);
      console.groupEnd();
      
      if (wasReparsed) tree.delete();
      continue;
    }

    matches.forEach(match => {
      const captureMap: Record<string, any> = {};
      match.captures.forEach(c => captureMap[c.name] = c.node);

      if (captureMap['import']) {
        const sourceNode = captureMap['import.source'];
        if (!sourceNode) return;

        // Clean path (remove quotes)
        const rawImportPath = sourceNode.text.replace(/['"]/g, '');
        
        // Resolve to actual file in the system
        const resolvedPath = resolveImportPath(file.path, rawImportPath, allFilePaths);

        if (resolvedPath) {
          // A. Update Graph (File -> IMPORTS -> File)
          const sourceId = generateId('File', file.path);
          const targetId = generateId('File', resolvedPath);
          const relId = generateId('IMPORTS', `${file.path}->${resolvedPath}`);

          graph.addRelationship({
            id: relId,
            sourceId,
            targetId,
            type: 'IMPORTS',
            confidence: 1.0,
            reason: '',
          });

          // B. Update Import Map (For Pass 4)
          // Store all resolved import paths for this file
          if (!importMap.has(file.path)) {
            importMap.set(file.path, new Set());
          }
          importMap.get(file.path)!.add(resolvedPath);
        }
      }
    });

    // If re-parsed just for this, delete the tree to save memory
    if (wasReparsed) {
      tree.delete();
    }
  }
};


