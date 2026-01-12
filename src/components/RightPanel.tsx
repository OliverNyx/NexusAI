import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, Sparkles, User,
  PanelRightClose, Loader2, Settings, AlertTriangle
} from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppState } from '../hooks/useAppState';
import { ToolCallCard } from './ToolCallCard';
import { isProviderConfigured } from '../core/llm/settings-service';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages update or while streaming
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatLoading]);

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

    // Match line:num or line:num-num (supports both hyphen - and en dash –)
    const lineMatch = raw.match(/^(.*):(\d+)(?:[-–](\d+))?$/);
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

  // Handler for node grounding: [[Class:View]], [[Function:trigger]], etc.
  const handleNodeGroundingClick = useCallback((nodeTypeAndName: string) => {
    const raw = nodeTypeAndName.trim();
    if (!raw || !graph) return;

    // Parse Type:Name format
    const match = raw.match(/^(Class|Function|Method|Interface|File|Folder|Variable|Enum|Type|CodeElement):(.+)$/);
    if (!match) return;

    const [, nodeType, nodeName] = match;
    const trimmedName = nodeName.trim();

    // Find node in graph by type + name
    const node = graph.nodes.find(n =>
      n.label === nodeType &&
      n.properties.name === trimmedName
    );

    if (!node) {
      console.warn(`Node not found: ${nodeType}:${trimmedName}`);
      return;
    }

    // 1. Highlight in graph (add to AI citation highlights)
    // Note: This requires accessing the state setter from parent context
    // For now, we'll add to code references which triggers the highlight

    // 2. Add to Code Panel (if node has file/line info)
    if (node.properties.filePath) {
      const resolvedPath = resolveFilePathForUI(node.properties.filePath);
      if (resolvedPath) {
        addCodeReference({
          filePath: resolvedPath,
          startLine: node.properties.startLine ? node.properties.startLine - 1 : undefined,
          endLine: node.properties.endLine ? node.properties.endLine - 1 : undefined,
          nodeId: node.id,
          label: node.label,
          name: node.properties.name,
          source: 'ai',
        });
      }
    }
  }, [graph, resolveFilePathForUI, addCodeReference]);

  const formatMarkdownForDisplay = useCallback((md: string) => {
    // Avoid rewriting inside fenced code blocks.
    const parts = md.split('```');
    for (let i = 0; i < parts.length; i += 2) {
      // Pattern 1: File grounding - [[file.ext]] or [[file.ext:line]] or [[file.ext:line-line]]
      // Line numbers are optional
      parts[i] = parts[i].replace(
        /\[\[([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+(?::\d+(?:[-–]\d+)?)?)\]\]/g,
        (_m, inner: string) => {
          const trimmed = inner.trim();
          const href = `code-ref:${encodeURIComponent(trimmed)}`;
          return `[${trimmed}](${href})`;
        }
      );

      // Pattern 2: Node grounding - [[Type:Name]] or [[graph:Type:Name]]
      // Valid types: Class, Function, Method, Interface, File, Folder, Variable, Enum, Type, CodeElement
      parts[i] = parts[i].replace(
        /\[\[(?:graph:)?(Class|Function|Method|Interface|File|Folder|Variable|Enum|Type|CodeElement):([^\]]+)\]\]/g,
        (_m, nodeType: string, nodeName: string) => {
          const trimmed = `${nodeType}:${nodeName.trim()}`;
          const href = `node-ref:${encodeURIComponent(trimmed)}`;
          return `[${trimmed}](${href})`;
        }
      );
    }
    return parts.join('```');
  }, []);

  const formatRefChipLabel = useCallback((ref: string): string => {
    const raw = ref.trim();
    if (!raw) return '';

    // Drop any scheme prefix we might have accidentally passed through
    const withoutScheme = raw.startsWith('code-ref:') ? raw.slice('code-ref:'.length) : raw;

    // Strip query/hash
    const cleaned = withoutScheme.split('#')[0].split('?')[0];

    // Support both hyphen - and en dash – for line ranges
    const m = cleaned.match(/^(.*):(\d+)(?:[-–](\d+))?$/);
    const path = (m ? m[1] : cleaned).replace(/\\/g, '/');
    const base = path.split('/').pop() ?? path;

    if (!m) return base;

    const start = m[2];
    const end = m[3] ?? m[2];
    return `${base} ${start}–${end}`;
  }, []);

  const isLikelyFileRefHref = useCallback((href: string): boolean => {
    const h = href.trim();
    if (!h) return false;
    if (h.startsWith('code-ref:')) return true;
    if (/^(https?:|mailto:|tel:|#)/i.test(h)) return false;
    if (h.includes('://')) return false;

    // Strip query/hash
    const cleaned = h.split('#')[0].split('?')[0];

    // Looks like: path/to/file.ext or path\to\file.ext:12-34 (supports both hyphen and en dash)
    return /[A-Za-z0-9_\-./\\]+\.[A-Za-z0-9]+(?::\d+(?:[-–]\d+)?)?$/.test(cleaned);
  }, []);

  const extractTextFromChildren = useCallback((children: any): string => {
    if (children == null) return '';
    if (typeof children === 'string' || typeof children === 'number') return String(children);
    if (Array.isArray(children)) return children.map(extractTextFromChildren).join('');
    // React element or other objects
    return '';
  }, []);

  const getInternalRefFromLink = useCallback((href: string | undefined, children: any): string | null => {
    const hrefStr = (href ?? '').trim();
    const textStr = extractTextFromChildren(children).trim();

    if (hrefStr && isLikelyFileRefHref(hrefStr)) return hrefStr;
    if (textStr && isLikelyFileRefHref(textStr)) return textStr;

    return null;
  }, [extractTextFromChildren, isLikelyFileRefHref]);

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
            <div className="flex flex-col gap-6">
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className="animate-fade-in"
                >
                  {/* User message - compact label style */}
                  {message.role === 'user' && (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <User className="w-4 h-4 text-text-muted" />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">You</span>
                      </div>
                      <div className="pl-6 text-sm text-text-primary">
                        {message.content}
                      </div>
                    </div>
                  )}

                  {/* Assistant message - copilot style */}
                  {message.role === 'assistant' && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <Sparkles className="w-4 h-4 text-accent" />
                        <span className="text-xs font-medium text-text-muted uppercase tracking-wide">Nexus AI</span>
                        {isChatLoading && message === chatMessages[chatMessages.length - 1] && (
                          <Loader2 className="w-3 h-3 animate-spin text-accent" />
                        )}
                      </div>
                      <div className="pl-6 chat-prose">
                        {/* Render steps in order (reasoning, tool calls, content interleaved) */}
                        {message.steps && message.steps.length > 0 ? (
                          <div className="space-y-4">
                            {message.steps.map((step) => (
                              <div key={step.id}>
                                {step.type === 'reasoning' && step.content && (
                                  <div className="text-text-secondary text-sm italic border-l-2 border-text-muted/30 pl-3 mb-3">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        a: ({ href, children, ...props }) => {
                                          if (href && href.startsWith('code-ref:')) {
                                            const inner = decodeURIComponent(href.slice('code-ref:'.length));
                                            const label = formatRefChipLabel(inner);
                                            return (
                                              <a
                                                href={href}
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleGroundingClick(inner);
                                                }}
                                                className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-300/55 bg-cyan-400/10 !text-cyan-200 visited:!text-cyan-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-cyan-400/15 hover:border-cyan-200/70 transition-colors"
                                                title={`Open in Code panel • ${inner}`}
                                                {...props}
                                              >
                                                <span className="text-inherit">{label || children}</span>
                                              </a>
                                            );
                                          }
                                          // Handle node grounding: node-ref:Type:Name
                                          if (href && href.startsWith('node-ref:')) {
                                            const inner = decodeURIComponent(href.slice('node-ref:'.length));
                                            return (
                                              <a
                                                href={href}
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleNodeGroundingClick(inner);
                                                }}
                                                className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-amber-300/55 bg-amber-400/10 !text-amber-200 visited:!text-amber-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-amber-400/15 hover:border-amber-200/70 transition-colors"
                                                title={`View ${inner} in Code panel`}
                                                {...props}
                                              >
                                                <span className="text-inherit">{children}</span>
                                              </a>
                                            );
                                          }
                                          const internalRef = getInternalRefFromLink(href, children);
                                          if (internalRef) {
                                            const label = formatRefChipLabel(internalRef);
                                            return (
                                              <a
                                                href={href}
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleGroundingClick(internalRef);
                                                }}
                                                className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-300/55 bg-cyan-400/10 !text-cyan-200 visited:!text-cyan-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-cyan-400/15 hover:border-cyan-200/70 transition-colors"
                                                title={`Open in Code panel • ${internalRef}`}
                                                {...props}
                                              >
                                                <span className="text-inherit">{label || children}</span>
                                              </a>
                                            );
                                          }
                                          // Non-citation link - just render as plain text (not a useless external link)
                                          return <span {...props}>{children}</span>;
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
                                  </div>
                                )}
                                {step.type === 'tool_call' && step.toolCall && (
                                  <div className="mb-3">
                                    <ToolCallCard toolCall={step.toolCall} defaultExpanded={false} />
                                  </div>
                                )}
                                {step.type === 'content' && step.content && (
                                  <div className="text-text-primary text-sm">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        a: ({ href, children, ...props }) => {
                                          if (href && href.startsWith('code-ref:')) {
                                            const inner = decodeURIComponent(href.slice('code-ref:'.length));
                                            const label = formatRefChipLabel(inner);
                                            return (
                                              <a
                                                href={href}
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleGroundingClick(inner);
                                                }}
                                                className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-300/55 bg-cyan-400/10 !text-cyan-200 visited:!text-cyan-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-cyan-400/15 hover:border-cyan-200/70 transition-colors"
                                                title={`Open in Code panel • ${inner}`}
                                                {...props}
                                              >
                                                <span className="text-inherit">{label || children}</span>
                                              </a>
                                            );
                                          }
                                          // Handle node grounding: node-ref:Type:Name
                                          if (href && href.startsWith('node-ref:')) {
                                            const inner = decodeURIComponent(href.slice('node-ref:'.length));
                                            return (
                                              <a
                                                href={href}
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleNodeGroundingClick(inner);
                                                }}
                                                className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-amber-300/55 bg-amber-400/10 !text-amber-200 visited:!text-amber-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-amber-400/15 hover:border-amber-200/70 transition-colors"
                                                title={`View ${inner} in Code panel`}
                                                {...props}
                                              >
                                                <span className="text-inherit">{children}</span>
                                              </a>
                                            );
                                          }
                                          const internalRef = getInternalRefFromLink(href, children);
                                          if (internalRef) {
                                            const label = formatRefChipLabel(internalRef);
                                            return (
                                              <a
                                                href={href}
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  handleGroundingClick(internalRef);
                                                }}
                                                className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-300/55 bg-cyan-400/10 !text-cyan-200 visited:!text-cyan-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-cyan-400/15 hover:border-cyan-200/70 transition-colors"
                                                title={`Open in Code panel • ${internalRef}`}
                                                {...props}
                                              >
                                                <span className="text-inherit">{label || children}</span>
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
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          // Fallback: render content + toolCalls separately (old format)
                          <div className="text-text-primary text-sm">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ href, children, ...props }) => {
                                  if (href && href.startsWith('code-ref:')) {
                                    const inner = decodeURIComponent(href.slice('code-ref:'.length));
                                    const label = formatRefChipLabel(inner);
                                    return (
                                      <a
                                        href={href}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          handleGroundingClick(inner);
                                        }}
                                        className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-300/55 bg-cyan-400/10 !text-cyan-200 visited:!text-cyan-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-cyan-400/15 hover:border-cyan-200/70 transition-colors"
                                        title={`Open in Code panel • ${inner}`}
                                        {...props}
                                      >
                                        <span className="text-inherit">{label || children}</span>
                                      </a>
                                    );
                                  }
                                  // Handle node grounding: node-ref:Type:Name
                                  if (href && href.startsWith('node-ref:')) {
                                    const inner = decodeURIComponent(href.slice('node-ref:'.length));
                                    return (
                                      <a
                                        href={href}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          handleNodeGroundingClick(inner);
                                        }}
                                        className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-amber-300/55 bg-amber-400/10 !text-amber-200 visited:!text-amber-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-amber-400/15 hover:border-amber-200/70 transition-colors"
                                        title={`View ${inner} in Code panel`}
                                        {...props}
                                      >
                                        <span className="text-inherit">{children}</span>
                                      </a>
                                    );
                                  }
                                  const internalRef = getInternalRefFromLink(href, children);
                                  if (internalRef) {
                                    const label = formatRefChipLabel(internalRef);
                                    return (
                                      <a
                                        href={href}
                                        onClick={(e) => {
                                          e.preventDefault();
                                          handleGroundingClick(internalRef);
                                        }}
                                        className="code-ref-btn inline-flex items-center px-2 py-0.5 rounded-md border border-cyan-300/55 bg-cyan-400/10 !text-cyan-200 visited:!text-cyan-200 font-mono text-[12px] !no-underline hover:!no-underline hover:bg-cyan-400/15 hover:border-cyan-200/70 transition-colors"
                                        title={`Open in Code panel • ${internalRef}`}
                                        {...props}
                                      >
                                        <span className="text-inherit">{label || children}</span>
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
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}


            </div>
          )}
          {/* Scroll anchor for auto-scroll */}
          <div ref={messagesEndRef} />
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
              <span>
                {isProviderConfigured()
                  ? 'Initializing AI agent...'
                  : 'Configure an LLM provider to enable chat.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};



