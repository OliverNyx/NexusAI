/**
 * Processes Panel
 * 
 * Lists all detected processes grouped by type (cross-community / intra-community).
 * Clicking a process opens the ProcessFlowModal with a flowchart.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import { GitBranch, Search, Eye, Zap, Home, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useAppState } from '../hooks/useAppState';
import { ProcessFlowModal } from './ProcessFlowModal';
import type { ProcessData, ProcessStep } from '../lib/mermaid-generator';

export const ProcessesPanel = () => {
    const { graph, runQuery, setHighlightedNodeIds, highlightedNodeIds } = useAppState();
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedProcess, setSelectedProcess] = useState<ProcessData | null>(null);
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['cross', 'intra']));
    const [loadingProcess, setLoadingProcess] = useState<string | null>(null);

    // Extract processes from graph
    const processes = useMemo(() => {
        if (!graph) return { cross: [], intra: [] };

        const processNodes = graph.nodes.filter(n => n.label === 'Process');

        const cross: Array<{ id: string; label: string; stepCount: number; clusters: string[] }> = [];
        const intra: Array<{ id: string; label: string; stepCount: number; clusters: string[] }> = [];

        for (const node of processNodes) {
            const item = {
                id: node.id,
                label: node.properties.heuristicLabel || node.properties.name || node.id,
                stepCount: node.properties.stepCount || 0,
                clusters: node.properties.communities || [],
            };

            if (node.properties.processType === 'cross_community') {
                cross.push(item);
            } else {
                intra.push(item);
            }
        }

        // Sort by step count (most complex first)
        cross.sort((a, b) => b.stepCount - a.stepCount);
        intra.sort((a, b) => b.stepCount - a.stepCount);

        return { cross, intra };
    }, [graph]);

    // Filter by search
    const filteredProcesses = useMemo(() => {
        if (!searchQuery.trim()) return processes;

        const query = searchQuery.toLowerCase();
        return {
            cross: processes.cross.filter(p => p.label.toLowerCase().includes(query)),
            intra: processes.intra.filter(p => p.label.toLowerCase().includes(query)),
        };
    }, [processes, searchQuery]);

    // Toggle section expansion
    const toggleSection = useCallback((section: string) => {
        setExpandedSections(prev => {
            const next = new Set(prev);
            if (next.has(section)) {
                next.delete(section);
            } else {
                next.add(section);
            }
            return next;
        });
    }, []);

    // Load process steps and open modal
    const handleViewProcess = useCallback(async (processId: string, label: string, processType: string) => {
        setLoadingProcess(processId);

        try {
            // Query for process steps
            const stepsQuery = `
        MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process {id: '${processId.replace(/'/g, "''")}'})
        RETURN s.id AS id, s.name AS name, s.filePath AS filePath, r.step AS stepNumber
        ORDER BY r.step
      `;

            const stepsResult = await runQuery(stepsQuery);

            const steps: ProcessStep[] = stepsResult.map((row: any) => ({
                id: row.id || row[0],
                name: row.name || row[1] || 'Unknown',
                filePath: row.filePath || row[2],
                stepNumber: row.stepNumber || row.step || row[3] || 0,
            }));

            // Get step IDs for edge query
            const stepIds = steps.map(s => s.id);

            // Query for CALLS edges between the steps in this process
            let edges: Array<{ from: string; to: string; type: string }> = [];
            if (stepIds.length > 0) {
                const edgesQuery = `
          MATCH (from)-[r:CodeRelation {type: 'CALLS'}]->(to)
          WHERE from.id IN [${stepIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]
            AND to.id IN [${stepIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]
          RETURN from.id AS fromId, to.id AS toId, r.type AS type
        `;

                try {
                    const edgesResult = await runQuery(edgesQuery);
                    edges = edgesResult
                        .map((row: any) => ({
                            from: row.fromId || row[0],
                            to: row.toId || row[1],
                            type: row.type || row[2] || 'CALLS',
                        }))
                        .filter(edge => edge.from !== edge.to); // Remove self-loops
                } catch (err) {
                    console.warn('Could not fetch edges:', err);
                    // Continue with empty edges - will fallback to linear
                }
            }

            // Get clusters for this process
            const processNode = graph?.nodes.find(n => n.id === processId);
            const clusters = processNode?.properties.communities || [];

            const processData: ProcessData = {
                id: processId,
                label,
                processType: processType as 'cross_community' | 'intra_community',
                steps,
                edges,
                clusters,
            };

            setSelectedProcess(processData);
        } catch (error) {
            console.error('Failed to load process steps:', error);
        } finally {
            setLoadingProcess(null);
        }
    }, [runQuery, graph]);

    // Load ALL processes and combine into one mega-diagram
    const handleViewAllProcesses = useCallback(async () => {
        setLoadingProcess('all');

        try {
            const allProcessIds = [...processes.cross, ...processes.intra].map(p => p.id);

            if (allProcessIds.length === 0) return;

            // Collect all steps from all processes
            const allStepsMap = new Map<string, ProcessStep>();
            const allEdges: Array<{ from: string; to: string; type: string }> = [];
            const processColors: Map<string, number> = new Map();

            for (let i = 0; i < allProcessIds.length; i++) {
                const processId = allProcessIds[i];
                processColors.set(processId, i);

                // Query steps for this process
                const stepsQuery = `
          MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process {id: '${processId.replace(/'/g, "''")}'})
          RETURN s.id AS id, s.name AS name, s.filePath AS filePath, r.step AS stepNumber
        `;

                const stepsResult = await runQuery(stepsQuery);

                for (const row of stepsResult) {
                    const stepId = row.id || row[0];
                    if (!allStepsMap.has(stepId)) {
                        allStepsMap.set(stepId, {
                            id: stepId,
                            name: row.name || row[1] || 'Unknown',
                            filePath: row.filePath || row[2],
                            stepNumber: row.stepNumber || row.step || row[3] || 0,
                        });
                    }
                }
            }

            const allSteps = Array.from(allStepsMap.values());
            const stepIds = allSteps.map(s => s.id);

            // Query for all CALLS edges between the combined steps
            if (stepIds.length > 0) {
                const edgesQuery = `
          MATCH (from)-[r:CodeRelation {type: 'CALLS'}]->(to)
          WHERE from.id IN [${stepIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]
            AND to.id IN [${stepIds.map(id => `'${id.replace(/'/g, "''")}'`).join(',')}]
          RETURN from.id AS fromId, to.id AS toId, r.type AS type
        `;

                try {
                    const edgesResult = await runQuery(edgesQuery);
                    allEdges.push(...edgesResult
                        .map((row: any) => ({
                            from: row.fromId || row[0],
                            to: row.toId || row[1],
                            type: row.type || row[2] || 'CALLS',
                        }))
                        .filter(edge => edge.from !== edge.to));
                } catch (err) {
                    console.warn('Could not fetch combined edges:', err);
                }
            }

            const combinedProcessData: ProcessData = {
                id: 'combined-all',
                label: `All Processes (${allProcessIds.length} combined)`,
                processType: 'cross_community',
                steps: allSteps,
                edges: allEdges,
                clusters: [],
            };

            setSelectedProcess(combinedProcessData);
        } catch (error) {
            console.error('Failed to load combined processes:', error);
        } finally {
            setLoadingProcess(null);
        }
    }, [processes, runQuery]);

    // Focus in graph callback - toggles highlight
    const handleFocusInGraph = useCallback((nodeIds: string[]) => {
        // Check if all these nodes are already highlighted
        const allAlreadyHighlighted = nodeIds.every(id => highlightedNodeIds.has(id))
            && highlightedNodeIds.size === nodeIds.length;

        if (allAlreadyHighlighted) {
            // Clear if already highlighted
            setHighlightedNodeIds(new Set());
        } else {
            // Highlight if not
            setHighlightedNodeIds(new Set(nodeIds));
        }
    }, [highlightedNodeIds, setHighlightedNodeIds]);

    const totalCount = processes.cross.length + processes.intra.length;

    // Auto-show combined diagram when panel first loads
    useEffect(() => {
        if (totalCount > 0 && !selectedProcess && loadingProcess === null) {
            // Auto-trigger view all on first load
            handleViewAllProcesses();
        }
    }, [totalCount]); // Only run when totalCount changes from 0

    if (totalCount === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-14 h-14 mb-4 flex items-center justify-center bg-surface rounded-xl">
                    <GitBranch className="w-7 h-7 text-text-muted" />
                </div>
                <h3 className="text-base font-medium text-text-primary mb-2">No Processes Detected</h3>
                <p className="text-sm text-text-secondary max-w-xs">
                    Processes are execution flows traced from entry points. Load a codebase to see detected processes.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header with search */}
            <div className="p-3 border-b border-border-subtle">
                <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-elevated border border-border-subtle rounded-lg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
                        <Search className="w-4 h-4 text-text-muted" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Filter processes..."
                            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted"
                        />
                    </div>
                    <button
                        onClick={handleViewAllProcesses}
                        disabled={totalCount === 0 || loadingProcess !== null}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-purple-300 bg-purple-950/30 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-400/50 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-purple-900/20 whitespace-nowrap"
                    >
                        <Eye className="w-3.5 h-3.5" />
                        View All
                    </button>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>{totalCount} processes detected</span>
                </div>
            </div>

            {/* Process list */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
                {/* Cross-Community Section */}
                {filteredProcesses.cross.length > 0 && (
                    <div className="border-b border-border-subtle">
                        <button
                            onClick={() => toggleSection('cross')}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-hover transition-colors"
                        >
                            {expandedSections.has('cross') ? (
                                <ChevronDown className="w-4 h-4 text-text-muted" />
                            ) : (
                                <ChevronRight className="w-4 h-4 text-text-muted" />
                            )}
                            <Zap className="w-4 h-4 text-amber-400" />
                            <span className="text-sm font-medium text-text-primary">Cross-Community</span>
                            <span className="ml-auto text-xs text-text-muted bg-surface px-2 py-0.5 rounded-full">
                                {filteredProcesses.cross.length}
                            </span>
                        </button>

                        {expandedSections.has('cross') && (
                            <div className="pb-2">
                                {filteredProcesses.cross.map((process) => (
                                    <ProcessItem
                                        key={process.id}
                                        process={process}
                                        isLoading={loadingProcess === process.id}
                                        onView={() => handleViewProcess(process.id, process.label, 'cross_community')}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Intra-Community Section */}
                {filteredProcesses.intra.length > 0 && (
                    <div>
                        <button
                            onClick={() => toggleSection('intra')}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-hover transition-colors"
                        >
                            {expandedSections.has('intra') ? (
                                <ChevronDown className="w-4 h-4 text-text-muted" />
                            ) : (
                                <ChevronRight className="w-4 h-4 text-text-muted" />
                            )}
                            <Home className="w-4 h-4 text-emerald-400" />
                            <span className="text-sm font-medium text-text-primary">Intra-Community</span>
                            <span className="ml-auto text-xs text-text-muted bg-surface px-2 py-0.5 rounded-full">
                                {filteredProcesses.intra.length}
                            </span>
                        </button>

                        {expandedSections.has('intra') && (
                            <div className="pb-2">
                                {filteredProcesses.intra.map((process) => (
                                    <ProcessItem
                                        key={process.id}
                                        process={process}
                                        isLoading={loadingProcess === process.id}
                                        onView={() => handleViewProcess(process.id, process.label, 'intra_community')}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Modal */}
            <ProcessFlowModal
                process={selectedProcess}
                onClose={() => setSelectedProcess(null)}
                onFocusInGraph={handleFocusInGraph}
            />
        </div>
    );
};

// Individual process item
interface ProcessItemProps {
    process: { id: string; label: string; stepCount: number; clusters: string[] };
    isLoading: boolean;
    onView: () => void;
}

const ProcessItem = ({ process, isLoading, onView }: ProcessItemProps) => {
    return (
        <div className="flex items-center gap-2 px-4 py-2 mx-2 rounded-lg hover:bg-hover group transition-colors">
            <GitBranch className="w-4 h-4 text-text-muted flex-shrink-0" />
            <div className="flex-1 min-w-0">
                <div className="text-sm text-text-primary truncate">{process.label}</div>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span>{process.stepCount} steps</span>
                    {process.clusters.length > 0 && (
                        <>
                            <span>•</span>
                            <span>{process.clusters.length} clusters</span>
                        </>
                    )}
                </div>
            </div>
            <button
                onClick={onView}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-cyan-400 hover:text-cyan-300 bg-cyan-950/30 hover:bg-cyan-900/50 border border-cyan-500/30 hover:border-cyan-400/50 rounded-md opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 shadow-sm shadow-cyan-900/20"
            >
                {isLoading ? (
                    <span className="animate-pulse">Loading...</span>
                ) : (
                    <>
                        <Eye className="w-3.5 h-3.5" />
                        View
                    </>
                )}
            </button>
        </div>
    );
};
