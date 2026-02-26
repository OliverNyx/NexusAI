import { KnowledgeGraph } from '../graph/types.js';
import { ASTCache } from './ast-cache.js';
import { SymbolTable } from './symbol-table.js';
import { ImportMap } from './import-processor.js';
import Parser from 'tree-sitter';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader.js';
import { LANGUAGE_QUERIES } from './tree-sitter-queries.js';
import { generateId } from '../../lib/utils.js';
import { getLanguageFromFilename, yieldToEventLoop } from './utils.js';
import type { ExtractedCall } from './workers/parse-worker.js';

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
  // Java
  'method_declaration',
  'constructor_declaration',
  // C/C++
  // 'function_definition' already included above
  // Go
  // 'method_declaration' already included from Java
  // C#
  'local_function_statement',
  // Rust
  'function_item',
  'impl_item', // Methods inside impl blocks
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
      let label = 'Function';
      
      // Different node types have different name locations
      if (current.type === 'function_declaration' || 
          current.type === 'function_definition' ||
          current.type === 'async_function_declaration' ||
          current.type === 'generator_function_declaration' ||
          current.type === 'function_item') { // Rust function
        // Named function: function foo() {}
        const nameNode = current.childForFieldName?.('name') || 
                         current.children?.find((c: any) => c.type === 'identifier' || c.type === 'property_identifier');
        funcName = nameNode?.text;
      } else if (current.type === 'impl_item') {
        // Rust method inside impl block: wrapper around function_item or const_item
        // We need to look inside for the function_item
        const funcItem = current.children?.find((c: any) => c.type === 'function_item');
        if (funcItem) {
           const nameNode = funcItem.childForFieldName?.('name') || 
                            funcItem.children?.find((c: any) => c.type === 'identifier');
           funcName = nameNode?.text;
           label = 'Method';
        }
      } else if (current.type === 'method_definition') {
        // Method: foo() {} inside class (JS/TS)
        const nameNode = current.childForFieldName?.('name') ||
                         current.children?.find((c: any) => c.type === 'property_identifier');
        funcName = nameNode?.text;
        label = 'Method';
      } else if (current.type === 'method_declaration') {
        // Java method: public void foo() {}
        const nameNode = current.childForFieldName?.('name') ||
                         current.children?.find((c: any) => c.type === 'identifier');
        funcName = nameNode?.text;
        label = 'Method';
      } else if (current.type === 'constructor_declaration') {
        // Java constructor: public ClassName() {}
        const nameNode = current.childForFieldName?.('name') ||
                         current.children?.find((c: any) => c.type === 'identifier');
        funcName = nameNode?.text;
        label = 'Method'; // Treat constructors as methods for process detection
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
        // Try exact match first
        const nodeId = symbolTable.lookupExact(filePath, funcName);
        if (nodeId) return nodeId;
        
        // Try construct ID manually if lookup fails (common for non-exported internal functions)
        // Format should match what parsing-processor generates: "Function:path/to/file:funcName"
        // Check if we already have a node with this ID in the symbol table to be safe
        const generatedId = generateId(label, `${filePath}:${funcName}`);
        
        // Ideally we should verify this ID exists, but strictly speaking if we are inside it,
        // it SHOULD exist. Returning it is better than falling back to File.
        return generatedId;
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
      // Cache Miss: Re-parse
      // Use larger bufferSize for files > 32KB
      try {
        tree = parser.parse(file.content, undefined, { bufferSize: 1024 * 256 });
      } catch (parseError) {
        // Skip files that can't be parsed
        continue;
      }
      wasReparsed = true;
      // Cache re-parsed tree so heritage phase gets hits
      astCache.set(file.path, tree);
    }

    let query;
    let matches;
    try {
      const language = parser.getLanguage();
      query = new Parser.Query(language, queryStr);
      matches = query.matches(tree.rootNode);
    } catch (queryError) {
      console.warn(`Query error for ${file.path}:`, queryError);
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

      // 4. Resolve the target using priority strategy (returns confidence)
      const resolved = resolveCallTarget(
        calledName,
        file.path,
        symbolTable,
        importMap
      );

      if (!resolved) return;

      // 5. Find the enclosing function (caller)
      const callNode = captureMap['call'];
      const enclosingFuncId = findEnclosingFunction(callNode, file.path, symbolTable);
      
      // Use enclosing function as source, fallback to file for top-level calls
      const sourceId = enclosingFuncId || generateId('File', file.path);
      
      const relId = generateId('CALLS', `${sourceId}:${calledName}->${resolved.nodeId}`);

      graph.addRelationship({
        id: relId,
        sourceId,
        targetId: resolved.nodeId,
        type: 'CALLS',
        confidence: resolved.confidence,
        reason: resolved.reason,
      });
    });

    // Tree is now owned by the LRU cache — no manual delete needed
  }
};

/**
 * Resolution result with confidence scoring
 */
interface ResolveResult {
  nodeId: string;
  confidence: number;  // 0-1: how sure are we?
  reason: string;      // 'import-resolved' | 'same-file' | 'fuzzy-global'
}

/**
 * Resolve a function call to its target node ID using priority strategy:
 * A. Check imported files first (highest confidence)
 * B. Check local file definitions
 * C. Fuzzy global search (lowest confidence)
 * 
 * Returns confidence score so agents know what to trust.
 */
const resolveCallTarget = (
  calledName: string,
  currentFile: string,
  symbolTable: SymbolTable,
  importMap: ImportMap
): ResolveResult | null => {
  // Strategy B first (cheapest — single map lookup): Check local file
  const localNodeId = symbolTable.lookupExact(currentFile, calledName);
  if (localNodeId) {
    return { nodeId: localNodeId, confidence: 0.85, reason: 'same-file' };
  }

  // Strategy A: Check if any definition of calledName is in an imported file
  // Reversed: instead of iterating all imports and checking each, get all definitions
  // and check if any is imported. O(definitions) instead of O(imports).
  const allDefs = symbolTable.lookupFuzzy(calledName);
  if (allDefs.length > 0) {
    const importedFiles = importMap.get(currentFile);
    if (importedFiles) {
      for (const def of allDefs) {
        if (importedFiles.has(def.filePath)) {
          return { nodeId: def.nodeId, confidence: 0.9, reason: 'import-resolved' };
        }
      }
    }

    // Strategy C: Fuzzy global (no import match found)
    const confidence = allDefs.length === 1 ? 0.5 : 0.3;
    return { nodeId: allDefs[0].nodeId, confidence, reason: 'fuzzy-global' };
  }

  return null;
};

/**
 * Filter out common built-in functions and noise
 * that shouldn't be tracked as calls
 */
/** Pre-built set (module-level singleton) to avoid re-creating per call */
const BUILT_IN_NAMES = new Set([
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
  // C/C++ standard library and common kernel helpers
  'printf', 'fprintf', 'sprintf', 'snprintf', 'vprintf', 'vfprintf', 'vsprintf', 'vsnprintf',
  'scanf', 'fscanf', 'sscanf',
  'malloc', 'calloc', 'realloc', 'free', 'memcpy', 'memmove', 'memset', 'memcmp',
  'strlen', 'strcpy', 'strncpy', 'strcat', 'strncat', 'strcmp', 'strncmp', 'strstr', 'strchr', 'strrchr',
  'atoi', 'atol', 'atof', 'strtol', 'strtoul', 'strtoll', 'strtoull', 'strtod',
  'sizeof', 'offsetof', 'typeof',
  'assert', 'abort', 'exit', '_exit',
  'fopen', 'fclose', 'fread', 'fwrite', 'fseek', 'ftell', 'rewind', 'fflush', 'fgets', 'fputs',
  // Linux kernel common macros/helpers (not real call targets)
  'likely', 'unlikely', 'BUG', 'BUG_ON', 'WARN', 'WARN_ON', 'WARN_ONCE',
  'IS_ERR', 'PTR_ERR', 'ERR_PTR', 'IS_ERR_OR_NULL',
  'ARRAY_SIZE', 'container_of', 'list_for_each_entry', 'list_for_each_entry_safe',
  'min', 'max', 'clamp', 'abs', 'swap',
  'pr_info', 'pr_warn', 'pr_err', 'pr_debug', 'pr_notice', 'pr_crit', 'pr_emerg',
  'printk', 'dev_info', 'dev_warn', 'dev_err', 'dev_dbg',
  'GFP_KERNEL', 'GFP_ATOMIC',
  'spin_lock', 'spin_unlock', 'spin_lock_irqsave', 'spin_unlock_irqrestore',
  'mutex_lock', 'mutex_unlock', 'mutex_init',
  'kfree', 'kmalloc', 'kzalloc', 'kcalloc', 'krealloc', 'kvmalloc', 'kvfree',
  'get', 'put',
]);

const isBuiltInOrNoise = (name: string): boolean => BUILT_IN_NAMES.has(name);

/**
 * Fast path: resolve pre-extracted call sites from workers.
 * No AST parsing — workers already extracted calledName + sourceId.
 * This function only does symbol table lookups + graph mutations.
 */
export const processCallsFromExtracted = async (
  graph: KnowledgeGraph,
  extractedCalls: ExtractedCall[],
  symbolTable: SymbolTable,
  importMap: ImportMap,
  onProgress?: (current: number, total: number) => void
) => {
  // Group by file for progress reporting
  const byFile = new Map<string, ExtractedCall[]>();
  for (const call of extractedCalls) {
    let list = byFile.get(call.filePath);
    if (!list) {
      list = [];
      byFile.set(call.filePath, list);
    }
    list.push(call);
  }

  const totalFiles = byFile.size;
  let filesProcessed = 0;

  for (const [_filePath, calls] of byFile) {
    filesProcessed++;
    if (filesProcessed % 100 === 0) {
      onProgress?.(filesProcessed, totalFiles);
      await yieldToEventLoop();
    }

    for (const call of calls) {
      const resolved = resolveCallTarget(
        call.calledName,
        call.filePath,
        symbolTable,
        importMap
      );
      if (!resolved) continue;

      const relId = generateId('CALLS', `${call.sourceId}:${call.calledName}->${resolved.nodeId}`);
      graph.addRelationship({
        id: relId,
        sourceId: call.sourceId,
        targetId: resolved.nodeId,
        type: 'CALLS',
        confidence: resolved.confidence,
        reason: resolved.reason,
      });
    }
  }

  onProgress?.(totalFiles, totalFiles);
};
