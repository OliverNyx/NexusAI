import { useState, useMemo } from 'react';
import { 
  X, Send, Sparkles, User, FileCode, Hash, GitBranch, Code, MessageSquare, 
  PanelRightClose, Loader2, Settings, AlertTriangle 
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import { useAppState } from '../hooks/useAppState';
import { NODE_COLORS } from '../lib/constants';
import { ToolCallCard } from './ToolCallCard';

// Custom syntax theme
const customTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
    background: '#0a0a10',
    margin: 0,
    padding: '16px 0',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  'code[class*="language-"]': {
    ...vscDarkPlus['code[class*="language-"]'],
    background: 'transparent',
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  },
};

export const RightPanel = () => {
  const { 
    selectedNode, 
    setSelectedNode,
    fileContents, 
    graph,
    isRightPanelOpen,
    setRightPanelOpen,
    rightPanelTab,
    setRightPanelTab,
    // LLM / chat state
    chatMessages,
    isChatLoading,
    currentToolCalls,
    agentError,
    isAgentReady,
    isAgentInitializing,
    setSettingsPanelOpen,
    sendChatMessage,
    clearChat,
  } = useAppState();
  
  const [chatInput, setChatInput] = useState('');

  // Get source code for selected node
  const sourceCode = useMemo(() => {
    if (!selectedNode) return null;
    
    const filePath = selectedNode.properties.filePath;
    const content = fileContents.get(filePath);
    
    if (!content) return null;

    const startLine = selectedNode.properties.startLine ?? 0;
    const endLine = selectedNode.properties.endLine ?? startLine;
    
    // Get lines around the definition with more context
    const lines = content.split('\n');
    const contextStart = Math.max(0, startLine - 3);
    const contextEnd = Math.min(lines.length - 1, endLine + 15);
    
    return {
      code: lines.slice(contextStart, contextEnd + 1).join('\n'),
      startLine: contextStart,
      highlightStart: startLine - contextStart,
      highlightEnd: endLine - contextStart,
      totalLines: lines.length,
    };
  }, [selectedNode, fileContents]);

  // Get language for syntax highlighting
  const language = useMemo(() => {
    if (!selectedNode) return 'typescript';
    const filePath = selectedNode.properties.filePath;
    if (filePath.endsWith('.py')) return 'python';
    if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'javascript';
    return 'typescript';
  }, [selectedNode]);

  // Count relationships
  const relationshipCount = useMemo(() => {
    if (!selectedNode || !graph) return 0;
    return graph.relationships.filter(
      r => r.sourceId === selectedNode.id || r.targetId === selectedNode.id
    ).length;
  }, [selectedNode, graph]);

  // Chat handlers
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    await sendChatMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const chatSuggestions = [
    'What does this project do?',
    'Show me the entry point',
    'Find all API handlers',
  ];

  if (!isRightPanelOpen) return null;

  const nodeColor = selectedNode ? NODE_COLORS[selectedNode.label] || '#6b7280' : '#6b7280';

  return (
    <aside className="w-[40%] min-w-[400px] max-w-[600px] flex flex-col bg-deep border-l border-border-subtle animate-slide-in relative z-30 flex-shrink-0">
      {/* Header with tabs */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-border-subtle">
        <div className="flex items-center gap-1">
          {/* Code Tab */}
          <button
            onClick={() => setRightPanelTab('code')}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
              ${rightPanelTab === 'code' 
                ? 'bg-accent/20 text-accent' 
                : 'text-text-secondary hover:text-text-primary hover:bg-hover'
              }
            `}
          >
            <Code className="w-4 h-4" />
            <span>Code</span>
          </button>
          
          {/* Chat Tab */}
          <button
            onClick={() => setRightPanelTab('chat')}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors
              ${rightPanelTab === 'chat' 
                ? 'bg-accent/20 text-accent' 
                : 'text-text-secondary hover:text-text-primary hover:bg-hover'
              }
            `}
          >
            <MessageSquare className="w-4 h-4" />
            <span>Chat</span>
          </button>
        </div>
        
        {/* Close button */}
        <button
          onClick={() => setRightPanelOpen(false)}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
          title="Close Panel"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Code Panel Content */}
      {rightPanelTab === 'code' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedNode ? (
            <>
              {/* File info header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-elevated/50 border-b border-border-subtle">
                <span 
                  className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: nodeColor, color: '#06060a' }}
                >
                  {selectedNode.label}
                </span>
                <span className="font-mono text-sm font-medium text-text-primary truncate">
                  {selectedNode.properties.name}
                </span>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="ml-auto p-1 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* File path breadcrumb */}
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted border-b border-border-subtle bg-surface/50">
                <FileCode className="w-3.5 h-3.5" />
                <span className="font-mono truncate">{selectedNode.properties.filePath}</span>
              </div>

              {/* Code content */}
              <div className="flex-1 overflow-auto scrollbar-thin">
                {sourceCode ? (
                  <SyntaxHighlighter
                    language={language}
                    style={customTheme}
                    showLineNumbers
                    startingLineNumber={sourceCode.startLine + 1}
                    lineNumberStyle={{
                      minWidth: '3em',
                      paddingRight: '1em',
                      color: '#5a5a70',
                      textAlign: 'right',
                      userSelect: 'none',
                    }}
                    lineProps={(lineNumber) => {
                      const isHighlighted = 
                        lineNumber >= sourceCode.startLine + sourceCode.highlightStart + 1 &&
                        lineNumber <= sourceCode.startLine + sourceCode.highlightEnd + 1;
                      return {
                        style: {
                          display: 'block',
                          backgroundColor: isHighlighted ? 'rgba(124, 58, 237, 0.15)' : 'transparent',
                          borderLeft: isHighlighted ? '3px solid #7c3aed' : '3px solid transparent',
                          paddingLeft: '12px',
                          paddingRight: '16px',
                        },
                      };
                    }}
                    wrapLines
                  >
                    {sourceCode.code}
                  </SyntaxHighlighter>
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-text-muted">
                    Source code not available
                  </div>
                )}
              </div>

              {/* Metadata footer */}
              <div className="flex items-center gap-4 px-4 py-2.5 bg-surface border-t border-border-subtle text-xs text-text-muted">
                {selectedNode.properties.startLine !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <Hash className="w-3.5 h-3.5" />
                    <span>
                      Lines {selectedNode.properties.startLine + 1}
                      {selectedNode.properties.endLine !== selectedNode.properties.startLine && 
                        `–${(selectedNode.properties.endLine ?? selectedNode.properties.startLine) + 1}`
                      }
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5" />
                  <span>{relationshipCount} connections</span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
              <div className="w-16 h-16 mb-4 flex items-center justify-center bg-elevated border border-border-subtle rounded-xl">
                <Code className="w-8 h-8 text-text-muted" />
              </div>
              <h3 className="text-base font-medium text-text-secondary mb-2">
                No code selected
              </h3>
              <p className="text-sm text-text-muted">
                Click on a node in the graph or file tree to view its source code
              </p>
            </div>
          )}
        </div>
      )}

      {/* Chat Panel Content */}
      {rightPanelTab === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chat header */}
          <div className="flex items-center gap-2.5 px-4 py-3 bg-elevated/50 border-b border-border-subtle">
            <Sparkles className="w-4 h-4 text-accent" />
            <span className="font-medium text-sm">Nexus AI</span>
            <span className="text-xs text-text-muted">• Ask about the codebase</span>
            <div className="ml-auto flex items-center gap-2">
              {!isAgentReady && (
                <span className="text-[11px] px-2 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Configure AI
                </span>
              )}
              {isAgentInitializing && (
                <span className="text-[11px] px-2 py-1 rounded-full bg-surface border border-border-subtle flex items-center gap-1 text-text-muted">
                  <Loader2 className="w-3 h-3 animate-spin" /> Connecting
                </span>
              )}
              <button
                onClick={() => setSettingsPanelOpen(true)}
                className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                title="AI Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Status / errors */}
          {agentError && (
            <div className="px-4 py-3 bg-rose-500/10 border-b border-rose-500/30 text-rose-100 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              <span>{agentError}</span>
            </div>
          )}

          {/* Active tool calls - shown at top during execution */}
          {currentToolCalls.length > 0 && (
            <div className="px-4 py-3 bg-elevated/60 border-b border-border-subtle space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-text-muted flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Working...</span>
              </div>
              {currentToolCalls.map(tc => (
                <ToolCallCard key={tc.id} toolCall={tc} defaultExpanded={false} />
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            {chatMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-14 h-14 mb-4 flex items-center justify-center bg-gradient-to-br from-accent to-node-interface rounded-xl shadow-glow text-2xl">
                  🧠
                </div>
                <h3 className="text-base font-medium mb-2">
                  Ask me anything
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed mb-5">
                  I can help you understand the architecture, find functions, or explain connections.
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {chatSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setChatInput(suggestion)}
                      className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-full text-xs text-text-secondary hover:border-accent hover:text-text-primary transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''} animate-fade-in`}
                  >
                    <div className={`
                      w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-md text-sm
                      ${message.role === 'assistant' 
                        ? 'bg-gradient-to-br from-accent to-node-interface text-white' 
                        : 'bg-elevated border border-border-subtle text-text-secondary'
                      }
                    `}>
                      {message.role === 'assistant' ? (
                        <Sparkles className="w-3.5 h-3.5" />
                      ) : (
                        <User className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <div className={`
                      max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed
                      ${message.role === 'assistant'
                        ? 'bg-elevated border border-border-subtle text-text-primary prose prose-sm prose-invert max-w-none'
                        : 'bg-accent text-white'
                      }
                    `}>
                      {message.role === 'assistant' ? (
                        // Render steps in order (reasoning, tool calls, content interleaved)
                        message.steps && message.steps.length > 0 ? (
                          <div className="space-y-3">
                            {message.steps.map((step) => (
                              <div key={step.id}>
                                {step.type === 'reasoning' && step.content && (
                                  <div className="text-text-secondary text-sm italic border-l-2 border-accent/30 pl-3">
                                    {step.content}
                                  </div>
                                )}
                                {step.type === 'tool_call' && step.toolCall && (
                                  <ToolCallCard toolCall={step.toolCall} defaultExpanded={false} />
                                )}
                                {step.type === 'content' && step.content && (
                                  <ReactMarkdown
                                    components={{
                                      code: ({ className, children, ...props }) => {
                                        const match = /language-(\w+)/.exec(className || '');
                                        const isInline = !className && !match;
                                        const codeContent = String(children).replace(/\n$/, '');
                                        
                                        if (isInline) {
                                          return (
                                          <code className="px-1 py-0.5 bg-surface rounded text-accent font-mono text-xs" {...props}>
                                            {children}
                                          </code>
                                          );
                                        }
                                        
                                        const language = match ? match[1] : 'text';
                                        return (
                                          <SyntaxHighlighter
                                            style={customTheme}
                                            language={language}
                                            PreTag="div"
                                            customStyle={{
                                              margin: 0,
                                              padding: '12px',
                                              borderRadius: '8px',
                                              fontSize: '12px',
                                              background: '#0a0a10',
                                            }}
                                          >
                                            {codeContent}
                                          </SyntaxHighlighter>
                                        );
                                      },
                                      pre: ({ children }) => <>{children}</>,
                                    }}
                                  >
                                    {step.content}
                                  </ReactMarkdown>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          // Fallback: render content + toolCalls separately (old format)
                          <>
                            <ReactMarkdown
                              components={{
                                code: ({ className, children, ...props }) => {
                                  const match = /language-(\w+)/.exec(className || '');
                                  const isInline = !className && !match;
                                  const codeContent = String(children).replace(/\n$/, '');
                                  
                                  if (isInline) {
                                    return (
                                    <code className="px-1 py-0.5 bg-surface rounded text-accent font-mono text-xs" {...props}>
                                      {children}
                                    </code>
                                    );
                                  }
                                  
                                  const language = match ? match[1] : 'text';
                                  return (
                                    <SyntaxHighlighter
                                      style={customTheme}
                                      language={language}
                                      PreTag="div"
                                      customStyle={{
                                        margin: 0,
                                        padding: '12px',
                                        borderRadius: '8px',
                                        fontSize: '12px',
                                        background: '#0a0a10',
                                      }}
                                    >
                                      {codeContent}
                                    </SyntaxHighlighter>
                                  );
                                },
                                pre: ({ children }) => <>{children}</>,
                              }}
                            >
                              {message.content}
                            </ReactMarkdown>
                            {message.toolCalls && message.toolCalls.length > 0 && (
                              <div className="mt-3 space-y-2">
                                {message.toolCalls.map(tc => (
                                  <ToolCallCard key={tc.id} toolCall={tc} defaultExpanded={false} />
                                ))}
                              </div>
                            )}
                          </>
                        )
                      ) : (
                        message.content
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 bg-surface border-t border-border-subtle">
            <div className="flex items-end gap-2 px-3 py-2 bg-elevated border border-border-subtle rounded-xl transition-all focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about the codebase..."
                rows={1}
                className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted resize-none max-h-24"
              />
              <button
                onClick={clearChat}
                className="px-2 py-1 text-xs text-text-muted hover:text-text-primary transition-colors"
                title="Clear chat"
              >
                Clear
              </button>
              <button
                onClick={handleSendMessage}
                disabled={!chatInput.trim() || isChatLoading || isAgentInitializing}
                className="w-9 h-9 flex items-center justify-center bg-accent rounded-md text-white transition-all hover:bg-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!isAgentReady && !isAgentInitializing && (
              <div className="mt-2 text-xs text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Configure an LLM provider to enable chat.</span>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};



