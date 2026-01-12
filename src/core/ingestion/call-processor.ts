import { KnowledgeGraph } from '../graph/types';
import { ASTCache } from './ast-cache';
import { SymbolTable } from './symbol-table';
import { ImportMap } from './import-processor';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { getLanguageFromFilename } from './utils';

/**
 * Node types that represent function/method definitions across languages.
 * Used to find the enclosing function for a call site.
 */
const FUNCTION_NODE_TYPES = new Set([
  // TypeScript/JavaScript
  'function_declaration',
  'arrow_function',
  'function_expression',
  'method_definition',
  'generator_function_declaration',
  // Python
  'function_definition',
  // Common async variants
  'async_function_declaration',
  'async_arrow_function',
]);

/**
 * Walk up the AST from a node to find the enclosing function/method.
 * Returns null if the call is at module/file level (top-level code).
 */
const findEnclosingFunction = (
  node: any,
  filePath: string,
  symbolTable: SymbolTable
): string | null => {
  let current = node.parent;
  
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) {
      // Found enclosing function - try to get its name
      let funcName: string | null = null;
      
      // Different node types have different name locations
      if (current.type === 'function_declaration' || 
          current.type === 'function_definition' ||
          current.type === 'async_function_declaration' ||
          current.type === 'generator_function_declaration') {
        // Named function: function foo() {}
        const nameNode = current.childForFieldName?.('name') || 
                         current.children?.find((c: any) => c.type === 'identifier' || c.type === 'property_identifier');
        funcName = nameNode?.text;
      } else if (current.type === 'method_definition') {
        // Method: foo() {} inside class
        const nameNode = current.childForFieldName?.('name') ||
                         current.children?.find((c: any) => c.type === 'property_identifier');
        funcName = nameNode?.text;
      } else if (current.type === 'arrow_function' || current.type === 'function_expression') {
        // Arrow/expression: const foo = () => {} - check parent variable declarator
        const parent = current.parent;
        if (parent?.type === 'variable_declarator') {
          const nameNode = parent.childForFieldName?.('name') ||
                           parent.children?.find((c: any) => c.type === 'identifier');
          funcName = nameNode?.text;
        }
      }
      
      if (funcName) {
        // Look up the function in symbol table to get its node ID
        const nodeId = symbolTable.lookupExact(filePath, funcName);
        if (nodeId) return nodeId;
        
        // Fallback: generate ID based on name and file
        return generateId('Function', `${filePath}:${funcName}`);
      }
      
      // Couldn't determine function name - try parent (might be nested)
    }
    current = current.parent;
  }
  
  return null; // Top-level call (not inside any function)
};

export const processCalls = async (
  graph: KnowledgeGraph,
  files: { path: string; content: string }[],
  astCache: ASTCache,
  symbolTable: SymbolTable,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void
) => {
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
      // Cache Miss: Re-parse
      tree = parser.parse(file.content);
      wasReparsed = true;
    }

    let query;
    let matches;
    try {
      query = parser.getLanguage().query(queryStr);
      matches = query.matches(tree.rootNode);
    } catch (queryError) {
      console.warn(`Query error for ${file.path}:`, queryError);
      if (wasReparsed) tree.delete();
      continue;
    }

    // 3. Process each call match
    matches.forEach(match => {
      const captureMap: Record<string, any> = {};
      match.captures.forEach(c => captureMap[c.name] = c.node);

      // Only process @call captures
      if (!captureMap['call']) return;

      const nameNode = captureMap['call.name'];
      if (!nameNode) return;

      const calledName = nameNode.text;

      // Skip common built-ins and noise
      if (isBuiltInOrNoise(calledName)) return;

      // 4. Resolve the target using priority strategy
      const targetNodeId = resolveCallTarget(
        calledName,
        file.path,
        symbolTable,
        importMap
      );

      if (!targetNodeId) return;

      // 5. Find the enclosing function (caller)
      const callNode = captureMap['call'];
      const enclosingFuncId = findEnclosingFunction(callNode, file.path, symbolTable);
      
      // Use enclosing function as source, fallback to file for top-level calls
      const sourceId = enclosingFuncId || generateId('File', file.path);
      
      const relId = generateId('CALLS', `${sourceId}:${calledName}->${targetNodeId}`);

      graph.addRelationship({
        id: relId,
        sourceId,
        targetId: targetNodeId,
        type: 'CALLS'
      });
    });

    // Cleanup if re-parsed
    if (wasReparsed) {
      tree.delete();
    }
  }
};

/**
 * Resolve a function call to its target node ID using priority strategy:
 * A. Check imported files first (highest confidence)
 * B. Check local file definitions
 * C. Fuzzy global search (lowest confidence)
 */
const resolveCallTarget = (
  calledName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap
): string | null => {
  // Strategy A: Check imported files
  const importedFiles = importMap.get(currentFile);
  if (importedFiles) {
    for (const importedFile of importedFiles) {
      const nodeId = symbolTable.lookupExact(importedFile, calledName);
      if (nodeId) return nodeId;
    }
  }

  // Strategy B: Check local file (same file definition)
  const localNodeId = symbolTable.lookupExact(currentFile, calledName);
  if (localNodeId) return localNodeId;

  // Strategy C: Fuzzy global search (pick first match)
  const fuzzyMatches = symbolTable.lookupFuzzy(calledName);
  if (fuzzyMatches.length > 0) {
    return fuzzyMatches[0].nodeId;
  }

  return null;
};

/**
 * Filter out common built-in functions and noise
 * that shouldn't be tracked as calls
 */
const isBuiltInOrNoise = (name: string): boolean => {
  const builtIns = new Set([
    // JavaScript/TypeScript built-ins
    'console', 'log', 'warn', 'error', 'info', 'debug',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
    'JSON', 'parse', 'stringify',
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
    'Map', 'Set', 'WeakMap', 'WeakSet',
    'Promise', 'resolve', 'reject', 'then', 'catch', 'finally',
    'Math', 'Date', 'RegExp', 'Error',
    'require', 'import', 'export',
    'fetch', 'Response', 'Request',
    // React hooks and common functions
    'useState', 'useEffect', 'useCallback', 'useMemo', 'useRef', 'useContext',
    'useReducer', 'useLayoutEffect', 'useImperativeHandle', 'useDebugValue',
    'createElement', 'createContext', 'createRef', 'forwardRef', 'memo', 'lazy',
    // Common array/object methods
    'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every',
    'includes', 'indexOf', 'slice', 'splice', 'concat', 'join', 'split',
    'push', 'pop', 'shift', 'unshift', 'sort', 'reverse',
    'keys', 'values', 'entries', 'assign', 'freeze', 'seal',
    'hasOwnProperty', 'toString', 'valueOf',
    // Python built-ins
    'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
    'open', 'read', 'write', 'close', 'append', 'extend', 'update',
    'super', 'type', 'isinstance', 'issubclass', 'getattr', 'setattr', 'hasattr',
    'enumerate', 'zip', 'sorted', 'reversed', 'min', 'max', 'sum', 'abs',
  ]);

  return builtIns.has(name);
};

