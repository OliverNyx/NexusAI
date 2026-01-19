/**
 * MCP Toggle Component
 * 
 * Toggle for enabling MCP exposure to external AI agents (Cursor, Claude, etc.)
 * Shows MCP config for setup and connection status.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Copy, Check, X, Sparkles, Zap, ExternalLink } from 'lucide-react';
import { getMCPClient, type CodebaseContext } from '../core/mcp/mcp-client';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface MCPToggleProps {
    onSearch?: (query: string, limit?: number) => Promise<any>;
    onCypher?: (query: string) => Promise<any>;
    onBlastRadius?: (nodeId: string, hops?: number) => Promise<any>;
    onHighlight?: (nodeIds: string[], color?: string) => void;
    onGrep?: (pattern: string, caseSensitive?: boolean, maxResults?: number) => Promise<any>;
    onRead?: (filePath: string, startLine?: number, endLine?: number) => Promise<any>;
    showOnboardingTip?: boolean;
    getContext?: () => Promise<CodebaseContext | null>;
}

const MCP_TIP_DISMISSED_KEY = 'gitnexus-mcp-tip-dismissed';

// MCP config that users copy to their AI agent
const MCP_CONFIG = `{
  "mcpServers": {
    "gitnexus": {
      "command": "npx",
      "args": ["-y", "gitnexus-mcp"]
    }
  }
}`;

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
    const [showPopup, setShowPopup] = useState(false);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [showTip, setShowTip] = useState(false);

    const isConnected = status === 'connected';
    const isConnecting = status === 'connecting';

    // Show tip when graph becomes ready
    useEffect(() => {
        if (showOnboardingTip) {
            const dismissed = localStorage.getItem(MCP_TIP_DISMISSED_KEY);
            if (!dismissed) {
                const timer = setTimeout(() => setShowTip(true), 1500);
                return () => clearTimeout(timer);
            }
        }
    }, [showOnboardingTip]);

    // Close popup when clicking outside
    useEffect(() => {
        if (!showPopup) return;
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                setShowPopup(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showPopup]);

    const dismissTip = () => {
        setShowTip(false);
        localStorage.setItem(MCP_TIP_DISMISSED_KEY, 'true');
    };

    const connect = useCallback(async () => {
        const client = getMCPClient();
        setStatus('connecting');
        setShowTip(false);

        try {
            await client.connect();

            // Register tool handlers
            if (onSearch) client.registerHandler('search', async (params) => onSearch(params.query, params.limit));
            if (onCypher) client.registerHandler('cypher', async (params) => onCypher(params.query));
            if (onBlastRadius) client.registerHandler('blastRadius', async (params) => onBlastRadius(params.nodeId, params.hops));
            if (onHighlight) client.registerHandler('highlight', async (params) => { onHighlight(params.nodeIds, params.color); return { highlighted: params.nodeIds.length }; });
            if (onGrep) client.registerHandler('grep', async (params) => onGrep(params.pattern, params.caseSensitive, params.maxResults));
            if (onRead) client.registerHandler('read', async (params) => onRead(params.filePath, params.startLine, params.endLine));
            if (getContext) client.registerHandler('context', async () => getContext());

            setStatus('connected');
            setShowPopup(false);
            localStorage.setItem(MCP_TIP_DISMISSED_KEY, 'true');

            // Send context after connecting
            if (getContext) {
                try {
                    const context = await getContext();
                    if (context) client.sendContext(context);
                } catch (e) {
                    console.error('[MCP] Failed to send context:', e);
                }
            }
        } catch {
            setStatus('error');
        }
    }, [onSearch, onCypher, onBlastRadius, onHighlight, onGrep, onRead, getContext]);

    const disconnect = useCallback(() => {
        const client = getMCPClient();
        client.disconnect();
        setStatus('disconnected');
    }, []);

    const toggle = useCallback(() => {
        if (isConnected) {
            disconnect();
        } else if (!isConnecting) {
            connect();
        }
    }, [isConnected, isConnecting, connect, disconnect]);

    const copyConfig = () => {
        navigator.clipboard.writeText(MCP_CONFIG);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Listen for connection changes
    useEffect(() => {
        const client = getMCPClient();
        const unsubscribe = client.onConnectionChange((connected) => {
            setStatus(connected ? 'connected' : 'disconnected');
            if (connected) setShowPopup(false);
        });
        return () => { unsubscribe(); };
    }, []);

    return (
        <div className="relative flex items-center gap-2">
            {/* MCP Button */}
            <button
                onClick={() => setShowPopup(!showPopup)}
                className={`
          flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
          transition-all duration-200
          ${isConnected
                        ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
                        : 'bg-surface hover:bg-hover text-text-secondary hover:text-text-primary border border-border-subtle'
                    }
        `}
            >
                <Zap className={`w-3.5 h-3.5 ${isConnected ? 'text-green-400' : ''}`} />
                <span>MCP</span>
                {isConnected && <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />}
            </button>

            {/* Popup */}
            {showPopup && (
                <div
                    ref={popupRef}
                    className="absolute top-full right-0 mt-2 w-[380px] bg-surface/95 backdrop-blur-xl border border-border-subtle rounded-xl shadow-2xl z-50 overflow-hidden"
                >
                    {/* Header */}
                    <div className="px-4 py-3 bg-gradient-to-r from-accent/10 to-transparent border-b border-border-subtle">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="p-1.5 bg-accent/20 rounded-lg">
                                    <Sparkles className="w-4 h-4 text-accent" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-semibold text-text-primary">Connect AI Agents</h3>
                                    <p className="text-[10px] text-text-muted">Cursor, Claude Code, Antigravity</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowPopup(false)}
                                className="p-1 text-text-muted hover:text-text-primary rounded transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="p-4 space-y-4">
                        {/* Step 1: Config */}
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold">1</span>
                                <span className="text-xs text-text-secondary">Add to your AI agent's MCP config</span>
                            </div>
                            <div className="relative group">
                                <pre className="p-3 bg-deep rounded-lg text-[11px] font-mono text-text-primary overflow-x-auto border border-border-subtle">
                                    {MCP_CONFIG}
                                </pre>
                                <button
                                    onClick={copyConfig}
                                    className="absolute top-2 right-2 p-1.5 bg-surface/80 hover:bg-hover rounded-md transition-colors opacity-0 group-hover:opacity-100"
                                    title="Copy config"
                                >
                                    {copied ? (
                                        <Check className="w-3.5 h-3.5 text-green-400" />
                                    ) : (
                                        <Copy className="w-3.5 h-3.5 text-text-muted" />
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Step 2: Connect */}
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-accent/20 text-accent text-[10px] font-bold">2</span>
                                <span className="text-xs text-text-secondary">Connect browser to daemon</span>
                            </div>
                            <button
                                onClick={toggle}
                                disabled={isConnecting}
                                className={`
                  w-full py-2.5 rounded-lg text-sm font-medium transition-all duration-200
                  ${isConnected
                                        ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
                                        : isConnecting
                                            ? 'bg-surface text-text-muted cursor-wait'
                                            : 'bg-accent text-white hover:bg-accent-dim'
                                    }
                `}
                            >
                                {isConnected ? '✓ Connected' : isConnecting ? 'Connecting...' : 'Connect'}
                            </button>
                        </div>

                        {/* Status message */}
                        {status === 'error' && (
                            <p className="text-[11px] text-amber-400 text-center">
                                Daemon not running. Make sure your AI agent has started gitnexus-mcp.
                            </p>
                        )}

                        {/* Help link */}
                        <a
                            href="https://github.com/abhigyanpatwari/GitNexus#mcp-integration"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-1.5 text-[11px] text-text-muted hover:text-accent transition-colors"
                        >
                            <span>Learn more</span>
                            <ExternalLink className="w-3 h-3" />
                        </a>
                    </div>
                </div>
            )}

            {/* Onboarding Tip */}
            {showTip && !isConnected && !showPopup && (
                <div className="absolute top-full right-0 mt-3 w-72 p-4 bg-surface/95 backdrop-blur-xl border border-accent/30 rounded-xl shadow-2xl z-50 animate-in fade-in slide-in-from-top-2">
                    <button
                        onClick={dismissTip}
                        className="absolute top-2 right-2 p-1 text-text-muted hover:text-text-primary rounded transition-colors"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-accent/20 rounded-lg flex-shrink-0">
                            <Sparkles className="w-4 h-4 text-accent" />
                        </div>
                        <div>
                            <h4 className="text-sm font-semibold text-text-primary mb-1">
                                Connect your AI tools
                            </h4>
                            <p className="text-xs text-text-secondary leading-relaxed mb-3">
                                Let Cursor or Claude access GitNexus code intelligence.
                            </p>
                            <button
                                onClick={() => { dismissTip(); setShowPopup(true); }}
                                className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-lg hover:bg-accent-dim transition-colors"
                            >
                                Set up MCP
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
