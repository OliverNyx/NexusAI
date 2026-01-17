export type NodeLabel =
  | 'Project'
  | 'Package'
  | 'Module'
  | 'Folder'
  | 'File'
  | 'Class'
  | 'Function'
  | 'Method'
  | 'Variable'
  | 'Interface'
  | 'Enum'
  | 'Decorator'
  | 'Import'
  | 'Type'
  | 'CodeElement';


export type NodeProperties = {
  name: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
  language?: string,
  isExported?: boolean,
}

export type RelationshipType = 
  | 'CONTAINS' 
  | 'CALLS' 
  | 'INHERITS' 
  | 'OVERRIDES' 
  | 'IMPORTS'
  | 'USES'
  | 'DEFINES'
  | 'DECORATES'
  | 'IMPLEMENTS'
  | 'EXTENDS'

export interface GraphNode {
  id:  string,
  label: NodeLabel,
  properties: NodeProperties,  
}

export interface GraphRelationship {
  id: string,
  sourceId: string,
  targetId: string,
  type: RelationshipType,
}

export interface KnowledgeGraph {
  nodes: GraphNode[],
  relationships: GraphRelationship[],
  nodeCount: number,
  relationshipCount: number,
  addNode: (node: GraphNode) => void,
  addRelationship: (relationship: GraphRelationship) => void,
}