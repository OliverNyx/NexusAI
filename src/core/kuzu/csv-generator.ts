/**
 * CSV Generator for KuzuDB
 * 
 * Converts our in-memory KnowledgeGraph into CSV format
 * for bulk loading into KuzuDB.
 * 
 * RFC 4180 Compliant:
 * - Fields containing commas, double quotes, or newlines are enclosed in double quotes
 * - Double quotes within fields are escaped by doubling them ("")
 * - All fields are consistently quoted for safety with code content
 */

import { KnowledgeGraph, GraphNode } from '../graph/types';

/**
 * Sanitize string to ensure valid UTF-8
 * Removes or replaces invalid characters that would break CSV parsing
 */
const sanitizeUTF8 = (str: string): string => {
  // Remove null bytes and other control characters (except newline, tab, carriage return)
  // Also remove surrogate pairs and other problematic Unicode
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control chars except \t \n \r
    .replace(/[\uD800-\uDFFF]/g, '') // Remove surrogate pairs (invalid standalone)
    .replace(/[\uFFFE\uFFFF]/g, ''); // Remove BOM and special chars
};

/**
 * RFC 4180 compliant CSV field escaping
 * ALWAYS wraps in double quotes for safety with code content
 * Escapes internal double quotes by doubling them
 * Sanitizes to valid UTF-8
 */
const escapeCSVField = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) {
    return '""'; // Empty quoted string
  }
  
  let str = String(value);
  
  // Sanitize to valid UTF-8
  str = sanitizeUTF8(str);
  
  // Always quote and escape double quotes by doubling them
  // This is the safest approach for code content which may contain anything
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

/**
 * Check if content looks like binary data
 * Binary files have high ratio of non-printable characters
 */
const isBinaryContent = (content: string): boolean => {
  if (!content || content.length === 0) return false;
  
  // Check first 1000 chars for binary indicators
  const sample = content.slice(0, 1000);
  
  // Count non-printable characters (excluding common whitespace)
  let nonPrintable = 0;
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    // Non-printable: 0-8, 14-31, 127, or high bytes that aren't valid UTF-8 sequences
    if ((code < 9) || (code > 13 && code < 32) || code === 127) {
      nonPrintable++;
    }
  }
  
  // If more than 10% non-printable, likely binary
  return (nonPrintable / sample.length) > 0.1;
};

/**
 * Extract code content for a node
 * - For File nodes: return entire file content (limited to avoid huge CSVs)
 * - For Function/Class/Method nodes: extract lines from startLine to endLine
 * - For Folder nodes: empty string
 * - For binary files: return placeholder
 */
const extractContent = (
  node: GraphNode,
  fileContents: Map<string, string>
): string => {
  const filePath = node.properties.filePath;
  const content = fileContents.get(filePath);
  
  if (!content) {
    return '';
  }
  
  // For Folder nodes, no content
  if (node.label === 'Folder') {
    return '';
  }
  
  // Check for binary content
  if (isBinaryContent(content)) {
    return '[Binary file - content not stored]';
  }
  
  // For File nodes, return content (limited to prevent huge CSVs)
  if (node.label === 'File') {
    // Limit file content to 10KB to avoid memory issues
    const MAX_FILE_CONTENT = 10000;
    if (content.length > MAX_FILE_CONTENT) {
      return content.slice(0, MAX_FILE_CONTENT) + '\n... [truncated]';
    }
    return content;
  }
  
  // For code elements (Function, Class, Method, etc.), extract the relevant lines
  const startLine = node.properties.startLine;
  const endLine = node.properties.endLine;
  
  if (startLine === undefined || endLine === undefined) {
    return '';
  }
  
  const lines = content.split('\n');
  
  // Extract with some context
  const contextLines = 2;
  const start = Math.max(0, startLine - contextLines);
  const end = Math.min(lines.length - 1, endLine + contextLines);
  
  const snippet = lines.slice(start, end + 1).join('\n');
  
  // Limit snippet size
  const MAX_SNIPPET = 5000;
  if (snippet.length > MAX_SNIPPET) {
    return snippet.slice(0, MAX_SNIPPET) + '\n... [truncated]';
  }
  
  return snippet;
};

/**
 * Generate CSV for nodes
 * Headers: id,label,name,filePath,startLine,endLine,content
 * 
 * All string fields are quoted for RFC 4180 compliance
 * Note: embedding column is NOT included in CSV - it's populated later via UPDATE queries
 * by the embedding pipeline after bulk load completes
 */
export const generateNodeCSV = (
  graph: KnowledgeGraph,
  fileContents: Map<string, string>
): string => {
  const headers = ['id', 'label', 'name', 'filePath', 'startLine', 'endLine', 'content'];
  const rows: string[] = [headers.join(',')];
  
  for (const node of graph.nodes) {
    const content = extractContent(node, fileContents);
    
    const row = [
      escapeCSVField(node.id),
      escapeCSVField(node.label),
      escapeCSVField(node.properties.name || ''),
      escapeCSVField(node.properties.filePath || ''),
      escapeCSVNumber(node.properties.startLine, -1),
      escapeCSVNumber(node.properties.endLine, -1),
      escapeCSVField(content),
    ];
    
    rows.push(row.join(','));
  }
  
  return rows.join('\n');
};

/**
 * Generate CSV for edges/relationships
 * Headers: from,to,type
 * 
 * Note: Kuzu expects 'from' and 'to' columns for relationship tables
 */
export const generateEdgeCSV = (graph: KnowledgeGraph): string => {
  const headers = ['from', 'to', 'type'];
  const rows: string[] = [headers.join(',')];
  
  for (const rel of graph.relationships) {
    const row = [
      escapeCSVField(rel.sourceId),
      escapeCSVField(rel.targetId),
      escapeCSVField(rel.type),
    ];
    
    rows.push(row.join(','));
  }
  
  return rows.join('\n');
};
