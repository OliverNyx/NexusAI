import { NodeLabel } from '../core/graph/types';

// Node colors by type - slightly muted for less visual noise
export const NODE_COLORS: Record<NodeLabel, string> = {
  Project: '#a855f7',    // Purple - prominent
  Package: '#8b5cf6',    // Violet
  Module: '#7c3aed',     // Violet darker
  Folder: '#6366f1',     // Indigo
  File: '#3b82f6',       // Blue
  Class: '#f59e0b',      // Amber - stands out
  Function: '#10b981',   // Emerald
  Method: '#14b8a6',     // Teal
  Variable: '#64748b',   // Slate - muted (less important)
  Interface: '#ec4899',  // Pink
  Enum: '#f97316',       // Orange
  Decorator: '#eab308',  // Yellow
  Import: '#475569',     // Slate darker - very muted
  Type: '#a78bfa',       // Violet light
  CodeElement: '#64748b', // Slate - muted
};

// Node sizes by type - clear visual hierarchy with dramatic size differences
// Structural nodes are MUCH larger to make hierarchy obvious
export const NODE_SIZES: Record<NodeLabel, number> = {
  Project: 20,     // Largest - root of everything
  Package: 16,     // Major structural element
  Module: 13,      // Important container
  Folder: 10,      // Structural - clearly bigger than files
  File: 6,         // Common element - smaller than folders
  Class: 8,        // Important code structure
  Function: 4,     // Common code element - small
  Method: 3,       // Smaller than function
  Variable: 2,     // Tiny - leaf node
  Interface: 7,    // Important type definition
  Enum: 5,         // Type definition
  Decorator: 2,    // Tiny modifier
  Import: 1.5,     // Very small - usually hidden anyway
  Type: 3,         // Type alias - small
  CodeElement: 2,  // Generic small
};

// Labels to show by default (hide imports and variables by default as they clutter)
export const DEFAULT_VISIBLE_LABELS: NodeLabel[] = [
  'Project',
  'Package',
  'Module',
  'Folder',
  'File',
  'Class',
  'Function',
  'Method',
  'Interface',
  'Enum',
  'Type',
];

// All filterable labels
export const FILTERABLE_LABELS: NodeLabel[] = [
  'Folder',
  'File',
  'Class',
  'Function',
  'Method',
  'Variable',
  'Interface',
  'Import',
];
