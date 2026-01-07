import { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Send, Sparkles, User,
  PanelRightClose, Loader2, Settings, AlertTriangle 
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import { useAppState } from '../hooks/useAppState';
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
    isRightPanelOpen,
    setRightPanelOpen,
    fileContents,
    graph,
    addCodeReference,
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resolveFilePathForUI = useCallback((requestedPath: string): string | null => {
    const req = requestedPath.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
    if (!req) return null;

    // Exact match first (case-insensitive)
    for (const key of fileContents.keys()) {
      const norm = key.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
      if (norm === req) return key;
    }

    // Ends-with match (best for partial paths)
    let best: { path: string; score: number } | null = null;
    for (const key of fileContents.keys()) {
      const norm = key.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();
      if (norm.endsWith(req)) {
        const score = 1000 - norm.length;
        if (!best || score > best.score) best = { path: key, score };
      }
    }
    return best?.path ?? null;
  }, [fileContents]);

  const findFileNodeIdForUI = useCallback((filePath: string): string | undefined => {
    if (!graph) return undefined;
    const target = filePath.replace(/\\/g, '/').replace(/^\.?\//, '');
    const node = graph.nodes.find(
      (n) => n.label === 'File' && n.properties.filePath.replace(/\\/g, '/').replace(/^\.?\//, '') === target
    );
    return node?.id;
  }, [graph]);

  const handleGroundingClick = useCallback((inner: string) => {
    const raw = inner.trim();
    if (!raw) return;

    let rawPath = raw;
    let startLine1: number | undefined;
    let endLine1: number | undefined;

    const lineMatch = raw.match(/^(.*):(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      rawPath = lineMatch[1].trim();
      startLine1 = parseInt(lineMatch[2], 10);
      endLine1 = parseInt(lineMatch[3] || lineMatch[2], 10);
    }

    const resolvedPath = resolveFilePathForUI(rawPath);
    if (!resolvedPath) return;

    const nodeId = findFileNodeIdForUI(resolvedPath);

    addCodeReference({
      filePath: resolvedPath,
      startLine: startLine1 ? Math.max(0, startLine1 - 1) : undefined,
      endLine: endLine1 ? Math.max(0, endLine1 - 1) : (startLine1 ? Math.max(0, startLine1 - 1) : undefined),
      nodeId,
      label: 'File',
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      source: 'ai',
    });
  }, [addCodeReference, findFileNodeIdForUI, resolveFilePathForUI]);

  const formatMarkdownForDisplay = useCallback((md: string) => {
    // Avoid rewriting inside fenced code blocks. Also avoid rewriting when immediately preceded by a backtick.
    const parts = md.split('```');
    for (let i = 0; i < parts.length; i += 2) {
      parts[i] = parts[i].replace(/(^|[^`])\[\[([^\]\n]+?)\]\]/g, (_m, prefix: string, inner: string) => {
        const trimmed = inner.trim();
        const href = `code-ref:${encodeURIComponent(trimmed)}`;
        return `${prefix}[${trimmed}](${href})`;
      });
    }
    return parts.join('```');
  }, []);
  
  // Auto-resize textarea as user types
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    // Reset height to get accurate scrollHeight
    textarea.style.height = 'auto';
    // Set to scrollHeight, capped at max
    const maxHeight = 160; // ~6 lines
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
    // Show scrollbar if content exceeds max
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);
  
  // Adjust height when input changes
  useEffect(() => {
    adjustTextareaHeight();
  }, [chatInput, adjustTextareaHeight]);

  // Chat handlers
  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput('');
    // Reset textarea height after sending
    if (textareaRef.current) {
      textareaRef.current.style.height = '36px';
      textareaRef.current.style.overflowY = 'hidden';
    }
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

  return (
    <aside className="w-[40%] min-w-[400px] max-w-[600px] flex flex-col bg-deep border-l border-border-subtle animate-slide-in relative z-30 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-border-subtle">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-accent" />
          <span className="font-medium text-sm">Nexus AI</span>
          <span className="text-xs text-text-muted">• Ask about the codebase</span>
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

      {/* Chat Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Status bar */}
        <div className="flex items-center gap-2.5 px-4 py-3 bg-elevated/50 border-b border-border-subtle">
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
              <div className="flex flex-col gap-5">
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
                      max-w-[90%] rounded-xl
                      ${message.role === 'assistant'
                        ? 'px-4 py-3 bg-elevated border border-border-subtle text-text-primary chat-prose'
                        : 'px-3.5 py-2.5 bg-accent text-white text-sm'
                      }
                    `}>
                      {message.role === 'assistant' ? (
                        // Render steps in order (reasoning, tool calls, content interleaved)
                        message.steps && message.steps.length > 0 ? (
                          <div className="space-y-4">
                            {message.steps.map((step) => (
                              <div key={step.id}>
                                {step.type === 'reasoning' && step.content && (
                                  <div className="text-text-secondary text-[13px] italic border-l-2 border-accent/40 pl-3 py-0.5 bg-accent/5 rounded-r">
                                    {step.content}
                                  </div>
                                )}
                                {step.type === 'tool_call' && step.toolCall && (
                                  <ToolCallCard toolCall={step.toolCall} defaultExpanded={false} />
                                )}
                                {step.type === 'content' && step.content && (
                                  <ReactMarkdown
                                    components={{
                                      a: ({ href, children, ...props }) => {
                                        if (href && href.startsWith('code-ref:')) {
                                          const inner = decodeURIComponent(href.slice('code-ref:'.length));
                                          return (
                                            <a
                                              href={href}
                                              onClick={(e) => {
                                                e.preventDefault();
                                                handleGroundingClick(inner);
                                              }}
                                              className="inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 font-mono text-[12px] hover:bg-cyan-500/15 hover:border-cyan-300/60 transition-colors"
                                              title="Open in Code panel"
                                              {...props}
                                            >
                                              {children}
                                            </a>
                                          );
                                        }
                                        return (
                                          <a
                                            href={href}
                                            className="text-accent underline underline-offset-2 hover:text-purple-300"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            {...props}
                                          >
                                            {children}
                                          </a>
                                        );
                                      },
                                      code: ({ className, children, ...props }) => {
                                        const match = /language-(\w+)/.exec(className || '');
                                        const isInline = !className && !match;
                                        const codeContent = String(children).replace(/\n$/, '');
                                        
                                        if (isInline) {
                                          return <code {...props}>{children}</code>;
                                        }
                                        
                                        const language = match ? match[1] : 'text';
                                        return (
                                          <SyntaxHighlighter
                                            style={customTheme}
                                            language={language}
                                            PreTag="div"
                                            customStyle={{
                                              margin: 0,
                                              padding: '14px 16px',
                                              borderRadius: '8px',
                                              fontSize: '13px',
                                              background: '#0a0a10',
                                              border: '1px solid #1e1e2a',
                                            }}
                                          >
                                            {codeContent}
                                          </SyntaxHighlighter>
                                        );
                                      },
                                      pre: ({ children }) => <>{children}</>,
                                    }}
                                  >
                                    {formatMarkdownForDisplay(step.content)}
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
                                a: ({ href, children, ...props }) => {
                                  if (href && href.startsWith('code-ref:')) {
                                    const inner = decodeURIComponent(href.slice('code-ref:'.length));
                                    return (
                                      <a
                                        href={href}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          handleGroundingClick(inner);
                                        }}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-400/40 bg-cyan-500/10 text-cyan-200 font-mono text-[12px] hover:bg-cyan-500/15 hover:border-cyan-300/60 transition-colors"
                                        title="Open in Code panel"
                                        {...props}
                                      >
                                        {children}
                                      </a>
                                    );
                                  }
                                  return (
                                    <a
                                      href={href}
                                      className="text-accent underline underline-offset-2 hover:text-purple-300"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      {...props}
                                    >
                                      {children}
                                    </a>
                                  );
                                },
                                code: ({ className, children, ...props }) => {
                                  const match = /language-(\w+)/.exec(className || '');
                                  const isInline = !className && !match;
                                  const codeContent = String(children).replace(/\n$/, '');
                                  
                                  if (isInline) {
                                    return <code {...props}>{children}</code>;
                                  }
                                  
                                  const language = match ? match[1] : 'text';
                                  return (
                                    <SyntaxHighlighter
                                      style={customTheme}
                                      language={language}
                                      PreTag="div"
                                      customStyle={{
                                        margin: 0,
                                        padding: '14px 16px',
                                        borderRadius: '8px',
                                        fontSize: '13px',
                                        background: '#0a0a10',
                                        border: '1px solid #1e1e2a',
                                      }}
                                    >
                                      {codeContent}
                                    </SyntaxHighlighter>
                                  );
                                },
                                pre: ({ children }) => <>{children}</>,
                              }}
                            >
                              {formatMarkdownForDisplay(message.content)}
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
                ref={textareaRef}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about the codebase..."
                rows={1}
                className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted resize-none min-h-[36px] scrollbar-thin"
                style={{ height: '36px', overflowY: 'hidden' }}
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
    </aside>
  );
};



