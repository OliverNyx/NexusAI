import { Brain, Sparkles, X, Settings } from 'lucide-react';

interface IntelligentClusteringModalProps {
    isOpen: boolean;
    onClose: () => void;
    onEnable: () => void;
    onConfigure: () => void;
}

export const IntelligentClusteringModal = ({
    isOpen,
    onClose,
    onEnable,
    onConfigure
}: IntelligentClusteringModalProps) => {
    if (!isOpen) return null;

    // Parent handles all state updates via onEnable/onConfigure/onClose
    const handleEnable = () => {
        onEnable();
    };

    const handleSkip = () => {
        onClose();
    };


    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={handleSkip}
            />

            {/* Modal Content */}
            <div className="relative bg-surface border border-border-subtle rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header with cool gradient background */}
                <div className="bg-gradient-to-br from-accent/20 to-surface p-6 pb-8 border-b border-border-subtle/50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Brain className="w-32 h-32 rotate-12" />
                    </div>

                    <button
                        onClick={handleSkip}
                        className="absolute top-4 right-4 p-2 text-text-muted hover:text-text-primary rounded-full hover:bg-black/10 transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-3 bg-accent text-white rounded-xl shadow-lg shadow-accent/20">
                            <Sparkles className="w-6 h-6" />
                        </div>
                    </div>

                    <h2 className="text-xl font-bold text-text-primary mt-4">
                        Upgrade to Intelligent Clustering?
                    </h2>
                    <p className="text-text-secondary mt-1 text-sm leading-relaxed">
                        Your clusters are ready, but they could be smarter! Right now they're just named after folders.
                    </p>
                </div>

                {/* Body */}
                <div className="p-6 space-y-6">

                    <div className="space-y-3">
                        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                            <Brain className="w-4 h-4 text-accent" />
                            What you get:
                        </h3>
                        <ul className="space-y-2 text-sm text-text-secondary">
                            <li className="flex items-start gap-2">
                                <span className="text-green-400 mt-1">✓</span>
                                Semantic names (e.g., "Auth System" vs "utils")
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-400 mt-1">✓</span>
                                Search keywords for better agent context
                            </li>
                            <li className="flex items-start gap-2">
                                <span className="text-green-400 mt-1">✓</span>
                                Descriptions of what the code actually does
                            </li>
                        </ul>
                    </div>

                    {/* How it works */}
                    <div className="p-4 bg-elevated/50 border border-border-subtle rounded-xl">
                        <div className="flex items-start gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg text-blue-400">
                                <Brain className="w-4 h-4" />
                            </div>
                            <div>
                                <h4 className="text-sm font-medium text-text-primary">Uses Your Configured LLM</h4>
                                <p className="text-xs text-text-muted mt-1 leading-relaxed">
                                    Runs on your own API key. Very low token usage (~$0.01 for most codebases).
                                    <br />
                                    <span className="text-amber-400">💡 Tip:</span> Use a cheaper model like GPT-4o-mini in settings!
                                </p>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Actions */}
                <div className="p-6 pt-2 bg-surface flex flex-col gap-3">
                    <button
                        onClick={handleEnable}
                        className="w-full py-3 px-4 bg-accent text-white font-medium rounded-xl hover:bg-accent-dim shadow-lg shadow-accent/20 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                        <Sparkles className="w-4 h-4" />
                        Enable Smart Clustering
                    </button>

                    <div className="flex bg-elevated rounded-xl p-1 gap-1">
                        <button
                            onClick={onConfigure}
                            className="flex-1 py-2 px-3 text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-hover rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <Settings className="w-3 h-3" />
                            Configure Model
                        </button>
                        <div className="w-px bg-border-subtle my-2" />
                        <button
                            onClick={handleSkip}
                            className="flex-1 py-2 px-3 text-sm font-medium text-text-muted hover:text-text-primary hover:bg-hover rounded-lg transition-colors"
                        >
                            No thanks (Free)
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
};
