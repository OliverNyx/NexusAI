/**
 * Activity Feed Component
 * 
 * Shows real-time log of external AI agent tool calls.
 * Used in RightPanel as an alternative to the Chat tab.
 */

import { useState, useEffect, useRef } from 'react';
import { Activity, Search, Database, Terminal, Eye, Loader2, CheckCircle, XCircle, Clock, FileText, Zap } from 'lucide-react';
import { getMCPClient, type ActivityEvent } from '../core/mcp/mcp-client';

// Tool icons
const TOOL_ICONS: Record<string, typeof Search> = {
    context: Zap,
    search: Search,
    cypher: Database,
    grep: Terminal,
    read: FileText,
    blastRadius: Activity,
    highlight: Eye,
};

// Tool colors
const TOOL_COLORS: Record<string, string> = {
    context: 'text-amber-400',
    search: 'text-cyan-400',
    cypher: 'text-purple-400',
    grep: 'text-green-400',
    read: 'text-blue-400',
    blastRadius: 'text-rose-400',
    highlight: 'text-teal-400',
};

export function ActivityFeed() {
    const [events, setEvents] = useState<ActivityEvent[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const client = getMCPClient();

        // Subscribe to activity events
        const unsubscribe = client.onActivity((event) => {
            setEvents(prev => {
                // Keep max 100 events
                const next = [...prev, event];
                if (next.length > 100) {
                    next.shift();
                }
                return next;
            });
        });

        // Get existing events
        setEvents(client.getActivityLog());

        return () => {
            unsubscribe();
        };
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [events]);

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    const formatParams = (params: any): string => {
        if (!params) return '';
        // Show first key-value pairs, truncated
        const entries = Object.entries(params).slice(0, 2);
        return entries.map(([k, v]) => {
            const val = typeof v === 'string' ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30);
            return `${k}: ${val}${val.length >= 30 ? '...' : ''}`;
        }).join(', ');
    };

    const formatResult = (event: ActivityEvent): string => {
        if (event.status === 'running') return 'Running...';
        if (event.status === 'error') return `Error: ${event.error?.slice(0, 50) || 'Unknown'}`;

        // Format result based on type
        if (Array.isArray(event.result)) {
            return `${event.result.length} results`;
        }
        if (typeof event.result === 'object' && event.result) {
            const keys = Object.keys(event.result);
            if (keys.includes('content')) return `${event.result.content?.length || 0} chars`;
            if (keys.includes('projectName')) return event.result.projectName;
            return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}}`;
        }
        return String(event.result || 'Done');
    };

    if (events.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
                <div className="w-14 h-14 mb-4 flex items-center justify-center bg-gradient-to-br from-accent to-node-class rounded-xl shadow-glow text-2xl">
                    📡
                </div>
                <h3 className="text-base font-medium mb-2">
                    No Agent Activity
                </h3>
                <p className="text-sm text-text-secondary leading-relaxed">
                    When external AI agents (Cursor, Claude Code) call GitNexus tools,
                    their activity will appear here in real-time.
                </p>
                <p className="text-xs text-text-muted mt-4">
                    Make sure MCP toggle is enabled in the header
                </p>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            <div className="space-y-3">
                {events.map((event) => {
                    const Icon = TOOL_ICONS[event.tool] || Activity;
                    const color = TOOL_COLORS[event.tool] || 'text-text-muted';

                    return (
                        <div
                            key={event.id}
                            className="bg-elevated border border-border-subtle rounded-lg p-3 animate-fade-in"
                        >
                            {/* Header row */}
                            <div className="flex items-center gap-2 mb-2">
                                {/* Agent color indicator */}
                                {event.agentColor && (
                                    <div
                                        className="w-2 h-2 rounded-full shrink-0"
                                        style={{ backgroundColor: event.agentColor }}
                                        title={event.agentName || 'Unknown agent'}
                                    />
                                )}
                                <Icon className={`w-4 h-4 ${color}`} />
                                <span className="font-medium text-sm">{event.tool}</span>
                                {event.agentName && event.agentName !== 'Unknown' && (
                                    <span
                                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                                        style={{
                                            backgroundColor: `${event.agentColor}20`,
                                            color: event.agentColor
                                        }}
                                    >
                                        {event.agentName}
                                    </span>
                                )}
                                <span className="text-xs text-text-muted ml-auto flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {formatTime(event.timestamp)}
                                </span>
                            </div>

                            {/* Params preview */}
                            {event.params && Object.keys(event.params).length > 0 && (
                                <div className="text-xs text-text-secondary font-mono bg-deep rounded px-2 py-1 mb-2 truncate">
                                    {formatParams(event.params)}
                                </div>
                            )}

                            {/* Status/Result */}
                            <div className="flex items-center gap-2 text-xs">
                                {event.status === 'running' && (
                                    <>
                                        <Loader2 className="w-3 h-3 animate-spin text-accent" />
                                        <span className="text-accent">Running...</span>
                                    </>
                                )}
                                {event.status === 'complete' && (
                                    <>
                                        <CheckCircle className="w-3 h-3 text-green-400" />
                                        <span className="text-text-secondary">{formatResult(event)}</span>
                                        {event.duration && (
                                            <span className="text-text-muted ml-auto">{event.duration}ms</span>
                                        )}
                                    </>
                                )}
                                {event.status === 'error' && (
                                    <>
                                        <XCircle className="w-3 h-3 text-rose-400" />
                                        <span className="text-rose-300">{formatResult(event)}</span>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
