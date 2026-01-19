/**
 * CSV Generator for KuzuDB Hybrid Schema
 * 
 * Generates separate CSV files for each node table and one relation CSV.
 * This enables efficient bulk loading via COPY FROM for hybrid schema.
 * 
 * RFC 4180 Compliant:
 * - Fields containing commas, double quotes, or newlines are enclosed in double quotes
 * - Double quotes within fields are escaped by doubling them ("")
 * - All fields are consistently quoted for safety with code content
 */

import { KnowledgeGraph, GraphNode, NodeLabel } from '../graph/types';
import { NODE_TABLES, NodeTableName } from './schema';

// ============================================================================
// CSV ESCAPE UTILITIES
// ============================================================================

/**
 * Sanitize string to ensure valid UTF-8
 * Removes or replaces invalid characters that would break CSV parsing
 */
const sanitizeUTF8 = (str: string): string => {
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \t \n \r
    .replace(/[\uD800-\uDFFF]/g, '') // Remove surrogate pairs (invalid standalone)
    .replace(/[\uFFFE\uFFFF]/g, ''); // Remove BOM and special chars
};

/**
 * RFC 4180 compliant CSV field escaping
 * ALWAYS wraps in double quotes for safety with code content
 */
const escapeCSVField = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) {
    return '""';
  }
  let str = String(value);
  str = sanitizeUTF8(str);
  return `"${str.replace(/"/g, '""')}"`;
};

/**
 * Escape a numeric value (no quotes needed for numbers)
 */
const escapeCSVNumber = (value: number | undefined | null, defaultValue: number = -1): string => {
  if (value === undefined || value === null) {
    return String(defaultValue);
  }
  return String(value);
};

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

/**
 * Check if content looks like binary data
 */
const isBinaryContent = (content: string): boolean => {
  if (!content || content.length === 0) return false;
  const sample = content.slice(0, 1000);
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if ((code < 9) || (code > 13 && code < 32) || code === 127) {
      nonPrintable++;
    }
  }
  return (nonPrintable / sample.length) > 0.1;
};

/**
 * Extract code content for a node
 */
const extractContent = (
  node: GraphNode,
  fileContents: Map<string, string>
): string => {
  const filePath = node.properties.filePath;
  const content = fileContents.get(filePath);
  
  if (!content) return '';
  if (node.label === 'Folder') return '';
  if (isBinaryContent(content)) return '[Binary file - content not stored]';
  
  // For File nodes, return content (limited)
  if (node.label === 'File') {
    const MAX_FILE_CONTENT = 10000;
    if (content.length > MAX_FILE_CONTENT) {
      return content.slice(0, MAX_FILE_CONTENT) + '\n... [truncated]';
    }
    return content;
  }
  
  // For code elements, extract the relevant lines with context
  const startLine = node.properties.startLine;
  const endLine = node.properties.endLine;
  
  if (startLine === undefined || endLine === undefined) return '';
  
  const lines = content.split('\n');
  const contextLines = 2;
  const start = Math.max(0, startLine - contextLines);
  const end = Math.min(lines.length - 1, endLine + contextLines);
  
  const snippet = lines.slice(start, end + 1).join('\n');
  const MAX_SNIPPET = 5000;
  if (snippet.length > MAX_SNIPPET) {
    return snippet.slice(0, MAX_SNIPPET) + '\n... [truncated]';
  }
  return snippet;
};

// ============================================================================
// CSV GENERATION RESULT TYPE
// ============================================================================

export interface CSVData {
  nodes: Map<NodeTableName, string>;
  relCSV: string;  // Single relation CSV with from,to,type,confidence,reason columns
}

// ============================================================================
// NODE CSV GENERATORS
// ============================================================================

/**
 * Generate CSV for File nodes
 * Headers: id,name,filePath,content
 */
const generateFileCSV = (nodes: GraphNode[], fileContents: Map<string, string>): string => {
  const headers = ['id', 'name', 'filePath', 'content'];
  const rows: string[] = [headers.join(',')];
  
  for (const node of nodes) {
    if (node.label !== 'File') continue;
    const content = extractContent(node, fileContents);
    rows.push([
      escapeCSVField(node.id),
      escapeCSVField(node.properties.name || ''),
      escapeCSVField(node.properties.filePath || ''),
      escapeCSVField(content),
    ].join(','));
  }
  
  return rows.join('\n');
};

/**
 * Generate CSV for Folder nodes
 * Headers: id,name,filePath
 */
const generateFolderCSV = (nodes: GraphNode[]): string => {
  const headers = ['id', 'name', 'filePath'];
  const rows: string[] = [headers.join(',')];
  
  for (const node of nodes) {
    if (node.label !== 'Folder') continue;
    rows.push([
      escapeCSVField(node.id),
      escapeCSVField(node.properties.name || ''),
      escapeCSVField(node.properties.filePath || ''),
    ].join(','));
  }
  
  return rows.join('\n');
};

/**
 * Generate CSV for code element nodes (Function, Class, Interface, Method, CodeElement)
 * Headers: id,name,filePath,startLine,endLine,content
 */
const generateCodeElementCSV = (
  nodes: GraphNode[],
  label: NodeLabel,
  fileContents: Map<string, string>
): string => {
  const headers = ['id', 'name', 'filePath', 'startLine', 'endLine', 'content'];
  const rows: string[] = [headers.join(',')];
  
  for (const node of nodes) {
    if (node.label !== label) continue;
    const content = extractContent(node, fileContents);
    rows.push([
      escapeCSVField(node.id),
      escapeCSVField(node.properties.name || ''),
      escapeCSVField(node.properties.filePath || ''),
      escapeCSVNumber(node.properties.startLine, -1),
      escapeCSVNumber(node.properties.endLine, -1),
      escapeCSVField(content),
    ].join(','));
  }
  
  return rows.join('\n');
};

// ============================================================================
// RELATIONSHIP CSV GENERATOR (Single Table)
// ============================================================================

/**
 * Generate CSV for the single CodeRelation table
 * Headers: from,to,type,confidence,reason
 * 
 * confidence: 0-1 score for CALLS edges (how sure are we about the target?)
 * reason: 'import-resolved' | 'same-file' | 'fuzzy-global' (or empty for non-CALLS)
 */
const generateRelationCSV = (graph: KnowledgeGraph): string => {
  const headers = ['from', 'to', 'type', 'confidence', 'reason'];
  const rows: string[] = [headers.join(',')];
  
  for (const rel of graph.relationships) {
    rows.push([
      escapeCSVField(rel.sourceId),
      escapeCSVField(rel.targetId),
      escapeCSVField(rel.type),
      escapeCSVNumber(rel.confidence, 1.0),
      escapeCSVField(rel.reason),
    ].join(','));
  }
  
  return rows.join('\n');
};

// ============================================================================
// MAIN CSV GENERATION FUNCTION
// ============================================================================

/**
 * Generate all CSV data for hybrid schema bulk loading
 * Returns Maps of node table name -> CSV content, and single relation CSV
 */
export const generateAllCSVs = (
  graph: KnowledgeGraph,
  fileContents: Map<string, string>
): CSVData => {
  const nodes = Array.from(graph.nodes);
  
  // Generate node CSVs
  const nodeCSVs = new Map<NodeTableName, string>();
  nodeCSVs.set('File', generateFileCSV(nodes, fileContents));
  nodeCSVs.set('Folder', generateFolderCSV(nodes));
  nodeCSVs.set('Function', generateCodeElementCSV(nodes, 'Function', fileContents));
  nodeCSVs.set('Class', generateCodeElementCSV(nodes, 'Class', fileContents));
  nodeCSVs.set('Interface', generateCodeElementCSV(nodes, 'Interface', fileContents));
  nodeCSVs.set('Method', generateCodeElementCSV(nodes, 'Method', fileContents));
  nodeCSVs.set('CodeElement', generateCodeElementCSV(nodes, 'CodeElement', fileContents));
  
  // Generate single relation CSV
  const relCSV = generateRelationCSV(graph);
  
  return { nodes: nodeCSVs, relCSV };
};

