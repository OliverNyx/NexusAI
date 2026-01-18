/**
 * MCP Toggle Component
 * 
 * Toggle switch for enabling/disabling MCP exposure to external AI agents.
 * Shows connection status and setup instructions if bridge not found.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Check, AlertCircle, X, Sparkles } from 'lucide-react';
import { getMCPClient, type CodebaseContext } from '../core/mcp/mcp-client';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface MCPToggleProps {
    /** Handler for search tool calls from external agents */
    onSearch?: (query: string, limit?: number) => Promise<any>;
    /** Handler for cypher tool calls from external agents */
    onCypher?: (query: string) => Promise<any>;
    /** Handler for blastRadius tool calls from external agents */
    onBlastRadius?: (nodeId: string, hops?: number) => Promise<any>;
    /** Handler for highlight tool calls from external agents */
    onHighlight?: (nodeIds: string[], color?: string) => void;
    /** Handler for grep tool calls from external agents */
    onGrep?: (pattern: string, caseSensitive?: boolean, maxResults?: number) => Promise<any>;
    /** Handler for read tool calls from external agents */
    onRead?: (filePath: string, startLine?: number, endLine?: number) => Promise<any>;
    /** Whether to show the onboarding tip */
    showOnboardingTip?: boolean;
    /** Callback to get codebase context for external agents */
    getContext?: () => Promise<CodebaseContext | null>;
}

const MCP_TIP_DISMISSED_KEY = 'gitnexus-mcp-tip-dismissed';

export function MCPToggle({
    onSearch,
    onCypher,
    onBlastRadius,
    onHighlight,
    onGrep,
    onRead,
    showOnboardingTip = false,
    getContext,
}: MCPToggleProps = {}) {
    const [status, setStatus] = useState<ConnectionState>('disconnected');
    const [copied, setCopied] = useState(false);
    const [showSetup, setShowSetup] = useState(false);
    const [hasConnectionError, setHasConnectionError] = useState(false);
    const setupPopupRef = useRef<HTMLDivElement | null>(null);
    const [showTip, setShowTip] = useState(false);

    const isConnected = status === 'connected';
    const isConnecting = status === 'connecting';

    // Show tip when graph becomes ready (only once per session)
    useEffect(() => {
        if (showOnboardingTip) {
            const dismissed = localStorage.getItem(MCP_TIP_DISMISSED_KEY);
            if (!dismissed) {
                // Small delay so it appears after graph loads
                const timer = setTimeout(() => setShowTip(true), 1500);
                return () => clearTimeout(timer);
            }
        }
    }, [showOnboardingTip]);

    // Close setup popup when clicking outside
    useEffect(() => {
        if (!showSetup) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (!setupPopupRef.current) return;
            if (!setupPopupRef.current.contains(event.target as Node)) {
                setShowSetup(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showSetup]);

    const dismissTip = () => {
        setShowTip(false);
        localStorage.setItem(MCP_TIP_DISMISSED_KEY, 'true');
    };

    const connect = useCallback(async () => {
        const client = getMCPClient();
        setStatus('connecting');
        setShowTip(false);
        setHasConnectionError(false);

        try {
            await client.connect();

            // Register tool handlers if provided
            if (onSearch) {
                client.registerHandler('search', async (params) => {
                    return await onSearch(params.query, params.limit);
                });
            }

            if (onCypher) {
                client.registerHandler('cypher', async (params) => {
                    return await onCypher(params.query);
                });
            }

            if (onBlastRadius) {
                client.registerHandler('blastRadius', async (params) => {
                    return await onBlastRadius(params.nodeId, params.hops);
                });
            }

            if (onHighlight) {
                client.registerHandler('highlight', async (params) => {
                    onHighlight(params.nodeIds, params.color);
                    return { highlighted: params.nodeIds.length };
                });
            }

            // Register context tool handler
            if (getContext) {
                client.registerHandler('context', async () => {
                    const context = await getContext();
                    return context;
                });
            }

            // Register grep tool handler
            if (onGrep) {
                client.registerHandler('grep', async (params) => {
                    return await onGrep(params.pattern, params.caseSensitive, params.maxResults);
                });
            }

            // Register read tool handler
            if (onRead) {
                client.registerHandler('read', async (params) => {
                    return await onRead(params.filePath, params.startLine, params.endLine);
                });
            }

            setStatus('connected');
            setShowSetup(false);
            setHasConnectionError(false);
            localStorage.setItem(MCP_TIP_DISMISSED_KEY, 'true');

            // Send codebase context after connecting
            if (getContext) {
                try {
                    const context = await getContext();
                    if (context) {
                        client.sendContext(context);
                    }
                } catch (e) {
                    console.error('[MCP] Failed to send context:', e);
                }
            }
        } catch {
            setStatus('error');
            setShowSetup(true);
            setHasConnectionError(true);
        }
    }, [onSearch, onCypher, onBlastRadius, onHighlight, onGrep, onRead, getContext]);

    const disconnect = useCallback(() => {
        const client = getMCPClient();
        client.disconnect();
        setStatus('disconnected');
        setHasConnectionError(false);
    }, []);

    const toggle = useCallback(() => {
        if (isConnected) {
            disconnect();
        } else if (!isConnecting) {
            connect();
        }
    }, [isConnected, isConnecting, connect, disconnect]);

    const copyCommand = (command: string) => {
        navigator.clipboard.writeText(command);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Listen for connection changes
    useEffect(() => {
        const client = getMCPClient();
        const unsubscribe = client.onConnectionChange((connected) => {
            if (connected) {
                setStatus('connected');
                setShowSetup(false);
                setHasConnectionError(false);
            } else {
                setStatus('disconnected');
            }
        });
        return () => { unsubscribe(); };
    }, []);

    // Error state - show setup popup
    if (hasConnectionError && showSetup) {
        return (
            <div className="relative flex items-center gap-2">
                <span className="text-xs text-text-primary font-medium">MCP</span>
                <button
                    onClick={() => setShowSetup(!showSetup)}
                    className="flex items-center gap-1.5 px-2 py-1 text-xs text-amber-400 hover:bg-amber-400/10 rounded transition-colors"
                >
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>Daemon</span>
                </button>

                <div
                    ref={setupPopupRef}
                    className="absolute top-full right-0 mt-2 p-5 bg-surface border border-border rounded-lg shadow-xl z-50 w-[28rem]"
                >
                    <p className="text-sm text-text-primary mb-4">
                        MCP daemon isn't running. Follow the steps below:
                    </p>

                    <div className="mb-3">
                        <p className="text-sm text-text-secondary mb-2">1) Install/configure your IDE:</p>
                        <div className="flex items-center gap-2 bg-background/60 border border-border/60 px-3 py-2 rounded font-mono text-sm">
                            <code className="flex-1 text-text-primary">npx gitnexus-mcp setup</code>
                            <button
                                onClick={() => copyCommand('npx gitnexus-mcp setup')}
                                className="p-1.5 hover:bg-surface-hover rounded"
                                title="Copy command"
                            >
                                {copied ? (
                                    <Check className="w-4 h-4 text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-text-secondary" />
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="mb-3">
                        <p className="text-sm text-text-secondary mb-2">2) Start the daemon (recommended):</p>
                        <div className="flex items-center gap-2 bg-background/60 border border-border/60 px-3 py-2 rounded font-mono text-sm">
                            <code className="flex-1 text-text-primary">npx gitnexus-mcp daemon</code>
                            <button
                                onClick={() => copyCommand('npx gitnexus-mcp daemon')}
                                className="p-1.5 hover:bg-surface-hover rounded"
                                title="Copy command"
                            >
                                {copied ? (
                                    <Check className="w-4 h-4 text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-text-secondary" />
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="mb-3">
                        <p className="text-sm text-text-secondary mb-2">Dev mode (from `gitnexus-mcp` dir):</p>
                        <div className="flex items-center gap-2 bg-background/60 border border-border/60 px-3 py-2 rounded font-mono text-sm">
                            <code className="flex-1 text-text-primary">npm run build &amp;&amp; node dist/cli.js daemon</code>
                            <button
                                onClick={() => copyCommand('npm run build && node dist/cli.js daemon')}
                                className="p-1.5 hover:bg-surface-hover rounded"
                                title="Copy command"
                            >
                                {copied ? (
                                    <Check className="w-4 h-4 text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-text-secondary" />
                                )}
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => { setShowSetup(false); connect(); }}
                        className="mt-2 w-full px-3 py-1.5 text-sm bg-green-500/20 text-green-400 rounded hover:bg-green-500/30 transition-colors"
                    >
                        Retry Connection
                    </button>
                </div>
            </div>
        );
    }

    // Toggle switch UI
    return (
        <div className="relative flex items-center gap-2">
            <span className="text-xs text-text-primary font-medium">MCP</span>
            <button
                onClick={toggle}
                disabled={isConnecting}
                className={`
          relative w-10 h-5 rounded-full transition-colors duration-200 ease-in-out
          focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:ring-offset-2 focus:ring-offset-deep
          ${isConnected
                        ? 'bg-green-500'
                        : isConnecting
                            ? 'bg-surface-hover cursor-wait'
                            : 'bg-surface-hover hover:bg-border'
                    }
        `}
                title={isConnected
                    ? 'MCP Connected - Click to disconnect'
                    : isConnecting
                        ? 'Connecting...'
                        : 'Connect to MCP bridge for external AI tools'
                }
            >
                {/* Toggle knob */}
                <span
                    className={`
            absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm
            transition-transform duration-200 ease-in-out
            ${isConnected ? 'translate-x-5' : 'translate-x-0'}
            ${isConnecting ? 'animate-pulse' : ''}
          `}
                />
            </button>
            {isConnected && (
                <span className="text-xs text-green-400 font-medium hidden sm:inline">Connected</span>
            )}

            {/* Onboarding Tip Popup */}
            {showTip && !isConnected && (
                <div className="absolute top-full right-0 mt-3 w-80 p-4 bg-surface border border-green-500/30 rounded-lg shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-300">
                    <button
                        onClick={dismissTip}
                        className="absolute top-2 right-2 p-1 text-text-muted hover:text-text-primary rounded transition-colors"
                    >
                        <X className="w-4 h-4" />
                    </button>

                    <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-green-500/20 rounded-lg flex-shrink-0">
                            <Sparkles className="w-5 h-5 text-green-400" />
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-text-primary mb-1">
                                Connect your AI coding tool
                            </h4>
                            <p className="text-xs text-text-secondary leading-relaxed">
                                Let Cursor, Claude Code, or Antigravity use GitNexus for code intelligence.
                            </p>
                        </div>
                    </div>

                    <div className="mb-3">
                        <p className="text-xs text-text-muted mb-2">Run this in your terminal:</p>
                        <div className="flex items-center gap-2 bg-background p-2 rounded font-mono text-sm">
                            <code className="flex-1 text-green-400">npx gitnexus-mcp setup</code>
                            <button
                        onClick={() => copyCommand('npx gitnexus-mcp setup')}
                                className="p-1 hover:bg-surface-hover rounded"
                                title="Copy command"
                            >
                                {copied ? (
                                    <Check className="w-4 h-4 text-green-400" />
                                ) : (
                                    <Copy className="w-4 h-4 text-text-secondary" />
                                )}
                            </button>
                        </div>
                    </div>

                    <button
                        onClick={() => { dismissTip(); connect(); }}
                        className="w-full px-3 py-2 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                    >
                        I've run setup — Connect Now
                    </button>
                </div>
            )}
        </div>
    );
}
