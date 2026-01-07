import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Code, PanelLeftClose, PanelLeft, Trash2, X, Target } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useAppState } from '../hooks/useAppState';
import { NODE_COLORS } from '../lib/constants';

// Match the code theme used elsewhere in the app
const customTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: '#0a0a10',
    margin: 0,
    padding: '12px 0',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  },
};

export interface CodeReferencesPanelProps {
  onFocusNode: (nodeId: string) => void;
}

export const CodeReferencesPanel = ({ onFocusNode }: CodeReferencesPanelProps) => {
  const {
    graph,
    fileContents,
    selectedNode,
    codeReferences,
    removeCodeReference,
    clearCodeReferences,
    setSelectedNode,
  } = useAppState();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = window.localStorage.getItem('gitnexus.codePanelWidth');
      const parsed = saved ? parseInt(saved, 10) : NaN;
      if (!Number.isFinite(parsed)) return 560; // increased default
      return Math.max(420, Math.min(parsed, 900));
    } catch {
      return 560;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem('gitnexus.codePanelWidth', String(panelWidth));
    } catch {
      // ignore
    }
  }, [panelWidth]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      const delta = ev.clientX - state.startX;
      const next = Math.max(420, Math.min(state.startWidth + delta, 900));
      setPanelWidth(next);
    };

    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth]);

  const aiReferences = useMemo(() => codeReferences.filter(r => r.source === 'ai'), [codeReferences]);

  const refsWithSnippets = useMemo(() => {
    return aiReferences.map((ref) => {
      const content = fileContents.get(ref.filePath);
      if (!content) {
        return { ref, content: null as string | null, start: 0, end: 0, highlightStart: 0, highlightEnd: 0, totalLines: 0 };
      }

      const lines = content.split('\n');
      const totalLines = lines.length;

      const startLine = ref.startLine ?? 0;
      const endLine = ref.endLine ?? startLine;

      const contextBefore = 3;
      const contextAfter = 20;
      const start = Math.max(0, startLine - contextBefore);
      const end = Math.min(totalLines - 1, endLine + contextAfter);

      return {
        ref,
        content: lines.slice(start, end + 1).join('\n'),
        start,
        end,
        highlightStart: Math.max(0, startLine - start),
        highlightEnd: Math.max(0, endLine - start),
        totalLines,
      };
    });
  }, [aiReferences, fileContents]);

  const selectedFilePath = selectedNode?.properties?.filePath;
  const selectedFileContent = selectedFilePath ? fileContents.get(selectedFilePath) : undefined;
  const selectedIsFile = selectedNode?.label === 'File' && !!selectedFilePath;
  const showSelectedViewer = !!selectedNode && !!selectedFilePath;
  const showCitations = aiReferences.length > 0;

  if (isCollapsed) {
    return (
      <aside className="h-full w-12 bg-surface border-r border-border-subtle flex flex-col items-center py-3 gap-2 flex-shrink-0">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 text-text-secondary hover:text-text-primary hover:bg-hover rounded transition-colors"
          title="Expand Code Panel"
        >
          <PanelLeft className="w-5 h-5" />
        </button>
        <div className="w-6 h-px bg-border-subtle my-1" />
        <div className="text-[10px] text-text-muted rotate-90 whitespace-nowrap font-mono">
          {showCitations ? `${aiReferences.length} refs` : 'Selected'}
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={(el) => { panelRef.current = el; }}
      className="h-full bg-surface/95 backdrop-blur-md border-r border-border-subtle flex flex-col animate-slide-in relative shadow-2xl"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute top-0 right-0 h-full w-2 cursor-col-resize bg-transparent hover:bg-cyan-500/25 transition-colors"
        title="Drag to resize"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated/40">
        <div className="flex items-center gap-2">
          <Code className="w-4 h-4 text-cyan-300" />
          <span className="text-sm font-medium">Code</span>
          {showCitations && <span className="text-xs text-text-muted">• {aiReferences.length} refs</span>}
        </div>
        <div className="flex items-center gap-1.5">
          {showCitations && (
            <button
              onClick={() => clearCodeReferences()}
              className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
              title="Clear all code references"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
            title="Collapse Panel"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Top: Selected file viewer (when a node is selected) */}
        {showSelectedViewer && (
          <div className={`${showCitations ? 'h-[42%]' : 'flex-1'} min-h-0 flex flex-col`}>
            <div className="px-3 py-2 bg-surface/40 border-b border-border-subtle flex items-center gap-2">
              <span className="text-[11px] text-text-muted uppercase tracking-wide">Selected</span>
              <span className="text-xs text-text-primary font-mono truncate flex-1">
                {selectedNode?.properties?.filePath ?? selectedNode?.properties?.name}
              </span>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
                title="Clear selection"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
              {selectedFileContent ? (
                <SyntaxHighlighter
                  language={
                    selectedFilePath?.endsWith('.py') ? 'python' :
                    selectedFilePath?.endsWith('.js') || selectedFilePath?.endsWith('.jsx') ? 'javascript' :
                    selectedFilePath?.endsWith('.ts') || selectedFilePath?.endsWith('.tsx') ? 'typescript' :
                    'text'
                  }
                  style={customTheme as any}
                  showLineNumbers
                  startingLineNumber={1}
                  lineNumberStyle={{
                    minWidth: '3em',
                    paddingRight: '1em',
                    color: '#5a5a70',
                    textAlign: 'right',
                    userSelect: 'none',
                  }}
                  lineProps={(lineNumber) => {
                    const startLine = selectedNode?.properties?.startLine;
                    const endLine = selectedNode?.properties?.endLine ?? startLine;
                    const isHighlighted =
                      typeof startLine === 'number' &&
                      lineNumber >= startLine + 1 &&
                      lineNumber <= (endLine ?? startLine) + 1;
                    return {
                      style: {
                        display: 'block',
                        backgroundColor: isHighlighted ? 'rgba(6, 182, 212, 0.14)' : 'transparent',
                        borderLeft: isHighlighted ? '3px solid #06b6d4' : '3px solid transparent',
                        paddingLeft: '12px',
                        paddingRight: '16px',
                      },
                    };
                  }}
                  wrapLines
                >
                  {selectedFileContent}
                </SyntaxHighlighter>
              ) : (
                <div className="px-3 py-3 text-sm text-text-muted">
                  {selectedIsFile ? (
                    <>Code not available in memory for <span className="font-mono">{selectedFilePath}</span></>
                  ) : (
                    <>Select a file node to preview its contents.</>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Divider between Selected viewer and AI refs (more visible) */}
        {showSelectedViewer && showCitations && (
          <div className="h-2 bg-gradient-to-r from-cyan-500/0 via-cyan-400/35 to-cyan-500/0 border-y border-cyan-400/25" />
        )}

        {/* Bottom: AI citations list */}
        {showCitations && (
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3 space-y-3">
            {refsWithSnippets.map(({ ref, content, start, highlightStart, highlightEnd, totalLines }) => {
          const nodeColor = ref.label ? (NODE_COLORS as any)[ref.label] || '#6b7280' : '#6b7280';
          const hasRange = typeof ref.startLine === 'number';
          const startDisplay = hasRange ? (ref.startLine ?? 0) + 1 : undefined;
          const endDisplay = hasRange ? (ref.endLine ?? ref.startLine ?? 0) + 1 : undefined;
          const language =
            ref.filePath.endsWith('.py') ? 'python' :
            ref.filePath.endsWith('.js') || ref.filePath.endsWith('.jsx') ? 'javascript' :
            ref.filePath.endsWith('.ts') || ref.filePath.endsWith('.tsx') ? 'typescript' :
            'text';

          return (
            <div key={ref.id} className="bg-elevated border border-border-subtle rounded-xl overflow-hidden">
              <div className="px-3 py-2 border-b border-border-subtle bg-surface/40 flex items-start gap-2">
                <span
                  className="mt-0.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide flex-shrink-0"
                  style={{ backgroundColor: nodeColor, color: '#06060a' }}
                  title={ref.label ?? 'Code'}
                >
                  {ref.label ?? 'Code'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-primary font-medium truncate">
                    {ref.name ?? ref.filePath.split('/').pop() ?? ref.filePath}
                  </div>
                  <div className="text-[11px] text-text-muted font-mono truncate">
                    {ref.filePath}
                    {startDisplay !== undefined && (
                      <span className="text-text-secondary">
                        {' '}
                        • L{startDisplay}
                        {endDisplay !== startDisplay ? `–${endDisplay}` : ''}
                      </span>
                    )}
                    {totalLines > 0 && <span className="text-text-muted"> • {totalLines} lines</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {ref.nodeId && (
                    <button
                      onClick={() => {
                        const nodeId = ref.nodeId!;
                        // Sync selection + focus graph
                        if (graph) {
                          const node = graph.nodes.find((n) => n.id === nodeId);
                          if (node) setSelectedNode(node);
                        }
                        onFocusNode(nodeId);
                      }}
                      className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
                      title="Focus in graph"
                    >
                      <Target className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => removeCodeReference(ref.id)}
                    className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
                    title="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto">
                {content ? (
                  <SyntaxHighlighter
                    language={language}
                    style={customTheme as any}
                    showLineNumbers
                    startingLineNumber={start + 1}
                    lineNumberStyle={{
                      minWidth: '3em',
                      paddingRight: '1em',
                      color: '#5a5a70',
                      textAlign: 'right',
                      userSelect: 'none',
                    }}
                    lineProps={(lineNumber) => {
                      const isHighlighted =
                        hasRange &&
                        lineNumber >= start + highlightStart + 1 &&
                        lineNumber <= start + highlightEnd + 1;
                      return {
                        style: {
                          display: 'block',
                          backgroundColor: isHighlighted ? 'rgba(6, 182, 212, 0.14)' : 'transparent',
                          borderLeft: isHighlighted ? '3px solid #06b6d4' : '3px solid transparent',
                          paddingLeft: '12px',
                          paddingRight: '16px',
                        },
                      };
                    }}
                    wrapLines
                  >
                    {content}
                  </SyntaxHighlighter>
                ) : (
                  <div className="px-3 py-3 text-sm text-text-muted">
                    Code not available in memory for <span className="font-mono">{ref.filePath}</span>
                  </div>
                )}
              </div>
            </div>
          );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};


