import { useState, useCallback, DragEvent } from 'react';
import { Upload, FileArchive } from 'lucide-react';

interface DropZoneProps {
  onFileSelect: (file: File) => void;
}

export const DropZone = ({ onFileSelect }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.zip')) {
        onFileSelect(file);
      } else {
        alert('Please drop a .zip file');
      }
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.zip')) {
        onFileSelect(file);
      } else {
        alert('Please select a .zip file');
      }
    }
  }, [onFileSelect]);

  return (
    <div className="flex items-center justify-center min-h-screen p-8 bg-void">
      {/* Background gradient effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-node-interface/10 rounded-full blur-3xl" />
      </div>

      <div
        className={`
          relative w-full max-w-lg p-16 
          bg-surface border-2 border-dashed rounded-3xl
          transition-all duration-300 cursor-pointer
          ${isDragging 
            ? 'border-accent bg-elevated scale-105 shadow-glow' 
            : 'border-border-default hover:border-accent/50 hover:bg-elevated/50 animate-breathe'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".zip"
          className="hidden"
          onChange={handleFileInput}
        />

        {/* Icon */}
        <div className={`
          mx-auto w-20 h-20 mb-6
          flex items-center justify-center
          bg-gradient-to-br from-accent to-node-interface
          rounded-2xl shadow-glow
          transition-transform duration-300
          ${isDragging ? 'scale-110' : ''}
        `}>
          {isDragging ? (
            <Upload className="w-10 h-10 text-white" />
          ) : (
            <FileArchive className="w-10 h-10 text-white" />
          )}
        </div>

        {/* Text */}
        <h2 className="text-xl font-semibold text-text-primary text-center mb-2">
          {isDragging ? 'Drop it here!' : 'Drop your codebase'}
        </h2>
        <p className="text-sm text-text-secondary text-center mb-6">
          Drag & drop a .zip file to generate a knowledge graph
        </p>

        {/* Hints */}
        <div className="flex items-center justify-center gap-3 text-xs text-text-muted">
          <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
            .zip
          </span>
          <span className="px-3 py-1.5 bg-elevated border border-border-subtle rounded-md">
            up to 50MB
          </span>
        </div>
      </div>
    </div>
  );
};

