import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    primaryColor: '#06b6d4',
    primaryTextColor: '#e4e4ed',
    primaryBorderColor: '#1e1e2a',
    lineColor: '#3b3b54',
    secondaryColor: '#1e1e2a',
    tertiaryColor: '#0a0a10',
    background: '#0a0a10',
    mainBkg: '#0f0f18',
    nodeBorder: '#3b3b54',
    clusterBkg: '#1e1e2a',
    titleColor: '#e4e4ed',
    edgeLabelBackground: '#0f0f18',
    nodeTextColor: '#e4e4ed',
  },
  flowchart: {
    curve: 'basis',
    padding: 15,
    nodeSpacing: 50,
    rankSpacing: 50,
  },
  sequence: {
    actorMargin: 50,
    boxMargin: 10,
    boxTextMargin: 5,
    noteMargin: 10,
    messageMargin: 35,
  },
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 13,
  suppressErrorRendering: true, // Prevent default error div appending
});

// Override the default error handler to prevent it from logging to UI
mermaid.parseError = (_err) => {
  // Silent catch
};

interface MermaidDiagramProps {
  code: string;
}

export const MermaidDiagram = ({ code }: MermaidDiagramProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [svg, setSvg] = useState<string>('');

  useEffect(() => {
    const renderDiagram = async () => {
      if (!containerRef.current) return;

      try {
        // Generate unique ID for this diagram
        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(id, code.trim());
        setSvg(renderedSvg);
        setError(null);
      } catch (err) {
        // Silent catch for streaming: 
        // If render fails (common during partial streaming), we:
        // 1. Log to console for debugging
        // 2. Do NOT set error state (avoids flashing red box)
        // 3. Do NOT clear existing SVG (keeps last valid state visible)
        console.debug('Mermaid render skipped (incomplete):', err);
      }
    };

    // Debounce rendering to prevent "jerking" during high-speed streaming
    const timeoutId = setTimeout(() => {
      renderDiagram();
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [code]);

  if (error) {
    return (
      <div className="my-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg">
        <div className="flex items-center gap-2 text-rose-300 text-sm mb-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-medium">Diagram Error</span>
        </div>
        <pre className="text-xs text-rose-200/70 font-mono whitespace-pre-wrap">{error}</pre>
        <details className="mt-2">
          <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
            Show source
          </summary>
          <pre className="mt-2 p-2 bg-surface rounded text-xs text-text-muted overflow-x-auto">
            {code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className={`my-3 relative group ${isExpanded ? 'fixed inset-4 z-50' : ''}`}>
      {/* Backdrop for expanded view */}
      {isExpanded && (
        <div
          className="absolute inset-0 -m-4 bg-deep/95 backdrop-blur-sm"
          onClick={() => setIsExpanded(false)}
        />
      )}

      <div className={`
        relative bg-gradient-to-b from-surface to-elevated 
        border border-border-subtle rounded-xl overflow-hidden
        ${isExpanded ? 'h-full' : ''}
      `}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-surface/60 border-b border-border-subtle">
          <span className="text-[10px] text-text-muted uppercase tracking-wider font-medium">
            Diagram
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-text-muted hover:text-text-primary hover:bg-hover rounded transition-colors"
            title={isExpanded ? 'Minimize' : 'Expand'}
          >
            {isExpanded ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {/* Diagram container */}
        <div
          ref={containerRef}
          className={`
            flex items-center justify-center p-4 overflow-auto
            ${isExpanded ? 'h-[calc(100%-40px)]' : 'max-h-[400px]'}
          `}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>
  );
};

