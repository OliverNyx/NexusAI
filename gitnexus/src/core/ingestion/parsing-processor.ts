import { KnowledgeGraph, GraphNode, GraphRelationship } from '../graph/types';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { SymbolTable } from './symbol-table';
import { ASTCache } from './ast-cache';
import { getLanguageFromFilename } from './utils';

export type FileProgressCallback = (current: number, total: number, filePath: string) => void;

export const processParsing = async (
  graph: KnowledgeGraph, 
  files: { path: string; content: string }[],
  symbolTable: SymbolTable,
  astCache: ASTCache,
  onFileProgress?: FileProgressCallback
) => {
 
  const parser = await loadParser();
  const total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // Report progress for each file
    onFileProgress?.(i + 1, total, file.path);
    
    const language = getLanguageFromFilename(file.path);

    if (!language) continue;

    await loadLanguage(language, file.path);
    
    // 3. Parse the text content into an AST
    const tree = parser.parse(file.content);
    
    // Store in cache immediately (this might evict an old one)
    astCache.set(file.path, tree);
    
    // 4. Get the specific query string for this language
    const queryString = LANGUAGE_QUERIES[language];
    if (!queryString) {
      continue;
    }

    // 5. Run the query against the AST root node
    // This looks for patterns like (function_declaration)
    let query;
    let matches;
    try {
      query = parser.getLanguage().query(queryString);
      matches = query.matches(tree.rootNode);
    } catch (queryError) {
      console.warn(`Query error for ${file.path}:`, queryError);
      continue;
    }

    // 6. Process every match found
    matches.forEach(match => {
      const captureMap: Record<string, any> = {};
      
      match.captures.forEach(c => {
        captureMap[c.name] = c.node;
      });

      // Skip imports here - they are handled by import-processor.ts
      // which creates proper File -> IMPORTS -> File relationships
      if (captureMap['import']) {
        return;
      }

      // Skip call expressions - they are handled by call-processor.ts
      if (captureMap['call']) {
        return;
      }

      const nameNode = captureMap['name'];
      if (!nameNode) return;

      const nodeName = nameNode.text;
      
      let nodeLabel = 'CodeElement';
      
      if (captureMap['definition.function']) nodeLabel = 'Function';
      else if (captureMap['definition.class']) nodeLabel = 'Class';
      else if (captureMap['definition.interface']) nodeLabel = 'Interface';
      else if (captureMap['definition.method']) nodeLabel = 'Method';

      const nodeId = generateId(nodeLabel, `${file.path}:${nodeName}`);
      
      const node: GraphNode = {
        id: nodeId,
        label: nodeLabel as any,
        properties: {
          name: nodeName,
          filePath: file.path,
          startLine: nameNode.startPosition.row,
          endLine: nameNode.endPosition.row,
          language: language
        }
      };

      graph.addNode(node);

      // Register in Symbol Table (only definitions, not imports)
      symbolTable.add(file.path, nodeName, nodeId, nodeLabel);

      const fileId = generateId('File', file.path);
      
      const relId = generateId('DEFINES', `${fileId}->${nodeId}`);
      
      const relationship: GraphRelationship = {
        id: relId,
        sourceId: fileId,
        targetId: nodeId,
        type: 'DEFINES',
        confidence: 1.0,
        reason: '',
      };

      graph.addRelationship(relationship);
    });
    
    // Don't delete tree here - LRU cache handles cleanup when evicted
  }
};
